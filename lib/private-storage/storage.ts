import {
  ContractValidationError,
  canonicalTimestamp,
  randomUuid,
} from "../contracts/errors";
import {
  SAVED_LOAN_LIMITS,
  canonicalSavedLoanPayload,
  parseCreatedAt,
  parseExpectedRevision,
  parseRequestId,
  parseSavedLoanPayload,
} from "../contracts/saved-loan";
import type {
  ClaimedOperation,
  CachedSavedLoan,
  DeleteAcknowledgement,
  DiscardResult,
  PrivateAccountState,
  PrivateOperationKind,
  PrivateOutboxOperation,
  PrivatePartitionRecord,
  PrivateResult,
  PrivateStorageOptions,
  QueueDeleteInput,
  QueueSaveInput,
  SaveAcknowledgement,
  ServerSavedLoanState,
  StorageGuard,
  VerifiedAccountContext,
} from "./types";
import type { PrivateSessionAccess } from "../auth/private-session";
import {
  PRIVATE_LEASE_MS,
  PRIVATE_MAX_OUTBOX_ITEMS,
  PRIVATE_REPLAY_WINDOW_MS,
  PRIVATE_STORAGE_VERSION,
} from "./types";

export const PRIVATE_DB_NAME = "truecost-private-v1";
export const PRIVATE_STORE_NAME = "partitions";
/** Metadata is deliberately separate from member records so the browser-wide
 * clear can fence writers even when a partition row is absent. */
export const PRIVATE_META_STORE_NAME = "browserMeta";
export const PRIVATE_BROWSER_EPOCH_KEY = "browserEpoch";
export const PRIVATE_DATABASE_VERSION = PRIVATE_STORAGE_VERSION + 1;
export const PRIVATE_MAX_RETRY_ATTEMPTS = 8;
const PRIVATE_DB_OPEN_TIMEOUT_MS = 5_000;

export type FormerPartitionCleanupResult =
  | { kind: "cleared"; generation: number }
  | { kind: "retry"; reason: "storage-failure" | "runtime-changed" };

export interface CapturedFormerPartitionCleanup {
  run(): Promise<FormerPartitionCleanupResult>;
}

export interface PrivateBrowserEpochRecord {
  key: typeof PRIVATE_BROWSER_EPOCH_KEY;
  epoch: number;
}

function readBrowserEpoch(value: unknown): number {
  if (value === undefined) return 0;
  if (!value || typeof value !== "object") throw new Error("invalid browser epoch");
  const record = value as Partial<PrivateBrowserEpochRecord>;
  if (record.key !== PRIVATE_BROWSER_EPOCH_KEY || typeof record.epoch !== "number" || !Number.isSafeInteger(record.epoch) || record.epoch < 0) {
    throw new Error("invalid browser epoch");
  }
  return record.epoch;
}

export function openPrivateDatabase(factory: IDBFactory | undefined = defaultIndexedDb()): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new Error("indexeddb unavailable"));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let open: IDBOpenDBRequest;
    const finishError = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error("indexeddb open failed"));
    };
    try {
      open = factory.open(PRIVATE_DB_NAME, PRIVATE_DATABASE_VERSION);
    } catch (error) {
      finishError(error);
      return;
    }
    timeout = setTimeout(() => {
      settled = true;
      timeout = undefined;
      try { open.transaction?.abort(); } catch { /* request may already be terminal */ }
      reject(new Error("indexeddb open timed out"));
    }, PRIVATE_DB_OPEN_TIMEOUT_MS);
    open.onupgradeneeded = () => {
      if (settled) {
        try { open.transaction?.abort(); } catch { /* request may already be terminal */ }
        return;
      }
      const database = open.result;
      if (!database.objectStoreNames.contains(PRIVATE_STORE_NAME)) {
        database.createObjectStore(PRIVATE_STORE_NAME, { keyPath: "partitionKey" });
      }
      if (!database.objectStoreNames.contains(PRIVATE_META_STORE_NAME)) {
        database.createObjectStore(PRIVATE_META_STORE_NAME, { keyPath: "key" });
      }
    };
    open.onsuccess = () => {
      if (settled) {
        open.result.close();
        return;
      }
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () => finishError(open.error ?? new Error("indexeddb open failed"));
    open.onblocked = () => finishError(new Error("indexeddb open blocked"));
  });
}

