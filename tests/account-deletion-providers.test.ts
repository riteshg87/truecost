import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";

const modules = {
  "./accountDeletion.ts": async () => import("../convex/accountDeletion"),
  "./accountDeletionProviders.ts": async () => import("../convex/accountDeletionProviders"),
  "./privacyGrants.ts": async () => import("../convex/privacyGrants"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};
const issueGrant = makeFunctionReference<"mutation">("privacyGrants:issueVerifiedGrant");
const requestDeletion = makeFunctionReference<"mutation">("accountDeletion:requestDeletion");
const claimProvider = makeFunctionReference<"mutation">("accountDeletionProviders:claimProvider");
const executeProvider = makeFunctionReference<"action">("accountDeletionProviders:executeProvider");
const finalizeProvider = makeFunctionReference<"mutation">("accountDeletionProviders:finalizeProvider");
const identity = { issuer: "https://issuer.example", subject: "owner-a", sid: "session-a", tokenIdentifier: "https://issuer.example|owner-a" };
const id = (n: number) => `123e4567-e89b-42d3-a456-${String(426614170000 + n).padStart(12, "0")}`;

// Resolve cold module imports before the bounded fake-timer scheduler pump.
// Keep deletion behavior and completion assertions unchanged.
beforeAll(async () => {
  await Promise.all(Object.values(modules).map((load) => load()));
  await import("../convex/accountDeletionStatus");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function fixture(withAnalytics = true) {
  vi.stubEnv("TRUECOST_PRIVACY_AUDIENCE", "truecost_test");
  vi.stubEnv("TRUECOST_MIXPANEL_PROJECT_TOKEN", "project-token");
  vi.stubEnv("TRUECOST_MIXPANEL_PRIVACY_API_TOKEN", "privacy-token");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_private");
  const t = convexTest({ schema, modules: { ...modules, "./accountDeletionStatus.ts": async () => import("../convex/accountDeletionStatus") } });
  const now = Date.now();
  const ownerId = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { authKey: identity.tokenIdentifier, clerkSubject: identity.subject, status: "active", createdAt: now, updatedAt: now });
    if (withAnalytics) await ctx.db.insert("analyticsPreferences", { ownerId, consent: "accepted", policyVersion: "v1", revision: 1, analyticsAccountId: "analytics-owner-a", updatedAt: now });
    return ownerId;
  });
  const nowSeconds = Math.floor(now / 1000);
  const grant = await t.run((ctx) => ctx.db.insert("sensitiveGrants", {
    ownerId, subject: identity.subject, sessionId: identity.sid, audience: "truecost_test", purpose: "account_delete", nonce: id(1), issuedAt: nowSeconds - 1, expiresAt: nowSeconds + 60, consumedAt: null,
  }));
  return { t, account: t.withIdentity(identity), ownerId, grant };
}

