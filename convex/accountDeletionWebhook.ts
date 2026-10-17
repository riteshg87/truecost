import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { startDeletionJob } from "./accountDeletion";

const boundedString = (value: string, max: number): boolean => value.length > 0 && value.length <= max;

const ingestResult = v.object({
  status: v.union(v.literal("processed"), v.literal("ignored")),
  jobId: v.union(v.id("accountDeletionJobs"), v.null()),
});

/**
 * Applies a verified Clerk user.deleted event. Signature verification happens
 * in the HTTP action; this transaction owns dedupe and the irreversible local
 * deletion boundary. Webhooks never grant private access.
 */
export const ingest = internalMutation({
  args: {
    eventId: v.string(),
    clerkSubject: v.string(),
  },
  returns: ingestResult,
  handler: async (ctx, args) => {
    if (!boundedString(args.eventId, 256) || !boundedString(args.clerkSubject, 256)) {
      throw new Error("Webhook event is invalid");
    }
    const prior = await ctx.db.query("clerkWebhookReceipts").withIndex("by_eventId", (q) => q.eq("eventId", args.eventId)).unique();
    if (prior) return { status: prior.status, jobId: prior.jobId };

    const owner = await ctx.db.query("users").withIndex("by_clerkSubject", (q) => q.eq("clerkSubject", args.clerkSubject)).unique();
    const existingTombstone = await ctx.db.query("clerkDeletionTombstones").withIndex("by_clerkSubject", (q) => q.eq("clerkSubject", args.clerkSubject)).first();
    const now = Date.now();

    if (!owner) {
      if (!existingTombstone) {
        await ctx.db.insert("clerkDeletionTombstones", { clerkSubject: args.clerkSubject, eventId: args.eventId, createdAt: now });
      }
      await ctx.db.insert("clerkWebhookReceipts", {
        eventId: args.eventId,
        eventType: "user.deleted",
        clerkSubject: args.clerkSubject,
        status: "ignored",
        jobId: null,
        processedAt: now,
      });
      return { status: "ignored" as const, jobId: null };
    }

    // Keep a subject tombstone even when the profile row remains. This makes
    // provisioning safe if a later retention job removes that row.
    if (!existingTombstone) {
      await ctx.db.insert("clerkDeletionTombstones", { clerkSubject: args.clerkSubject, eventId: args.eventId, createdAt: now });
    }

    const existingJob = await ctx.db.query("accountDeletionJobs").withIndex("by_owner", (q) => q.eq("ownerId", owner._id)).first();
    let jobId: Id<"accountDeletionJobs"> | null = existingJob?._id ?? null;
    if (existingJob) {
      if (owner.status === "active") await ctx.db.patch(owner._id, { status: "deleting", updatedAt: now });
    } else if (owner.status === "active" || owner.status === "deleting") {
      if (owner.status === "active") await ctx.db.patch(owner._id, { status: "deleting", updatedAt: now });
      jobId = await startDeletionJob(ctx, {
        ownerId: owner._id,
        requestId: crypto.randomUUID(),
        grantId: null,
        subject: args.clerkSubject,
        sessionId: null,
        origin: "clerk_webhook",
      });
    }

    await ctx.db.insert("clerkWebhookReceipts", {
      eventId: args.eventId,
      eventType: "user.deleted",
      clerkSubject: args.clerkSubject,
      status: "processed",
      jobId,
      processedAt: now,
    });
    return { status: "processed" as const, jobId };
  },
});
