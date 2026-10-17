import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  canonicalSavedLoanPayload,
  parseCreatedAt,
  parseExpectedRevision,
  parseRequestId,
  parseSavedLoanPayload,
  type SavedLoanPayload,
} from "../lib/contracts/saved-loan";
import { ContractValidationError, exactKeys } from "../lib/contracts/errors";
import { bumpExportRevision } from "./exportRevision";

const loanBasis = v.union(
  v.literal("repo"),
  v.literal("tbill"),
  v.literal("mclr"),
  v.literal("fixed"),
);

const resetCycle = v.union(
  v.literal("monthly"),
  v.literal("quarterly"),
  v.literal("half"),
);

const loanInputProvenance = v.union(
  v.literal("confirmed"),
  v.literal("unknown"),
  v.literal("legacy"),
);

const loanRecord = v.object({
  lender: v.string(),
  original: v.number(),
  outstanding: v.number(),
  ratePct: v.number(),
  basis: loanBasis,
  spreadPct: v.union(v.number(), v.null()),
  spreadProvenance: v.optional(loanInputProvenance),
  cycle: resetCycle,
  lastReset: v.string(),
  lastResetProvenance: v.optional(loanInputProvenance),
  monthsLeft: v.number(),
});

const transferQuote = v.object({
  newRatePct: v.number(),
  feePct: v.number(),
  legalCharges: v.number(),
  keepTenure: v.boolean(),
  newTenureMonths: v.number(),
});

const payloadValidator = v.object({
  loan: loanRecord,
  quote: transferQuote,
  surplus: v.number(),
  bufferMonths: v.number(),
  rateResolvedAt: v.union(v.string(), v.null()),
});

const requestIdValidator = v.string();
const expectedRevisionValidator = v.number();
const createdAtValidator = v.string();

const saveArgsValidator = v.object({
  requestId: requestIdValidator,
  expectedRevision: expectedRevisionValidator,
  payload: payloadValidator,
  createdAt: createdAtValidator,
});

const deleteArgsValidator = v.object({
  requestId: requestIdValidator,
  expectedRevision: expectedRevisionValidator,
  createdAt: createdAtValidator,
});

const savedAckValidator = v.object({
  status: v.union(v.literal("saved"), v.literal("replayed"), v.literal("deleted")),
  requestId: v.string(),
  revision: v.number(),
});

const conflictValidator = v.object({
  status: v.literal("conflict"),
  code: v.literal("revision_conflict"),
  currentRevision: v.number(),
});

const errorValidator = v.object({
  status: v.literal("error"),
  code: v.string(),
  message: v.string(),
});

const operationResultValidator = v.union(
  savedAckValidator,
  conflictValidator,
  errorValidator,
);

const payloadProjectionValidator = v.object({
  loan: loanRecord,
  quote: transferQuote,
  surplus: v.number(),
  bufferMonths: v.number(),
  rateResolvedAt: v.union(v.string(), v.null()),
});

const currentLoanValidator = v.object({
  revision: v.number(),
  updatedAt: v.union(v.number(), v.null()),
  payload: v.union(payloadProjectionValidator, v.null()),
});

type ReadContext = QueryCtx | MutationCtx;
type OperationResult =
  | { status: "saved" | "replayed" | "deleted"; requestId: string; revision: number }
  | { status: "conflict"; code: "revision_conflict"; currentRevision: number }
  | { status: "error"; code: string; message: string };

const ENTITY_KIND = "savedLoan" as const;
const ENTITY_KEY = "singleton" as const;
const REPLAY_REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function activeOwnerId(ctx: ReadContext): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  const authKey = identity?.tokenIdentifier;
  if (!authKey) throw new Error("Unauthorized");
  const user = await ctx.db
    .query("users")
    .withIndex("by_authKey", (q) => q.eq("authKey", authKey))
    .unique();
  if (!user || user.status !== "active") throw new Error("Unauthorized");
  return user._id;
}

async function currentRecord(ctx: ReadContext, ownerId: Id<"users">) {
  return await ctx.db
    .query("savedLoans")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .unique();
}

async function currentTombstone(ctx: ReadContext, ownerId: Id<"users">) {
  return await ctx.db
    .query("recordTombstones")
    .withIndex("by_owner_entity", (q) =>
      q.eq("ownerId", ownerId).eq("entityKind", ENTITY_KIND).eq("entityKey", ENTITY_KEY),
    )
    .unique();
}

function activeProjection(record: {
  revision: number;
  updatedAt: number;
  loan: SavedLoanPayload["loan"];
  quote: SavedLoanPayload["quote"];
  surplus: number;
  bufferMonths: number;
  rateResolvedAt: string | null;
}) {
  return {
    revision: record.revision,
    updatedAt: record.updatedAt,
    payload: {
      loan: record.loan,
      quote: record.quote,
      surplus: record.surplus,
      bufferMonths: record.bufferMonths,
      rateResolvedAt: record.rateResolvedAt,
    },
  };
}

function emptyProjection(revision: number, updatedAt: number | null) {
  return { revision, updatedAt, payload: null };
}

function safeValidationFailure(error: unknown): OperationResult {
  if (error instanceof ContractValidationError) {
    return { status: "error", code: error.code, message: error.message };
  }
  return { status: "error", code: "invalid_shape", message: "Request payload is invalid" };
}

