import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { consumeSensitiveGrant } from "./privacyGrants";

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_MS = 30_000;
const BATCH_SIZE = 100;

const jobStatus = v.union(v.literal("app_pending"), v.literal("providers_pending"), v.literal("completed"));
const jobStage = v.union(v.literal("purge"), v.literal("providers"));
const purgeTable = v.union(
  v.literal("savedLoans"),
  v.literal("comparisons"),
  v.literal("feedback"),
  v.literal("feedbackDismissals"),
  v.literal("operationReceipts"),
  v.literal("comparisonReceipts"),
  v.literal("recordTombstones"),
  v.literal("comparisonTombstones"),
  v.literal("comparisonRateLimits"),
  v.literal("feedbackRateLimits"),
  v.literal("exportSessions"),
  v.literal("sensitiveGrants"),
  v.literal("analyticsPreferences"),
);

const PURGE_TABLES = [
  "savedLoans",
  "comparisons",
  "feedback",
  "feedbackDismissals",
  "operationReceipts",
  "comparisonReceipts",
  "recordTombstones",
  "comparisonTombstones",
  "comparisonRateLimits",
  "feedbackRateLimits",
  "exportSessions",
  "sensitiveGrants",
  "analyticsPreferences",
] as const;
type PurgeTable = (typeof PURGE_TABLES)[number];

const requestResult = v.object({
  status: v.union(v.literal("accepted"), v.literal("replayed")),
  requestId: v.string(),
  jobId: v.id("accountDeletionJobs"),
  jobStatus,
});

const claimResult = v.object({
  status: v.union(v.literal("claimed"), v.literal("busy"), v.literal("providers_pending")),
  attemptToken: v.union(v.string(), v.null()),
});

const purgeResult = v.object({
  status: v.union(v.literal("purged"), v.literal("ignored"), v.literal("providers_pending")),
  deleted: v.number(),
});

const claimRef = makeFunctionReference<"mutation", { jobId: Id<"accountDeletionJobs"> }>("accountDeletion:claimPurge");
const purgeRef = makeFunctionReference<"mutation", { jobId: Id<"accountDeletionJobs">; attemptToken: string }>("accountDeletion:purgeAccountData");
const providerClaimRef = makeFunctionReference<"mutation", { jobId: Id<"accountDeletionJobs"> }>("accountDeletionProviders:claimProvider");

type AuthenticatedIdentity = { authKey: string; subject: string; sessionId: string };

export type DeletionJobOrigin = "user_requested" | "clerk_webhook";

type DeletionJobStart = {
  ownerId: Id<"users">;
  requestId: string;
  grantId: Id<"sensitiveGrants"> | null;
  subject: string;
  sessionId: string | null;
  origin: DeletionJobOrigin;
};

async function verifiedIdentity(ctx: MutationCtx): Promise<AuthenticatedIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.tokenIdentifier || typeof identity.tokenIdentifier !== "string" || !identity.subject || typeof identity.subject !== "string" || typeof identity.sid !== "string" || !identity.sid || identity.tokenIdentifier.length > 512 || identity.subject.length > 256 || identity.sid.length > 256) {
    throw new Error("Deletion authentication unavailable");
  }
  return { authKey: identity.tokenIdentifier, subject: identity.subject, sessionId: identity.sid };
}

function validateRequestId(value: string): string {
  if (!requestIdPattern.test(value)) throw new Error("Deletion request ID is invalid");
  return value;
}

function newAttemptToken(jobId: Id<"accountDeletionJobs">, attemptNumber: number): string {
  // This token is an internal OCC fence, not a bearer secret. Including the
  // durable job ID and monotonic attempt number keeps retries deterministic and makes
  // an expired worker unable to overwrite a newer claim.
  return `${jobId}:${attemptNumber}`;
}

async function ownerFor(ctx: MutationCtx, authKey: string) {
  return await ctx.db.query("users").withIndex("by_authKey", (q) => q.eq("authKey", authKey)).unique();
}

