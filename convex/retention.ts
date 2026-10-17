import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { feedbackRetentionCutoff } from "../lib/feedback/retention";
import { bumpExportRevision } from "./exportRevision";

const BATCH_SIZE = 100;

/** Internal only: callers cannot supply a cutoff or select another user's rows. */
export const purgeExpiredFeedback = internalMutation({
  args: {},
  returns: v.object({ feedbackDeleted: v.number(), dismissalsDeleted: v.number(), continuationScheduled: v.boolean() }),
  handler: async (ctx): Promise<{ feedbackDeleted: number; dismissalsDeleted: number; continuationScheduled: boolean }> => {
    const cutoff = feedbackRetentionCutoff(Date.now());
    const feedback = await ctx.db.query("feedback").withIndex("by_createdAt", (q) => q.lte("createdAt", cutoff)).take(BATCH_SIZE);
    const dismissals = await ctx.db.query("feedbackDismissals").withIndex("by_createdAt", (q) => q.lte("createdAt", cutoff)).take(BATCH_SIZE);
    const owners = new Set([...feedback.map((row) => row.ownerId), ...dismissals.map((row) => row.ownerId)]);
    for (const row of feedback) await ctx.db.delete(row._id);
    for (const row of dismissals) await ctx.db.delete(row._id);
    for (const ownerId of owners) {
      const owner = await ctx.db.get(ownerId);
      if (owner?.status === "active") await bumpExportRevision(ctx, ownerId);
    }
    const continuationScheduled = feedback.length === BATCH_SIZE || dismissals.length === BATCH_SIZE;
    if (continuationScheduled) await ctx.scheduler.runAfter(0, internal.retention.purgeExpiredFeedback, {});
    return { feedbackDeleted: feedback.length, dismissalsDeleted: dismissals.length, continuationScheduled };
  },
});
