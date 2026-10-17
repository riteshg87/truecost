import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  checkMixpanelDeletion,
  createMixpanelDeletion,
  deleteClerkUser,
  type ClerkDeletionResult,
  type MixpanelDeletionResult,
  type ProviderManualCode,
  type ProviderRetryCode,
} from "./lib/deletionProviders";

const LEASE_MS = 30_000;
const POLL_DELAY_MS = 60_000;
const POLL_DELAY_STEP_MS = 5 * 60_000;
const POLL_DELAY_MAX_MS = 60 * 60_000;
const PROVIDER_PENDING_DEADLINE_MS = 30 * 24 * 60 * 60_000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 8;

const providerStage = v.union(
  v.literal("mixpanel_create_pending"),
  v.literal("mixpanel_create_in_flight"),
  v.literal("mixpanel_poll_pending"),
  v.literal("clerk_pending"),
  v.literal("manual_review"),
  v.literal("complete"),
);
const retryCode = v.union(v.literal("timeout"), v.literal("network"), v.literal("rate_limited"), v.literal("server_error"));
const manualCode = v.union(v.literal("configuration"), v.literal("malformed_response"), v.literal("redirect_blocked"), v.literal("unexpected_status"), v.literal("provider_failure"), v.literal("ambiguous"));
const claimResult = v.object({
  status: v.union(v.literal("claimed"), v.literal("busy"), v.literal("manual_review"), v.literal("completed"), v.literal("ignored")),
  attemptToken: v.union(v.string(), v.null()),
});
const executionResult = v.union(
  v.object({ status: v.literal("ignored") }),
  v.object({ status: v.literal("pending"), trackingId: v.union(v.string(), v.null()) }),
  v.object({ status: v.literal("success"), trackingId: v.union(v.string(), v.null()) }),
  v.object({ status: v.literal("retry"), code: retryCode, retryAfterMs: v.number() }),
  v.object({ status: v.literal("manual_review"), code: manualCode }),
);
const finalizeResult = v.object({ status: v.union(v.literal("applied"), v.literal("ignored")) });

type JobId = Id<"accountDeletionJobs">;
type ProviderStage = "mixpanel_create_pending" | "mixpanel_create_in_flight" | "mixpanel_poll_pending" | "clerk_pending" | "manual_review" | "complete";
type ProviderJob = {
  _id: JobId;
  ownerId: Id<"users">;
  subject: string;
  status: "app_pending" | "providers_pending" | "completed";
  analyticsAccountId: string | null;
  providerStage?: ProviderStage;
  providerTrackingId?: string | null;
  providerLeaseUntil?: number | null;
  providerAttemptToken?: string | null;
  providerAttemptNumber?: number;
  providerRetryCount?: number | null;
  providerPollCount?: number | null;
  providerPendingSince?: number | null;
  providerNextAttemptAt?: number | null;
};

const providerJobRef = makeFunctionReference<"query", { jobId: JobId }, ProviderJob | null>("accountDeletionProviders:getJob");
const claimRef = makeFunctionReference<"mutation", { jobId: JobId }>("accountDeletionProviders:claimProvider");
const executeRef = makeFunctionReference<"action", { jobId: JobId; attemptToken: string }>("accountDeletionProviders:executeProvider");
const finalizeRef = makeFunctionReference<"mutation", { jobId: JobId; attemptToken: string; result: ProviderExecution }>("accountDeletionProviders:finalizeProvider");

type ProviderExecution =
  | { status: "ignored" }
  | { status: "pending"; trackingId: string | null }
  | { status: "success"; trackingId: string | null }
  | { status: "retry"; code: ProviderRetryCode; retryAfterMs: number }
  | { status: "manual_review"; code: ProviderManualCode };

function retryDelay(value: number, retryCount: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 1_000;
  const exponent = Math.min(Math.max(retryCount - 1, 0), 10);
  return Math.min(value * (2 ** exponent), MAX_RETRY_DELAY_MS);
}

function pollDelay(pollCount: number): number {
  if (pollCount <= 0) return POLL_DELAY_MS;
  if (pollCount === 1) return POLL_DELAY_STEP_MS;
  return POLL_DELAY_MAX_MS;
}

