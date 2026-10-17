import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";

const modules = {
  "./accountDeletionStatus.ts": async () => import("../convex/accountDeletionStatus"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};
const current = makeFunctionReference<"query">("accountDeletionStatus:current");
const identity = (subject: string) => ({
  issuer: "https://issuer.example", subject, sid: `session-${subject}`,
  tokenIdentifier: `https://issuer.example|${subject}`,
});

describe("private deletion progress", () => {
  it("allows a deleting owner to read only sanitized progress, including from a new session", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        authKey: identity("a").tokenIdentifier, clerkSubject: "a", status: "deleting",
        exportRevision: 0, createdAt: 1, updatedAt: 2,
      });
      const grantId = await ctx.db.insert("sensitiveGrants", {
        ownerId, subject: "a", sessionId: "old-session", audience: "test",
        purpose: "account_delete", nonce: "nonce", issuedAt: 1, expiresAt: 2,
        consumedAt: 2,
      });
      await ctx.db.insert("accountDeletionJobs", {
        ownerId, requestId: "private-request", grantId, subject: "a", sessionId: "old-session",
        purpose: "account_delete", analyticsAccountId: "private-analytics-id",
        status: "providers_pending", stage: "providers", purgeTable: null, purgeCursor: null,
        leaseUntil: null, attemptToken: "private-worker-token", attemptNumber: 1,
        createdAt: 1, updatedAt: 2,
      });
    });
    expect(await t.withIdentity(identity("a")).query(current, {})).toEqual({
      status: "providers_pending", needsAttention: false, createdAt: 1, updatedAt: 2,
    });
    expect(await t.withIdentity(identity("b")).query(current, {})).toBeNull();
    await expect(t.query(current, {})).rejects.toThrow("Deletion authentication unavailable");
    await expect(t.withIdentity({ subject: "a", tokenIdentifier: identity("a").tokenIdentifier })
      .query(current, {})).rejects.toThrow("Deletion authentication unavailable");
    expect(await t.withIdentity({ ...identity("a"), subject: "b" }).query(current, {})).toBeNull();
  });

  it("exposes only a boolean attention signal for provider manual review", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", {
        authKey: identity("a").tokenIdentifier, clerkSubject: "a", status: "deleting", createdAt: 1, updatedAt: 2,
      });
      const grantId = await ctx.db.insert("sensitiveGrants", {
        ownerId, subject: "a", sessionId: "old-session", audience: "test", purpose: "account_delete", nonce: "nonce2", issuedAt: 1, expiresAt: 2, consumedAt: 2,
      });
      await ctx.db.insert("accountDeletionJobs", {
        ownerId, requestId: "private-request-2", grantId, subject: "a", sessionId: "old-session", purpose: "account_delete", analyticsAccountId: null,
        status: "providers_pending", stage: "providers", purgeTable: null, purgeCursor: null, leaseUntil: null, attemptToken: null, attemptNumber: 1,
        providerStage: "manual_review", providerCode: "configuration", providerTrackingId: null, providerLeaseUntil: null, providerAttemptToken: null, providerAttemptNumber: 1, providerNextAttemptAt: null,
        createdAt: 1, updatedAt: 2,
      });
    });
    const progress = await t.withIdentity(identity("a")).query(current, {});
    expect(progress).toEqual({ status: "providers_pending", needsAttention: true, createdAt: 1, updatedAt: 2 });
    expect(JSON.stringify(progress)).not.toMatch(/private|configuration|a\b|token|grant/i);
  });
});
