import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  ContractValidationError,
  canonicalTimestamp,
  contractFail,
  exactKeys,
  stringValue,
  uuidValue,
} from "../lib/contracts/errors";
import {
  decodeComparisonSnapshot,
  serializeComparisonSnapshot,
  type ComparisonSnapshot,
} from "../lib/contracts/snapshot";
import { bumpExportRevision } from "./exportRevision";

const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_TITLE_LENGTH = 120;
const MAX_CURSOR_LENGTH = 16_384;
const MAX_PAGE_ITEMS = 50;
const MAX_ROWS_READ = 50;
const MAX_BYTES_READ = 512 * 1024;
const REQUEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const QUOTA_WINDOW_MS = 60 * 1000;
const QUOTA_LIMIT = 20;

const sourceValidator = v.union(v.literal("guest"), v.literal("member"));
const saveArgsValidator = v.object({
  requestId: v.string(),
  snapshot: v.string(),
  createdAt: v.string(),
  title: v.union(v.string(), v.null()),
  source: sourceValidator,
});
const deleteArgsValidator = v.object({
  requestId: v.string(),
  resultId: v.string(),
  createdAt: v.string(),
});

const comparisonView = v.object({
  _id: v.id("comparisons"),
  _creationTime: v.number(),
  resultId: v.string(),
  snapshot: v.string(),
  title: v.union(v.string(), v.null()),
  source: sourceValidator,
  createdAt: v.string(),
  calculationVersion: v.string(),
});

const savedResult = v.object({
  status: v.union(v.literal("saved"), v.literal("replayed")),
  requestId: v.string(),
  resultId: v.string(),
  comparisonId: v.id("comparisons"),
  serverHash: v.string(),
});
const deletedResult = v.object({
  status: v.union(v.literal("deleted"), v.literal("replayed")),
  requestId: v.string(),
  resultId: v.string(),
  comparisonId: v.union(v.id("comparisons"), v.null()),
  serverHash: v.string(),
});
const blockedResult = v.object({
  status: v.literal("blocked"),
  code: v.literal("deleted"),
  requestId: v.string(),
  resultId: v.string(),
  message: v.string(),
});
const conflictResult = v.object({
  status: v.literal("error"),
  code: v.union(v.literal("request_reuse"), v.literal("result_conflict")),
  message: v.string(),
});
const limitedResult = v.object({
  status: v.literal("limited"),
  code: v.literal("rate_limited"),
  retryAfterMs: v.number(),
  message: v.string(),
});
const validationResult = v.object({
  status: v.literal("error"),
  code: v.string(),
  message: v.string(),
});
const saveResult = v.union(savedResult, blockedResult, conflictResult, limitedResult, validationResult);
const deleteResult = v.union(deletedResult, conflictResult, limitedResult, validationResult);

const listPage = paginationResultValidator(comparisonView);
const listResult = v.union(
  v.object({ status: v.literal("ok"), result: listPage }),
  validationResult,
);

type ReadContext = QueryCtx | MutationCtx;
type ComparisonRow = {
  _id: Id<"comparisons">;
  _creationTime: number;
  resultId: string;
  snapshot: string;
  title: string | null;
  source: "guest" | "member";
  createdAt: string;
  calculationVersion: string;
};
type SaveResult =
  | { status: "saved" | "replayed"; requestId: string; resultId: string; comparisonId: Id<"comparisons">; serverHash: string }
  | { status: "blocked"; code: "deleted"; requestId: string; resultId: string; message: string }
  | { status: "error"; code: "request_reuse" | "result_conflict"; message: string }
  | { status: "limited"; code: "rate_limited"; retryAfterMs: number; message: string }
  | { status: "error"; code: string; message: string };
type DeleteResult =
  | { status: "deleted" | "replayed"; requestId: string; resultId: string; comparisonId: Id<"comparisons"> | null; serverHash: string }
  | { status: "error"; code: "request_reuse"; message: string }
  | { status: "limited"; code: "rate_limited"; retryAfterMs: number; message: string }
  | { status: "error"; code: string; message: string };

function safeError(error: unknown): { status: "error"; code: string; message: string } {
  if (error instanceof ContractValidationError) {
    return { status: "error", code: error.code, message: error.message };
  }
  return { status: "error", code: "invalid_shape", message: "Comparison request is invalid" };
}

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