function mixpanelConfig(distinctId: string) {
  const projectToken = process.env.TRUECOST_MIXPANEL_PROJECT_TOKEN;
  const privacyApiToken = process.env.TRUECOST_MIXPANEL_PRIVACY_API_TOKEN;
  return projectToken && privacyApiToken ? { projectToken, privacyApiToken, distinctId } : null;
}

function clerkConfig(userId: string) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  return secretKey ? { secretKey, userId } : null;
}

async function scheduleClaim(ctx: MutationCtx, jobId: JobId, delayMs: number): Promise<void> {
  await ctx.scheduler.runAfter(Math.max(0, Math.min(delayMs, MAX_RETRY_DELAY_MS)), claimRef, { jobId });
}

/** Internal read used only by the side-effecting provider action. */
export const getJob = internalQuery({
  args: { jobId: v.id("accountDeletionJobs") },
  returns: v.union(v.null(), v.object({
    _id: v.id("accountDeletionJobs"), ownerId: v.id("users"), subject: v.string(),
    status: v.union(v.literal("app_pending"), v.literal("providers_pending"), v.literal("completed")),
    analyticsAccountId: v.union(v.string(), v.null()), providerStage: v.optional(providerStage),
    providerTrackingId: v.optional(v.union(v.string(), v.null())), providerLeaseUntil: v.optional(v.union(v.number(), v.null())),
    providerAttemptToken: v.optional(v.union(v.string(), v.null())), providerAttemptNumber: v.optional(v.number()),
    providerRetryCount: v.optional(v.union(v.number(), v.null())),
    providerPollCount: v.optional(v.union(v.number(), v.null())), providerPendingSince: v.optional(v.union(v.number(), v.null())),
    providerNextAttemptAt: v.optional(v.union(v.number(), v.null())),
  })),
  handler: async (ctx, args): Promise<ProviderJob | null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    return {
      _id: job._id, ownerId: job.ownerId, subject: job.subject, status: job.status,
      analyticsAccountId: job.analyticsAccountId, providerStage: job.providerStage,
      providerTrackingId: job.providerTrackingId, providerLeaseUntil: job.providerLeaseUntil,
      providerAttemptToken: job.providerAttemptToken, providerAttemptNumber: job.providerAttemptNumber,
      providerRetryCount: job.providerRetryCount,
      providerPollCount: job.providerPollCount, providerPendingSince: job.providerPendingSince,
      providerNextAttemptAt: job.providerNextAttemptAt,
    };
  },
});

/** Claims one provider operation. Creation is fenced durably before its action runs. */
export const claimProvider = internalMutation({
  args: { jobId: v.id("accountDeletionJobs") },
  returns: claimResult,
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status === "app_pending") return { status: "ignored" as const, attemptToken: null };
    if (job.status === "completed" || job.providerStage === "complete") return { status: "completed" as const, attemptToken: null };
    if (job.providerStage === "manual_review") return { status: "manual_review" as const, attemptToken: null };
    const now = Date.now();
    if (job.providerLeaseUntil !== null && job.providerLeaseUntil !== undefined && job.providerLeaseUntil > now) return { status: "busy" as const, attemptToken: null };
    if (job.providerStage === "mixpanel_create_in_flight") {
      await ctx.db.patch(job._id, { providerStage: "manual_review", providerCode: "ambiguous", providerLeaseUntil: null, providerAttemptToken: null, providerNextAttemptAt: null, updatedAt: now });
      return { status: "manual_review" as const, attemptToken: null };
    }
    if (job.providerNextAttemptAt !== null && job.providerNextAttemptAt !== undefined && job.providerNextAttemptAt > now) {
      await scheduleClaim(ctx, job._id, job.providerNextAttemptAt - now);
      return { status: "busy" as const, attemptToken: null };
    }
    let stage: ProviderStage = job.providerStage ?? (job.analyticsAccountId === null ? "clerk_pending" : "mixpanel_create_pending");
    if (stage === "mixpanel_create_pending") stage = "mixpanel_create_in_flight";
    const attemptNumber = (job.providerAttemptNumber ?? 0) + 1;
    const attemptToken = `${job._id}:provider:${attemptNumber}`;
    await ctx.db.patch(job._id, {
      providerStage: stage,
      providerLeaseUntil: now + LEASE_MS,
      providerAttemptToken: attemptToken,
      providerAttemptNumber: attemptNumber,
      providerNextAttemptAt: null,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, executeRef, { jobId: job._id, attemptToken });
    await ctx.scheduler.runAfter(LEASE_MS + 1, claimRef, { jobId: job._id });
    return { status: "claimed" as const, attemptToken };
  },
});

