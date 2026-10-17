import {
  canonicalTimestamp,
  contractFail,
  deepFreeze,
  exactKeys,
  integerValue,
  recordOf,
  randomUuid,
  stringValue,
  uuidValue,
  type ContractErrorCode,
} from "./errors";

export const AUTH_INTENT_SCHEMA_VERSION = 1 as const;
export const AUTH_INTENT_TTL_MS = 10 * 60 * 1000;
export const AUTH_INTENT_LEASE_MS = 2 * 60 * 1000;
export const MAX_AUTH_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

export type AuthIntentAction =
  | "save"
  | "download"
  | "new_comparison"
  | "recalculate_existing_draft";
export type AuthIntentState = "pending" | "claimed" | "completed" | "cancelled";

export interface AuthIntent {
  schemaVersion: typeof AUTH_INTENT_SCHEMA_VERSION;
  nonce: string;
  requestId: string;
  action: AuthIntentAction;
  resultId: string | null;
  draftId: string | null;
  createdAt: string;
  expiresAt: string;
  state: AuthIntentState;
  initiatingTabId: string;
  accountKeyHash: string | null;
  authEpoch: number | null;
  claimId: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface CreateAuthIntentInput {
  action: AuthIntentAction;
  resultId?: string | null;
  draftId?: string | null;
  initiatingTabId: string;
  now?: string;
  ttlMs?: number;
}

export interface IntentContext {
  initiatingTabId: string;
  accountKeyHash: string;
  authEpoch: number;
  /** Required to complete or cancel a claimed intent; omitted for a first claim. */
  claimId?: string;
  now?: string;
}

/** The only context accepted when a guest cancels before the first claim. */
export interface PendingIntentContext {
  initiatingTabId: string;
  now?: string;
}

type TransitionContext = IntentContext | PendingIntentContext;

// These helpers only compare the caller-supplied verified identity and tab.
// Authentication belongs to the caller. Persisted callers must also load the
// latest intent and commit the transition with serialized/CAS storage; these
// pure functions cannot prevent races between stale in-memory copies.

export type IntentTransitionStatus = "claimed" | "already_claimed" | "completed" | "cancelled";
export type IntentTransitionErrorCode = ContractErrorCode;
export type IntentTransition =
  | { ok: true; intent: Readonly<AuthIntent>; status: IntentTransitionStatus }
  | { ok: false; error: { code: IntentTransitionErrorCode; message: string } };

const INTENT_KEYS = [
  "schemaVersion",
  "nonce",
  "requestId",
  "action",
  "resultId",
  "draftId",
  "createdAt",
  "expiresAt",
  "state",
  "initiatingTabId",
  "accountKeyHash",
  "authEpoch",
  "claimId",
  "claimedAt",
  "leaseExpiresAt",
  "completedAt",
  "cancelledAt",
] as const;

const ACTION_DESTINATIONS: Record<AuthIntentAction, "/compare/results" | "/compare"> = {
  save: "/compare/results",
  download: "/compare/results",
  new_comparison: "/compare",
  recalculate_existing_draft: "/compare",
};

function actionValue(value: unknown): AuthIntentAction {
  if (value === "save" || value === "download" || value === "new_comparison" || value === "recalculate_existing_draft") return value;
  contractFail("invalid_enum", "intent action is not supported");
}

function stateValue(value: unknown): AuthIntentState {
  if (value === "pending" || value === "claimed" || value === "completed" || value === "cancelled") return value;
  contractFail("invalid_state", "intent state is not supported");
}

function nullableString(value: unknown, label: string, max: number): string | null {
  if (value === null) return null;
  return stringValue(value, label, max);
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  return integerValue(value, label, 0, 2_147_483_647);
}

function dateFor(value: string): number {
  return new Date(value).getTime();
}

function validateIntentRelations(intent: AuthIntent): void {
  const created = dateFor(intent.createdAt);
  const expires = dateFor(intent.expiresAt);
  if (!(expires > created) || expires - created > MAX_AUTH_INTENT_TTL_MS) {
    contractFail("invalid_timestamp", "intent expiry must follow creation within the supported TTL");
  }
  if (intent.action === "recalculate_existing_draft" && !intent.draftId) {
    contractFail("invalid_shape", "recalculation requires a preserved draft reference");
  }
  if ((intent.action === "save" || intent.action === "download") && !intent.resultId) {
    contractFail("invalid_shape", `${intent.action} requires a result reference`);
  }
  if (intent.action !== "recalculate_existing_draft" && intent.draftId !== null) {
    contractFail("invalid_shape", "only recalculation may carry a draft reference");
  }
  const claimed = intent.claimedAt === null ? null : dateFor(intent.claimedAt);
  const lease = intent.leaseExpiresAt === null ? null : dateFor(intent.leaseExpiresAt);
  const completed = intent.completedAt === null ? null : dateFor(intent.completedAt);
  const cancelled = intent.cancelledAt === null ? null : dateFor(intent.cancelledAt);
  const hasBinding = intent.accountKeyHash !== null && intent.authEpoch !== null;
  if ((intent.accountKeyHash === null) !== (intent.authEpoch === null)) {
    contractFail("invalid_state", "account binding fields must be set together");
  }
  if (intent.state === "pending") {
    if (hasBinding || intent.claimId !== null || claimed !== null || lease !== null || completed !== null || cancelled !== null) {
      contractFail("invalid_state", "pending intent has binding, claim, or terminal fields");
    }
  } else if (intent.state === "claimed") {
    if (!hasBinding || !intent.claimId || claimed === null || lease === null || completed !== null || cancelled !== null) {
      contractFail("invalid_state", "claimed intent has invalid binding or lease fields");
    }
    if (!(created <= claimed && claimed < lease && lease <= expires)) {
      contractFail("invalid_timestamp", "claimed intent timestamps are out of order");
    }
  } else if (intent.state === "completed") {
    if (!hasBinding || !intent.claimId || claimed === null || completed === null || lease !== null || cancelled !== null) {
      contractFail("invalid_state", "completed intent has invalid claim or terminal fields");
    }
    if (!(created <= claimed && claimed <= completed && completed < expires)) {
      contractFail("invalid_timestamp", "completed intent timestamps are out of order");
    }
  } else {
    if (!intent.cancelledAt || completed !== null || lease !== null) {
      contractFail("invalid_state", "cancelled intent has invalid terminal fields");
    }
    if (claimed === null) {
      if (hasBinding || intent.claimId !== null) contractFail("invalid_state", "unclaimed cancellation has claim fields");
      if (!(created <= cancelled! && cancelled! < expires)) contractFail("invalid_timestamp", "cancellation time is out of order");
    } else {
      if (!hasBinding || !intent.claimId || !(created <= claimed && claimed <= cancelled! && cancelled! < expires)) {
        contractFail("invalid_timestamp", "claimed cancellation timestamps are out of order");
      }
    }
  }
}

export function createAuthIntent(input: CreateAuthIntentInput): Readonly<AuthIntent> {
  const createdAt = canonicalTimestamp(input.now ?? new Date().toISOString(), "intent.createdAt");
  const ttlMs = input.ttlMs ?? AUTH_INTENT_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_AUTH_INTENT_TTL_MS) contractFail("invalid_number", "intent TTL is out of bounds");
  const resultId = input.resultId ?? null;
  if (resultId !== null) uuidValue(resultId, "intent.resultId");
  const draftId = input.draftId ?? null;
  if (draftId !== null) stringValue(draftId, "intent.draftId", 128);
  const action = actionValue(input.action);
  const intent: AuthIntent = {
    schemaVersion: AUTH_INTENT_SCHEMA_VERSION,
    nonce: randomUuid(),
    requestId: randomUuid(),
    action,
    resultId,
    draftId,
    createdAt,
    expiresAt: new Date(dateFor(createdAt) + ttlMs).toISOString(),
    state: "pending",
    initiatingTabId: stringValue(input.initiatingTabId, "intent.initiatingTabId", 128),
    accountKeyHash: null,
    authEpoch: null,
    claimId: null,
    claimedAt: null,
    leaseExpiresAt: null,
    completedAt: null,
    cancelledAt: null,
  };
  validateIntentRelations(intent);
  return deepFreeze(intent);
}