function parseTitle(value: string | null): string | null {
  if (value === null) return null;
  const title = stringValue(value, "title", MAX_TITLE_LENGTH, false).trim();
  return title.length === 0 ? null : title;
}

function parseOriginalCreatedAt(value: string, now: number): string {
  const createdAt = canonicalTimestamp(value, "createdAt");
  const createdMs = Date.parse(createdAt);
  if (createdMs > now) contractFail("invalid_timestamp", "createdAt cannot be in the future");
  if (now - createdMs > REQUEST_MAX_AGE_MS) contractFail("expired", "createdAt is outside the retry window");
  return createdAt;
}

function parseSnapshotJson(value: string, createdAt: string): { snapshot: Readonly<ComparisonSnapshot>; canonical: string } {
  if (typeof TextEncoder !== "undefined" && new TextEncoder().encode(value).byteLength > MAX_SNAPSHOT_BYTES) {
    contractFail("invalid_shape", "snapshot is too large");
  }
  let decodedValue: unknown;
  try {
    decodedValue = JSON.parse(value);
  } catch {
    contractFail("invalid_shape", "snapshot is not valid JSON");
  }
  const snapshot = decodeComparisonSnapshot(decodedValue);
  if (Date.parse(snapshot.createdAt) > Date.parse(createdAt)) {
    contractFail("invalid_timestamp", "snapshot createdAt cannot be after the save request");
  }
  const canonical = serializeComparisonSnapshot(snapshot);
  if (new TextEncoder().encode(canonical).byteLength > MAX_SNAPSHOT_BYTES) {
    contractFail("invalid_shape", "snapshot is too large");
  }
  return { snapshot, canonical };
}

async function hashCanonical(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function operationHashInput(
  kind: "save" | "delete",
  canonicalPayload: string,
  resultId: string,
  title: string | null,
  source: "guest" | "member" | null,
  createdAt: string,
): string {
  return JSON.stringify(["comparison", kind, canonicalPayload, resultId, title, source, createdAt]);
}

function receiptMatches(
  receipt: {
    kind: "save" | "delete";
    resultId: string;
    createdAt: string;
    serverHash: string;
  },
  kind: "save" | "delete",
  resultId: string,
  createdAt: string,
  serverHash: string,
): boolean {
  return receipt.kind === kind && receipt.resultId === resultId && receipt.createdAt === createdAt &&
    receipt.serverHash === serverHash;
}

function toView(row: ComparisonRow) {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    resultId: row.resultId,
    snapshot: row.snapshot,
    title: row.title,
    source: row.source,
    createdAt: row.createdAt,
    calculationVersion: row.calculationVersion,
  };
}

async function consumeQuota(ctx: MutationCtx, ownerId: Id<"users">, now: number): Promise<null | { status: "limited"; code: "rate_limited"; retryAfterMs: number; message: string }> {
  const row = await ctx.db
    .query("comparisonRateLimits")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .unique();
  const timestamps = (row?.successfulAt ?? []).filter((timestamp) =>
    Number.isFinite(timestamp) && timestamp <= now && now - timestamp < QUOTA_WINDOW_MS,
  );
  if (timestamps.length >= QUOTA_LIMIT) {
    const oldest = Math.min(...timestamps);
    const retryAfterMs = Math.max(1, Math.ceil(QUOTA_WINDOW_MS - (now - oldest)));
    return { status: "limited", code: "rate_limited", retryAfterMs, message: "Comparison write limit reached; retry later" };
  }
  const next = [...timestamps, now].slice(-QUOTA_LIMIT);
  if (row) await ctx.db.patch(row._id, { successfulAt: next });
  else await ctx.db.insert("comparisonRateLimits", { ownerId, successfulAt: next });
  return null;
}

async function parseSave(
  args: { requestId: string; snapshot: string; createdAt: string; title: string | null; source: "guest" | "member" },
  now: number,
) {
  exactKeys(args as unknown as Record<string, unknown>, ["requestId", "snapshot", "createdAt", "title", "source"], "saveComparison");
  const requestId = uuidValue(args.requestId, "requestId");
  const createdAt = parseOriginalCreatedAt(args.createdAt, now);
  const { snapshot, canonical } = parseSnapshotJson(args.snapshot, createdAt);
  const title = parseTitle(args.title);
  const payloadHash = await hashCanonical(canonical);
  const serverHash = await hashCanonical(operationHashInput("save", canonical, snapshot.resultId, title, args.source, createdAt));
  return { requestId, createdAt, snapshot, canonical, title, payloadHash, serverHash };
}

