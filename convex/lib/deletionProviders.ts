/**
 * Server-only transport boundaries for account deletion providers.
 *
 * The endpoint URLs are constants by design. Callers provide private
 * credentials and an injected fetch implementation, never an arbitrary URL.
 * Returned values contain only stable control-plane state; provider bodies and
 * exception text are deliberately discarded.
 */

const MIXPANEL_CREATE_URL = "https://mixpanel.com/api/app/data-deletions/v3.0/";
const MIXPANEL_STATUS_URL = "https://mixpanel.com/api/app/data-deletions/v3.0/";
const CLERK_USERS_URL = "https://api.clerk.com/v1/users/";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ID_LENGTH = 512;

export type ProviderRetryCode = "timeout" | "network" | "rate_limited" | "server_error";
export type ProviderManualCode = "configuration" | "malformed_response" | "redirect_blocked" | "unexpected_status" | "provider_failure" | "ambiguous";

export type MixpanelDeletionResult =
  | { provider: "mixpanel"; status: "pending"; trackingId: string }
  | { provider: "mixpanel"; status: "success"; trackingId: string }
  | { provider: "mixpanel"; status: "retry"; code: ProviderRetryCode; retryAfterMs: number }
  | { provider: "mixpanel"; status: "manual_review"; code: ProviderManualCode };

export type ClerkDeletionResult =
  | { provider: "clerk"; status: "success"; alreadyRemoved: boolean }
  | { provider: "clerk"; status: "retry"; code: ProviderRetryCode; retryAfterMs: number }
  | { provider: "clerk"; status: "manual_review"; code: ProviderManualCode };

export interface MixpanelDeletionConfig {
  readonly projectToken: string;
  /** GDPR API bearer credential, distinct from the ingestion token. */
  readonly privacyApiToken: string;
  readonly distinctId: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface ClerkDeletionConfig {
  readonly secretKey: string;
  readonly userId: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;
type TransportError = "timeout" | "network" | "redirect" | "malformed_body";
type FetchResult = { response: Response; body: string | null } | { error: TransportError };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timeoutValue(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) throw new Error("Invalid provider timeout");
  return value;
}

function credential(value: string, label: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_ID_LENGTH) throw new Error(`Invalid ${label}`);
}

function retryAfter(response: Response): number {
  const raw = response.headers.get("retry-after");
  const seconds = raw === null ? NaN : Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 300) return Math.max(1, Math.ceil(seconds * 1000));
  return 1_000;
}

async function request(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<FetchResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      (async () => {
        const response = await fetcher(input, { ...init, signal: controller.signal, redirect: "error" });
        const body = await readBody(response, controller.signal);
        return { response, body };
      })(),
      new Promise<{ timeout: true }>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ timeout: true });
        }, timeoutMs);
      }),
    ]);
    if ("timeout" in result) return { error: "timeout" };
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { error: "timeout" };
    if (error instanceof Error && /redirect/i.test(error.message)) {
      return { error: "redirect" };
    }
    return {
      error: error instanceof BodyTooLarge || error instanceof MalformedBody ? "malformed_body" : "network",
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class BodyTooLarge extends Error {}
class MalformedBody extends Error {}

async function readBody(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancelReader, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.byteLength > MAX_BODY_BYTES - total) throw new BodyTooLarge();
      total += next.value.byteLength;
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new MalformedBody();
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    signal.removeEventListener("abort", cancelReader);
  }
}

function transportFailure<P extends "mixpanel" | "clerk">(provider: P, error: TransportError, ambiguous: boolean, retryAfterMs?: number): MixpanelDeletionResult | ClerkDeletionResult {
  if (error === "redirect") return { provider, status: "manual_review", code: "redirect_blocked" } as MixpanelDeletionResult | ClerkDeletionResult;
  if (error === "malformed_body") return { provider, status: "manual_review", code: "malformed_response" } as MixpanelDeletionResult | ClerkDeletionResult;
  if (ambiguous) return { provider, status: "manual_review", code: "ambiguous" } as MixpanelDeletionResult | ClerkDeletionResult;
  return { provider, status: "retry", code: error, retryAfterMs: retryAfterMs ?? 1_000 } as MixpanelDeletionResult | ClerkDeletionResult;
}

function mapHttpFailure<T extends "mixpanel" | "clerk">(provider: T, response: Response, ambiguousServerFailure = false): Exclude<MixpanelDeletionResult | ClerkDeletionResult, { status: "pending" } | { status: "success" }> {
  if (response.status === 401 || response.status === 403) return { provider, status: "manual_review", code: "configuration" } as never;
  if (response.status === 429) return { provider, status: "retry", code: "rate_limited", retryAfterMs: retryAfter(response) } as never;
  if (response.status >= 500 || response.status === 408) {
    return ambiguousServerFailure
      ? { provider, status: "manual_review", code: "ambiguous" } as never
      : { provider, status: "retry", code: "server_error", retryAfterMs: 1_000 } as never;
  }
  if (response.status >= 300 && response.status < 400) return { provider, status: "manual_review", code: "redirect_blocked" } as never;
  return { provider, status: "manual_review", code: "unexpected_status" } as never;
}