export async function removePrivatePartitionForRecovery(
  profileId: string,
  factory: IDBFactory | undefined = defaultIndexedDb(),
  isCurrent: () => boolean,
): Promise<FormerPartitionCleanupResult> {
  if (!profileId || !isCurrent()) return { kind: "retry", reason: "runtime-changed" };
  if (!factory) return { kind: "retry", reason: "storage-failure" };
  let db: IDBDatabase | null = null;
  let transaction: IDBTransaction | null = null;
  try {
    db = await openPrivateDatabase(factory);
    if (!isCurrent()) return { kind: "retry", reason: "runtime-changed" };
    transaction = db.transaction([PRIVATE_STORE_NAME, PRIVATE_META_STORE_NAME], "readwrite");
    const done = complete(transaction);
    done.catch(() => undefined);
    const store = transaction.objectStore(PRIVATE_STORE_NAME);
    const stored = await request(store.get(profileId)) as unknown;
    let generation = 0;
    if (stored !== undefined) {
      if (!stored || typeof stored !== "object" || !Number.isSafeInteger((stored as { generation?: unknown }).generation) || ((stored as { generation: number }).generation < 0)) throw new Error("invalid generation");
      generation = (stored as { generation: number }).generation;
    }
    if (!isCurrent() || generation >= Number.MAX_SAFE_INTEGER) {
      try { transaction.abort(); } catch { /* already aborted */ }
      await done.catch(() => undefined);
      return { kind: "retry", reason: "runtime-changed" };
    }
    store.put({ version: PRIVATE_STORAGE_VERSION, partitionKey: profileId, generation: generation + 1, revision: 0, cachedLoan: null, outbox: [] });
    if (!isCurrent()) {
      try { transaction.abort(); } catch { /* already aborted */ }
      await done.catch(() => undefined);
      return { kind: "retry", reason: "runtime-changed" };
    }
    await done;
    return isCurrent() ? { kind: "cleared", generation: generation + 1 } : { kind: "retry", reason: "runtime-changed" };
  } catch {
    try { transaction?.abort(); } catch { /* already completed */ }
    return isCurrent() ? { kind: "retry", reason: "storage-failure" } : { kind: "retry", reason: "runtime-changed" };
  } finally {
    db?.close();
  }
}

const TRANSIENT_ERROR_CODES = new Set(["network", "timeout", "unavailable", "rate_limited"]);

type DbMode = "readonly" | "readwrite";

function defaultIndexedDb(): IDBFactory | undefined {
  return typeof indexedDB === "undefined" ? undefined : indexedDB;
}

