import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { readConvexUrl } from "../auth/config";
import { canonicalTimestamp, ContractValidationError } from "../contracts/errors";
import { parseExpectedRevision, parseRequestId, parseSavedLoanPayload } from "../contracts/saved-loan";
import type { SavedLoanTransport } from "./sync";
import type { QueueDeleteInput, QueueSaveInput, VerifiedAccountContext } from "./types";

export interface TransportIdentity extends VerifiedAccountContext {
  subject: string;
}

export interface SessionTransportOptions {
  url: string;
  identity: TransportIdentity;
  /** Return a Convex-audience token from Clerk. Never persist or log it. */
  getToken: () => Promise<string | null>;
  /** Must compare the current subject, session, epoch and unlocked lifetime. */
  isCurrent: (identity: Readonly<TransportIdentity>) => boolean;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export class PrivateTransportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PrivateTransportError";
  }
}

/** These claims only prevent credential mix-ups; Convex verifies the signature and ownership. */
function tokenMatches(token: string | null, identity: TransportIdentity, now: number): token is string {
  if (!token || token.length > 32_768) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const body = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(body.padEnd(Math.ceil(body.length / 4) * 4, "="))) as Record<string, unknown>;
    return claims.sub === identity.subject && claims.sid === identity.sessionId &&
      claims.aud === "convex" && typeof claims.exp === "number" && Number.isFinite(claims.exp) &&
      claims.exp * 1000 > now;
  } catch {
    return false;
  }
}

function safeFailure(error: unknown): PrivateTransportError {
  if (error instanceof PrivateTransportError) return error;
  if (error instanceof ContractValidationError) return new PrivateTransportError("invalid_shape");
  // The current backend deliberately exposes no record data in this message.
  if (error instanceof Error && /\bUnauthorized\b/.test(error.message)) return new PrivateTransportError("unauthorized");
  return new PrivateTransportError("network");
}

const VALIDATION_CODES = new Set(["invalid_shape", "invalid_number", "invalid_enum", "invalid_timestamp", "invalid_id", "expired"]);

function requireAcknowledgement<K extends "saveLoan" | "deleteLoan">(
  result: { status: string; requestId?: string; revision?: number; code?: string },
  requestId: string,
  expectedRevision: number,
  kind: K,
) {
  if (result.status === "conflict" || result.code === "not_found") throw new PrivateTransportError("conflict");
  if (result.status === "error") {
    throw new PrivateTransportError(result.code === "rate_limited" ? "rate_limited" :
      VALIDATION_CODES.has(result.code ?? "") ? result.code! : "invalid_shape");
  }
  const expectedStatus = kind === "saveLoan" ? "saved" : "deleted";
  if ((result.status !== expectedStatus && result.status !== "replayed") || result.requestId !== requestId ||
      !Number.isSafeInteger(result.revision) || result.revision !== expectedRevision + 1) {
    throw new PrivateTransportError("invalid_shape");
  }
  return { requestId, kind, revision: result.revision! };
}

/** A new HTTP client for every operation cannot acquire another session's credentials on reconnect. */
export function createSessionBoundSavedLoanTransport(options: SessionTransportOptions): SavedLoanTransport {
  const url = readConvexUrl(options.url);
  if (!url) throw new PrivateTransportError("invalid_shape");
  const identity = Object.freeze({ ...options.identity });
  const { getToken, isCurrent } = options;
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;

  function assertCurrent() {
    if (!isCurrent(identity)) throw new PrivateTransportError("unauthorized");
  }

  async function request<T>(run: (client: ConvexHttpClient) => Promise<T>): Promise<T> {
    try {
      assertCurrent();
      const token = await getToken();
      assertCurrent();
      if (!tokenMatches(token, identity, now())) throw new PrivateTransportError("unauthorized");
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
    async currentLoan() {
      const result = await request((client) => client.query(api.savedLoans.currentLoan, {}));
      try {
        const revision = parseExpectedRevision(result.revision);
        const payload = result.payload === null ? null : parseSavedLoanPayload(result.payload);
        if (revision === 0 && payload !== null) throw new PrivateTransportError("invalid_shape");
        return { revision, payload };
      } catch (error) { throw safeFailure(error); }
    },
    async saveLoan(input: QueueSaveInput) {
      let stable: QueueSaveInput;
      try {
        stable = { requestId: parseRequestId(input.requestId), expectedRevision: parseExpectedRevision(input.expectedRevision),
          createdAt: canonicalTimestamp(input.createdAt, "createdAt"), payload: parseSavedLoanPayload(input.payload) };
      } catch (error) { throw safeFailure(error); }
      const result = await request((client) => client.mutation(api.savedLoans.saveLoan, stable));
      return requireAcknowledgement(result, stable.requestId, stable.expectedRevision, "saveLoan");
    },
    async deleteLoan(input: QueueDeleteInput) {
      let stable: QueueDeleteInput;
      try {
        stable = { requestId: parseRequestId(input.requestId), expectedRevision: parseExpectedRevision(input.expectedRevision),
          createdAt: canonicalTimestamp(input.createdAt, "createdAt") };
      } catch (error) { throw safeFailure(error); }
      const result = await request((client) => client.mutation(api.savedLoans.deleteLoan, stable));
      return requireAcknowledgement(result, stable.requestId, stable.expectedRevision, "deleteLoan");
    },
  };
}