function resultFromMixpanel(result: MixpanelDeletionResult): ProviderExecution {
  if (result.status === "pending") return { status: "pending", trackingId: result.trackingId };
  if (result.status === "success") return { status: "success", trackingId: result.trackingId };
  if (result.status === "retry") return { status: "retry", code: result.code, retryAfterMs: result.retryAfterMs };
  return { status: "manual_review", code: result.code };
}

function resultFromClerk(result: ClerkDeletionResult): ProviderExecution {
  if (result.status === "success") return { status: "success", trackingId: null };
  if (result.status === "retry") return { status: "retry", code: result.code, retryAfterMs: result.retryAfterMs };
  return { status: "manual_review", code: result.code };
}

/** Performs one bounded external request, then commits only through the fence. */
export const executeProvider = internalAction({
  args: { jobId: v.id("accountDeletionJobs"), attemptToken: v.string() },
  returns: executionResult,
  handler: async (ctx: ActionCtx, args): Promise<ProviderExecution> => {
    const job = await ctx.runQuery(providerJobRef, { jobId: args.jobId });
    if (!job || job.status !== "providers_pending" || job.providerAttemptToken !== args.attemptToken || job.providerLeaseUntil === null || job.providerLeaseUntil === undefined || job.providerLeaseUntil <= Date.now()) return { status: "ignored" };
    let result: ProviderExecution;
    try {
      const stage = job.providerStage ?? (job.analyticsAccountId === null ? "clerk_pending" : "mixpanel_create_in_flight");
      if (stage === "mixpanel_create_in_flight") {
        const config = job.analyticsAccountId === null ? null : mixpanelConfig(job.analyticsAccountId);
        result = config ? resultFromMixpanel(await createMixpanelDeletion(config)) : { status: "manual_review", code: "configuration" };
      } else if (stage === "mixpanel_poll_pending" && job.providerTrackingId) {
        const config = mixpanelConfig(job.analyticsAccountId ?? "");
        result = config ? resultFromMixpanel(await checkMixpanelDeletion(config, job.providerTrackingId)) : { status: "manual_review", code: "configuration" };
      } else if (stage === "clerk_pending") {
        const config = clerkConfig(job.subject);
        result = config ? resultFromClerk(await deleteClerkUser(config)) : { status: "manual_review", code: "configuration" };
      } else {
        result = { status: "ignored" };
      }
    } catch {
      result = { status: "manual_review", code: "provider_failure" };
    }
    await ctx.runMutation(finalizeRef, { jobId: args.jobId, attemptToken: args.attemptToken, result });
    return result;
  },
});

