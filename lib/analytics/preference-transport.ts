import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { readConvexUrl } from "../auth/config";
import type { PrivateSessionAccess } from "../auth/private-session";

export type AnalyticsPreferenceConsent = "unknown" | "declined" | "accepted";

export interface AnalyticsPreference {
  readonly consent: AnalyticsPreferenceConsent;
  readonly policyVersion: "v1";
  readonly revision: number;
  readonly analyticsAccountId: string | null;
  readonly sendPermission: boolean;
}

export type AnalyticsPreferenceWrite = "accepted" | "declined";

export class AnalyticsPreferenceError extends Error {
  constructor(readonly code: "unavailable" | "unauthorized" | "conflict" | "invalid_shape" | "network") {
    super(code);
    this.name = "AnalyticsPreferenceError";
  }
}

export interface AnalyticsPreferenceTransport {
  read(): Promise<AnalyticsPreference>;
  write(consent: AnalyticsPreferenceWrite, expectedRevision: number): Promise<AnalyticsPreference>;
}

export function markAnalyticsDiagnostic(name: string): void {
  if (process.env.NEXT_PUBLIC_TRUECOST_ANALYTICS_DIAGNOSTICS !== "1" || process.env.NEXT_PUBLIC_ANALYTICS_ENVIRONMENT !== "development" || typeof performance === "undefined") return;
  try { performance.mark(`truecost.analytics.${name}`); } catch { /* optional diagnostics */ }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validToken(token: string | null, identity: PrivateSessionAccess["identity"]): token is string {
  if (!token || token.length > 32_768) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const body = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(body.padEnd(Math.ceil(body.length / 4) * 4, "="))) as Record<string, unknown>;
    return claims.sub === identity.subject && claims.sid === identity.sessionId && claims.aud === "convex" &&
      typeof claims.exp === "number" && Number.isFinite(claims.exp) && claims.exp * 1000 > Date.now();
  } catch { return false; }
}

function parse(value: unknown): AnalyticsPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AnalyticsPreferenceError("invalid_shape");
  const row = value as Record<string, unknown>;
  if (!["unknown", "declined", "accepted"].includes(row.consent as string) || row.policyVersion !== "v1" ||
      typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
      (row.analyticsAccountId !== null && (typeof row.analyticsAccountId !== "string" || !UUID.test(row.analyticsAccountId))) ||
      typeof row.sendPermission !== "boolean") throw new AnalyticsPreferenceError("invalid_shape");
  const consent = row.consent as AnalyticsPreferenceConsent;
  const allowed = consent === "accepted" && row.analyticsAccountId !== null;
  if (row.sendPermission !== allowed) throw new AnalyticsPreferenceError("invalid_shape");
  return Object.freeze({ consent, policyVersion: "v1", revision: row.revision, analyticsAccountId: row.analyticsAccountId as string | null, sendPermission: row.sendPermission });
}

function safeFailure(error: unknown): AnalyticsPreferenceError {
  if (error instanceof AnalyticsPreferenceError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/stale|revision/i.test(message)) return new AnalyticsPreferenceError("conflict");
  if (/unauthorized|authentication|profile/i.test(message)) return new AnalyticsPreferenceError("unauthorized");
  return new AnalyticsPreferenceError("network");
}

export function createSessionBoundAnalyticsPreferenceTransport(options: {
  readonly session: PrivateSessionAccess;
  readonly url?: string;
}): AnalyticsPreferenceTransport {
  const url = readConvexUrl(options.url ?? process.env.NEXT_PUBLIC_CONVEX_URL);
  if (!url) throw new AnalyticsPreferenceError("unavailable");
  const session = options.session;
  const identity = Object.freeze({ ...session.identity });
  const assertCurrent = () => { if (!session.isCurrent()) throw new AnalyticsPreferenceError("unauthorized"); };
  async function request<T>(run: (client: ConvexHttpClient) => Promise<T>): Promise<T> {
    try {
      assertCurrent();
      markAnalyticsDiagnostic("preference.request_started");
      markAnalyticsDiagnostic("preference.token_started");
      const token = await session.getToken();
      markAnalyticsDiagnostic("preference.token_resolved");
      assertCurrent();
      if (!validToken(token, identity)) throw new AnalyticsPreferenceError("unauthorized");
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 15_000);
      try {
        const client = new ConvexHttpClient(url!, { auth: token, logger: false, fetch: async (input, init) => {
          assertCurrent();
          return globalThis.fetch(input, { ...init, signal: abort.signal, credentials: "omit", cache: "no-store" });
        }});
        const result = await run(client);
        assertCurrent();
        markAnalyticsDiagnostic("preference.query_resolved");
        return result;
      } finally { clearTimeout(timeout); }
    } catch (error) { throw safeFailure(error); }
  }
  return {
    async read() {
      const value = await request((client) => client.query(api.analytics.getPreference, {}));
      const preference = parse(value);
      markAnalyticsDiagnostic("preference.parsed");
      return preference;
    },
    async write(consent, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new AnalyticsPreferenceError("invalid_shape");
      const value = await request((client) => client.mutation(api.analytics.setPreference, { consent, policyVersion: "v1", expectedRevision }));
      const preference = parse(value);
      markAnalyticsDiagnostic("preference.parsed");
      return preference;
    },
  };
}