function jsonBody(text: string | null): unknown | null {
  if (text === null) return null;
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const taskStatuses = new Set(["PENDING", "STAGING", "STARTED", "SUCCESS", "FAILURE", "REVOKED", "NOT_FOUND", "UNKNOWN"]);

function mixpanelTask(payload: unknown, create: boolean, expectedTrackingId?: string): { status: string; trackingId: string } | null {
  if (!isObject(payload) || payload.status !== "ok") return null;
  const row = create ? (Array.isArray(payload.results) && payload.results.length === 1 ? payload.results[0] : null) : payload.results;
  if (!isObject(row) || typeof row.status !== "string" || !taskStatuses.has(row.status)) return null;
  if (create) {
    if (typeof row.tracking_id !== "string" || row.tracking_id.length < 1 || row.tracking_id.length > MAX_ID_LENGTH) return null;
    return { status: row.status, trackingId: row.tracking_id };
  }
  if (typeof expectedTrackingId !== "string") return null;
  if (row.tracking_id !== undefined && (typeof row.tracking_id !== "string" || row.tracking_id !== expectedTrackingId)) return null;
  return { status: row.status, trackingId: expectedTrackingId };
}

function mixpanelOutcome(trackingId: string, status: string, fromCreate: boolean): MixpanelDeletionResult {
  if (fromCreate && (status === "PENDING" || status === "STAGING" || status === "STARTED")) {
    return { provider: "mixpanel", status: "pending", trackingId };
  }
  if (fromCreate && status === "SUCCESS") {
    return { provider: "mixpanel", status: "pending", trackingId };
  }
  if (!fromCreate && status === "SUCCESS") return { provider: "mixpanel", status: "success", trackingId };
  if (status === "PENDING" || status === "STAGING" || status === "STARTED") return { provider: "mixpanel", status: "pending", trackingId };
  return { provider: "mixpanel", status: "manual_review", code: "provider_failure" };
}

export async function createMixpanelDeletion(config: MixpanelDeletionConfig): Promise<MixpanelDeletionResult> {
  credential(config.projectToken, "Mixpanel project token");
  credential(config.privacyApiToken, "Mixpanel privacy credential");
  credential(config.distinctId, "Mixpanel distinct ID");
  const timeoutMs = timeoutValue(config.timeoutMs);
  const result = await request(config.fetcher ?? globalThis.fetch, `${MIXPANEL_CREATE_URL}?token=${encodeURIComponent(config.projectToken)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.privacyApiToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ compliance_type: "GDPR", distinct_ids: [config.distinctId] }),
  }, timeoutMs);
  if ("error" in result) return transportFailure("mixpanel", result.error, true) as MixpanelDeletionResult;
  if (!result.response.ok) return mapHttpFailure("mixpanel", result.response, true) as MixpanelDeletionResult;
  const task = mixpanelTask(jsonBody(result.body), true);
  return task ? mixpanelOutcome(task.trackingId, task.status, true) : { provider: "mixpanel", status: "manual_review", code: "malformed_response" };
}

export async function checkMixpanelDeletion(config: MixpanelDeletionConfig, trackingId: string): Promise<MixpanelDeletionResult> {
  credential(config.projectToken, "Mixpanel project token");
  credential(config.privacyApiToken, "Mixpanel privacy credential");
  credential(trackingId, "Mixpanel tracking ID");
  const timeoutMs = timeoutValue(config.timeoutMs);
  const result = await request(config.fetcher ?? globalThis.fetch, `${MIXPANEL_STATUS_URL}${encodeURIComponent(trackingId)}?token=${encodeURIComponent(config.projectToken)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.privacyApiToken}`, Accept: "application/json" },
  }, timeoutMs);
  if ("error" in result) return transportFailure("mixpanel", result.error, false, result.error === "timeout" ? timeoutMs : undefined) as MixpanelDeletionResult;
  if (!result.response.ok) return mapHttpFailure("mixpanel", result.response) as MixpanelDeletionResult;
  const task = mixpanelTask(jsonBody(result.body), false, trackingId);
  return task ? mixpanelOutcome(task.trackingId, task.status, false) : { provider: "mixpanel", status: "manual_review", code: "malformed_response" };
}

function exactClerkUserNotFound(payload: unknown, userId: string): boolean {
  if (!isObject(payload)) return false;
  if (!Array.isArray(payload.errors) || payload.errors.length !== 1 || !isObject(payload.errors[0])) return false;
  const error = payload.errors[0];
  return error.code === "resource_not_found" && error.message === "not found" && error.long_message === `No user was found with id ${userId}`;
}

export async function deleteClerkUser(config: ClerkDeletionConfig): Promise<ClerkDeletionResult> {
  credential(config.secretKey, "Clerk secret key");
  credential(config.userId, "Clerk user ID");
  const timeoutMs = timeoutValue(config.timeoutMs);
  const result = await request(config.fetcher ?? globalThis.fetch, `${CLERK_USERS_URL}${encodeURIComponent(config.userId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" },
  }, timeoutMs);
  if ("error" in result) return transportFailure("clerk", result.error, false, result.error === "timeout" ? timeoutMs : undefined) as ClerkDeletionResult;
  if (result.response.status === 404) {
    const body = jsonBody(result.body);
    return exactClerkUserNotFound(body, config.userId)
      ? { provider: "clerk", status: "success", alreadyRemoved: true }
      : { provider: "clerk", status: "manual_review", code: "unexpected_status" };
  }
  if (!result.response.ok) return mapHttpFailure("clerk", result.response) as ClerkDeletionResult;
  const body = jsonBody(result.body);
  return isObject(body) && body.id === config.userId && body.deleted === true
    ? { provider: "clerk", status: "success", alreadyRemoved: false }
    : { provider: "clerk", status: "manual_review", code: "malformed_response" };
}