export function decodeAuthIntent(value: unknown): Readonly<AuthIntent> {
  const record = recordOf(value, "intent");
  exactKeys(record, INTENT_KEYS, "intent");
  const schemaVersion = integerValue(record.schemaVersion, "intent.schemaVersion", 1, Number.MAX_SAFE_INTEGER);
  if (schemaVersion !== AUTH_INTENT_SCHEMA_VERSION) contractFail("unsupported_schema", "intent schema is unsupported");
  const intent: AuthIntent = {
    schemaVersion,
    nonce: uuidValue(record.nonce, "intent.nonce"),
    requestId: uuidValue(record.requestId, "intent.requestId"),
    action: actionValue(record.action),
    resultId: record.resultId === null ? null : uuidValue(record.resultId, "intent.resultId"),
    draftId: nullableString(record.draftId, "intent.draftId", 128),
    createdAt: canonicalTimestamp(record.createdAt, "intent.createdAt"),
    expiresAt: canonicalTimestamp(record.expiresAt, "intent.expiresAt"),
    state: stateValue(record.state),
    initiatingTabId: stringValue(record.initiatingTabId, "intent.initiatingTabId", 128),
    accountKeyHash: nullableString(record.accountKeyHash, "intent.accountKeyHash", 128),
    authEpoch: nullableInteger(record.authEpoch, "intent.authEpoch"),
    claimId: record.claimId === null ? null : uuidValue(record.claimId, "intent.claimId"),
    claimedAt: record.claimedAt === null ? null : canonicalTimestamp(record.claimedAt, "intent.claimedAt"),
    leaseExpiresAt: record.leaseExpiresAt === null ? null : canonicalTimestamp(record.leaseExpiresAt, "intent.leaseExpiresAt"),
    completedAt: record.completedAt === null ? null : canonicalTimestamp(record.completedAt, "intent.completedAt"),
    cancelledAt: record.cancelledAt === null ? null : canonicalTimestamp(record.cancelledAt, "intent.cancelledAt"),
  };
  validateIntentRelations(intent);
  return deepFreeze(intent);
}