function nowIso(now: number): string {
  return new Date(now).toISOString();
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

class PrivateOperationError extends Error {
  constructor(readonly code: string) { super(code); }
}

function safeCode(error: unknown): string {
  return error instanceof ContractValidationError ? error.code : "storage_failure";
}

function blankPartition(partitionKey: string): PrivatePartitionRecord {
  return { version: PRIVATE_STORAGE_VERSION, partitionKey, generation: 0, revision: 0, cachedLoan: null, outbox: [] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("indexeddb request failed"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb transaction aborted"));
  });
}

export class PrivateStorage {
  private readonly factory: IDBFactory | undefined;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly transactions = new Set<IDBTransaction>();
  private context: VerifiedAccountContext | null = null;
  private partitionGeneration: number | null = null;
  private browserEpoch: number | null = null;
  private runtimeNonce = 0;

  constructor(options: PrivateStorageOptions = {}) {
    this.factory = options.indexedDB ?? defaultIndexedDb();
    this.now = options.now ?? (() => Date.now());
    this.leaseMs = options.leaseDurationMs ?? PRIVATE_LEASE_MS;
  }

  isUnlocked(): boolean {
    return this.context !== null;
  }

  captureGuard(): StorageGuard | null {
    const context = this.context;
    return context ? { profileId: context.profileId, sessionId: context.sessionId, authEpoch: context.authEpoch, runtimeNonce: this.runtimeNonce } : null;
  }

  isGuardCurrent(guard: StorageGuard | null): boolean {
    const context = this.context;
    return Boolean(context && guard && context.profileId === guard.profileId && context.sessionId === guard.sessionId && context.authEpoch === guard.authEpoch && guard.runtimeNonce === this.runtimeNonce);
  }

  async unlock(context: VerifiedAccountContext): Promise<PrivateResult<void>> {
    if (!context || context.verifiedOnline !== true || typeof context.profileId !== "string" || context.profileId.length === 0 || context.profileId.length > 200 || typeof context.sessionId !== "string" || context.sessionId.length === 0 || !Number.isInteger(context.authEpoch) || context.authEpoch < 0) {
      return { kind: "invalid", code: "invalid_account_context" };
    }
    const boundContext: VerifiedAccountContext = { ...context };
    this.context = null;
    this.partitionGeneration = null;
    this.browserEpoch = null;
    this.invalidateTransactions();
    const unlockNonce = ++this.runtimeNonce;
    if (!this.factory) return { kind: "storage-unavailable", reason: "indexeddb-unavailable" };
    let db: IDBDatabase | null = null;
    try {
      db = await this.open();
      const transaction = db.transaction([PRIVATE_STORE_NAME, PRIVATE_META_STORE_NAME], "readonly");
      const completion = complete(transaction);
      completion.catch(() => undefined);
      const stored = await request(transaction.objectStore(PRIVATE_STORE_NAME).get(boundContext.profileId));
      const epoch = readBrowserEpoch(await request(transaction.objectStore(PRIVATE_META_STORE_NAME).get(PRIVATE_BROWSER_EPOCH_KEY)));
      await completion;
      if (unlockNonce !== this.runtimeNonce) return { kind: "locked", reason: "stale-callback" };
      const record = stored ? this.validateStoredRecord(stored, boundContext.profileId) : blankPartition(boundContext.profileId);
      this.partitionGeneration = record.generation;
      this.browserEpoch = epoch;
      this.context = boundContext;
      return { kind: "ok", value: undefined };
    } catch {
      return { kind: "storage-unavailable", reason: "transaction-failed" };
    } finally {
      db?.close();
    }
  }

  lock(): void {
    this.context = null;
    this.runtimeNonce += 1;
    this.partitionGeneration = null;
    this.browserEpoch = null;
    this.invalidateTransactions();
  }

  private isContextCurrent(context: VerifiedAccountContext, nonce = this.runtimeNonce): boolean {
    return this.context?.profileId === context.profileId && this.context?.sessionId === context.sessionId && this.context?.authEpoch === context.authEpoch && nonce === this.runtimeNonce;
  }

  private invalidateTransactions(): void {
    for (const transaction of this.transactions) {
      try { transaction.abort(); } catch { /* already completed */ }
    }
    this.transactions.clear();
  }

  private requireGuard(guard?: StorageGuard): PrivateResult<StorageGuard> {
    const current = this.captureGuard();
    if (!current) return { kind: "locked", reason: "not-unlocked" };
    if (guard && !this.isGuardCurrent(guard)) return { kind: "locked", reason: "stale-callback" };
    return { kind: "ok", value: current };
  }

  private async withPartition<T>(mode: DbMode, fn: (record: PrivatePartitionRecord, put: () => void) => Promise<T> | T): Promise<PrivateResult<T>> {
    const context = this.context;
    const nonce = this.runtimeNonce;
    if (!context) return { kind: "locked", reason: "not-unlocked" };
    if (!this.factory) return { kind: "storage-unavailable", reason: "indexeddb-unavailable" };
    let db: IDBDatabase | null = null;
    let transaction: IDBTransaction | null = null;
    try {
      db = await this.open();
      if (!this.isContextCurrent(context, nonce)) throw new PrivateOperationError("stale_callback");
      transaction = db.transaction([PRIVATE_STORE_NAME, PRIVATE_META_STORE_NAME], mode);
      this.transactions.add(transaction);
      const completion = complete(transaction);
      completion.catch(() => undefined);
      const store = transaction.objectStore(PRIVATE_STORE_NAME);
      const epoch = readBrowserEpoch(await request(transaction.objectStore(PRIVATE_META_STORE_NAME).get(PRIVATE_BROWSER_EPOCH_KEY)));
      if (this.browserEpoch === null || epoch !== this.browserEpoch) throw new PrivateOperationError("browser_revoked");
      const key = context.profileId;
      const stored = await request(store.get(key));
      if (!this.isContextCurrent(context, nonce)) throw new PrivateOperationError("stale_callback");
      const record = stored ? this.validateStoredRecord(stored, key) : blankPartition(key);
      if (this.partitionGeneration === null) this.partitionGeneration = record.generation;
      if (record.generation !== this.partitionGeneration) throw new PrivateOperationError("partition_revoked");
      let shouldPut = false;
      const result = await fn(record, () => { shouldPut = true; });
      if (!this.isContextCurrent(context, nonce)) throw new PrivateOperationError("stale_callback");
      if (shouldPut) await request(store.put(clone(record)));
      await completion;
      if (!this.isContextCurrent(context, nonce)) {
        return { kind: "locked", reason: "stale-callback" };
      }
      return { kind: "ok", value: result };
    } catch (error) {
      if (transaction) {
        try { transaction.abort(); } catch { /* already completed */ }
      }
      if (error instanceof PrivateOperationError) {
        if (error.code === "not_found") return { kind: "not-found" };
        if ((error.code === "partition_revoked" || error.code === "browser_revoked") && this.isContextCurrent(context, nonce)) this.lock();
        if (error.code === "stale_callback" || error.code === "partition_revoked" || error.code === "browser_revoked") return { kind: "locked", reason: "stale-callback" };
        return { kind: "invalid", code: error.code };
      }
      if (error instanceof ContractValidationError) {
        if (error.code === "expired") return { kind: "expired", requestId: "" };
        return { kind: "invalid", code: error.code };
      }
      if (!this.isContextCurrent(context, nonce)) return { kind: "locked", reason: "stale-callback" };
      return { kind: "storage-unavailable", reason: "transaction-failed" };
    } finally {
      if (transaction) this.transactions.delete(transaction);
      db?.close();
    }
  }

  private open(): Promise<IDBDatabase> {
    return openPrivateDatabase(this.factory);
  }

  private validateStoredRecord(value: unknown, key: string): PrivatePartitionRecord {
    if (!value || typeof value !== "object") throw new Error("invalid private record");
    const record = value as Partial<PrivatePartitionRecord>;
    if (!hasExactKeys(record, ["version", "partitionKey", "generation", "revision", "cachedLoan", "outbox"])) throw new Error("invalid private record");
    if (record.version !== PRIVATE_STORAGE_VERSION || record.partitionKey !== key) throw new Error("invalid private record");
    if (!Number.isInteger(record.generation) || (record.generation as number) < 0 || !Number.isInteger(record.revision) || (record.revision as number) < 0) throw new Error("invalid private revision");
    if (!Array.isArray(record.outbox) || record.outbox.length > PRIVATE_MAX_OUTBOX_ITEMS) throw new Error("invalid private outbox");
    if (record.cachedLoan !== null && typeof record.cachedLoan !== "object") throw new Error("invalid private cache");
    if (record.cachedLoan) {
      const cached = record.cachedLoan as CachedSavedLoan;
      if (!hasExactKeys(cached, ["revision", "payload", "acknowledgedAt"]) || !Number.isInteger(cached.revision) || cached.revision < 1 || cached.revision > (record.revision as number) || !cached.payload || !canonicalSavedLoanPayload(cached.payload) || typeof cached.acknowledgedAt !== "string") throw new Error("invalid private cache");
      canonicalTimestamp(cached.acknowledgedAt, "acknowledgedAt");
    }
    const requestIds = new Set<string>();
    for (const operation of record.outbox as PrivateOutboxOperation[]) {
      if (!operation || typeof operation !== "object" || !hasExactKeys(operation, ["requestId", "kind", "expectedRevision", "createdAt", "payloadJson", "payloadHash", "status", "attempts", "nextAttemptAt", "leaseId", "leaseUntil", "pauseReason", "lastErrorCode"])) throw new Error("invalid private operation");
      const id = parseRequestId(operation.requestId);
      if (requestIds.has(id)) throw new Error("duplicate private operation");
      requestIds.add(id);
      if (parseExpectedRevision(operation.expectedRevision) !== operation.expectedRevision) throw new Error("invalid private revision");
      if (typeof operation.createdAt !== "string") throw new Error("invalid private timestamp");
      canonicalTimestamp(operation.createdAt, "createdAt");
      if (!["saveLoan", "deleteLoan"].includes(operation.kind)) throw new Error("invalid private operation");
      if (!["queued", "sending", "paused"].includes(operation.status)) throw new Error("invalid private operation");
      if (!Number.isInteger(operation.attempts) || operation.attempts < 0 || operation.attempts > PRIVATE_MAX_RETRY_ATTEMPTS) throw new Error("invalid private attempts");
      if (!Number.isFinite(operation.nextAttemptAt) || operation.nextAttemptAt < 0) throw new Error("invalid private timing");
      if (typeof operation.payloadHash !== "string" || operation.payloadHash.length > 64) throw new Error("invalid private hash");
      if (operation.lastErrorCode !== null && !TRANSIENT_ERROR_CODES.has(operation.lastErrorCode)) throw new Error("invalid private error");
      if (operation.pauseReason !== null && !["validation", "authorization", "conflict", "retry-exhausted", "expired"].includes(operation.pauseReason)) throw new Error("invalid private pause");
      if (operation.status === "paused" ? operation.pauseReason === null || operation.leaseId !== null || operation.leaseUntil !== null : operation.pauseReason !== null) throw new Error("invalid private status");
      if (operation.status === "sending") {
        if (typeof operation.leaseId !== "string" || parseRequestId(operation.leaseId) !== operation.leaseId || operation.leaseUntil === null || !Number.isFinite(operation.leaseUntil) || operation.leaseUntil < 0) throw new Error("invalid private lease");
      } else if (operation.leaseId !== null || operation.leaseUntil !== null) throw new Error("invalid private lease");
      if (operation.kind === "saveLoan") {
        if (typeof operation.payloadJson !== "string" || operation.payloadJson.length > 20_000) throw new Error("invalid private payload");
        const canonical = canonicalSavedLoanPayload(JSON.parse(operation.payloadJson));
        if (canonical !== operation.payloadJson || hashText(["saveLoan", operation.expectedRevision, new Date(operation.createdAt).getTime(), operation.payloadJson].join("|")) !== operation.payloadHash) throw new Error("invalid private payload");
      }
      if (operation.kind === "deleteLoan" && operation.payloadJson !== null) throw new Error("invalid private operation");
      if (operation.kind === "deleteLoan" && hashText(["deleteLoan", operation.expectedRevision, new Date(operation.createdAt).getTime()].join("|")) !== operation.payloadHash) throw new Error("invalid private payload");
    }
    return record as PrivatePartitionRecord;
  }

  async readState(guard?: StorageGuard): Promise<PrivateResult<PrivateAccountState>> {
    const required = this.requireGuard(guard);
    if (required.kind !== "ok") return required;
    return this.withPartition("readonly", (record) => ({ revision: record.revision, cachedLoan: clone(record.cachedLoan), outbox: clone(record.outbox) }));
  }

  async queueSaveLoan(input: QueueSaveInput, guard?: StorageGuard): Promise<PrivateResult<{ requestId: string }>> {
    const required = this.requireGuard(guard);
    if (required.kind !== "ok") return required;
    let requestId: string;
    let createdTime: number;
    let payloadJson: string;
    try {
      requestId = parseRequestId(input.requestId);
      createdTime = parseCreatedAt(input.createdAt, this.now());
      payloadJson = canonicalSavedLoanPayload(input.payload);
      parseExpectedRevision(input.expectedRevision);
    } catch (error) {
      if (error instanceof ContractValidationError && error.code === "expired") return { kind: "expired", requestId: input.requestId };
      return { kind: "invalid", code: safeCode(error) };
    }
    const stableExpectedRevision = input.expectedRevision;
    const stableCreatedAt = input.createdAt;
    const stablePayloadJson = payloadJson;
    const hash = hashText(["saveLoan", input.expectedRevision, createdTime, payloadJson].join("|"));
    return this.withPartition("readwrite", (record, put) => {
      const existing = record.outbox.find((operation) => operation.requestId === requestId);
      if (existing) {
        if (existing.kind !== "saveLoan" || existing.expectedRevision !== stableExpectedRevision || existing.createdAt !== stableCreatedAt || existing.payloadHash !== hash || existing.payloadJson !== stablePayloadJson) throw new PrivateOperationError("request_id_reused");
        return { requestId };
      }
      if (record.outbox.length >= PRIVATE_MAX_OUTBOX_ITEMS) throw new PrivateOperationError("outbox_full");
      const nextRevision = record.outbox.at(-1)?.expectedRevision;
      const expected = nextRevision === undefined ? record.revision : nextRevision + 1;
      if (stableExpectedRevision !== expected || record.revision > expected) throw new PrivateOperationError("queue_changed");
      record.outbox.push({ requestId, kind: "saveLoan", expectedRevision: stableExpectedRevision, createdAt: stableCreatedAt, payloadJson: stablePayloadJson, payloadHash: hash, status: "queued", attempts: 0, nextAttemptAt: createdTime, leaseId: null, leaseUntil: null, pauseReason: null, lastErrorCode: null });
      put();
      return { requestId };
    });
  }

  async queueDeleteLoan(input: QueueDeleteInput, guard?: StorageGuard): Promise<PrivateResult<{ requestId: string }>> {
    const required = this.requireGuard(guard);
    if (required.kind !== "ok") return required;
    let requestId: string;
    let createdTime: number;
    try {
      requestId = parseRequestId(input.requestId);
      createdTime = parseCreatedAt(input.createdAt, this.now());
      parseExpectedRevision(input.expectedRevision);
    } catch (error) {
      if (error instanceof ContractValidationError && error.code === "expired") return { kind: "expired", requestId: input.requestId };
      return { kind: "invalid", code: safeCode(error) };
    }
    const stableExpectedRevision = input.expectedRevision;
    const stableCreatedAt = input.createdAt;
    const hash = hashText(["deleteLoan", input.expectedRevision, createdTime].join("|"));
    return this.withPartition("readwrite", (record, put) => {
      const existing = record.outbox.find((operation) => operation.requestId === requestId);
      if (existing) {
        if (existing.kind !== "deleteLoan" || existing.expectedRevision !== stableExpectedRevision || existing.createdAt !== stableCreatedAt || existing.payloadHash !== hash || existing.payloadJson !== null) throw new PrivateOperationError("request_id_reused");
        return { requestId };
      }
      if (record.outbox.length >= PRIVATE_MAX_OUTBOX_ITEMS) throw new PrivateOperationError("outbox_full");
      const nextRevision = record.outbox.at(-1)?.expectedRevision;
      const expected = nextRevision === undefined ? record.revision : nextRevision + 1;
      if (stableExpectedRevision !== expected || record.revision > expected) throw new PrivateOperationError("queue_changed");
      record.outbox.push({ requestId, kind: "deleteLoan", expectedRevision: stableExpectedRevision, createdAt: stableCreatedAt, payloadJson: null, payloadHash: hash, status: "queued", attempts: 0, nextAttemptAt: createdTime, leaseId: null, leaseUntil: null, pauseReason: null, lastErrorCode: null });
      put();
      return { requestId };
    });
  }

  async claimNext(guard?: StorageGuard, online = false): Promise<PrivateResult<ClaimedOperation> | PrivateResult<never>> {
    const required = this.requireGuard(guard);
    if (required.kind !== "ok") return required;
    if (!online) return { kind: "locked", reason: "offline" };
    const current = required.value;
    const now = this.now();
    const result = await this.withPartition("readwrite", (record, put) => {
      let recoveredLease = false;
      for (const operation of record.outbox) {
        if (operation.status === "sending" && operation.leaseUntil !== null && operation.leaseUntil <= now) {
          operation.status = "queued"; operation.leaseId = null; operation.leaseUntil = null; recoveredLease = true;
        }
      }
      const head = record.outbox[0];
      const expired = head && now - new Date(head.createdAt).getTime() > PRIVATE_REPLAY_WINDOW_MS ? head : undefined;
      if (expired) {
        expired.status = "paused";
        expired.pauseReason = "expired";
        expired.leaseId = null;
        expired.leaseUntil = null;
        put();
        return { kind: "expired", requestId: expired.requestId } as const;
      }
      const operation = record.outbox[0];
      if (!operation || operation.status !== "queued" || operation.nextAttemptAt > now) {
        if (recoveredLease) put();
        return { kind: "not-found" } as const;
      }
      if (operation.attempts >= PRIVATE_MAX_RETRY_ATTEMPTS) {
        operation.status = "paused";
        operation.pauseReason = "retry-exhausted";
        put();
        return { kind: "not-found" } as const;
      }
      operation.status = "sending"; operation.attempts += 1; operation.leaseId = randomUuid(); operation.leaseUntil = now + this.leaseMs; put();
      return { kind: "claimed", operation: clone(operation) } as const;
    });
    if (result.kind !== "ok") return result;
    if (result.value.kind === "expired") return result.value;
    if (result.value.kind === "not-found") return { kind: "not-found" };
    return { kind: "ok", value: { operation: result.value.operation, guard: current } };
  }

  async acknowledge(ack: SaveAcknowledgement | DeleteAcknowledgement, guard: StorageGuard): Promise<PrivateResult<void>> {
    const required = this.requireGuard(guard);
    if (required.kind !== "ok") return required;
    if (!Number.isInteger(ack.revision) || ack.revision < 1) return { kind: "invalid", code: "invalid_revision" };
    const result = await this.withPartition("readwrite", (record, put) => {
      const operation = record.outbox.find((candidate) => candidate.requestId === ack.requestId);
      if (!operation || operation.kind !== ack.kind || operation.leaseId !== ack.leaseId || operation.status !== "sending") throw new PrivateOperationError("ack_mismatch");
      if (ack.revision !== operation.expectedRevision + 1) throw new PrivateOperationError("ack_mismatch");
      if (operation.leaseUntil === null || operation.leaseUntil <= this.now()) throw new PrivateOperationError("lease_expired");
      record.outbox = record.outbox.filter((candidate) => candidate.requestId !== ack.requestId);
      put();
      return undefined;
    });
    if (result.kind !== "ok") return result;
    return result;
  }

  /** Apply a fresh server projection. Historical receipts never repopulate this cache. */
  async applyServerState(state: ServerSavedLoanState, guard?: StorageGuard): Promise<PrivateResult<void>> {
    const required = this.requireGuard(guard);
    if (required.kind !== "ok") return required;
    let payload = null;
    try {
      if (!Number.isInteger(state.revision) || state.revision < 0 || (state.revision === 0 && state.payload !== null)) return { kind: "invalid", code: "invalid_revision" };
      payload = state.payload === null ? null : parseSavedLoanPayload(state.payload);
    } catch (error) {
      return { kind: "invalid", code: safeCode(error) };
    }
    const stableRevision = state.revision;
    const stablePayload = payload;
    const result = await this.withPartition("readwrite", (record, put) => {
      if (stableRevision < record.revision) throw new PrivateOperationError("stale_revision");
      record.revision = stableRevision;
      record.cachedLoan = stablePayload === null ? null : { revision: stableRevision, payload: stablePayload, acknowledgedAt: nowIso(this.now()) };
      put();
      return undefined;
    });
    return result;
  }

  async recordTransientFailure(requestId: string, leaseId: string, errorCode: string, guard?: StorageGuard): Promise<PrivateResult<void>> {
    const required = this.requireGuard(guard);
    if (required.kind !== "ok") return required;
    let id: string;
    try { id = parseRequestId(requestId); } catch (error) { return { kind: "invalid", code: safeCode(error) }; }
    const result = await this.withPartition("readwrite", (record, put) => {
      const operation = record.outbox.find((candidate) => candidate.requestId === id);
      if (!operation) throw new PrivateOperationError("not_found");
      if (operation.status !== "sending") throw new PrivateOperationError("operation_not_sending");
      if (!operation.leaseId || operation.leaseId !== leaseId || operation.leaseUntil === null || operation.leaseUntil <= this.now()) throw new PrivateOperationError("lease_expired");
      const safeErrorCode = TRANSIENT_ERROR_CODES.has(errorCode) ? errorCode : "unavailable";
      operation.lastErrorCode = safeErrorCode;
      operation.leaseId = null; operation.leaseUntil = null;
      if (operation.attempts >= PRIVATE_MAX_RETRY_ATTEMPTS) {
        operation.status = "paused"; operation.pauseReason = "retry-exhausted";
      } else {
        operation.status = "queued"; operation.nextAttemptAt = this.now() + Math.min(60_000, 1000 * 2 ** Math.min(operation.attempts, 6));
      }
      put();
      return undefined;
    });
    return result;
  }

  async pauseOperation(requestId: string, leaseId: string, reason: "validation" | "authorization" | "conflict", guard?: StorageGuard): Promise<PrivateResult<void>> {
    const required = this.requireGuard(guard);
    if (required.kind !== "ok") return required;
    let id: string;
    try { id = parseRequestId(requestId); } catch (error) { return { kind: "invalid", code: safeCode(error) }; }
    const result = await this.withPartition("readwrite", (record, put) => {
      const operation = record.outbox.find((candidate) => candidate.requestId === id);
      if (!operation) throw new PrivateOperationError("not_found");
      if (operation.status !== "sending" || operation.leaseId !== leaseId || operation.leaseUntil === null || operation.leaseUntil <= this.now()) throw new PrivateOperationError("lease_expired");
      operation.status = "paused"; operation.pauseReason = reason; operation.leaseId = null; operation.leaseUntil = null; put(); return undefined;
    });
    return result;
  }

  /**
   * Resolve a paused FIFO chain with one guarded compare-and-swap. The
   * observed IDs and current revision must still match, so a second tab cannot
   * silently drop newer local intent while replacing the chain.
   */
  async resolvePausedQueue(
    requestId: string,
    observedRequestIds: readonly string[],
    expectedRevision: number,
    replacement: QueueSaveInput | QueueDeleteInput | null,
    guard?: StorageGuard,
  ): Promise<PrivateResult<{ requestId?: string }>> {
    const required = this.requireGuard(guard);
    if (required.kind !== "ok") return required;
    let id: string;
    let observed: string[];
    let prepared: PrivateOutboxOperation | null = null;
    try {
      id = parseRequestId(requestId);
      parseExpectedRevision(expectedRevision);
      observed = observedRequestIds.map((candidate) => parseRequestId(candidate));
      if (observed.length === 0 || observed[0] !== id || new Set(observed).size !== observed.length) throw new PrivateOperationError("queue_changed");
      if (replacement) {
        const replacementId = parseRequestId(replacement.requestId);
        const createdTime = parseCreatedAt(replacement.createdAt, this.now());
        if (replacement.expectedRevision !== expectedRevision || observed.includes(replacementId)) throw new PrivateOperationError("queue_changed");
        if ("payload" in replacement) {
          const payloadJson = canonicalSavedLoanPayload(replacement.payload);
          prepared = { requestId: replacementId, kind: "saveLoan", expectedRevision, createdAt: replacement.createdAt, payloadJson, payloadHash: hashText(["saveLoan", expectedRevision, createdTime, payloadJson].join("|")), status: "queued", attempts: 0, nextAttemptAt: createdTime, leaseId: null, leaseUntil: null, pauseReason: null, lastErrorCode: null };
        } else {
          prepared = { requestId: replacementId, kind: "deleteLoan", expectedRevision, createdAt: replacement.createdAt, payloadJson: null, payloadHash: hashText(["deleteLoan", expectedRevision, createdTime].join("|")), status: "queued", attempts: 0, nextAttemptAt: createdTime, leaseId: null, leaseUntil: null, pauseReason: null, lastErrorCode: null };
        }
      }
    } catch (error) {
      if (error instanceof PrivateOperationError) return { kind: "invalid", code: error.code };
      return { kind: "invalid", code: safeCode(error) };
    }
    return this.withPartition("readwrite", (record, put) => {
      if (record.revision !== expectedRevision || record.outbox.length !== observed.length || record.outbox.some((operation, index) => operation.requestId !== observed[index]) || record.outbox[0]?.requestId !== id || record.outbox[0]?.status !== "paused" || record.outbox.some((operation) => operation.status === "sending")) throw new PrivateOperationError("queue_changed");
      record.outbox = prepared ? [prepared] : [];
      put();
      return prepared ? { requestId: prepared.requestId } : {};
    });
  }

  async confirmDiscardFormerMember(guard: StorageGuard, confirmed: boolean): Promise<DiscardResult> {
    if (!confirmed) return { kind: "cancelled" };
    if (!this.isGuardCurrent(guard)) return { kind: "locked" };
    if (!this.factory) return { kind: "storage-unavailable" };
    const result = await this.withPartition("readwrite", (record, put) => { record.generation += 1; record.revision = 0; record.cachedLoan = null; record.outbox = []; put(); return { kind: "discarded", clearedPartition: record.partitionKey } as const; });
    if (result.kind !== "ok") return { kind: "storage-unavailable" };
    this.lock();
    return result.value;
  }

  /**
   * Capture an account-bound local cleanup operation before deletion submits.
   * The returned operation is the only API that can run after this session is
   * revoked; it never returns the partition contents or contacts a server.
   */
  captureFormerAccountCleanup(
    access: PrivateSessionAccess,
    confirmed: boolean,
  ): CapturedFormerPartitionCleanup | null {
    if (!confirmed || !access.isCurrent()) return null;
    const guard = this.captureGuard();
    if (!guard || access.identity.profileId !== guard.profileId || access.identity.sessionId !== guard.sessionId ||
        access.identity.authEpoch !== guard.authEpoch || access.identity.verifiedOnline !== true || !this.isGuardCurrent(guard)) return null;
    const capturedGeneration = this.partitionGeneration ?? 0;
    const capturedEpoch = this.browserEpoch ?? 0;
    let completed: FormerPartitionCleanupResult | null = null;
    return {
      run: async () => {
        if (completed) return completed;
        const result = await this.clearCapturedPartition(guard, capturedGeneration, capturedEpoch);
        if (result.kind === "cleared") completed = result;
        return result;
      },
    };
  }

  private async clearCapturedPartition(
    guard: StorageGuard,
    capturedGeneration: number,
    capturedEpoch: number,
  ): Promise<FormerPartitionCleanupResult> {
    const current = this.context;
    if (current && current.profileId === guard.profileId &&
        (current.sessionId !== guard.sessionId || current.authEpoch !== guard.authEpoch || this.runtimeNonce !== guard.runtimeNonce)) {
      return { kind: "retry", reason: "runtime-changed" };
    }
    if (!this.factory) return { kind: "retry", reason: "storage-failure" };
    let db: IDBDatabase | null = null;
    try {
      db = await this.open();
      const transaction = db.transaction([PRIVATE_STORE_NAME, PRIVATE_META_STORE_NAME], "readwrite");
      const completion = complete(transaction);
      completion.catch(() => undefined);
      const store = transaction.objectStore(PRIVATE_STORE_NAME);
      const epoch = readBrowserEpoch(await request(transaction.objectStore(PRIVATE_META_STORE_NAME).get(PRIVATE_BROWSER_EPOCH_KEY)));
      if (epoch !== capturedEpoch) {
        try { transaction.abort(); } catch { /* already aborted */ }
        await completion.catch(() => undefined);
        return { kind: "retry", reason: "runtime-changed" };
      }
      const stored = await request(store.get(guard.profileId)) as unknown;
      let generation = capturedGeneration;
      if (stored && typeof stored === "object") {
        const storedGeneration = (stored as { generation?: unknown }).generation;
        if (!Number.isSafeInteger(storedGeneration) || (storedGeneration as number) < 0) throw new Error("invalid generation");
        generation = Math.max(generation, storedGeneration as number);
      }
      if (generation >= Number.MAX_SAFE_INTEGER) throw new Error("generation exhausted");
      const nextGeneration = generation + 1;
      store.put({ version: PRIVATE_STORAGE_VERSION, partitionKey: guard.profileId, generation: nextGeneration, revision: 0, cachedLoan: null, outbox: [] });
      await completion;
      const after = this.context;
      if (after && after.profileId === guard.profileId &&
          (after.sessionId !== guard.sessionId || after.authEpoch !== guard.authEpoch || this.runtimeNonce !== guard.runtimeNonce)) {
        return { kind: "retry", reason: "runtime-changed" };
      }
      if (after && after.profileId === guard.profileId && after.sessionId === guard.sessionId && after.authEpoch === guard.authEpoch) this.lock();
      return { kind: "cleared", generation: nextGeneration };
    } catch {
      return { kind: "retry", reason: "storage-failure" };
    } finally {
      db?.close();
    }
  }
}

export function createPrivateStorage(options: PrivateStorageOptions = {}): PrivateStorage {
  return new PrivateStorage(options);
}

export function isReplayWindowValid(createdAt: string, now = Date.now()): boolean {
  try {
    const timestamp = new Date(canonicalTimestamp(createdAt, "createdAt")).getTime();
    return timestamp <= now && now - timestamp <= SAVED_LOAN_LIMITS.maxRequestAgeMs;
  } catch { return false; }
}
