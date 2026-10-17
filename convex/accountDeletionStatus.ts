import { v } from "convex/values";
import { query } from "./_generated/server";

/** A deleting owner can inspect progress without regaining private-data access. */
export const current = query({
  args: {},
  returns: v.union(v.null(), v.object({
    status: v.union(v.literal("app_pending"), v.literal("providers_pending"), v.literal("completed")),
    needsAttention: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || typeof identity.tokenIdentifier !== "string" || !identity.tokenIdentifier ||
        typeof identity.subject !== "string" || !identity.subject ||
        typeof identity.sid !== "string" || !identity.sid) {
      throw new Error("Deletion authentication unavailable");
    }
    const owner = await ctx.db.query("users")
      .withIndex("by_authKey", (q) => q.eq("authKey", identity.tokenIdentifier)).unique();
    if (!owner || owner.clerkSubject !== identity.subject) return null;
    const job = await ctx.db.query("accountDeletionJobs")
      .withIndex("by_owner", (q) => q.eq("ownerId", owner._id)).unique();
    if (!job) return null;
    // Never expose subject, session/grant IDs, analytics IDs or worker tokens.
    return { status: job.status, needsAttention: job.providerStage === "manual_review", createdAt: job.createdAt, updatedAt: job.updatedAt };
  },
});
