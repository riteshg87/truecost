import { v } from "convex/values";
import { query } from "./_generated/server";

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recoveryStatus = v.union(v.literal("app_pending"), v.literal("providers_pending"), v.literal("completed"));

const recoveryReceiptValidator = v.object({
  requestId: v.string(),
  ownerId: v.id("users"),
  status: recoveryStatus,
});

/**
 * Returns the minimum server receipt needed to resume local cleanup after a
 * reload. The journal and this receipt are recovery hints, not authorization:
 * the original Clerk identity, request ID and deletion grant remain bound by
 * the deletion mutation. This query never reads the grant row, so it still
 * works after the purge worker removes that capability record.
 */
export const recoveryReceipt = query({
  args: { requestId: v.string(), grantId: v.id("sensitiveGrants") },
  returns: v.union(v.null(), recoveryReceiptValidator),
  handler: async (ctx, args) => {
    if (!requestIdPattern.test(args.requestId)) return null;
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.tokenIdentifier !== "string" || !identity.tokenIdentifier ||
      typeof identity.subject !== "string" || !identity.subject ||
      typeof identity.sid !== "string" || !identity.sid ||
      identity.tokenIdentifier.length > 512 || identity.subject.length > 256 || identity.sid.length > 256) {
      throw new Error("Deletion recovery authentication unavailable");
    }

    const owner = await ctx.db.query("users")
      .withIndex("by_authKey", (q) => q.eq("authKey", identity.tokenIdentifier))
      .unique();
    if (!owner || owner.clerkSubject !== identity.subject || owner.status !== "deleting") return null;

    const job = await ctx.db.query("accountDeletionJobs")
      .withIndex("by_owner_requestId", (q) => q.eq("ownerId", owner._id).eq("requestId", args.requestId))
      .unique();
    if (!job || job.ownerId !== owner._id || job.subject !== identity.subject ||
      job.sessionId !== identity.sid || job.purpose !== "account_delete" ||
      job.requestId !== args.requestId || job.grantId !== args.grantId ||
      (job.status !== "app_pending" && job.status !== "providers_pending" && job.status !== "completed")) return null;

    // Keep this return intentionally narrower than the durable job. In
    // particular, do not expose session/grant, analytics or worker/provider data.
    return { requestId: job.requestId, ownerId: owner._id, status: job.status };
  },
});
