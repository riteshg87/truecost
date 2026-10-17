import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { consumeSensitiveGrant } from "../convex/privacyGrants";

const modules = {
  "./accountExports.ts": async () => import("../convex/accountExports"),
  "./privacyGrants.ts": async () => import("../convex/privacyGrants"),
  "./feedback.ts": async () => import("../convex/feedback"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};
const issue = makeFunctionReference<"mutation">("privacyGrants:issueVerifiedGrant");
const begin = makeFunctionReference<"mutation">("accountExports:beginExport");
const page = makeFunctionReference<"mutation">("accountExports:pageComparisons");
const finalize = makeFunctionReference<"mutation">("accountExports:finalizeExport");
const submitFeedback = makeFunctionReference<"mutation">("feedback:submitFeedback");
const identity = (subject: string, sid: string) => ({ subject, sid, issuer: "https://issuer.example", tokenIdentifier: `https://issuer.example|${subject}` });
const requestId = "123e4567-e89b-42d3-a456-426614174000";

beforeEach(() => vi.stubEnv("TRUECOST_PRIVACY_AUDIENCE", "truecost_dev"));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

async function fixture() {
  const t = convexTest({ schema, modules });
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { authKey: "https://issuer.example|user-a", clerkSubject: "user-a", status: "active", exportRevision: 0, createdAt: Date.now(), updatedAt: Date.now() }));
  const account = t.withIdentity(identity("user-a", "session-a"));
  const now = Math.floor(Date.now() / 1000);
  const grant = await account.mutation(issue, { authKey: "https://issuer.example|user-a", subject: "user-a", sessionId: "session-a", audience: "truecost_dev", purpose: "account_export", nonce: "123e4567-e89b-42d3-a456-426614174001", issuedAt: now - 1, expiresAt: now + 60 });
  return { t, account, ownerId, grant };
}
const pagination = { numItems: 50, cursor: null };

