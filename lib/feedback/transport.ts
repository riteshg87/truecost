import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { readConvexUrl } from "../auth/config";
import type { PrivateSessionAccess } from "../auth/private-session";
import { ContractValidationError } from "../contracts/errors";
import {
  parseFeedbackDismissal,
  parseFeedbackInput,
  type FeedbackAnswer,
} from "../contracts/feedback";
import type { FeedbackContext } from "./context";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

export interface FeedbackSubmission {
  readonly requestId: string;
  readonly context: FeedbackContext;
  readonly answer: FeedbackAnswer;
  readonly comment?: string | null;
}

export interface FeedbackStatus {
  readonly status: "available" | "submitted" | "dismissed";
  readonly context: FeedbackContext;
}

export interface FeedbackAcknowledgement {
  readonly status: "submitted" | "dismissed" | "replayed";
  readonly requestId: string;
  readonly context: FeedbackContext;
}

export type FeedbackTransportErrorCode =
  | "unavailable" | "unauthorized" | "network" | "timeout" | "invalid_shape"
  | "invalid_id" | "rate_limited" | "request_reuse" | "already_resolved";

export class FeedbackTransportError extends Error {
  constructor(readonly code: FeedbackTransportErrorCode, readonly retryAfterMs?: number) {
    super(code);
    this.name = "FeedbackTransportError";
  }
}

export interface FeedbackTransport {
  getStatus(context: FeedbackContext): Promise<FeedbackStatus>;
  submit(input: FeedbackSubmission): Promise<FeedbackAcknowledgement>;
  dismiss(context: FeedbackContext, requestId: string): Promise<FeedbackAcknowledgement>;
}

function tokenMatches(token: string | null, identity: PrivateSessionAccess["identity"], now: number): token is string {
  if (!token || token.length > 32_768) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const body = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(body.padEnd(Math.ceil(body.length / 4) * 4, "="))) as Record<string, unknown>;
    return claims.sub === identity.subject && claims.sid === identity.sessionId && claims.aud === "convex" &&
      typeof claims.exp === "number" && Number.isFinite(claims.exp) && claims.exp * 1000 > now;
  } catch { return false; }
}

function safeFailure(error: unknown): FeedbackTransportError {
  if (error instanceof FeedbackTransportError) return error;
  if (error instanceof ContractValidationError) {
    return new FeedbackTransportError(error.code === "invalid_id" ? "invalid_id" : "invalid_shape");
  }
  const message = error instanceof Error ? error.message : "";
  if (/unauthorized|authentication|profile/i.test(message)) return new FeedbackTransportError("unauthorized");
  if (/timeout|abort/i.test(message)) return new FeedbackTransportError("timeout");
  if (/rate_limited|rate limit/i.test(message)) return new FeedbackTransportError("rate_limited");
  if (/request_reuse/i.test(message)) return new FeedbackTransportError("request_reuse");
  if (/already_resolved/i.test(message)) return new FeedbackTransportError("already_resolved");
  return new FeedbackTransportError("network");
}

function safeContext(context: FeedbackContext): FeedbackContext {
  try {
    if (context.contextVersion !== "v1" || (context.feature !== "comparison" && context.feature !== "loan_health")) {
      throw new FeedbackTransportError("invalid_shape");
    }
    return Object.freeze({ feature: context.feature, contextId: parseFeedbackDismissal({ requestId: "00000000-0000-4000-8000-000000000000", ...context }).contextId, contextVersion: context.contextVersion });
  } catch (error) { throw safeFailure(error); }
}

function parseContextResult(value: unknown, expected: FeedbackContext): FeedbackStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FeedbackTransportError("invalid_shape");
  const row = value as Record<string, unknown>;
  if ((row.status !== "available" && row.status !== "submitted" && row.status !== "dismissed") ||
      row.feature !== expected.feature || row.contextId !== expected.contextId || row.contextVersion !== expected.contextVersion) {
    throw new FeedbackTransportError("invalid_shape");
  }
  return { status: row.status, context: expected };
}