function sameReplay(job: Doc<"accountDeletionJobs">, requestId: string, grantId: Id<"sensitiveGrants">, subject: string, sessionId: string): boolean {
  return job.requestId === requestId && job.grantId === grantId && job.subject === subject && job.sessionId === sessionId && job.purpose === "account_delete";
}

/** Shared durable boundary for user-initiated and provider-initiated deletion. */
export async function startDeletionJob(ctx: MutationCtx, args: DeletionJobStart): Promise<Id<"accountDeletionJobs">> {
  const now = Date.now();
  const preferences = await ctx.db.query("analyticsPreferences").withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId)).unique();
  const jobId = await ctx.db.insert("accountDeletionJobs", {
    ownerId: args.ownerId,
    requestId: args.requestId,
    grantId: args.grantId,
    subject: args.subject,
    sessionId: args.sessionId,
    purpose: "account_delete",
    analyticsAccountId: preferences?.analyticsAccountId ?? null,
    status: "app_pending",
    stage: "purge",
    purgeTable: PURGE_TABLES[0],
    purgeCursor: null,
    leaseUntil: null,
    attemptToken: null,
    attemptNumber: 0,
    origin: args.origin,
    providerStage: (preferences?.analyticsAccountId ?? null) === null ? "clerk_pending" : "mixpanel_create_pending",
    providerTrackingId: null,
    providerLeaseUntil: null,
    providerAttemptToken: null,
    providerAttemptNumber: 0,
    providerRetryCount: 0,
    providerLastRetryCode: null,
    providerPollCount: 0,
    providerPendingSince: null,
    providerNextAttemptAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, claimRef, { jobId });
  return jobId;
}

/** Starts the application deletion boundary after a fresh, server-verified grant. */
export const requestDeletion = mutation({
  args: { grantId: v.id("sensitiveGrants"), requestId: v.string() },
  returns: requestResult,
  handler: async (ctx, args) => {
    const identity = await verifiedIdentity(ctx);
    const requestId = validateRequestId(args.requestId);
    const owner = await ownerFor(ctx, identity.authKey);
    if (!owner || owner.clerkSubject !== identity.subject) throw new Error("Deletion account unavailable");

    const existing = await ctx.db.query("accountDeletionJobs").withIndex("by_owner_requestId", (q) => q.eq("ownerId", owner._id).eq("requestId", requestId)).unique();
    if (existing) {
      if (!sameReplay(existing, requestId, args.grantId, identity.subject, identity.sessionId)) throw new Error("Deletion request binding mismatch");
      return { status: "replayed" as const, requestId, jobId: existing._id, jobStatus: existing.status };
    }
    if (owner.status !== "active") throw new Error("Deletion account unavailable");
    const audience = process.env.TRUECOST_PRIVACY_AUDIENCE;
    if (!audience) throw new Error("Deletion approval unavailable");

    // Grant consumption and the access block are one transaction. The grant
    // helper intentionally requires an active owner, so consume first and
    // then flip the owner before the transaction can commit.
    const now = Date.now();
    await consumeSensitiveGrant(ctx, args.grantId, {
      ownerId: owner._id,
      subject: identity.subject,
      sessionId: identity.sessionId,
      audience,
      purpose: "account_delete",
    });
    await ctx.db.patch(owner._id, { status: "deleting", updatedAt: now });
    const jobId = await startDeletionJob(ctx, {
      ownerId: owner._id,
      requestId,
      grantId: args.grantId,
      subject: identity.subject,
      sessionId: identity.sessionId,
      origin: "user_requested",
    });
    return { status: "accepted" as const, requestId, jobId, jobStatus: "app_pending" as const };
  },
});

