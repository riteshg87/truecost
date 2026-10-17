import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  canonicalFeedbackDismissalPayload,
  canonicalFeedbackPayload,
  parseFeedbackDismissal,
  parseFeedbackInput,
  type FeedbackFeature,
} from "../lib/contracts/feedback";
import { ContractValidationError, exactKeys } from "../lib/contracts/errors";
import { bumpExportRevision } from "./exportRevision";

const MAX_NEW_WRITES_PER_MINUTE = 20;
const RATE_WINDOW_MS = 60 * 1000;
const FEATURE_VERSIONS: Record<FeedbackFeature, readonly string[]> = {
  comparison: ["v1"],
  loan_health: ["v1"],
};

const featureValidator = v.union(v.literal("comparison"), v.literal("loan_health"));
const answerValidator = v.union(v.literal("yes"), v.literal("no"));
const contextArgsValidator = v.object({
  feature: featureValidator,
  contextId: v.string(),
  contextVersion: v.string(),
});
const submitArgsValidator = v.object({
  requestId: v.string(),
  feature: featureValidator,
  contextId: v.string(),
  contextVersion: v.string(),
  answer: answerValidator,
  comment: v.optional(v.union(v.string(), v.null())),
});
const dismissArgsValidator = v.object({
  requestId: v.string(),
  feature: featureValidator,
  contextId: v.string(),
  contextVersion: v.string(),
});

const operationResultValidator = v.union(
  v.object({
    status: v.union(v.literal("submitted"), v.literal("replayed")),
    requestId: v.string(),
    feature: featureValidator,
    contextId: v.string(),
    contextVersion: v.string(),
  }),
  v.object({
    status: v.union(v.literal("dismissed"), v.literal("replayed")),
    requestId: v.string(),
    feature: featureValidator,
    contextId: v.string(),
    contextVersion: v.string(),
  }),
  v.object({
    status: v.literal("limited"),
    code: v.literal("rate_limited"),
    retryAfterMs: v.number(),
    message: v.string(),
  }),
  v.object({
    status: v.literal("error"),
    code: v.string(),
    message: v.string(),
  }),
);

const statusValidator = v.object({
  status: v.union(v.literal("available"), v.literal("submitted"), v.literal("dismissed")),
  feature: featureValidator,
  contextId: v.string(),
  contextVersion: v.string(),
});

type ReadContext = QueryCtx | MutationCtx;
type OwnerId = Id<"users">;
type FeedbackInput = ReturnType<typeof parseFeedbackInput>;
type DismissalInput = ReturnType<typeof parseFeedbackDismissal>;
type OperationResult =
  | { status: "submitted" | "replayed"; requestId: string; feature: FeedbackFeature; contextId: string; contextVersion: string }
  | { status: "dismissed" | "replayed"; requestId: string; feature: FeedbackFeature; contextId: string; contextVersion: string }
  | { status: "limited"; code: "rate_limited"; retryAfterMs: number; message: string }
  | { status: "error"; code: string; message: string };

async function activeOwnerId(ctx: ReadContext): Promise<OwnerId> {
  const identity = await ctx.auth.getUserIdentity();
  const authKey = identity?.tokenIdentifier;
  if (!authKey) throw new Error("Authenticated identity is unavailable");
  const user = await ctx.db
    .query("users")
    .withIndex("by_authKey", (q) => q.eq("authKey", authKey))
    .unique();
  if (!user || user.status !== "active") throw new Error("Profile unavailable");
  return user._id;
}

function checkFeatureVersion(feature: FeedbackFeature, contextVersion: string): void {
  if (!FEATURE_VERSIONS[feature].includes(contextVersion)) {
    throw new ContractValidationError("invalid_enum", "feedback feature/version is not supported");
  }
}