async function hashCanonical(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameReceipt(
  receipt: {
    kind: "save" | "delete";
    payloadHash: string;
    expectedRevision: number;
    createdAt: number;
    revision: number;
    status: "saved" | "deleted";
  },
  kind: "save" | "delete",
  payloadHash: string,
  expectedRevision: number,
  createdAt: number,
): boolean {
  return receipt.kind === kind &&
    receipt.payloadHash === payloadHash &&
    receipt.expectedRevision === expectedRevision &&
    receipt.createdAt === createdAt;
}

function requestReuseFailure(): OperationResult {
  return {
    status: "error",
    code: "request_reuse",
    message: "Request ID was already used for different content",
  };
}

export const currentLoan = query({
  args: {},
  returns: currentLoanValidator,
  handler: async (ctx) => {
    const ownerId = await activeOwnerId(ctx);
    const record = await currentRecord(ctx, ownerId);
    if (record) return activeProjection(record);
    const tombstone = await currentTombstone(ctx, ownerId);
    return emptyProjection(tombstone?.revision ?? 0, tombstone?.deletedAt ?? null);
  },
});

export const saveLoan = mutation({
  args: saveArgsValidator,
  returns: operationResultValidator,
  handler: async (ctx, args): Promise<OperationResult> => {
    const ownerId = await activeOwnerId(ctx);
    const now = Date.now();
    let parsed: {
      requestId: string;
      expectedRevision: number;
      createdAt: number;
      payload: Readonly<SavedLoanPayload>;
    };
    try {
      exactKeys(args as unknown as Record<string, unknown>, ["requestId", "expectedRevision", "payload", "createdAt"], "save");
      parsed = {
        requestId: parseRequestId(args.requestId),
        expectedRevision: parseExpectedRevision(args.expectedRevision),
        createdAt: parseCreatedAt(args.createdAt, now),
        payload: parseSavedLoanPayload(args.payload),
      };
    } catch (error) {
      return safeValidationFailure(error);
    }
    const { requestId, expectedRevision, createdAt, payload } = parsed;
    const payloadHash = await hashCanonical(canonicalSavedLoanPayload(payload));
    const receipt = await ctx.db
      .query("operationReceipts")
      .withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId).eq("requestId", requestId))
      .unique();
    if (receipt) {
      if (sameReceipt(receipt, "save", payloadHash, expectedRevision, createdAt)) {
        return { status: "replayed", requestId, revision: receipt.revision };
      }
      return requestReuseFailure();
    }
    const current = await currentRecord(ctx, ownerId);
    const tombstone = await currentTombstone(ctx, ownerId);
    const currentRevision = current?.revision ?? tombstone?.revision ?? 0;
    if (expectedRevision !== currentRevision) {
      return { status: "conflict", code: "revision_conflict", currentRevision };
    }
    const revision = currentRevision + 1;
    const row = {
      ownerId,
      ...payload,
      revision,
      updatedAt: now,
    };
    if (current) await ctx.db.patch(current._id, row);
    else await ctx.db.insert("savedLoans", row);
    await ctx.db.insert("operationReceipts", {
      ownerId,
      requestId,
      kind: "save",
      resourceKey: "savedLoan",
      payloadHash,
      expectedRevision,
      revision,
      status: "saved",
      createdAt,
      reviewAfter: now + REPLAY_REVIEW_WINDOW_MS,
    });
    await bumpExportRevision(ctx, ownerId);
    return { status: "saved", requestId, revision };
  },
});

export const deleteLoan = mutation({
  args: deleteArgsValidator,
  returns: operationResultValidator,
  handler: async (ctx, args): Promise<OperationResult> => {
    const ownerId = await activeOwnerId(ctx);
    const now = Date.now();
    let parsed: { requestId: string; expectedRevision: number; createdAt: number };
    try {
      exactKeys(args as unknown as Record<string, unknown>, ["requestId", "expectedRevision", "createdAt"], "delete");
      parsed = {
        requestId: parseRequestId(args.requestId),
        expectedRevision: parseExpectedRevision(args.expectedRevision),
        createdAt: parseCreatedAt(args.createdAt, now),
      };
    } catch (error) {
      return safeValidationFailure(error);
    }
    const { requestId, expectedRevision, createdAt } = parsed;
    const payloadHash = await hashCanonical("savedLoan:delete");
    const receipt = await ctx.db
      .query("operationReceipts")
      .withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId).eq("requestId", requestId))
      .unique();
    if (receipt) {
      if (sameReceipt(receipt, "delete", payloadHash, expectedRevision, createdAt)) {
        return { status: "replayed", requestId, revision: receipt.revision };
      }
      return requestReuseFailure();
    }
    const current = await currentRecord(ctx, ownerId);
    const tombstone = await currentTombstone(ctx, ownerId);
    const currentRevision = current?.revision ?? tombstone?.revision ?? 0;
    if (expectedRevision !== currentRevision) {
      return { status: "conflict", code: "revision_conflict", currentRevision };
    }
    if (!current) {
      return { status: "error", code: "not_found", message: "Saved loan does not exist" };
    }
    const revision = currentRevision + 1;
    await ctx.db.delete(current._id);
    const tombstoneData = {
      ownerId,
      entityKind: ENTITY_KIND,
      entityKey: ENTITY_KEY,
      revision,
      deletedAt: now,
      reviewAfter: now + REPLAY_REVIEW_WINDOW_MS,
    } as const;
    if (tombstone) await ctx.db.patch(tombstone._id, tombstoneData);
    else await ctx.db.insert("recordTombstones", tombstoneData);
    await ctx.db.insert("operationReceipts", {
      ownerId,
      requestId,
      kind: "delete",
      resourceKey: "savedLoan",
      payloadHash,
      expectedRevision,
      revision,
      status: "deleted",
      createdAt,
      reviewAfter: now + REPLAY_REVIEW_WINDOW_MS,
    });
    await bumpExportRevision(ctx, ownerId);
    return { status: "deleted", requestId, revision };
  },
});
