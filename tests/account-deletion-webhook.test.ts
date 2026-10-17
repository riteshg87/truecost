import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { Webhook } from "standardwebhooks";
import schema from "../convex/schema";
import { MAX_BODY_BYTES, verifyClerkDeletionRequest } from "../convex/http";

const modules = {
  "./accountDeletionWebhook.ts": async () => import("../convex/accountDeletionWebhook"),
  "./accountDeletion.ts": async () => import("../convex/accountDeletion"),
  "./accountDeletionProviders.ts": async () => import("../convex/accountDeletionProviders"),
  "./privacyGrants.ts": async () => import("../convex/privacyGrants"),
  "./users.ts": async () => import("../convex/users"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};

const ingest = makeFunctionReference<"mutation", { eventId: string; clerkSubject: string }>("accountDeletionWebhook:ingest");
const ensureCurrentUser = makeFunctionReference<"mutation", Record<string, never>>("users:ensureCurrentUser");
const webhookSecret = "whsec_dGVzdF9zZWNyZXQ=";

const user = (subject: string) => ({
  authKey: `https://issuer.example|${subject}`,
  clerkSubject: subject,
  status: "active" as const,
  exportRevision: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

function testBackend() {
  return convexTest({ schema, modules });
}

function signedRequest(body: string, id = "msg_123") {
  const timestamp = new Date();
  const signature = new Webhook(webhookSecret).sign(id, timestamp, body);
  return new Request("https://example.test/clerk-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
    body,
  });
}

describe("Clerk webhook HTTP verification", () => {
  it("accepts a valid signed user.deleted event", async () => {
    const body = JSON.stringify({ type: "user.deleted", data: { id: "clerk-user-1", deleted: true } });
    await expect(verifyClerkDeletionRequest(signedRequest(body), webhookSecret)).resolves.toEqual({ eventId: "msg_123", clerkSubject: "clerk-user-1" });
  });

  it("rejects bad signatures and bodies over the pre-verification bound", async () => {
    const body = JSON.stringify({ type: "user.deleted", data: { id: "clerk-user-1", deleted: true } });
    const bad = signedRequest(body);
    bad.headers.set("svix-signature", "v1,bad");
    await expect(verifyClerkDeletionRequest(bad, webhookSecret)).resolves.toBeNull();
    const oversized = new Request("https://example.test/clerk-webhook", { method: "POST", body: "x".repeat(MAX_BODY_BYTES + 1) });
    await expect(verifyClerkDeletionRequest(oversized, webhookSecret)).resolves.toBeNull();
  });
});

describe("Clerk deletion webhook reconciliation", () => {
  it("creates one provider-origin deletion job for a valid event", async () => {
    const t = testBackend();
    const ownerId = await t.run((ctx) => ctx.db.insert("users", user("clerk-user-1")));
    const result = await t.mutation(ingest, { eventId: "evt_valid_1", clerkSubject: "clerk-user-1" });
    expect(result.status).toBe("processed");
    const state = await t.run(async (ctx) => ({
      owner: await ctx.db.get(ownerId),
      jobs: await ctx.db.query("accountDeletionJobs").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).collect(),
      receipts: await ctx.db.query("clerkWebhookReceipts").withIndex("by_eventId", (q) => q.eq("eventId", "evt_valid_1")).collect(),
    }));
    expect(state.owner?.status).toBe("deleting");
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0]).toMatchObject({ origin: "clerk_webhook", grantId: null, sessionId: null, subject: "clerk-user-1" });
    expect(state.receipts).toHaveLength(1);
  });

  it("deduplicates delivery and reuses a prior user-requested job", async () => {
    const t = testBackend();
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { ...user("clerk-user-2"), status: "deleting" }));
    const oldJob = await t.run((ctx) => ctx.db.insert("accountDeletionJobs", {
      ownerId, requestId: "123e4567-e89b-42d3-a456-426614174000", grantId: null,
      subject: "clerk-user-2", sessionId: "session-a", purpose: "account_delete",
      analyticsAccountId: null, status: "app_pending", stage: "purge", purgeTable: "savedLoans", purgeCursor: null,
      leaseUntil: null, attemptToken: null, attemptNumber: 0, origin: "user_requested",
      providerStage: "clerk_pending", providerTrackingId: null, providerLeaseUntil: null,
      providerAttemptToken: null, providerAttemptNumber: 0, providerRetryCount: 0, providerLastRetryCode: null,
      providerPollCount: 0, providerPendingSince: null, providerNextAttemptAt: null, createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const first = await t.mutation(ingest, { eventId: "evt_duplicate_1", clerkSubject: "clerk-user-2" });
    const second = await t.mutation(ingest, { eventId: "evt_duplicate_1", clerkSubject: "clerk-user-2" });
    expect(first.jobId).toBe(oldJob);
    expect(second.jobId).toBe(oldJob);
    expect(await t.run((ctx) => ctx.db.query("accountDeletionJobs").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).collect())).toHaveLength(1);
  });

  it("records a subject tombstone when the profile is already absent", async () => {
    const t = testBackend();
    await expect(t.mutation(ingest, { eventId: "evt_missing_1", clerkSubject: "purged-subject" })).resolves.toEqual({ status: "ignored", jobId: null });
    const tombstone = await t.run((ctx) => ctx.db.query("clerkDeletionTombstones").withIndex("by_clerkSubject", (q) => q.eq("clerkSubject", "purged-subject")).unique());
    expect(tombstone).toMatchObject({ clerkSubject: "purged-subject", eventId: "evt_missing_1" });
    const account = t.withIdentity({ issuer: "https://issuer.example", subject: "purged-subject", tokenIdentifier: "https://issuer.example|purged-subject" });
    await expect(account.mutation(ensureCurrentUser, {})).rejects.toThrow(/profile unavailable/i);
  });

  it("rejects malformed internal event arguments without writing", async () => {
    const t = testBackend();
    await expect(t.mutation(ingest, { eventId: "", clerkSubject: "subject" })).rejects.toThrow(/invalid/i);
    await expect(t.mutation(ingest, { eventId: "evt_bad", clerkSubject: "" })).rejects.toThrow(/invalid/i);
    expect(await t.run((ctx) => ctx.db.query("clerkWebhookReceipts").collect())).toHaveLength(0);
  });
});
