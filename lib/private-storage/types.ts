import type { SavedLoanPayload } from "../contracts/saved-loan";

export const PRIVATE_STORAGE_VERSION = 1 as const;
export const PRIVATE_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PRIVATE_LEASE_MS = 30_000;
export const PRIVATE_MAX_OUTBOX_ITEMS = 50;

export type PrivateOperationKind = "saveLoan" | "deleteLoan";
export type PrivateOperationStatus = "queued" | "sending" | "paused";
export type PrivatePauseReason = "validation" | "authorization" | "conflict" | "retry-exhausted" | "expired";

export interface VerifiedAccountContext {
  /** Opaque Convex profile ID supplied by an online verifier. */
  profileId: string;
  /** Runtime-only session binding; never written to IndexedDB. */
  sessionId: string;
  /** Runtime-only auth epoch; never written to IndexedDB. */
  authEpoch: number;
  verifiedOnline: true;
}

export interface StorageGuard {
  readonly profileId: string;
  readonly sessionId: string;
  readonly authEpoch: number;
  /** Runtime-only nonce prevents a lock/unlock ABA callback from becoming valid. */
  readonly runtimeNonce: number;
}

export interface CachedSavedLoan {
  revision: number;
  payload: Readonly<SavedLoanPayload>;
  acknowledgedAt: string;
}

export interface PrivateAccountState {
  revision: number;
  cachedLoan: CachedSavedLoan | null;
  outbox: readonly PrivateOutboxOperation[];
}

export interface PrivateOutboxOperation {
  requestId: string;
  kind: PrivateOperationKind;
  expectedRevision: number;
  createdAt: string;
  payloadJson: string | null;
  payloadHash: string;
  status: PrivateOperationStatus;
  attempts: number;
  nextAttemptAt: number;
  leaseId: string | null;
  leaseUntil: number | null;
  pauseReason: PrivatePauseReason | null;
  lastErrorCode: string | null;
}

export interface PrivatePartitionRecord {
  version: typeof PRIVATE_STORAGE_VERSION;
  partitionKey: string;
  /** Monotonic persisted revocation marker. It is advanced by confirmed discard. */
  generation: number;
  revision: number;
  cachedLoan: CachedSavedLoan | null;
  outbox: PrivateOutboxOperation[];
}

export interface QueueSaveInput {
  requestId: string;
  expectedRevision: number;
  createdAt: string;
  payload: SavedLoanPayload;
}

export interface QueueDeleteInput {
  requestId: string;
  expectedRevision: number;
  createdAt: string;
}

export interface ClaimedOperation {
  operation: Readonly<PrivateOutboxOperation>;
  guard: StorageGuard;
}

export interface SaveAcknowledgement {
  requestId: string;
  kind: "saveLoan";
  leaseId: string;
  revision: number;
}

export interface DeleteAcknowledgement {
  requestId: string;
  kind: "deleteLoan";
  leaseId: string;
  revision: number;
}

export interface ServerSavedLoanState {
  revision: number;
  payload: SavedLoanPayload | null;
}

export type PrivateResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "locked"; reason: "not-unlocked" | "stale-callback" | "account-switched" | "offline" }
  | { kind: "storage-unavailable"; reason: "indexeddb-unavailable" | "transaction-failed" }
  | { kind: "invalid"; code: string }
  | { kind: "not-found" }
  | { kind: "paused"; reason: PrivatePauseReason }
  | { kind: "expired"; requestId: string };

export interface DiscardResult {
  kind: "discarded" | "cancelled" | "locked" | "storage-unavailable";
  clearedPartition?: string;
}

export interface PrivateStorageOptions {
  indexedDB?: IDBFactory;
  now?: () => number;
  leaseDurationMs?: number;
}
