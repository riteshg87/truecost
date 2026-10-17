import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = {
  "./accountDeletionRecovery.ts": async () => import("../convex/accountDeletionRecovery"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};
const recoveryReceipt = makeFunctionReference<"query">("accountDeletionRecovery:recoveryReceipt");
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";

function identity(subject: string, sid: string, tokenSubject = subject) {
  return {
    issuer: "https://issuer.example",
    subject,
    sid,
    tokenIdentifier: `https://issuer.example|${tokenSubject}`,
  };
}

async function fixture(status: "app_pending" | "providers_pending" | "completed" | "active" = "providers_pending") {
  const t = convexTest({ schema, modules });
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      authKey: "https://issuer.example|owner-a",
      clerkSubject: "owner-a",
      status: status === "active" ? "active" : "deleting",
      exportRevision: 0,
      createdAt: 1,
      updatedAt: 2,
    });
    const grantId = await ctx.db.insert("sensitiveGrants", {
      ownerId,
      subject: "owner-a",
      sessionId: "session-a",
      audience: "truecost_test",
      purpose: "account_delete",
      nonce: "00000000-0000-4000-8000-000000000002",
      issuedAt: 1,
      expiresAt: 2,
      consumedAt: 2,
    });
    const jobId = await ctx.db.insert("accountDeletionJobs", {
      ownerId,
      requestId: REQUEST_ID,
      grantId,
      subject: "owner-a",
      sessionId: "session-a",
      purpose: "account_delete",
      analyticsAccountId: "private-analytics",
      status: status === "active" ? "app_pending" : status,
      stage: status === "completed" ? "providers" : "purge",
      purgeTable: null,
      purgeCursor: null,
      leaseUntil: null,
      attemptToken: "private-worker-token",
      attemptNumber: 3,
      providerStage: "manual_review",
      providerTrackingId: "private-tracking-id",
      providerLeaseUntil: null,
      providerAttemptToken: "private-provider-token",
      providerAttemptNumber: 2,
      providerRetryCount: 1,
      providerPollCount: 2,
      providerPendingSince: 1,
      providerNextAttemptAt: 4,
      providerCode: "provider_failure",
      createdAt: 1,
      updatedAt: 2,
    });
    return { ownerId, grantId, jobId };
  });
  return { t, ...ids };
}

describe("account deletion recovery receipt", () => {
  it.each(["app_pending", "providers_pending", "completed"] as const)("returns a minimal receipt for the original owner/session while %s", async (status) => {
    const { t, ownerId, grantId } = await fixture(status);
    await expect(t.withIdentity(identity("owner-a", "session-a")).query(recoveryReceipt, { requestId: REQUEST_ID, grantId })).resolves.toEqual({
      requestId: REQUEST_ID,
      ownerId,
      status,
    });
  });

  it("refuses a new session for the same subject", async () => {
    const { t, grantId } = await fixture();
    await expect(t.withIdentity(identity("owner-a", "session-new")).query(recoveryReceipt, { requestId: REQUEST_ID, grantId })).resolves.toBeNull();
  });

  it("refuses foreign and token-subject-mismatch identities", async () => {
    const { t, grantId } = await fixture();
    await expect(t.withIdentity(identity("owner-b", "session-b")).query(recoveryReceipt, { requestId: REQUEST_ID, grantId })).resolves.toBeNull();
    await expect(t.withIdentity(identity("owner-b", "session-a", "owner-a")).query(recoveryReceipt, { requestId: REQUEST_ID, grantId })).resolves.toBeNull();
  });

  it("refuses wrong request and wrong grant bindings", async () => {
    const { t, grantId, ownerId } = await fixture();
    const wrongGrantId = await t.run((ctx) => ctx.db.insert("sensitiveGrants", {
      ownerId,
      subject: "owner-a",
      sessionId: "session-a",
      audience: "truecost_test",
      purpose: "account_delete",
      nonce: "00000000-0000-4000-8000-000000000003",
      issuedAt: 1,
      expiresAt: 2,
      consumedAt: 2,
    }));
    await expect(t.withIdentity(identity("owner-a", "session-a")).query(recoveryReceipt, { requestId: "00000000-0000-4000-8000-000000000004", grantId })).resolves.toBeNull();
    await expect(t.withIdentity(identity("owner-a", "session-a")).query(recoveryReceipt, { requestId: REQUEST_ID, grantId: wrongGrantId })).resolves.toBeNull();
  });

  it("still succeeds after the sensitive grant row has been purged", async () => {
    const { t, grantId, ownerId } = await fixture("completed");
    await t.run((ctx) => ctx.db.delete(grantId));
    await expect(t.withIdentity(identity("owner-a", "session-a")).query(recoveryReceipt, { requestId: REQUEST_ID, grantId })).resolves.toEqual({ requestId: REQUEST_ID, ownerId, status: "completed" });
  });

  it("does not issue a receipt for an active owner", async () => {
    const { t, grantId } = await fixture("active");
    await expect(t.withIdentity(identity("owner-a", "session-a")).query(recoveryReceipt, { requestId: REQUEST_ID, grantId })).resolves.toBeNull();
  });

  it("fails authentication when identity or sid is missing", async () => {
    const { t, grantId } = await fixture();
    await expect(t.query(recoveryReceipt, { requestId: REQUEST_ID, grantId })).rejects.toThrow("Deletion recovery authentication unavailable");
    await expect(t.withIdentity({ subject: "owner-a", tokenIdentifier: "https://issuer.example|owner-a" }).query(recoveryReceipt, { requestId: REQUEST_ID, grantId })).rejects.toThrow("Deletion recovery authentication unavailable");
  });

  it("returns exactly requestId, ownerId and status", async () => {
    const { t, ownerId, grantId } = await fixture();
    const result = await t.withIdentity(identity("owner-a", "session-a")).query(recoveryReceipt, { requestId: REQUEST_ID, grantId });
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(["ownerId", "requestId", "status"]);
    expect(JSON.stringify(result)).not.toMatch(/grant|session|analytics|worker|subject|private/i);
    expect((result as { ownerId: Id<"users"> }).ownerId).toBe(ownerId);
  });

  it("rejects malformed request IDs before reading a job", async () => {
    const { t, grantId } = await fixture();
    await expect(t.withIdentity(identity("owner-a", "session-a")).query(recoveryReceipt, { requestId: "request-a", grantId })).resolves.toBeNull();
  });
});
