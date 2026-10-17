import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";

const modules = {
  "./accountDeletion.ts": async () => import("../convex/accountDeletion"),
  "./accountDeletionProviders.ts": async () => import("../convex/accountDeletionProviders"),
  "./privacyGrants.ts": async () => import("../convex/privacyGrants"),
  "./savedLoans.ts": async () => import("../convex/savedLoans"),
  "./feedback.ts": async () => import("../convex/feedback"),
  "./analytics.ts": async () => import("../convex/analytics"),
  "./users.ts": async () => import("../convex/users"),
  "./comparisons.ts": async () => import("../convex/comparisons"),
  "./accountExports.ts": async () => import("../convex/accountExports"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};

const issueGrant = makeFunctionReference<"mutation">("privacyGrants:issueVerifiedGrant");
const requestDeletion = makeFunctionReference<"mutation">("accountDeletion:requestDeletion");
const currentLoan = makeFunctionReference<"query">("savedLoans:currentLoan");
const getPreference = makeFunctionReference<"query">("analytics:getPreference");
const setPreference = makeFunctionReference<"mutation">("analytics:setPreference");
const submitFeedback = makeFunctionReference<"mutation">("feedback:submitFeedback");
const ensureCurrentUser = makeFunctionReference<"mutation">("users:ensureCurrentUser");
const listComparisons = makeFunctionReference<"query">("comparisons:listComparisons");
const getComparison = makeFunctionReference<"query">("comparisons:getComparison");
const saveComparison = makeFunctionReference<"mutation">("comparisons:saveComparison");
const saveLoan = makeFunctionReference<"mutation">("savedLoans:saveLoan");
const beginExport = makeFunctionReference<"mutation">("accountExports:beginExport");
const pageExport = makeFunctionReference<"mutation">("accountExports:pageComparisons");
const claimPurge = makeFunctionReference<"mutation">("accountDeletion:claimPurge");
const purgeAccountData = makeFunctionReference<"mutation">("accountDeletion:purgeAccountData");

const audience = "truecost_test";
const id = (n: number) => `123e4567-e89b-42d3-a456-${String(426614170000 + n).padStart(12, "0")}`;
const identity = (subject: string, sid: string) => ({
  issuer: "https://issuer.example",
  subject,
  sid,
  tokenIdentifier: `https://issuer.example|${subject}`,
});

// Resolve cold module imports before the bounded fake-timer scheduler pump.
// Keep deletion behavior and completion assertions unchanged.
beforeAll(async () => {
  await Promise.all(Object.values(modules).map((load) => load()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function fixture() {
  vi.stubEnv("TRUECOST_PRIVACY_AUDIENCE", audience);
  const t = convexTest({ schema, modules });
  const ownerId = await t.run((ctx) => ctx.db.insert("users", {
    authKey: "https://issuer.example|owner-a",
    clerkSubject: "owner-a",
    status: "active",
    exportRevision: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
  const account = t.withIdentity(identity("owner-a", "session-a"));
  const now = Math.floor(Date.now() / 1000);
  const grant = await account.mutation(issueGrant, {
    authKey: "https://issuer.example|owner-a",
    subject: "owner-a",
    sessionId: "session-a",
    audience,
    purpose: "account_delete",
    nonce: id(1),
    issuedAt: now - 1,
    expiresAt: now + 60,
  });
  return { t, account, ownerId, grant };
}

describe("account deletion application foundation", () => {
  it("retains the provider deletion identifier after analytics consent is withdrawn", async () => {
    vi.useFakeTimers();
    const { t, account, ownerId, grant } = await fixture();
    await t.run((ctx) => ctx.db.insert("analyticsPreferences", {
      ownerId, consent: "accepted", policyVersion: "v1", revision: 1,
      analyticsAccountId: "synthetic-previously-consented", updatedAt: Date.now(),
    }));
    const withdrawn = await account.mutation(setPreference, {
      consent: "declined", policyVersion: "v1", expectedRevision: 1,
    });
    expect(withdrawn).toMatchObject({ consent: "declined", analyticsAccountId: null, sendPermission: false });
    const accepted = await account.mutation(requestDeletion, { grantId: grant._id, requestId: id(90) });
    const job = await t.run((ctx) => ctx.db.get(accepted.jobId));
    expect(job).toMatchObject({
      analyticsAccountId: "synthetic-previously-consented",
      providerStage: "mixpanel_create_pending",
    });
  });

  it("requires a verified subject, token identifier, sid and matching delete grant", async () => {
    const { t, account, grant, ownerId } = await fixture();
    await expect(t.withIdentity(identity("owner-a", "other-session")).mutation(requestDeletion, { grantId: grant._id, requestId: id(2) })).rejects.toThrow(/binding|grant/i);
    await expect(t.withIdentity(identity("owner-b", "session-b")).mutation(requestDeletion, { grantId: grant._id, requestId: id(3) })).rejects.toThrow(/grant|account/i);
    await expect(t.withIdentity({ issuer: "https://issuer.example", subject: "owner-a", tokenIdentifier: "https://issuer.example|owner-a" }).mutation(requestDeletion, { grantId: grant._id, requestId: id(4) })).rejects.toThrow(/authentication/i);
    await expect(t.run((ctx) => ctx.db.get(ownerId))).resolves.toMatchObject({ status: "active" });
  });

  it("blocks existing private reads immediately and replays a lost response after deletion", async () => {
    vi.useFakeTimers();
    const { t, account, ownerId, grant } = await fixture();
    const requestId = id(10);
    const exportSessionId = await t.run((ctx) => ctx.db.insert("exportSessions", {
      ownerId,
      requestId: id(9),
      clerkSessionId: "session-a",
      grantId: grant._id,
      expectedRevision: 0,
      cutoffAt: Date.now(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      status: "active",
    }));
    const comparisonId = await t.run((ctx) => ctx.db.insert("comparisons", {
      ownerId, resultId: id(13), requestId: id(17), snapshot: "{}", payloadHash: "hash", title: null,
      source: "member", createdAt: new Date().toISOString(), calculationVersion: "v1", reviewAfter: Date.now() + 1_000,
    }));
    const alternateGrantId = await t.run((ctx) => ctx.db.insert("sensitiveGrants", {
      ownerId,
      subject: "owner-a",
      sessionId: "session-a",
      audience,
      purpose: "account_delete",
      nonce: id(40),
      issuedAt: Math.floor(Date.now() / 1000) - 1,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      consumedAt: null,
    }));
    const accepted = await account.mutation(requestDeletion, { grantId: grant._id, requestId });
    expect(accepted).toMatchObject({ status: "accepted", jobStatus: "app_pending", requestId });
    await expect(account.query(currentLoan, {})).rejects.toThrow(/unauthorized|profile unavailable/i);
    await expect(account.query(getPreference, {})).rejects.toThrow(/profile unavailable|authenticated/i);
    await expect(account.mutation(ensureCurrentUser, {})).rejects.toThrow(/profile unavailable|authenticated/i);
    await expect(account.query(listComparisons, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow(/profile unavailable|authenticated|unauthorized/i);
    await expect(account.query(getComparison, { comparisonId })).rejects.toThrow(/profile unavailable|authenticated|unauthorized/i);
    await expect(account.mutation(saveComparison, { requestId: id(14), snapshot: "{}", createdAt: new Date().toISOString(), title: null, source: "member" })).rejects.toThrow(/profile unavailable|unauthorized/i);
    await expect(account.mutation(saveLoan, {
      requestId: id(15), expectedRevision: 0, createdAt: new Date().toISOString(),
      payload: {
        loan: { lender: "Synthetic", original: 100, outstanding: 90, ratePct: 8, basis: "repo", spreadPct: null, cycle: "monthly", lastReset: "2026-01-01", monthsLeft: 12 },
        quote: { newRatePct: 7, feePct: 1, legalCharges: 0, keepTenure: true, newTenureMonths: 12 }, surplus: 0, bufferMonths: 0, rateResolvedAt: null,
      },
    })).rejects.toThrow(/profile unavailable|unauthorized/i);
    await expect(account.mutation(submitFeedback, {
      requestId: id(11), feature: "comparison", contextId: id(12), contextVersion: "v1", answer: "yes", comment: null,
    })).rejects.toThrow(/profile unavailable|unauthorized/i);
    await expect(account.mutation(beginExport, { grantId: grant._id, requestId: id(16) })).rejects.toThrow(/account unavailable|authentication/i);
    await expect(account.mutation(pageExport, { sessionId: exportSessionId, paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow(/account unavailable|authentication/i);

    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    await expect(account.mutation(requestDeletion, { grantId: grant._id, requestId })).resolves.toMatchObject({ status: "replayed", jobId: accepted.jobId });
    await expect(account.mutation(requestDeletion, { grantId: alternateGrantId, requestId })).rejects.toThrow(/binding/i);
    await expect(t.run((ctx) => ctx.db.get(ownerId))).resolves.toMatchObject({ status: "deleting" });
    await expect(t.run((ctx) => ctx.db.query("accountDeletionJobs").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(10))).resolves.toHaveLength(1);
  });

  it("purges each owner table in indexed bounded work and stops at providers_pending", async () => {
    vi.useFakeTimers();
    const { t, account, ownerId, grant } = await fixture();
    const now = Date.now();
    const foreignOwnerId = await t.run(async (ctx) => {
      const foreignOwnerId = await ctx.db.insert("users", { authKey: "https://issuer.example|owner-b", clerkSubject: "owner-b", status: "active", exportRevision: 0, createdAt: now, updatedAt: now });
      await ctx.db.insert("comparisons", {
        ownerId: foreignOwnerId, resultId: id(3999), requestId: id(4999), snapshot: "{}", payloadHash: "hash", title: null,
        source: "member", createdAt: new Date(now).toISOString(), calculationVersion: "v1", reviewAfter: now + 1_000,
      });
      for (let n = 0; n < 205; n++) await ctx.db.insert("comparisons", {
        ownerId, resultId: id(1000 + n), requestId: id(2000 + n), snapshot: "{}", payloadHash: "hash", title: null,
        source: "member", createdAt: new Date(now + n).toISOString(), calculationVersion: "v1", reviewAfter: now + 1_000,
      });
      await ctx.db.insert("savedLoans", {
        ownerId, loan: { lender: "Synthetic", original: 100, outstanding: 90, ratePct: 8, basis: "repo", spreadPct: null, cycle: "monthly", lastReset: "2026-01-01", monthsLeft: 12 },
        quote: { newRatePct: 7, feePct: 1, legalCharges: 0, keepTenure: true, newTenureMonths: 12 }, surplus: 0, bufferMonths: 0, rateResolvedAt: null, revision: 1, updatedAt: now,
      });
      await ctx.db.insert("feedback", { ownerId, requestId: id(3000), feature: "comparison", contextId: id(3001), contextVersion: "v1", answer: "yes", comment: null, payloadHash: "hash", createdAt: now });
      await ctx.db.insert("feedbackDismissals", { ownerId, requestId: id(3002), feature: "loan_health", contextId: id(3003), contextVersion: "v1", payloadHash: "hash", createdAt: now });
      await ctx.db.insert("comparisonRateLimits", { ownerId, successfulAt: [now] });
      await ctx.db.insert("feedbackRateLimits", { ownerId, successfulAt: [now] });
      await ctx.db.insert("analyticsPreferences", { ownerId, consent: "accepted", policyVersion: "v1", revision: 1, analyticsAccountId: "analytics-synthetic", updatedAt: now });
      await ctx.db.insert("operationReceipts", { ownerId, requestId: id(3500), kind: "save", resourceKey: "savedLoan", payloadHash: "hash", expectedRevision: 0, revision: 1, status: "saved", createdAt: now, reviewAfter: now + 1_000 });
      await ctx.db.insert("comparisonReceipts", { ownerId, requestId: id(3501), kind: "save", resultId: id(3502), comparisonId: null, createdAt: new Date(now).toISOString(), serverHash: "hash", status: "saved", reviewAfter: now + 1_000 });
      await ctx.db.insert("recordTombstones", { ownerId, entityKind: "savedLoan", entityKey: "singleton", revision: 1, deletedAt: now, reviewAfter: now + 1_000 });
      await ctx.db.insert("comparisonTombstones", { ownerId, resultId: id(3503), deletedAt: now, reviewAfter: now + 1_000 });
      await ctx.db.insert("exportSessions", { ownerId, requestId: id(3504), clerkSessionId: "session-a", grantId: grant._id, expectedRevision: 0, cutoffAt: now, createdAt: now, expiresAt: now + 60_000, status: "active" });
      return foreignOwnerId;
    });

    const accepted = await account.mutation(requestDeletion, { grantId: grant._id, requestId: id(20) });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(0));
    expect(await t.run((ctx) => ctx.db.query("comparisons").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("savedLoans").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("feedback").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("analyticsPreferences").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("operationReceipts").withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("comparisonReceipts").withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("recordTombstones").withIndex("by_owner_entity", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("comparisonTombstones").withIndex("by_owner_resultId", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("exportSessions").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("sensitiveGrants").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("comparisons").withIndex("by_owner", (q) => q.eq("ownerId", foreignOwnerId)).take(1))).toHaveLength(1);
    await expect(t.run((ctx) => ctx.db.get(accepted.jobId))).resolves.toMatchObject({ status: "providers_pending", stage: "providers", analyticsAccountId: "analytics-synthetic" });
  });

  it("creates one durable owner job under concurrent duplicate submissions", async () => {
    const { t, account, ownerId, grant } = await fixture();
    const requestId = id(30);
    const results = await Promise.allSettled([
      account.mutation(requestDeletion, { grantId: grant._id, requestId }),
      account.mutation(requestDeletion, { grantId: grant._id, requestId }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(await t.run((ctx) => ctx.db.query("accountDeletionJobs").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(10))).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("sensitiveGrants").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(10))).toHaveLength(1);
  });

  it("reclaims an expired lease, fences the stale worker, and increments attempts at one timestamp", async () => {
    vi.useFakeTimers();
    const { t, ownerId, grant } = await fixture();
    const now = Date.now();
    const jobId = await t.run((ctx) => ctx.db.insert("accountDeletionJobs", {
      ownerId,
      requestId: id(50),
      grantId: grant._id,
      subject: "owner-a",
      sessionId: "session-a",
      purpose: "account_delete",
      analyticsAccountId: null,
      status: "app_pending",
      stage: "purge",
      purgeTable: "savedLoans",
      purgeCursor: null,
      leaseUntil: null,
      attemptToken: null,
      attemptNumber: 0,
      createdAt: now,
      updatedAt: now,
    }));
    const first = await t.mutation(claimPurge, { jobId });
    expect(first.status).toBe("claimed");
    if (first.status !== "claimed") throw new Error("initial claim did not succeed");
    vi.advanceTimersByTime(30_001);
    const second = await t.mutation(claimPurge, { jobId });
    expect(second.status).toBe("claimed");
    if (second.status !== "claimed") throw new Error("watchdog claim did not succeed");
    expect(second.attemptToken).not.toBe(first.attemptToken);
    await expect(t.mutation(purgeAccountData, { jobId, attemptToken: first.attemptToken })).resolves.toEqual({ status: "ignored", deleted: 0 });
    await expect(t.mutation(purgeAccountData, { jobId, attemptToken: second.attemptToken })).resolves.toMatchObject({ status: "purged" });
    const third = await t.mutation(claimPurge, { jobId });
    expect(third.status).toBe("claimed");
    if (third.status !== "claimed") throw new Error("next batch claim did not succeed");
    expect(third.attemptToken).not.toBe(second.attemptToken);
    await expect(t.run((ctx) => ctx.db.get(jobId))).resolves.toMatchObject({ attemptNumber: 3, purgeTable: "comparisons" });
  });
});