function parseOperationResult(value: unknown, expectedRequestId: string, expected: FeedbackContext, expectedStatus: "submitted" | "dismissed"): FeedbackAcknowledgement {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FeedbackTransportError("invalid_shape");
  const row = value as Record<string, unknown>;
  if (row.status === "limited") {
    if (row.code !== "rate_limited" || typeof row.retryAfterMs !== "number" || !Number.isFinite(row.retryAfterMs) || row.retryAfterMs < 0 || row.retryAfterMs > MAX_RETRY_AFTER_MS) throw new FeedbackTransportError("invalid_shape");
    throw new FeedbackTransportError("rate_limited", row.retryAfterMs);
  }
  if (row.status === "error") {
    if (row.code === "request_reuse" || row.code === "already_resolved") throw new FeedbackTransportError(row.code);
    if (row.code === "rate_limited") throw new FeedbackTransportError("rate_limited");
    throw new FeedbackTransportError("invalid_shape");
  }
  if (row.status !== expectedStatus && row.status !== "replayed" || row.requestId !== expectedRequestId ||
      row.feature !== expected.feature || row.contextId !== expected.contextId || row.contextVersion !== expected.contextVersion) {
    throw new FeedbackTransportError("invalid_shape");
  }
  return { status: row.status as FeedbackAcknowledgement["status"], requestId: expectedRequestId, context: expected };
}

export function createSessionBoundFeedbackTransport(options: {
  readonly session: PrivateSessionAccess;
  readonly url?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}): FeedbackTransport {
  const url = readConvexUrl(options.url ?? process.env.NEXT_PUBLIC_CONVEX_URL);
  if (!url) throw new FeedbackTransportError("unavailable");
  const session = options.session;
  const identity = Object.freeze({ ...session.identity });
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;
  const assertCurrent = () => { if (!session.isCurrent()) throw new FeedbackTransportError("unauthorized"); };

  async function request<T>(run: (client: ConvexHttpClient) => Promise<T>): Promise<T> {
    try {
      assertCurrent();
      const token = await session.getToken();
      assertCurrent();
      if (!tokenMatches(token, identity, now())) throw new FeedbackTransportError("unauthorized");
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      try {
        const client = new ConvexHttpClient(url!, {
          auth: token,
          logger: false,
          fetch: async (input, init) => {
            assertCurrent();
            return fetcher(input, { ...init, signal: abort.signal, credentials: "omit", cache: "no-store" });
          },
        });
        const result = await run(client);
        assertCurrent();
        return result;
      } finally { clearTimeout(timeout); }
    } catch (error) { throw safeFailure(error); }
  }

  return {
    async getStatus(input) {
      const context = safeContext(input);
      const result = await request((client) => client.query(api.feedback.getFeedbackStatus, context));
      try { return parseContextResult(result, context); } catch (error) { throw safeFailure(error); }
    },
    async submit(input) {
      let stable: ReturnType<typeof parseFeedbackInput>;
      try {
        const context = safeContext(input.context);
        stable = parseFeedbackInput({
          requestId: input.requestId,
          feature: context.feature,
          contextId: context.contextId,
          contextVersion: context.contextVersion,
          answer: input.answer,
          comment: input.comment ?? null,
        });
      } catch (error) { throw safeFailure(error); }
      const result = await request((client) => client.mutation(api.feedback.submitFeedback, stable));
      try { return parseOperationResult(result, stable.requestId, { feature: stable.feature, contextId: stable.contextId, contextVersion: "v1" }, "submitted"); } catch (error) { throw safeFailure(error); }
    },
    async dismiss(input, requestId) {
      let stable: ReturnType<typeof parseFeedbackDismissal>;
      try {
        const context = safeContext(input);
        stable = parseFeedbackDismissal({ requestId, ...context });
      } catch (error) { throw safeFailure(error); }
      const result = await request((client) => client.mutation(api.feedback.dismissFeedback, stable));
      try { return parseOperationResult(result, stable.requestId, { feature: stable.feature, contextId: stable.contextId, contextVersion: "v1" }, "dismissed"); } catch (error) { throw safeFailure(error); }
    },
  };
}