export const saveComparison = mutation({
  args: saveArgsValidator,
  returns: saveResult,
  handler: async (ctx, args): Promise<SaveResult> => {
    const ownerId = await activeOwnerId(ctx);
    const now = Date.now();
    let parsed: Awaited<ReturnType<typeof parseSave>>;
    try {
      parsed = await parseSave(args, now);
    } catch (error) {
      return safeError(error);
    }
    const { requestId, createdAt, snapshot, canonical, title, payloadHash, serverHash } = parsed;
    const existingReceipt = await ctx.db
      .query("comparisonReceipts")
      .withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId).eq("requestId", requestId))
      .unique();
    if (existingReceipt) {
      if (receiptMatches(existingReceipt, "save", snapshot.resultId, createdAt, serverHash)) {
        return existingReceipt.comparisonId
          ? { status: "replayed", requestId, resultId: snapshot.resultId, comparisonId: existingReceipt.comparisonId, serverHash: existingReceipt.serverHash }
          : { status: "blocked", code: "deleted", requestId, resultId: snapshot.resultId, message: "Comparison was deleted" };
      }
      return { status: "error", code: "request_reuse", message: "Request ID was already used for different content" };
    }
    const tombstone = await ctx.db
      .query("comparisonTombstones")
      .withIndex("by_owner_resultId", (q) => q.eq("ownerId", ownerId).eq("resultId", snapshot.resultId))
      .unique();
    if (tombstone) return { status: "blocked", code: "deleted", requestId, resultId: snapshot.resultId, message: "Comparison was deleted" };

    const existing = await ctx.db
      .query("comparisons")
      .withIndex("by_owner_resultId", (q) => q.eq("ownerId", ownerId).eq("resultId", snapshot.resultId))
      .unique();
    if (existing) {
      if (existing.payloadHash === payloadHash && existing.title === title && existing.source === args.source) {
        const limited = await consumeQuota(ctx, ownerId, now);
        if (limited) return limited;
        await ctx.db.insert("comparisonReceipts", {
          ownerId,
          requestId,
          kind: "save",
          resultId: snapshot.resultId,
          comparisonId: existing._id,
          createdAt,
          serverHash,
          status: "saved",
          reviewAfter: now + REQUEST_MAX_AGE_MS,
        });
        return { status: "replayed", requestId, resultId: snapshot.resultId, comparisonId: existing._id, serverHash };
      }
      return { status: "error", code: "result_conflict", message: "A different comparison already uses this result ID" };
    }
    const limited = await consumeQuota(ctx, ownerId, now);
    if (limited) return limited;
    const comparisonId = await ctx.db.insert("comparisons", {
      ownerId,
      resultId: snapshot.resultId,
      requestId,
      snapshot: canonical,
      payloadHash,
      title,
      source: args.source,
      createdAt,
      calculationVersion: snapshot.calculationVersion,
      reviewAfter: now + REQUEST_MAX_AGE_MS,
    });
    await ctx.db.insert("comparisonReceipts", {
      ownerId,
      requestId,
      kind: "save",
      resultId: snapshot.resultId,
      comparisonId,
      createdAt,
      serverHash,
      status: "saved",
      reviewAfter: now + REQUEST_MAX_AGE_MS,
    });
    await bumpExportRevision(ctx, ownerId);
    return { status: "saved", requestId, resultId: snapshot.resultId, comparisonId, serverHash };
  },
});

export const getComparison = query({
  args: { comparisonId: v.id("comparisons") },
  returns: v.union(comparisonView, v.null()),
  handler: async (ctx, args) => {
    const ownerId = await activeOwnerId(ctx);
    const row = await ctx.db.get(args.comparisonId);
    if (!row || row.ownerId !== ownerId) return null;
    return toView(row);
  },
});