function safeError(error: unknown): { status: "error"; code: string; message: string } {
  if (error instanceof ContractValidationError) {
    return { status: "error", code: error.code, message: error.message };
  }
  return { status: "error", code: "invalid_shape", message: "Feedback request is invalid" };
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rateLimit(ctx: MutationCtx, ownerId: OwnerId, now: number): Promise<OperationResult | null> {
  const row = await ctx.db
    .query("feedbackRateLimits")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .unique();
  const recent = (row?.successfulAt ?? []).filter((timestamp) =>
    Number.isFinite(timestamp) && timestamp <= now && now - timestamp < RATE_WINDOW_MS,
  );
  if (recent.length >= MAX_NEW_WRITES_PER_MINUTE) {
    const oldest = Math.min(...recent);
    return {
      status: "limited",
      code: "rate_limited",
      retryAfterMs: Math.max(1, Math.ceil(RATE_WINDOW_MS - (now - oldest))),
      message: "Feedback write limit reached; try again later",
    };
  }
  const next = [...recent, now].slice(-MAX_NEW_WRITES_PER_MINUTE);
  if (row) await ctx.db.patch(row._id, { successfulAt: next });
  else await ctx.db.insert("feedbackRateLimits", { ownerId, successfulAt: next });
  return null;
}

function contextResult(status: "submitted" | "dismissed" | "replayed", input: FeedbackInput | DismissalInput) {
  return {
    status,
    requestId: input.requestId,
    feature: input.feature,
    contextId: input.contextId,
    contextVersion: input.contextVersion,
  } as const;
}

export const getFeedbackStatus = query({
  args: contextArgsValidator,
  returns: statusValidator,
  handler: async (ctx, args) => {
    const ownerId = await activeOwnerId(ctx);
    let input: DismissalInput;
    try {
      exactKeys(args as unknown as Record<string, unknown>, ["feature", "contextId", "contextVersion"], "feedbackStatus");
      input = parseFeedbackDismissal({ requestId: "00000000-0000-4000-8000-000000000000", ...args });
      checkFeatureVersion(input.feature, input.contextVersion);
    } catch (error) {
      throw error instanceof ContractValidationError ? error : new Error("Feedback context is invalid");
    }
    const submitted = await ctx.db
      .query("feedback")
      .withIndex("by_owner_context", (q) =>
        q.eq("ownerId", ownerId).eq("feature", input.feature).eq("contextId", input.contextId).eq("contextVersion", input.contextVersion),
      )
      .unique();
    if (submitted) return { status: "submitted" as const, feature: input.feature, contextId: input.contextId, contextVersion: input.contextVersion };
    const dismissed = await ctx.db
      .query("feedbackDismissals")
      .withIndex("by_owner_context", (q) =>
        q.eq("ownerId", ownerId).eq("feature", input.feature).eq("contextId", input.contextId).eq("contextVersion", input.contextVersion),
      )
      .unique();
    return {
      status: dismissed ? ("dismissed" as const) : ("available" as const),
      feature: input.feature,
      contextId: input.contextId,
      contextVersion: input.contextVersion,
    };
  },
});

export const submitFeedback = mutation({
  args: submitArgsValidator,
  returns: operationResultValidator,
  handler: async (ctx, args): Promise<OperationResult> => {
    const ownerId = await activeOwnerId(ctx);
    let input: FeedbackInput;
    try {
      exactKeys(args as unknown as Record<string, unknown>, ["requestId", "feature", "contextId", "contextVersion", "answer", "comment"], "submitFeedback");
      input = parseFeedbackInput(args);
      checkFeatureVersion(input.feature, input.contextVersion);
    } catch (error) {
      return safeError(error);
    }
    const payloadHash = await hash(canonicalFeedbackPayload(input));
    const existingSubmission = await ctx.db
      .query("feedback")
      .withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId).eq("requestId", input.requestId))
      .unique();
    const existingDismissal = await ctx.db
      .query("feedbackDismissals")
      .withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId).eq("requestId", input.requestId))
      .unique();
    if (existingSubmission || existingDismissal) {
      const same = existingSubmission?.payloadHash === payloadHash;
      return same
        ? contextResult("replayed", input)
        : { status: "error", code: "request_reuse", message: "Request ID was already used for different content" };
    }
    const existingContext = await ctx.db
      .query("feedback")
      .withIndex("by_owner_context", (q) =>
        q.eq("ownerId", ownerId).eq("feature", input.feature).eq("contextId", input.contextId).eq("contextVersion", input.contextVersion),
      )
      .unique();
    const existingContextDismissal = await ctx.db
      .query("feedbackDismissals")
      .withIndex("by_owner_context", (q) =>
        q.eq("ownerId", ownerId).eq("feature", input.feature).eq("contextId", input.contextId).eq("contextVersion", input.contextVersion),
      )
      .unique();
    if (existingContext || existingContextDismissal) {
      return { status: "error", code: "already_resolved", message: "Feedback was already resolved for this context" };
    }
    const now = Date.now();
    const limited = await rateLimit(ctx, ownerId, now);
    if (limited) return limited;
    await ctx.db.insert("feedback", { ownerId, ...input, payloadHash, createdAt: now });
    await bumpExportRevision(ctx, ownerId);
    return contextResult("submitted", input);
  },
});

export const dismissFeedback = mutation({
  args: dismissArgsValidator,
  returns: operationResultValidator,
  handler: async (ctx, args): Promise<OperationResult> => {
    const ownerId = await activeOwnerId(ctx);
    let input: DismissalInput;
    try {
      exactKeys(args as unknown as Record<string, unknown>, ["requestId", "feature", "contextId", "contextVersion"], "dismissFeedback");
      input = parseFeedbackDismissal(args);
      checkFeatureVersion(input.feature, input.contextVersion);
    } catch (error) {
      return safeError(error);
    }
    const payloadHash = await hash(canonicalFeedbackDismissalPayload(input));
    const existingSubmission = await ctx.db
      .query("feedback")
      .withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId).eq("requestId", input.requestId))
      .unique();
    const existingDismissal = await ctx.db
      .query("feedbackDismissals")
      .withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId).eq("requestId", input.requestId))
      .unique();
    if (existingSubmission || existingDismissal) {
      const same = existingDismissal?.payloadHash === payloadHash;
      return same
        ? contextResult("replayed", input)
        : { status: "error", code: "request_reuse", message: "Request ID was already used for different content" };
    }
    const existingContext = await ctx.db
      .query("feedback")
      .withIndex("by_owner_context", (q) =>
        q.eq("ownerId", ownerId).eq("feature", input.feature).eq("contextId", input.contextId).eq("contextVersion", input.contextVersion),
      )
      .unique();
    const existingContextDismissal = await ctx.db
      .query("feedbackDismissals")
      .withIndex("by_owner_context", (q) =>
        q.eq("ownerId", ownerId).eq("feature", input.feature).eq("contextId", input.contextId).eq("contextVersion", input.contextVersion),
      )
      .unique();
    if (existingContext || existingContextDismissal) {
      return { status: "error", code: "already_resolved", message: "Feedback was already resolved for this context" };
    }
    const now = Date.now();
    const limited = await rateLimit(ctx, ownerId, now);
    if (limited) return limited;
    await ctx.db.insert("feedbackDismissals", { ownerId, ...input, payloadHash, createdAt: now });
    await bumpExportRevision(ctx, ownerId);
    return contextResult("dismissed", input);
  },
});
