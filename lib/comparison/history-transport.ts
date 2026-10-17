import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { readConvexUrl } from "../auth/config";
import {
  canonicalTimestamp,
  ContractValidationError,
  stringValue,
  uuidValue,
} from "../contracts/errors";
import {
  decodeComparisonSnapshot,
  serializeComparisonSnapshot,
  type ComparisonSnapshot,
} from "../contracts/snapshot";
import {
  ComparisonTransportError,
  type ComparisonTransportErrorCode,
  type ComparisonTransportOptions,
} from "./transport";

const MAX_PAGE_ITEMS = 50;
const MAX_CURSOR_LENGTH = 16_384;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_TITLE_LENGTH = 120;
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export interface ComparisonHistoryRecord {
  comparisonId: string;
  creationTime: number;
  resultId: string;
  snapshot: Readonly<ComparisonSnapshot>;
  title: string | null;
  source: "guest" | "member";
  createdAt: string;
  calculationVersion: string;
}

export interface ComparisonHistoryListInput {
  cursor?: string | null;
  numItems?: number;
}

export interface ComparisonHistoryPage {
  page: readonly ComparisonHistoryRecord[];
  isDone: boolean;
  continueCursor: string;
}

export interface ComparisonHistoryDeleteInput {
  requestId: string;
  resultId: string;
  createdAt: string;
  /** Optional guard for the row the caller asked to delete. */
  comparisonId?: string | null;
}

export interface ComparisonHistoryDeleteAcknowledgement {
  status: "deleted" | "replayed";
  requestId: string;
  resultId: string;
  comparisonId: string | null;
  serverHash: string;
}

export interface ComparisonHistoryTransport {
  listComparisons(input?: ComparisonHistoryListInput): Promise<ComparisonHistoryPage>;
  getComparison(comparisonId: string): Promise<ComparisonHistoryRecord | null>;
  deleteComparison(input: ComparisonHistoryDeleteInput): Promise<ComparisonHistoryDeleteAcknowledgement>;
}

function safeFailure(error: unknown): ComparisonTransportError {
  if (error instanceof ComparisonTransportError) return error;
  if (error instanceof ContractValidationError) {
    const code: ComparisonTransportErrorCode = error.code === "invalid_timestamp" ||
      error.code === "invalid_id" || error.code === "expired" || error.code === "invalid_shape"
      ? error.code
      : "invalid_shape";
    return new ComparisonTransportError(code);
  }
  if (error instanceof SyntaxError) return new ComparisonTransportError("invalid_shape");
  const message = error instanceof Error ? error.message : "";
  if (/Unauthorized|unauthorized|authentication/i.test(message)) return new ComparisonTransportError("unauthorized");
  if (/timeout|abort/i.test(message)) return new ComparisonTransportError("timeout");
  if (/rate_limited|rate limit/i.test(message)) return new ComparisonTransportError("rate_limited");
  if (/request_reuse/i.test(message)) return new ComparisonTransportError("request_reuse");
  if (/result_conflict/i.test(message)) return new ComparisonTransportError("result_conflict");
  if (/deleted/i.test(message)) return new ComparisonTransportError("deleted");
  return new ComparisonTransportError("network");
}

function tokenMatches(
  token: string | null,
  identity: ComparisonTransportOptions["identity"],
  now: number,
): token is string {
  if (!token || token.length > 32_768) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const body = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(body.padEnd(Math.ceil(body.length / 4) * 4, "="))) as Record<string, unknown>;
    return claims.sub === identity.subject && claims.sid === identity.sessionId && claims.aud === "convex" &&
      typeof claims.exp === "number" && Number.isFinite(claims.exp) && claims.exp * 1000 > now;
  } catch {
    return false;
  }
}