export const listComparisons = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: listResult,
  handler: async (ctx, args) => {
    const ownerId = await activeOwnerId(ctx);
    const pagination = args.paginationOpts;
    if (!Number.isInteger(pagination.numItems) || pagination.numItems < 1 || pagination.numItems > MAX_PAGE_ITEMS) {
      return { status: "error" as const, code: "invalid_number", message: "numItems must be an integer from 1 to 50" };
    }
    for (const key of Object.keys(pagination)) {
      if (!["numItems", "cursor", "endCursor", "id", "maximumRowsRead", "maximumBytesRead"].includes(key)) {
        return { status: "error" as const, code: "unknown_field", message: "Pagination options are invalid" };
      }
    }
    if ((pagination.cursor !== null && pagination.cursor.length > MAX_CURSOR_LENGTH) ||
      (pagination.endCursor !== undefined && pagination.endCursor !== null && pagination.endCursor.length > MAX_CURSOR_LENGTH)) {
      return { status: "error" as const, code: "invalid_shape", message: "Pagination cursor is invalid" };
    }
    try {
      const result = await ctx.db
        .query("comparisons")
        .withIndex("by_owner_createdAt", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .paginate({
          ...pagination,
          numItems: Math.min(pagination.numItems, MAX_PAGE_ITEMS),
          maximumRowsRead: MAX_ROWS_READ,
          maximumBytesRead: MAX_BYTES_READ,
        });
      return { status: "ok" as const, result: { ...result, page: result.page.map(toView) } };
    } catch {
      return { status: "error" as const, code: "invalid_cursor", message: "Pagination cursor is invalid or expired" };
    }
  },
});

export const deleteComparison = mutation({
  args: deleteArgsValidator,
  returns: deleteResult,
  handler: async (ctx, args): Promise<DeleteResult> => {
    const ownerId = await activeOwnerId(ctx);
    const now = Date.now();
    let requestId: string;
    let resultId: string;
    let createdAt: string;
    try {
      exactKeys(args as unknown as Record<string, unknown>, ["requestId", "resultId", "createdAt"], "deleteComparison");
      requestId = uuidValue(args.requestId, "requestId");
      resultId = uuidValue(args.resultId, "resultId");
      createdAt = parseOriginalCreatedAt(args.createdAt, now);
    } catch (error) {
      return safeError(error);
    }
    const serverHash = await hashCanonical(operationHashInput("delete", "", resultId, null, null, createdAt));
    const existingReceipt = await ctx.db
      .query("comparisonReceipts")
      .withIndex("by_owner_requestId", (q) => q.eq("ownerId", ownerId).eq("requestId", requestId))
      .unique();
    if (existingReceipt) {
      if (receiptMatches(existingReceipt, "delete", resultId, createdAt, serverHash)) {
        return { status: "replayed", requestId, resultId, comparisonId: existingReceipt.comparisonId, serverHash: existingReceipt.serverHash };
      }
      return { status: "error", code: "request_reuse", message: "Request ID was already used for different content" };
    }
    const tombstone = await ctx.db
      .query("comparisonTombstones")
      .withIndex("by_owner_resultId", (q) => q.eq("ownerId", ownerId).eq("resultId", resultId))
      .unique();
    const existing = await ctx.db
      .query("comparisons")
      .withIndex("by_owner_resultId", (q) => q.eq("ownerId", ownerId).eq("resultId", resultId))
      .unique();
    if (tombstone) {
      const limited = await consumeQuota(ctx, ownerId, now);
      if (limited) return limited;
      await ctx.db.insert("comparisonReceipts", {
        ownerId, requestId, kind: "delete", resultId, comparisonId: null,
        createdAt, serverHash, status: "deleted", reviewAfter: now + REQUEST_MAX_AGE_MS,
      });
      return { status: "replayed", requestId, resultId, comparisonId: null, serverHash };
    }
    const limited = await consumeQuota(ctx, ownerId, now);
    if (limited) return limited;
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("comparisonTombstones", {
      ownerId, resultId, deletedAt: now, reviewAfter: now + REQUEST_MAX_AGE_MS,
    });
    await ctx.db.insert("comparisonReceipts", {
      ownerId, requestId, kind: "delete", resultId, comparisonId: existing?._id ?? null,
      createdAt, serverHash, status: "deleted", reviewAfter: now + REQUEST_MAX_AGE_MS,
    });
    if (existing) await bumpExportRevision(ctx, ownerId);
    return { status: "deleted", requestId, resultId, comparisonId: existing?._id ?? null, serverHash };
  },
});
