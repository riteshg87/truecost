import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { feedbackRetentionCutoff } from "../lib/feedback/retention";

const modules = {
  "./retention.ts": async () => import("../convex/retention"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("feedback retention", () => {
  it("uses calendar months and clamps leap day without rounding the time", () => {
    expect(new Date(feedbackRetentionCutoff(Date.parse("2024-02-29T12:34:56.789Z"))).toISOString()).toBe("2023-02-28T12:34:56.789Z");
    expect(new Date(feedbackRetentionCutoff(Date.parse("2025-03-01T00:00:00Z"))).toISOString()).toBe("2024-03-01T00:00:00.000Z");
    expect(() => feedbackRetentionCutoff(NaN)).toThrow();
  });

  it("deletes only expired feedback/dismissals and is safe to repeat", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-16T12:00:00Z"));
    const cutoff = feedbackRetentionCutoff(Date.now());
    const t = convexTest({ schema, modules });
    const ids = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { authKey: "test", clerkSubject: "test", status: "active", createdAt: 0, updatedAt: 0 });
      const common = { ownerId, requestId: "request", feature: "comparison" as const, contextId: "context", contextVersion: "v1", payloadHash: "hash" };
      const expired = await ctx.db.insert("feedback", { ...common, answer: "yes", comment: "expired text", createdAt: cutoff });
      const retained = await ctx.db.insert("feedback", { ...common, requestId: "recent", answer: "no", comment: "recent text", createdAt: cutoff + 1 });
      const dismissal = await ctx.db.insert("feedbackDismissals", { ...common, createdAt: cutoff - 1 });
      const quota = await ctx.db.insert("feedbackRateLimits", { ownerId, successfulAt: [Date.now()] });
      return { ownerId, expired, retained, dismissal, quota };
    });
    expect(await t.mutation(internal.retention.purgeExpiredFeedback, {})).toEqual({ feedbackDeleted: 1, dismissalsDeleted: 1, continuationScheduled: false });
    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.expired)).toBeNull();
      expect(await ctx.db.get(ids.dismissal)).toBeNull();
      expect((await ctx.db.get(ids.retained))?.comment).toBe("recent text");
      expect(await ctx.db.get(ids.ownerId)).not.toBeNull();
      expect(await ctx.db.get(ids.quota)).not.toBeNull();
    });
    expect(await t.mutation(internal.retention.purgeExpiredFeedback, {})).toEqual({ feedbackDeleted: 0, dismissalsDeleted: 0, continuationScheduled: false });
  });

  it("bounds each transaction and drains a larger backlog through scheduled continuation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    const cutoff = feedbackRetentionCutoff(Date.now());
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { authKey: "batch", clerkSubject: "batch", status: "active", createdAt: 0, updatedAt: 0 });
      for (let n = 0; n < 205; n++) await ctx.db.insert("feedback", {
        ownerId, requestId: `request-${n}`, feature: "loan_health", contextId: `context-${n}`, contextVersion: "v1", payloadHash: "hash", answer: "yes", comment: null, createdAt: cutoff - n,
      });
    });
    expect(await t.mutation(internal.retention.purgeExpiredFeedback, {})).toEqual({ feedbackDeleted: 100, dismissalsDeleted: 0, continuationScheduled: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.query("feedback").take(1))).toEqual([]);
  });
});