export function destinationForAuthIntent(action: AuthIntentAction): "/compare/results" | "/compare" {
  return ACTION_DESTINATIONS[action];
}

function contextTime(context: { now?: string }): string {
  return canonicalTimestamp(context.now ?? new Date().toISOString(), "intent.now");
}

function verifiedIdentity(context: TransitionContext): { accountKeyHash: string; authEpoch: number } | null {
  const hasAccount = "accountKeyHash" in context;
  const hasEpoch = "authEpoch" in context;
  if (!hasAccount && !hasEpoch) return null;
  if (!hasAccount || !hasEpoch) {
    contractFail("invalid_shape", "verified account context must include account and epoch");
  }
  return {
    accountKeyHash: stringValue(context.accountKeyHash, "context.accountKeyHash", 128),
    authEpoch: integerValue(context.authEpoch, "context.authEpoch", 0, 2_147_483_647),
  };
}

function contextError(
  intent: AuthIntent,
  context: TransitionContext,
  now: string,
  options: { requireVerifiedIdentity: boolean },
): { code: IntentTransitionErrorCode; message: string } | null {
  stringValue(context.initiatingTabId, "context.initiatingTabId", 128);
  if (context.initiatingTabId !== intent.initiatingTabId) return { code: "tab_mismatch", message: "intent belongs to another initiating tab" };
  const identity = verifiedIdentity(context);
  if (options.requireVerifiedIdentity && identity === null) {
    return { code: "invalid_shape", message: "verified account context is required" };
  }
  if (identity !== null) {
    if (intent.accountKeyHash !== null && identity.accountKeyHash !== intent.accountKeyHash) return { code: "account_mismatch", message: "intent belongs to another account" };
    if (intent.authEpoch !== null && identity.authEpoch !== intent.authEpoch) return { code: "stale_epoch", message: "intent belongs to an older authentication epoch" };
  }
  if (dateFor(now) < dateFor(intent.createdAt)) return { code: "invalid_timestamp", message: "intent callback predates intent creation" };
  if (dateFor(now) >= dateFor(intent.expiresAt)) return { code: "expired", message: "intent has expired" };
  return null;
}

function safeIntent(intent: AuthIntent): AuthIntent {
  return { ...intent };
}

