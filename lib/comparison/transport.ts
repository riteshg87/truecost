import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { readConvexUrl } from "../auth/config";
import { canonicalTimestamp, ContractValidationError, uuidValue } from "../contracts/errors";
import { decodeComparisonSnapshot, serializeComparisonSnapshot } from "../contracts/snapshot";

export type ComparisonSource = "guest" | "member";

export interface ComparisonSaveInput {
  requestId: string;
  snapshot: string;
  createdAt: string;
  title: string | null;
  source: ComparisonSource;
}

export interface ComparisonSaveAcknowledgement {
  status: "saved" | "replayed";
  requestId: string;
  resultId: string;
  serverHash: string;
}

export interface ComparisonTransport {
  saveComparison(input: ComparisonSaveInput): Promise<ComparisonSaveAcknowledgement>;
}

export interface ComparisonTransportOptions {
  url: string;
  identity: Readonly<{ subject: string; sessionId: string; authEpoch: number; profileId: string; verifiedOnline: true }>;
  getToken: () => Promise<string | null>;
  isCurrent: () => boolean;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export class ComparisonTransportError extends Error {
  constructor(readonly code: ComparisonTransportErrorCode, readonly retryAfterMs?: number) {
    super(code);
    this.name = "ComparisonTransportError";
  }
}

export type ComparisonTransportErrorCode =
  | "network"
  | "timeout"
  | "unavailable"
  | "rate_limited"
  | "unauthorized"
  | "invalid_shape"
  | "invalid_timestamp"
  | "invalid_id"
  | "expired"
  | "request_reuse"
  | "result_conflict"
  | "deleted";

function tokenMatches(token: string | null, identity: ComparisonTransportOptions["identity"], now: number): token is string {
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

function safeFailure(error: unknown): ComparisonTransportError {
  if (error instanceof ComparisonTransportError) return error;
  if (error instanceof ContractValidationError) {
    const code = error.code;
    if (code === "invalid_timestamp" || code === "invalid_id" || code === "expired" || code === "invalid_shape") {
      return new ComparisonTransportError(code);
    }
    return new ComparisonTransportError("invalid_shape");
  }
  if (error instanceof SyntaxError) return new ComparisonTransportError("invalid_shape");
  const message = error instanceof Error ? error.message : "";
  if (/Unauthorized|unauthorized|authentication/i.test(message)) return new ComparisonTransportError("unauthorized");
  if (/timeout|abort/i.test(message)) return new ComparisonTransportError("timeout");
  if (/rate_limited|rate limit/i.test(message)) return new ComparisonTransportError("rate_limited");
  if (/deleted/i.test(message)) return new ComparisonTransportError("deleted");
  if (/request_reuse/i.test(message)) return new ComparisonTransportError("request_reuse");
  if (/result_conflict/i.test(message)) return new ComparisonTransportError("result_conflict");
  return new ComparisonTransportError("network");
}

async function sha256Hex(value: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new ComparisonTransportError("unavailable");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function expectedServerHash(input: ComparisonSaveInput, canonicalSnapshot: string, resultId: string): Promise<string> {
  return sha256Hex(JSON.stringify(["comparison", "save", canonicalSnapshot, resultId, input.title, input.source, input.createdAt]));
}

async function requireAcknowledgement(result: unknown, input: ComparisonSaveInput): Promise<ComparisonSaveAcknowledgement> {
  if (!result || typeof result !== "object") throw new ComparisonTransportError("invalid_shape");
  const value = result as Record<string, unknown>;
  if (value.status === "blocked" && value.code === "deleted") throw new ComparisonTransportError("deleted");
  if (value.status === "limited" && value.code === "rate_limited") {
    const retryAfterMs = value.retryAfterMs;
    if (typeof retryAfterMs !== "number" || !Number.isFinite(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > 24 * 60 * 60 * 1000) {
      throw new ComparisonTransportError("invalid_shape");
    }
    throw new ComparisonTransportError("rate_limited", retryAfterMs);
  }
  if (value.status === "error") {
    const code = value.code;
    if (code === "request_reuse" || code === "result_conflict") throw new ComparisonTransportError(code);
    if (code === "rate_limited") throw new ComparisonTransportError(code);
    throw new ComparisonTransportError("invalid_shape");
  }
  let snapshot: ReturnType<typeof decodeComparisonSnapshot>;
  let canonicalSnapshot: string;
  try {
    if (new TextEncoder().encode(input.snapshot).byteLength > 256 * 1024) throw new Error("too large");
    snapshot = decodeComparisonSnapshot(JSON.parse(input.snapshot));
    canonicalSnapshot = serializeComparisonSnapshot(snapshot);
  } catch { throw new ComparisonTransportError("invalid_shape"); }
  if (value.status !== "saved" && value.status !== "replayed" || value.requestId !== input.requestId ||
      value.resultId !== snapshot.resultId || typeof value.serverHash !== "string" || !/^[a-f0-9]{64}$/.test(value.serverHash)) {
    throw new ComparisonTransportError("invalid_shape");
  }
  const expectedHash = await expectedServerHash(input, canonicalSnapshot, snapshot.resultId);
  if (value.serverHash !== expectedHash) throw new ComparisonTransportError("invalid_shape");
  return { status: value.status, requestId: input.requestId, resultId: value.resultId, serverHash: value.serverHash };
}

export function createSessionBoundComparisonTransport(options: ComparisonTransportOptions): ComparisonTransport {
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
      const timeout = setTimeout(() => abort.abort(), 15_000);
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
    async saveComparison(input) {
      let stable: ComparisonSaveInput;
      try {
        if (!input || typeof input !== "object" || typeof input.snapshot !== "string" ||
            new TextEncoder().encode(input.snapshot).byteLength > 256 * 1024) {
          throw new ComparisonTransportError("invalid_shape");
        }
        stable = {
          requestId: uuidValue(input.requestId, "requestId"),
          snapshot: serializeComparisonSnapshot(decodeComparisonSnapshot(JSON.parse(input.snapshot))),
          createdAt: canonicalTimestamp(input.createdAt, "createdAt"),
          title: input.title === null ? null : typeof input.title === "string" && input.title.length <= 120
            ? (input.title.trim() || null)
            : (() => { throw new ComparisonTransportError("invalid_shape"); })(),
          source: input.source === "guest" || input.source === "member" ? input.source : (() => { throw new ComparisonTransportError("invalid_shape"); })(),
        };
      } catch (error) {
        throw safeFailure(error);
      }
      const result = await request((client) => client.mutation(api.comparisons.saveComparison, stable));
      return await requireAcknowledgement(result, stable);
    },
  };
}