describe("account export revision fencing", () => {
  it("is owner and session bound, and begin replay returns the same session", async () => {
    const { t, account, grant } = await fixture();
    const first = await account.mutation(begin, { grantId: grant._id, requestId });
    const replay = await account.mutation(begin, { grantId: grant._id, requestId });
    expect(replay).toMatchObject({ status: "replayed", session: first.session });
    await expect(t.withIdentity(identity("user-b", "session-b")).mutation(page, { sessionId: first.session._id, paginationOpts: pagination })).rejects.toThrow(/account unavailable|authentication unavailable/i);
  });

  it("exports only rows created before the server cutoff and omits internal fields", async () => {
    const { t, account, ownerId, grant } = await fixture();
    await t.run((ctx) => ctx.db.insert("comparisons", { ownerId, resultId: "123e4567-e89b-42d3-a456-426614174010", requestId: "123e4567-e89b-42d3-a456-426614174011", snapshot: "{\"version\":1}", payloadHash: "internal", title: null, source: "member", createdAt: new Date().toISOString(), calculationVersion: "v1", reviewAfter: Date.now() + 1000 }));
    const started = await account.mutation(begin, { grantId: grant._id, requestId });
    await t.run((ctx) => ctx.db.insert("comparisons", { ownerId, resultId: "123e4567-e89b-42d3-a456-426614174012", requestId: "123e4567-e89b-42d3-a456-426614174013", snapshot: "{\"version\":1}", payloadHash: "internal", title: null, source: "member", createdAt: new Date().toISOString(), calculationVersion: "v1", reviewAfter: Date.now() + 1000 }));
    const result = await account.mutation(page, { sessionId: started.session._id, paginationOpts: pagination });
    expect(result).toMatchObject({ status: "ok" });
    if (result.status === "ok") {
      expect(result.result.page).toHaveLength(1);
      expect(result.result.page[0]).not.toHaveProperty("payloadHash");
    }
  });

  it("aborts the next page and finalization after an exported-data mutation", async () => {
    const { t, account, ownerId, grant } = await fixture();
    const started = await account.mutation(begin, { grantId: grant._id, requestId });
    const feedbackResult = await account.mutation(submitFeedback, { requestId: "123e4567-e89b-42d3-a456-426614174020", feature: "comparison", contextId: "123e4567-e89b-42d3-a456-426614174021", contextVersion: "v1", answer: "yes", comment: null });
    expect(feedbackResult).toMatchObject({ status: "submitted" });
    await expect(account.mutation(page, { sessionId: started.session._id, paginationOpts: pagination })).resolves.toMatchObject({ status: "aborted", code: "changed" });
    await expect(account.mutation(finalize, { sessionId: started.session._id })).resolves.toMatchObject({ status: "aborted" });
  });

  it("closes a changed session so a replacement export can start immediately", async () => {
    const { t, account, ownerId, grant } = await fixture();
    const started = await account.mutation(begin, { grantId: grant._id, requestId });
    const feedbackResult = await account.mutation(submitFeedback, { requestId: "123e4567-e89b-42d3-a456-426614174030", feature: "comparison", contextId: "123e4567-e89b-42d3-a456-426614174031", contextVersion: "v1", answer: "yes", comment: null });
    expect(feedbackResult).toMatchObject({ status: "submitted" });
    await expect(account.mutation(page, { sessionId: started.session._id, paginationOpts: pagination })).resolves.toMatchObject({ status: "aborted", code: "changed" });
    const now = Math.floor(Date.now() / 1000);
    const replacementGrant = await account.mutation(issue, { authKey: "https://issuer.example|user-a", subject: "user-a", sessionId: "session-a", audience: "truecost_dev", purpose: "account_export", nonce: "123e4567-e89b-42d3-a456-426614174032", issuedAt: now - 1, expiresAt: now + 60 });
    await expect(account.mutation(begin, { grantId: replacementGrant._id, requestId: "123e4567-e89b-42d3-a456-426614174033" })).resolves.toMatchObject({ status: "started" });
    await expect(t.run((ctx) => ctx.db.get(started.session._id))).resolves.toMatchObject({ status: "aborted", ownerId });
  });

  it("does not mutate a foreign session during finalization", async () => {
    const { t, account, grant } = await fixture();
    const started = await account.mutation(begin, { grantId: grant._id, requestId });
    await t.run((ctx) => ctx.db.insert("users", { authKey: "https://issuer.example|user-b", clerkSubject: "user-b", status: "active", exportRevision: 0, createdAt: Date.now(), updatedAt: Date.now() }));
    await expect(t.withIdentity(identity("user-b", "session-b")).mutation(finalize, { sessionId: started.session._id })).resolves.toMatchObject({ status: "aborted" });
    await expect(t.run((ctx) => ctx.db.get(started.session._id))).resolves.toMatchObject({ status: "active" });
  });

  it("checks expiry on each fresh page request", async () => {
    vi.useFakeTimers();
    const { account, grant } = await fixture();
    const started = await account.mutation(begin, { grantId: grant._id, requestId });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await expect(account.mutation(page, { sessionId: started.session._id, paginationOpts: pagination })).resolves.toMatchObject({ status: "aborted", code: "expired" });
  });

  it("keeps pagination bounded and resumes with the returned cursor", async () => {
    const { t, account, ownerId, grant } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 0; i < 51; i++) await ctx.db.insert("comparisons", { ownerId, resultId: `123e4567-e89b-42d3-a456-${String(426614180000 + i).padStart(12, "0")}`, requestId: `123e4567-e89b-42d3-a456-${String(426614181100 + i).padStart(12, "0")}`, snapshot: "{}", payloadHash: "internal", title: null, source: "member", createdAt: new Date().toISOString(), calculationVersion: "v1", reviewAfter: Date.now() + 1000 });
    });
    const started = await account.mutation(begin, { grantId: grant._id, requestId });
    const first = await account.mutation(page, { sessionId: started.session._id, paginationOpts: pagination });
    expect(first).toMatchObject({ status: "ok", result: { page: expect.any(Array) } });
    if (first.status === "ok") {
      expect(first.result.page.length).toBeLessThanOrEqual(50);
      if (!first.result.isDone) {
        const second = await account.mutation(page, { sessionId: started.session._id, paginationOpts: { numItems: 50, cursor: first.result.continueCursor } });
        expect(second).toMatchObject({ status: "ok", result: { page: expect.any(Array), isDone: true } });
      }
    }
  });

  it("finds an active session beyond historical records", async () => {
    const { t, account, ownerId, grant } = await fixture();
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 4; i++) await ctx.db.insert("exportSessions", { ownerId, requestId: `123e4567-e89b-42d3-a456-${String(426614190000 + i).padStart(12, "0")}`, clerkSessionId: "old", grantId: grant._id, expectedRevision: 0, cutoffAt: now - 1000, createdAt: now - 1000, expiresAt: now - 500, status: "completed" });
      await ctx.db.insert("exportSessions", { ownerId, requestId: "123e4567-e89b-42d3-a456-426614199999", clerkSessionId: "session-a", grantId: grant._id, expectedRevision: 0, cutoffAt: now, createdAt: now, expiresAt: now + 60_000, status: "active" });
    });
    await expect(account.mutation(begin, { grantId: grant._id, requestId })).resolves.toMatchObject({ status: "limited", code: "active_export", retryAfterMs: expect.any(Number) });
  });

  it("rate limits completed export churn within the ten minute window", async () => {
    const { t, account, ownerId, grant } = await fixture();
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) await ctx.db.insert("exportSessions", { ownerId, requestId: `123e4567-e89b-42d3-a456-${String(426614195000 + i).padStart(12, "0")}`, clerkSessionId: "session-a", grantId: grant._id, expectedRevision: 0, cutoffAt: now, createdAt: now - i, expiresAt: now + 60_000, status: "completed" });
    });
    await expect(account.mutation(begin, { grantId: grant._id, requestId })).resolves.toMatchObject({ status: "limited", code: "rate_limited", retryAfterMs: expect.any(Number) });
  });

  it("keeps expired grants through the issuance window so cleanup cannot reset churn limits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    const { t, account, ownerId, grant } = await fixture();
    const expected = { ownerId, subject: "user-a", sessionId: "session-a", audience: "truecost_dev", purpose: "account_export" as const };
    await t.run((ctx) => consumeSensitiveGrant(ctx, grant._id, expected));
    for (let i = 1; i < 10; i++) {
      const now = Math.floor(Date.now() / 1000);
      const next = await account.mutation(issue, { authKey: "https://issuer.example|user-a", subject: "user-a", sessionId: "session-a", audience: "truecost_dev", purpose: "account_export", nonce: `123e4567-e89b-42d3-a456-4266141740${String(i + 20).padStart(2, "0")}`, issuedAt: now - 1, expiresAt: now + 60 });
      await t.run((ctx) => consumeSensitiveGrant(ctx, next._id, expected));
    }
    vi.advanceTimersByTime(120 * 1000);
    await expect(t.mutation(internal.accountExports.purgeExpiredState, {})).resolves.toMatchObject({ grantsDeleted: 0 });
    await expect(account.mutation(issue, { authKey: "https://issuer.example|user-a", subject: "user-a", sessionId: "session-a", audience: "truecost_dev", purpose: "account_export", nonce: "123e4567-e89b-42d3-a456-426614174099", issuedAt: Math.floor(Date.now() / 1000) - 1, expiresAt: Math.floor(Date.now() / 1000) + 60 })).rejects.toMatchObject({ data: { code: "rate_limited", retryAfterMs: expect.any(Number) } });
  });
});