/** Applies an action result only if its lease token is still current. */
export const finalizeProvider = internalMutation({
  args: { jobId: v.id("accountDeletionJobs"), attemptToken: v.string(), result: executionResult },
  returns: finalizeResult,
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (!job || job.status !== "providers_pending" || job.providerAttemptToken !== args.attemptToken || job.providerLeaseUntil === null || job.providerLeaseUntil === undefined || job.providerLeaseUntil <= now) return { status: "ignored" as const };
    if (args.result.status === "ignored") return { status: "ignored" as const };
    if (args.result.status === "retry") {
      const retryCount = (job.providerRetryCount ?? 0) + 1;
      if (retryCount > MAX_RETRIES) {
        await ctx.db.patch(job._id, { providerStage: "manual_review", providerLeaseUntil: null, providerAttemptToken: null, providerNextAttemptAt: null, providerCode: "provider_failure", providerRetryCount: retryCount, providerLastRetryCode: args.result.code, updatedAt: now });
        return { status: "applied" as const };
      }
      const delay = retryDelay(args.result.retryAfterMs, retryCount);
      const nextStage = job.providerStage === "mixpanel_create_in_flight" ? "mixpanel_create_pending" : job.providerStage;
      await ctx.db.patch(job._id, { providerStage: nextStage, providerLeaseUntil: null, providerAttemptToken: null, providerNextAttemptAt: now + delay, providerCode: null, providerRetryCount: retryCount, providerLastRetryCode: args.result.code, updatedAt: now });
      await scheduleClaim(ctx, job._id, delay);
      return { status: "applied" as const };
    }
    if (args.result.status === "manual_review") {
      await ctx.db.patch(job._id, { providerStage: "manual_review", providerLeaseUntil: null, providerAttemptToken: null, providerNextAttemptAt: null, providerCode: args.result.code, updatedAt: now });
      return { status: "applied" as const };
    }
    if (job.providerStage === "mixpanel_create_in_flight") {
      if (typeof args.result.trackingId !== "string" || !args.result.trackingId) {
        await ctx.db.patch(job._id, { providerStage: "manual_review", providerLeaseUntil: null, providerAttemptToken: null, providerCode: "malformed_response", updatedAt: now });
      } else {
        const delay = args.result.status === "pending" ? POLL_DELAY_MS : 0;
        await ctx.db.patch(job._id, { providerStage: "mixpanel_poll_pending", providerTrackingId: args.result.trackingId, providerLeaseUntil: null, providerAttemptToken: null, providerNextAttemptAt: delay ? now + delay : null, providerCode: null, providerRetryCount: 0, providerLastRetryCode: null, providerPollCount: 0, providerPendingSince: now, updatedAt: now });
        await scheduleClaim(ctx, job._id, delay);
      }
      return { status: "applied" as const };
    }
    if (job.providerStage === "mixpanel_poll_pending") {
      if (args.result.trackingId !== job.providerTrackingId) {
        await ctx.db.patch(job._id, { providerStage: "manual_review", providerLeaseUntil: null, providerAttemptToken: null, providerCode: "malformed_response", updatedAt: now });
      } else if (args.result.status === "pending") {
        const pendingSince = job.providerPendingSince ?? now;
        if (now - pendingSince >= PROVIDER_PENDING_DEADLINE_MS) {
          await ctx.db.patch(job._id, { providerStage: "manual_review", providerLeaseUntil: null, providerAttemptToken: null, providerNextAttemptAt: null, providerCode: "provider_failure", providerRetryCount: 0, providerLastRetryCode: null, providerPendingSince: pendingSince, updatedAt: now });
        } else {
          const count = (job.providerPollCount ?? 0) + 1;
          const delay = pollDelay(count);
          await ctx.db.patch(job._id, { providerLeaseUntil: null, providerAttemptToken: null, providerNextAttemptAt: now + delay, providerCode: null, providerRetryCount: 0, providerLastRetryCode: null, providerPollCount: count, providerPendingSince: pendingSince, updatedAt: now });
          await scheduleClaim(ctx, job._id, delay);
        }
      } else {
        await ctx.db.patch(job._id, { providerStage: "clerk_pending", providerLeaseUntil: null, providerAttemptToken: null, providerNextAttemptAt: null, providerCode: null, providerRetryCount: 0, providerLastRetryCode: null, providerPollCount: 0, providerPendingSince: null, updatedAt: now });
        await scheduleClaim(ctx, job._id, 0);
      }
      return { status: "applied" as const };
    }
    if (job.providerStage === "clerk_pending" && args.result.status === "success") {
      await ctx.db.patch(job._id, { status: "completed", providerStage: "complete", stage: "providers", providerLeaseUntil: null, providerAttemptToken: null, providerNextAttemptAt: null, providerCode: null, updatedAt: now });
      return { status: "applied" as const };
    }
    return { status: "ignored" as const };
  },
});