describe("durable provider deletion orchestration", () => {
  it("persists the Mixpanel tracking ID, polls for exact success, then deletes Clerk last", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", results: [{ status: "PENDING", tracking_id: "task-123" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", results: { status: "SUCCESS" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "owner-a", deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const { t, account, grant, ownerId } = await fixture();
    const accepted = await account.mutation(requestDeletion, { grantId: grant, requestId: id(2) });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    vi.advanceTimersByTime(60_001);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    await expect(t.run((ctx) => ctx.db.get(accepted.jobId))).resolves.toMatchObject({ status: "completed", providerStage: "complete", providerTrackingId: "task-123" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "GET" });
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
    expect(await t.run((ctx) => ctx.db.get(ownerId))).toMatchObject({ status: "deleting" });
  });

  it("skips Mixpanel only when the deletion request copied an explicit null identifier", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "owner-a", deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const { t, account, grant } = await fixture(false);
    const accepted = await account.mutation(requestDeletion, { grantId: grant, requestId: id(3) });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    await expect(t.run((ctx) => ctx.db.get(accepted.jobId))).resolves.toMatchObject({ status: "completed", providerStage: "complete", providerTrackingId: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });

  it("leaves the blocked owner pending with sanitized configuration state", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { t, account, grant, ownerId } = await fixture();
    vi.stubEnv("TRUECOST_MIXPANEL_PROJECT_TOKEN", "");
    vi.stubEnv("TRUECOST_MIXPANEL_PRIVACY_API_TOKEN", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    const accepted = await account.mutation(requestDeletion, { grantId: grant, requestId: id(4) });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    await expect(t.run((ctx) => ctx.db.get(accepted.jobId))).resolves.toMatchObject({ status: "providers_pending", providerStage: "manual_review", providerCode: "configuration" });
    await expect(t.run((ctx) => ctx.db.get(ownerId))).resolves.toMatchObject({ status: "deleting" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fences an interrupted Mixpanel create after lease expiry without issuing a duplicate POST", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { t, ownerId, grant } = await fixture();
    const now = Date.now();
    const jobId = await t.run((ctx) => ctx.db.insert("accountDeletionJobs", {
      ownerId, requestId: id(5), grantId: grant, subject: "owner-a", sessionId: "session-a", purpose: "account_delete", analyticsAccountId: "analytics-owner-a",
      status: "providers_pending", stage: "providers", purgeTable: null, purgeCursor: null, leaseUntil: null, attemptToken: null, attemptNumber: 0,
      providerStage: "mixpanel_create_pending", providerTrackingId: null, providerLeaseUntil: null, providerAttemptToken: null, providerAttemptNumber: 0,
      providerRetryCount: 0, providerLastRetryCode: null, providerPollCount: 0, providerPendingSince: null, providerNextAttemptAt: null, createdAt: now, updatedAt: now,
    }));
    const first = await t.mutation(claimProvider, { jobId });
    if (first.status !== "claimed" || !first.attemptToken) throw new Error("provider claim did not succeed");
    vi.advanceTimersByTime(30_001);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    await expect(t.action(executeProvider, { jobId, attemptToken: first.attemptToken })).resolves.toEqual({ status: "ignored" });
    await expect(t.run((ctx) => ctx.db.get(jobId))).resolves.toMatchObject({ providerStage: "manual_review", providerCode: "ambiguous", providerAttemptToken: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a Clerk 404 only when the exact BAPI missing-user error names that subject", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ code: "resource_not_found", message: "not found", long_message: "No user was found with id owner-a" }] }), { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    const { t, account, grant } = await fixture(false);
    const accepted = await account.mutation(requestDeletion, { grantId: grant, requestId: id(6) });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    await expect(t.run((ctx) => ctx.db.get(accepted.jobId))).resolves.toMatchObject({ status: "completed", providerStage: "complete" });
  });

  it("returns a retryable Mixpanel 429 claim to create_pending with exponential retry state", async () => {
    vi.useFakeTimers();
    const { t, ownerId, grant } = await fixture();
    const now = Date.now();
    const jobId = await t.run((ctx) => ctx.db.insert("accountDeletionJobs", {
      ownerId, requestId: id(7), grantId: grant, subject: "owner-a", sessionId: "session-a", purpose: "account_delete", analyticsAccountId: "analytics-owner-a",
      status: "providers_pending", stage: "providers", purgeTable: null, purgeCursor: null, leaseUntil: now + 30_000, attemptToken: null, attemptNumber: 0,
      providerStage: "mixpanel_create_in_flight", providerTrackingId: null, providerLeaseUntil: now + 30_000, providerAttemptToken: "old-token", providerAttemptNumber: 1,
      providerRetryCount: 0, providerLastRetryCode: null, providerPollCount: 0, providerPendingSince: null, providerNextAttemptAt: null, createdAt: now, updatedAt: now,
    }));
    await expect(t.mutation(finalizeProvider, { jobId, attemptToken: "old-token", result: { status: "retry", code: "rate_limited", retryAfterMs: 1_000 } })).resolves.toEqual({ status: "applied" });
    const first = await t.run((ctx) => ctx.db.get(jobId));
    expect(first).toMatchObject({ providerStage: "mixpanel_create_pending", providerRetryCount: 1, providerLastRetryCode: "rate_limited" });
    expect(first?.providerNextAttemptAt).toBe(now + 1_000);

    await t.run((ctx) => ctx.db.patch(jobId, { providerStage: "mixpanel_create_in_flight", providerAttemptToken: "new-token", providerLeaseUntil: Date.now() + 30_000 }));
    await expect(t.mutation(finalizeProvider, { jobId, attemptToken: "new-token", result: { status: "retry", code: "rate_limited", retryAfterMs: 1_000 } })).resolves.toEqual({ status: "applied" });
    const second = await t.run((ctx) => ctx.db.get(jobId));
    expect(second?.providerRetryCount).toBe(2);
    expect(second?.providerNextAttemptAt).toBe(now + 2_000);

    await t.run((ctx) => ctx.db.patch(jobId, { providerStage: "mixpanel_create_in_flight", providerAttemptToken: "cap-token", providerLeaseUntil: Date.now() + 30_000 }));
    await expect(t.mutation(finalizeProvider, { jobId, attemptToken: "cap-token", result: { status: "retry", code: "server_error", retryAfterMs: 24 * 60 * 60 * 1_000 } })).resolves.toEqual({ status: "applied" });
    const capped = await t.run((ctx) => ctx.db.get(jobId));
    expect(capped?.providerNextAttemptAt).toBe(now + 24 * 60 * 60 * 1_000);

    await t.run((ctx) => ctx.db.patch(jobId, { providerStage: "clerk_pending", providerAttemptToken: "newest-token", providerLeaseUntil: Date.now() + 30_000 }));
    await expect(t.mutation(finalizeProvider, { jobId, attemptToken: "cap-token", result: { status: "success", trackingId: null } })).resolves.toEqual({ status: "ignored" });
    await expect(t.run((ctx) => ctx.db.get(jobId))).resolves.toMatchObject({ providerStage: "clerk_pending", providerAttemptToken: "newest-token" });
  });

  it("uses increasing poll delays and turns an over-age pending task into manual review", async () => {
    vi.useFakeTimers();
    const { t, ownerId, grant } = await fixture();
    const now = Date.now();
    const jobId = await t.run((ctx) => ctx.db.insert("accountDeletionJobs", {
      ownerId, requestId: id(8), grantId: grant, subject: "owner-a", sessionId: "session-a", purpose: "account_delete", analyticsAccountId: "analytics-owner-a",
      status: "providers_pending", stage: "providers", purgeTable: null, purgeCursor: null, leaseUntil: null, attemptToken: null, attemptNumber: 0,
      providerStage: "mixpanel_poll_pending", providerTrackingId: "task-123", providerLeaseUntil: now + 30_000, providerAttemptToken: "poll-one", providerAttemptNumber: 1,
      providerRetryCount: 0, providerLastRetryCode: null, providerPollCount: 0, providerPendingSince: now, providerNextAttemptAt: null, createdAt: now, updatedAt: now,
    }));
    await expect(t.mutation(finalizeProvider, { jobId, attemptToken: "poll-one", result: { status: "pending", trackingId: "task-123" } })).resolves.toEqual({ status: "applied" });
    const firstPoll = await t.run((ctx) => ctx.db.get(jobId));
    expect(firstPoll).toMatchObject({ providerPollCount: 1, providerStage: "mixpanel_poll_pending" });
    if (!firstPoll || firstPoll.updatedAt === undefined || firstPoll.providerNextAttemptAt === undefined) throw new Error("first poll state missing");
    expect(firstPoll.providerNextAttemptAt).toBe(firstPoll.updatedAt + 5 * 60_000);

    await t.run((ctx) => ctx.db.patch(jobId, { providerAttemptToken: "poll-two", providerLeaseUntil: Date.now() + 30_000, providerPollCount: 1 }));
    await expect(t.mutation(finalizeProvider, { jobId, attemptToken: "poll-two", result: { status: "pending", trackingId: "task-123" } })).resolves.toEqual({ status: "applied" });
    const secondPoll = await t.run((ctx) => ctx.db.get(jobId));
    expect(secondPoll?.providerPollCount).toBe(2);
    if (!secondPoll || secondPoll.updatedAt === undefined || secondPoll.providerNextAttemptAt === undefined) throw new Error("second poll state missing");
    expect(secondPoll.providerNextAttemptAt).toBe(secondPoll.updatedAt + 60 * 60_000);

    await t.run((ctx) => ctx.db.patch(jobId, { providerAttemptToken: "poll-old", providerLeaseUntil: Date.now() + 30_000, providerPendingSince: now - (30 * 24 * 60 * 60 * 1_000 + 1) }));
    await expect(t.mutation(finalizeProvider, { jobId, attemptToken: "poll-old", result: { status: "pending", trackingId: "task-123" } })).resolves.toEqual({ status: "applied" });
    await expect(t.run((ctx) => ctx.db.get(jobId))).resolves.toMatchObject({ providerStage: "manual_review", providerCode: "provider_failure", providerNextAttemptAt: null, providerAttemptToken: null });
  });

  it("uses a distinct monotonic fence for immediate successive claims", async () => {
    vi.useFakeTimers();
    const { t, ownerId, grant } = await fixture(false);
    const now = Date.now();
    const jobId = await t.run((ctx) => ctx.db.insert("accountDeletionJobs", {
      ownerId, requestId: id(9), grantId: grant, subject: "owner-a", sessionId: "session-a", purpose: "account_delete", analyticsAccountId: null,
      status: "providers_pending", stage: "providers", purgeTable: null, purgeCursor: null, leaseUntil: null, attemptToken: null, attemptNumber: 0,
      providerStage: "clerk_pending", providerTrackingId: null, providerLeaseUntil: null, providerAttemptToken: null, providerAttemptNumber: 0,
      providerRetryCount: 0, providerLastRetryCode: null, providerPollCount: 0, providerPendingSince: null, providerNextAttemptAt: null, createdAt: now, updatedAt: now,
    }));
    const first = await t.mutation(claimProvider, { jobId });
    if (first.status !== "claimed" || !first.attemptToken) throw new Error("first provider claim did not succeed");
    await expect(t.mutation(finalizeProvider, { jobId, attemptToken: first.attemptToken, result: { status: "retry", code: "network", retryAfterMs: 1 } })).resolves.toEqual({ status: "applied" });
    await t.run((ctx) => ctx.db.patch(jobId, { providerStage: "clerk_pending", providerNextAttemptAt: null }));
    const second = await t.mutation(claimProvider, { jobId });
    expect(second.status).toBe("claimed");
    expect(second.attemptToken).toBe(`${jobId}:provider:2`);
    expect(second.attemptToken).not.toBe(first.attemptToken);
  });
});
