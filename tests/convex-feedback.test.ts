import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = {
  "./users.ts": async () => import("../convex/users"),
  "./feedback.ts": async () => import("../convex/feedback"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};

function backend() {
  return convexTest({ schema, modules });
}

function identity(subject: string) {
  return {
    issuer: "https://issuer.example",
    subject,
    tokenIdentifier: `https://issuer.example|${subject}`,
  };
}

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${seed.toString(16).padStart(12, "0")}`;
}

async function member(t: ReturnType<typeof backend>, subject: string) {
  const account = t.withIdentity(identity(subject));
  await account.mutation(api.users.ensureCurrentUser, {});
  return account;
}

function comparisonContext(seed: number) {
  return { feature: "comparison" as const, contextId: uuid(seed), contextVersion: "v1" as const };
}

describe("owner-derived optional feedback", () => {
  it("denies guests and creates no feedback rows", async () => {
    const t = backend();
    await expect(t.query(api.feedback.getFeedbackStatus, comparisonContext(1))).rejects.toThrow(/authenticated/i);
    await expect(t.mutation(api.feedback.submitFeedback, {
      requestId: uuid(2), ...comparisonContext(1), answer: "yes",
    })).rejects.toThrow(/authenticated/i);
    await expect(t.run(async (ctx) => ctx.db.query("feedback").collect())).resolves.toEqual([]);
    await expect(t.run(async (ctx) => ctx.db.query("feedbackDismissals").collect())).resolves.toEqual([]);
  });

  it("stores an acknowledged answer and malicious text as inert exact data", async () => {
    const t = backend();
    const account = await member(t, "member-a");
    const comment = '<script>alert("x")</script> <img src=x onerror=alert(1)>';
    const context = comparisonContext(10);
    const request = { requestId: uuid(11), ...context, answer: "no" as const, comment };
    await expect(account.mutation(api.feedback.submitFeedback, request)).resolves.toEqual({
      status: "submitted", requestId: request.requestId, ...context,
    });
    await expect(account.query(api.feedback.getFeedbackStatus, context)).resolves.toEqual({
      status: "submitted", ...context,
    });
    await expect(t.run(async (ctx) => {
      const rows = await ctx.db.query("feedback").collect();
      return rows.map(({ comment: stored }) => stored);
    })).resolves.toEqual([comment]);
  });

  it("accepts a 1,000-character comment and rejects the first character over the limit", async () => {
    const t = backend();
    const account = await member(t, "length");
    const context = comparisonContext(20);
    const accepted = await account.mutation(api.feedback.submitFeedback, {
      requestId: uuid(21), ...context, answer: "yes", comment: "x".repeat(1_000),
    });
    expect(accepted.status).toBe("submitted");
    const rejected = await account.mutation(api.feedback.submitFeedback, {
      requestId: uuid(22), ...comparisonContext(22), answer: "yes", comment: "x".repeat(1_001),
    });
    expect(rejected).toMatchObject({ status: "error", code: "invalid_shape" });
  });

  it("replays identical requests, rejects changed request content, and resolves a context once", async () => {
    const t = backend();
    const account = await member(t, "dedup");
    const context = comparisonContext(30);
    const request = { requestId: uuid(31), ...context, answer: "yes" as const, comment: "Useful" };
    const first = await account.mutation(api.feedback.submitFeedback, request);
    await expect(account.mutation(api.feedback.submitFeedback, request)).resolves.toEqual({
      status: "replayed", requestId: request.requestId, ...context,
    });
    await expect(account.mutation(api.feedback.submitFeedback, { ...request, answer: "no" })).resolves.toMatchObject({
      status: "error", code: "request_reuse",
    });
    expect(first.status).toBe("submitted");
    await expect(account.mutation(api.feedback.submitFeedback, {
      requestId: uuid(32), ...context, answer: "no",
    })).resolves.toMatchObject({ status: "error", code: "already_resolved" });
  });

  it("makes dismissal terminal and keeps a changed context available", async () => {
    const t = backend();
    const account = await member(t, "dismiss");
    const context = comparisonContext(40);
    await expect(account.mutation(api.feedback.dismissFeedback, {
      requestId: uuid(41), ...context,
    })).resolves.toEqual({ status: "dismissed", requestId: uuid(41), ...context });
    await expect(account.query(api.feedback.getFeedbackStatus, context)).resolves.toEqual({ status: "dismissed", ...context });
    await expect(account.mutation(api.feedback.submitFeedback, {
      requestId: uuid(42), ...context, answer: "yes",
    })).resolves.toMatchObject({ status: "error", code: "already_resolved" });
    const changed = comparisonContext(43);
    await expect(account.query(api.feedback.getFeedbackStatus, changed)).resolves.toEqual({ status: "available", ...changed });
  });

  it("isolates owners even when they present the same opaque context ID", async () => {
    const t = backend();
    const accountA = await member(t, "owner-a");
    const accountB = await member(t, "owner-b");
    const context = comparisonContext(50);
    await accountA.mutation(api.feedback.submitFeedback, { requestId: uuid(51), ...context, answer: "yes" });
    await expect(accountB.query(api.feedback.getFeedbackStatus, context)).resolves.toEqual({ status: "available", ...context });
    await expect(accountB.mutation(api.feedback.dismissFeedback, { requestId: uuid(52), ...context })).resolves.toMatchObject({ status: "dismissed" });
    await expect(accountA.query(api.feedback.getFeedbackStatus, context)).resolves.toEqual({ status: "submitted", ...context });
  });

  it("rejects deleting profiles before reading or writing feedback", async () => {
    const t = backend();
    for (const [subject, status] of [["deleting", "deleting"], ["deleted", "deleted"]] as const) {
      const account = await member(t, subject);
      const profile = await account.query(api.users.currentUser, { expectedSubject: subject, sessionMarker: "test" });
      if (!profile) throw new Error("profile missing");
      await t.run(async (ctx) => ctx.db.patch(profile._id, { status }));
      const context = comparisonContext(status === "deleting" ? 60 : 62);
      await expect(account.query(api.feedback.getFeedbackStatus, context)).rejects.toThrow(/profile unavailable/i);
      await expect(account.mutation(api.feedback.submitFeedback, { requestId: uuid(status === "deleting" ? 61 : 63), ...context, answer: "yes" })).rejects.toThrow(/profile unavailable/i);
    }
  });

  it("rejects an authenticated identity with no provisioned profile", async () => {
    const t = backend();
    const account = t.withIdentity(identity("missing-profile"));
    const context = comparisonContext(64);
    await expect(account.query(api.feedback.getFeedbackStatus, context)).rejects.toThrow(/profile unavailable/i);
    await expect(account.mutation(api.feedback.dismissFeedback, { requestId: uuid(65), ...context })).rejects.toThrow(/profile unavailable/i);
  });

  it("enforces feature/version pairs and rejects malformed or forged context arguments", async () => {
    const t = backend();
    const account = await member(t, "validation");
    await expect(account.mutation(api.feedback.submitFeedback, {
      requestId: uuid(70), feature: "comparison", contextId: uuid(71), contextVersion: "v2", answer: "yes",
    })).resolves.toMatchObject({ status: "error", code: "invalid_enum" });
    await expect(account.mutation(api.feedback.submitFeedback, {
      requestId: uuid(72), feature: "other", contextId: uuid(73), contextVersion: "v1", answer: "yes",
    } as never)).rejects.toThrow();
    await expect(account.mutation(api.feedback.submitFeedback, {
      requestId: "forged", feature: "comparison", contextId: uuid(74), contextVersion: "v1", answer: "yes",
    })).resolves.toMatchObject({ status: "error", code: "invalid_id" });
  });

  it("allows twenty new writes, limits the twenty-first, and does not charge identical retries", async () => {
    const t = backend();
    const account = await member(t, "quota");
    const contexts = Array.from({ length: 20 }, (_, index) => comparisonContext(100 + index));
    for (let index = 0; index < contexts.length; index += 1) {
      await expect(account.mutation(api.feedback.submitFeedback, {
        requestId: uuid(200 + index), ...contexts[index], answer: "yes",
      })).resolves.toMatchObject({ status: "submitted" });
    }
    await expect(account.mutation(api.feedback.submitFeedback, {
      requestId: uuid(300), ...comparisonContext(300), answer: "yes",
    })).resolves.toMatchObject({ status: "limited", code: "rate_limited" });
    await expect(account.mutation(api.feedback.submitFeedback, {
      requestId: uuid(200), ...contexts[0], answer: "yes",
    })).resolves.toMatchObject({ status: "replayed" });

    const realNow = Date.now;
    const boundary = realNow() + 60 * 1000 + 1;
    Date.now = () => boundary;
    try {
      await expect(account.mutation(api.feedback.submitFeedback, {
        requestId: uuid(301), ...comparisonContext(301), answer: "yes",
      })).resolves.toMatchObject({ status: "submitted" });
    } finally {
      Date.now = realNow;
    }
  });

  it("serializes submit and dismiss races to one terminal outcome", async () => {
    const t = backend();
    const account = await member(t, "race");
    const context = comparisonContext(400);
    const [submitted, dismissed] = await Promise.all([
      account.mutation(api.feedback.submitFeedback, { requestId: uuid(401), ...context, answer: "yes" }),
      account.mutation(api.feedback.dismissFeedback, { requestId: uuid(402), ...context }),
    ]);
    const outcomes = [submitted, dismissed];
    expect(outcomes.filter((result) => result.status === "submitted" || result.status === "dismissed")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "error" && result.code === "already_resolved")).toHaveLength(1);
    const status = await account.query(api.feedback.getFeedbackStatus, context);
    expect(["submitted", "dismissed"]).toContain(status.status);
  });
});