export function claimAuthIntent(raw: AuthIntent, context: IntentContext): IntentTransition {
  try {
    const intent = decodeAuthIntent(raw);
    const now = contextTime(context);
    const error = contextError(intent, context, now, { requireVerifiedIdentity: true });
    if (error) return { ok: false, error };
    const identity = verifiedIdentity(context);
    if (identity === null) return { ok: false, error: { code: "invalid_shape", message: "verified account context is required" } };
    if (intent.state === "completed" || intent.state === "cancelled") return { ok: false, error: { code: "invalid_state", message: "intent is already terminal" } };
    if (intent.state === "claimed" && intent.leaseExpiresAt && dateFor(now) < dateFor(intent.leaseExpiresAt)) {
      return { ok: true, intent, status: "already_claimed" };
    }
    const next = safeIntent(intent);
    next.state = "claimed";
    next.accountKeyHash = identity.accountKeyHash;
    next.authEpoch = identity.authEpoch;
    next.claimId = randomUuid();
    next.claimedAt = now;
    next.leaseExpiresAt = new Date(Math.min(dateFor(now) + AUTH_INTENT_LEASE_MS, dateFor(intent.expiresAt))).toISOString();
    return { ok: true, intent: deepFreeze(next), status: "claimed" };
  } catch (error) {
    if (error instanceof Error && "code" in error) return { ok: false, error: { code: (error as { code: IntentTransitionErrorCode }).code, message: error.message } };
    return { ok: false, error: { code: "invalid_shape", message: "malformed intent" } };
  }
}

export function completeAuthIntent(raw: AuthIntent, context: IntentContext): IntentTransition {
  try {
    const intent = decodeAuthIntent(raw);
    const now = contextTime(context);
    const error = contextError(intent, context, now, { requireVerifiedIdentity: true });
    if (error) return { ok: false, error };
    if (intent.state !== "claimed") return { ok: false, error: { code: "invalid_state", message: "only a claimed intent can complete" } };
    if (!intent.claimedAt || dateFor(now) < dateFor(intent.claimedAt)) return { ok: false, error: { code: "invalid_timestamp", message: "completion predates the claim" } };
    if (!context.claimId || context.claimId !== intent.claimId) return { ok: false, error: { code: "claim_mismatch", message: "claim identity does not match" } };
    if (!intent.leaseExpiresAt || dateFor(now) >= dateFor(intent.leaseExpiresAt)) return { ok: false, error: { code: "lease_expired", message: "claim lease has expired" } };
    const next = safeIntent(intent);
    next.state = "completed";
    next.completedAt = now;
    next.leaseExpiresAt = null;
    return { ok: true, intent: deepFreeze(next), status: "completed" };
  } catch (error) {
    if (error instanceof Error && "code" in error) return { ok: false, error: { code: (error as { code: IntentTransitionErrorCode }).code, message: error.message } };
    return { ok: false, error: { code: "invalid_shape", message: "malformed intent" } };
  }
}

export function cancelAuthIntent(raw: AuthIntent, context: IntentContext | PendingIntentContext): IntentTransition {
  try {
    const intent = decodeAuthIntent(raw);
    const now = contextTime(context);
    const error = contextError(intent, context, now, { requireVerifiedIdentity: intent.state !== "pending" });
    if (error) return { ok: false, error };
    if (intent.state === "completed" || intent.state === "cancelled") return { ok: false, error: { code: "invalid_state", message: "intent is already terminal" } };
    if (intent.state === "claimed") {
      if (!intent.claimedAt || dateFor(now) < dateFor(intent.claimedAt)) return { ok: false, error: { code: "invalid_timestamp", message: "cancellation predates the claim" } };
      if (!("claimId" in context)) return { ok: false, error: { code: "invalid_shape", message: "verified claim context is required" } };
      if (!context.claimId || context.claimId !== intent.claimId) return { ok: false, error: { code: "claim_mismatch", message: "claim identity does not match" } };
      if (!intent.leaseExpiresAt || dateFor(now) >= dateFor(intent.leaseExpiresAt)) return { ok: false, error: { code: "lease_expired", message: "claim lease has expired" } };
    }
    const next = safeIntent(intent);
    next.state = "cancelled";
    next.cancelledAt = now;
    next.leaseExpiresAt = null;
    return { ok: true, intent: deepFreeze(next), status: "cancelled" };
  } catch (error) {
    if (error instanceof Error && "code" in error) return { ok: false, error: { code: (error as { code: IntentTransitionErrorCode }).code, message: error.message } };
    return { ok: false, error: { code: "invalid_shape", message: "malformed intent" } };
  }
}