/** Internal lease acquisition. A new token fences off late scheduled work. */
export const claimPurge = internalMutation({
  args: { jobId: v.id("accountDeletionJobs") },
  returns: claimResult,
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "app_pending") return { status: "providers_pending" as const, attemptToken: null };
    const now = Date.now();
    if (job.leaseUntil !== null && job.leaseUntil > now) return { status: "busy" as const, attemptToken: null };
    const attemptNumber = job.attemptNumber + 1;
    const attemptToken = newAttemptToken(job._id, attemptNumber);
    await ctx.db.patch(job._id, { leaseUntil: now + LEASE_MS, attemptToken, attemptNumber, updatedAt: now });
    await ctx.scheduler.runAfter(0, purgeRef, { jobId: job._id, attemptToken });
    // If the worker is delayed or interrupted, this wake-up can reclaim the
    // job after the bounded lease expires. A completed purge makes it a no-op.
    await ctx.scheduler.runAfter(LEASE_MS + 1, claimRef, { jobId: job._id });
    return { status: "claimed" as const, attemptToken };
  },
});

async function deleteOwnerBatch(ctx: MutationCtx, table: PurgeTable, ownerId: Id<"users">): Promise<number> {
  switch (table) {
    case "savedLoans": {
      const rows = await ctx.db.query("savedLoans").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "comparisons": {
      const rows = await ctx.db.query("comparisons").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "feedback": {
      const rows = await ctx.db.query("feedback").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "feedbackDismissals": {
      const rows = await ctx.db.query("feedbackDismissals").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "operationReceipts": {
      const rows = await ctx.db.query("operationReceipts").withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "comparisonReceipts": {
      const rows = await ctx.db.query("comparisonReceipts").withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "recordTombstones": {
      const rows = await ctx.db.query("recordTombstones").withIndex("by_owner_entity", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "comparisonTombstones": {
      const rows = await ctx.db.query("comparisonTombstones").withIndex("by_owner_resultId", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "comparisonRateLimits": {
      const rows = await ctx.db.query("comparisonRateLimits").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "feedbackRateLimits": {
      const rows = await ctx.db.query("feedbackRateLimits").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "exportSessions": {
      const rows = await ctx.db.query("exportSessions").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "sensitiveGrants": {
      const rows = await ctx.db.query("sensitiveGrants").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case "analyticsPreferences": {
      const rows = await ctx.db.query("analyticsPreferences").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
  }
}

/** Internal bounded application purge. Provider calls and completion are later slices. */
export const purgeAccountData = internalMutation({
  args: { jobId: v.id("accountDeletionJobs"), attemptToken: v.string() },
  returns: purgeResult,
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (!job || job.status !== "app_pending") return { status: "ignored" as const, deleted: 0 };
    if (job.attemptToken !== args.attemptToken || job.leaseUntil === null || job.leaseUntil <= now) {
      if (job.leaseUntil === null || job.leaseUntil <= now) await ctx.scheduler.runAfter(0, claimRef, { jobId: job._id });
      return { status: "ignored" as const, deleted: 0 };
    }
    const table = (job.purgeTable ?? PURGE_TABLES[0]) as PurgeTable;
    const deleted = await deleteOwnerBatch(ctx, table, job.ownerId);
    const index = PURGE_TABLES.indexOf(table);
    const exhausted = deleted < BATCH_SIZE;
    const nextTable = exhausted ? (PURGE_TABLES[index + 1] ?? null) : table;
    if (nextTable === null) {
      await ctx.db.patch(job._id, { status: "providers_pending", stage: "providers", purgeTable: null, purgeCursor: null, leaseUntil: null, attemptToken: null, providerStage: job.providerStage ?? "mixpanel_create_pending", providerTrackingId: job.providerTrackingId ?? null, providerLeaseUntil: null, providerAttemptToken: null, providerAttemptNumber: job.providerAttemptNumber ?? 0, providerRetryCount: job.providerRetryCount ?? 0, providerLastRetryCode: job.providerLastRetryCode ?? null, providerPollCount: job.providerPollCount ?? 0, providerPendingSince: job.providerPendingSince ?? null, providerNextAttemptAt: null, updatedAt: now });
      await ctx.scheduler.runAfter(0, providerClaimRef, { jobId: job._id });
      return { status: "providers_pending" as const, deleted };
    }
    await ctx.db.patch(job._id, { purgeTable: nextTable, purgeCursor: null, leaseUntil: null, attemptToken: null, updatedAt: now });
    await ctx.scheduler.runAfter(0, claimRef, { jobId: job._id });
    return { status: "purged" as const, deleted };
  },
});