async function sha256Hex(value: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new ComparisonTransportError("unavailable");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function comparisonIdValue(value: unknown, label: string): string {
  return stringValue(value, label, 128);
}

function parseHistoryRecord(value: unknown): ComparisonHistoryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ComparisonTransportError("invalid_shape");
  const row = value as Record<string, unknown>;
  const comparisonId = comparisonIdValue(row._id, "comparison._id");
  if (typeof row._creationTime !== "number" || !Number.isFinite(row._creationTime) || row._creationTime < 0 || row._creationTime > Number.MAX_SAFE_INTEGER) {
    throw new ComparisonTransportError("invalid_shape");
  }
  const resultId = uuidValue(row.resultId, "comparison.resultId");
  if (typeof row.snapshot !== "string" || new TextEncoder().encode(row.snapshot).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new ComparisonTransportError("invalid_shape");
  }
  const snapshot = decodeComparisonSnapshot(JSON.parse(row.snapshot));
  const canonical = serializeComparisonSnapshot(snapshot);
  if (canonical !== row.snapshot || snapshot.resultId !== resultId) throw new ComparisonTransportError("invalid_shape");
  const createdAt = canonicalTimestamp(row.createdAt, "comparison.createdAt");
  if (Date.parse(snapshot.createdAt) > Date.parse(createdAt)) throw new ComparisonTransportError("invalid_shape");
  if (snapshot.calculationVersion !== row.calculationVersion) throw new ComparisonTransportError("invalid_shape");
  const title = row.title === null ? null : stringValue(row.title, "comparison.title", MAX_TITLE_LENGTH, false);
  if (title !== null && title.trim() !== title) throw new ComparisonTransportError("invalid_shape");
  if (row.source !== "guest" && row.source !== "member") throw new ComparisonTransportError("invalid_shape");
  return {
    comparisonId,
    creationTime: row._creationTime,
    resultId,
    snapshot,
    title,
    source: row.source,
    createdAt,
    calculationVersion: stringValue(row.calculationVersion, "comparison.calculationVersion", 64),
  };
}

function parseListResult(value: unknown, requestedItems: number): ComparisonHistoryPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ComparisonTransportError("invalid_shape");
  const envelope = value as Record<string, unknown>;
  if (envelope.status === "error") {
    const code = envelope.code;
    if (code === "rate_limited") throw new ComparisonTransportError("rate_limited");
    throw new ComparisonTransportError("invalid_shape");
  }
  if (envelope.status !== "ok" || !envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) {
    throw new ComparisonTransportError("invalid_shape");
  }
  const result = envelope.result as Record<string, unknown>;
  if (!Array.isArray(result.page) || result.page.length > requestedItems || typeof result.isDone !== "boolean" ||
      typeof result.continueCursor !== "string" || result.continueCursor.length > MAX_CURSOR_LENGTH) {
    throw new ComparisonTransportError("invalid_shape");
  }
  const page = result.page.map(parseHistoryRecord);
  if (new Set(page.map((row) => row.comparisonId)).size !== page.length ||
      new Set(page.map((row) => row.resultId)).size !== page.length) {
    throw new ComparisonTransportError("invalid_shape");
  }
  return { page, isDone: result.isDone, continueCursor: result.continueCursor };
}

function retryAfterMsValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_RETRY_AFTER_MS) {
    throw new ComparisonTransportError("invalid_shape");
  }
  return value;
}

async function parseDeleteResult(value: unknown, input: ComparisonHistoryDeleteInput): Promise<ComparisonHistoryDeleteAcknowledgement> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ComparisonTransportError("invalid_shape");
  const result = value as Record<string, unknown>;
  if (result.status === "limited") {
    if (result.code !== "rate_limited") throw new ComparisonTransportError("invalid_shape");
    throw new ComparisonTransportError("rate_limited", retryAfterMsValue(result.retryAfterMs));
  }
  if (result.status === "error") {
    if (result.code === "request_reuse" || result.code === "result_conflict" || result.code === "deleted") {
      throw new ComparisonTransportError(result.code);
    }
    if (result.code === "expired") throw new ComparisonTransportError("expired");
    if (result.code === "rate_limited") throw new ComparisonTransportError("rate_limited");
    throw new ComparisonTransportError("invalid_shape");
  }
  if (result.status !== "deleted" && result.status !== "replayed" ||
      result.requestId !== input.requestId || result.resultId !== input.resultId ||
      (result.comparisonId !== null && typeof result.comparisonId !== "string") ||
      typeof result.serverHash !== "string" || !/^[a-f0-9]{64}$/.test(result.serverHash)) {
    throw new ComparisonTransportError("invalid_shape");
  }
  const expectedServerHash = await sha256Hex(JSON.stringify([
    "comparison", "delete", "", input.resultId, null, null, input.createdAt,
  ]));
  if (result.serverHash !== expectedServerHash) throw new ComparisonTransportError("invalid_shape");
  if (input.comparisonId !== undefined && input.comparisonId !== null &&
      result.comparisonId !== null && result.comparisonId !== input.comparisonId) {
    throw new ComparisonTransportError("invalid_shape");
  }
  return {
    status: result.status,
    requestId: input.requestId,
    resultId: input.resultId,
    comparisonId: result.comparisonId as string | null,
    serverHash: result.serverHash,
  };
}

export function createSessionBoundComparisonHistoryTransport(
  options: ComparisonTransportOptions,
): ComparisonHistoryTransport {
  const url = readConvexUrl(options.url);
  if (!url) throw new ComparisonTransportError("invalid_shape");
  const identity = Object.freeze({ ...options.identity });
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;

  function assertCurrent() {
    if (!options.isCurrent()) throw new ComparisonTransportError("unauthorized");
  }

  async function request<T>(run: (client: ConvexHttpClient) => Promise<T>): Promise<T> {
    try {
      assertCurrent();
      const token = await options.getToken();
      assertCurrent();
      if (!tokenMatches(token, identity, now())) throw new ComparisonTransportError("unauthorized");
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      try {
        const client = new ConvexHttpClient(url!, {
          auth: token,
          logger: false,
          fetch: async (input, init) => {
            assertCurrent();
            return await fetcher(input, { ...init, signal: abort.signal, credentials: "omit", cache: "no-store" });
          },
        });
        const result = await run(client);
        assertCurrent();
        return result;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      throw safeFailure(error);
    }
  }

  return {
    async listComparisons(input = {}) {
      let stable: Required<ComparisonHistoryListInput>;
      try {
        const cursor = input.cursor === undefined ? null : input.cursor;
        const numItems = input.numItems === undefined ? MAX_PAGE_ITEMS : input.numItems;
        if (cursor !== null && (typeof cursor !== "string" || cursor.length > MAX_CURSOR_LENGTH ||
            /[\u0000-\u001f\u007f]/.test(cursor)) ||
            typeof numItems !== "number" || !Number.isSafeInteger(numItems) || numItems < 1 || numItems > MAX_PAGE_ITEMS) {
          throw new ComparisonTransportError("invalid_shape");
        }
        stable = { cursor, numItems };
      } catch (error) {
        throw safeFailure(error);
      }
      const value = await request((client) => client.query(api.comparisons.listComparisons, { paginationOpts: stable }));
      let page: ComparisonHistoryPage;
      try {
        page = parseListResult(value, stable.numItems);
      } catch (error) {
        throw safeFailure(error);
      }
      assertCurrent();
      return page;
    },

    async getComparison(comparisonId) {
      let stableId: string;
      try {
        stableId = comparisonIdValue(comparisonId, "comparisonId");
      } catch (error) {
        throw safeFailure(error);
      }
      const value = await request((client) => client.query(api.comparisons.getComparison, { comparisonId: stableId as Id<"comparisons"> }));
      if (value === null) return null;
      let row: ComparisonHistoryRecord;
      try {
        row = parseHistoryRecord(value);
        if (row.comparisonId !== stableId) throw new ComparisonTransportError("invalid_shape");
      } catch (error) {
        throw safeFailure(error);
      }
      assertCurrent();
      return row;
    },

    async deleteComparison(input) {
      let stable: ComparisonHistoryDeleteInput;
      try {
        if (!input || typeof input !== "object") throw new ComparisonTransportError("invalid_shape");
        const createdAt = canonicalTimestamp(input.createdAt, "createdAt");
        const createdMs = Date.parse(createdAt);
        const nowMs = now();
        if (createdMs > nowMs) throw new ComparisonTransportError("invalid_timestamp");
        if (nowMs - createdMs > REQUEST_MAX_AGE_MS) throw new ComparisonTransportError("expired");
        stable = {
          requestId: uuidValue(input.requestId, "requestId"),
          resultId: uuidValue(input.resultId, "resultId"),
          createdAt,
          ...(input.comparisonId === undefined ? {} : { comparisonId: input.comparisonId === null ? null : comparisonIdValue(input.comparisonId, "comparisonId") }),
        };
      } catch (error) {
        throw safeFailure(error);
      }
      const value = await request((client) => client.mutation(api.comparisons.deleteComparison, {
        requestId: stable.requestId,
        resultId: stable.resultId,
        createdAt: stable.createdAt,
      }));
      let receipt: ComparisonHistoryDeleteAcknowledgement;
      try {
        receipt = await parseDeleteResult(value, stable);
      } catch (error) {
        throw safeFailure(error);
      }
      assertCurrent();
      return receipt;
    },
  };
}
