import {
  AUTH_INTENT_SCHEMA_VERSION,
  AUTH_INTENT_TTL_MS,
  cancelAuthIntent,
  claimAuthIntent,
  completeAuthIntent,
  createAuthIntent,
  decodeAuthIntent,
  type AuthIntent,
  type AuthIntentAction,
  type IntentContext,
  type PendingIntentContext,
} from "../contracts/auth-intent";
import {
  decodeComparisonDraft,
  serializeComparisonDraft,
  type CompareDraft,
} from "../contracts/comparison-draft";
import {
  decodeComparisonSnapshot,
  serializeComparisonSnapshot,
  type ComparisonSnapshot,
} from "../contracts/snapshot";
import {
  canonicalTimestamp,
  contractFail,
  exactKeys,
  randomUuid,
  recordOf,
  stringValue,
  uuidValue,
  type ContractValidationError,
} from "../contracts/errors";

export const GUEST_HANDOFF_DB_NAME = "truecost-guest-handoff-v1";
export const GUEST_HANDOFF_STORE_NAME = "handoffs";
export const GUEST_HANDOFF_RECOVERY_STORE_NAME = "guestDraftRecovery";
const GUEST_HANDOFF_DB_VERSION = 2;
export const GUEST_HANDOFF_MAX_RECORDS = 8;
export const GUEST_HANDOFF_MAX_BYTES = 256 * 1024;
export const GUEST_HANDOFF_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type HandoffFailureKind =
  | "invalid"
  | "storage-unavailable"
  | "not-found"
  | "locked"
  | "expired"
  | "terminal"
  | "quota";

export interface HandoffFailure {
  kind: HandoffFailureKind;
  message: string;
}

export type HandoffResult<T> = { kind: "ok"; value: T } | HandoffFailure;

export interface GuestHandoffValue {
  intent: Readonly<AuthIntent>;
  snapshot: Readonly<ComparisonSnapshot> | null;
  draft: Readonly<CompareDraft> | null;
}

export interface GuestHandoffRecoveryValue {
  status: "pending" | "expired" | "cancelled";
  snapshot: Readonly<ComparisonSnapshot> | null;
  draft: Readonly<CompareDraft> | null;
}

export interface GuestHandoffPrepareInput {
  action: AuthIntentAction;
  initiatingTabId: string;
  snapshot: ComparisonSnapshot | null;
  draft: CompareDraft | null;
}

interface StoredHandoff {
  requestId: string;
  intent: AuthIntent;
  snapshotJson: string | null;
  draftJson: string | null;
  updatedAt: string;
}

interface StoredRecovery {
  requestId: string;
  initiatingTabId: string;
  snapshotJson: string | null;
  draftJson: string | null;
  intentExpiresAt: string;
  expiresAt: string;
  status: "pending" | "expired" | "cancelled";
  updatedAt: string;
}

const RECORD_KEYS = ["requestId", "intent", "snapshotJson", "draftJson", "updatedAt"] as const;
const RECOVERY_KEYS = ["requestId", "initiatingTabId", "snapshotJson", "draftJson", "intentExpiresAt", "expiresAt", "status", "updatedAt"] as const;

function dateValue(value: string): number {
  return new Date(value).getTime();
}

function nowValue(now: () => string): string {
  return canonicalTimestamp(now(), "handoff.now");
}

function failure(kind: HandoffFailureKind, message: string): HandoffFailure {
  return { kind, message };
}

function classifyContract(error: unknown): HandoffFailure {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as ContractValidationError).code;
    if (code === "expired" || code === "lease_expired") return failure("expired", "handoff has expired");
  }
  return failure("invalid", "handoff input is invalid");
}

function openDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(GUEST_HANDOFF_DB_NAME, GUEST_HANDOFF_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GUEST_HANDOFF_STORE_NAME)) {
        request.result.createObjectStore(GUEST_HANDOFF_STORE_NAME, { keyPath: "requestId" });
      }
      if (!request.result.objectStoreNames.contains(GUEST_HANDOFF_RECOVERY_STORE_NAME)) {
        request.result.createObjectStore(GUEST_HANDOFF_RECOVERY_STORE_NAME, { keyPath: "requestId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

/**
 * Runs all read/validate/write work inside one IndexedDB transaction. The
 * operation callback must finish synchronously from its request handlers so a
 * stale read cannot be used to mutate a newer handoff.
 */
interface HandoffStores {
  handoffs: IDBObjectStore;
  recovery: IDBObjectStore;
}

function transaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (stores: HandoffStores, finish: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let result: T | undefined;
    let completed = false;
    let settled = false;
    let transactionRef: IDBTransaction | undefined;
    try {
      transactionRef = db.transaction([GUEST_HANDOFF_STORE_NAME, GUEST_HANDOFF_RECOVERY_STORE_NAME], mode);
      const transaction = transactionRef;
      const stores: HandoffStores = {
        handoffs: transaction.objectStore(GUEST_HANDOFF_STORE_NAME),
        recovery: transaction.objectStore(GUEST_HANDOFF_RECOVERY_STORE_NAME),
      };
      const finish = (value: T) => {
        if (completed) return;
        completed = true;
        result = value;
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        if (!completed) reject(new Error("IndexedDB transaction completed without a result"));
        else resolve(result as T);
      };
      transaction.onerror = () => {
        if (settled) return;
        settled = true;
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      };
      transaction.onabort = () => {
        if (settled) return;
        settled = true;
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      };
      operation(stores, finish);
    } catch (error) {
      try { transactionRef?.abort(); } catch { /* closed transaction */ }
      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });
}

function decodeStored(value: unknown): StoredHandoff {
  const record = recordOf(value, "handoff record");
  exactKeys(record, RECORD_KEYS, "handoff record");
  try {
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > GUEST_HANDOFF_MAX_BYTES) {
      contractFail("invalid_shape", "saved handoff data is too large");
    }
  } catch {
    contractFail("invalid_shape", "saved handoff data is not serializable");
  }
  const requestId = uuidValue(record.requestId, "handoff record.requestId");
  const intent = decodeAuthIntent(record.intent);
  if (intent.requestId !== requestId) contractFail("id_mismatch", "handoff request IDs do not match");
  const snapshotJson = record.snapshotJson;
  const draftJson = record.draftJson;
  if (snapshotJson !== null && typeof snapshotJson !== "string") contractFail("invalid_shape", "handoff snapshot payload is invalid");
  if (draftJson !== null && typeof draftJson !== "string") contractFail("invalid_shape", "handoff draft payload is invalid");
  const snapshot = snapshotJson === null ? null : decodeComparisonSnapshot(JSON.parse(snapshotJson));
  const draft = draftJson === null ? null : decodeComparisonDraft(JSON.parse(draftJson), 2);
  canonicalTimestamp(record.updatedAt, "handoff record.updatedAt");
  const terminal = intent.state === "completed" || intent.state === "cancelled";
  if (terminal && (snapshotJson !== null || draftJson !== null)) contractFail("invalid_shape", "terminal handoff retains payload");
  if (!terminal && intent.action === "recalculate_existing_draft" && draftJson === null) contractFail("invalid_shape", "handoff draft payload is missing");
  if (!terminal && intent.action !== "recalculate_existing_draft" && draftJson !== null) contractFail("invalid_shape", "handoff draft payload is not referenced");
  if (!terminal && (intent.action === "save" || intent.action === "download") && snapshotJson === null) contractFail("invalid_shape", "handoff snapshot payload is missing");
  if (snapshot !== null && snapshot.resultId !== intent.resultId) contractFail("id_mismatch", "handoff snapshot result does not match intent");
  return {
    requestId,
    intent: { ...intent },
    snapshotJson,
    draftJson,
    updatedAt: record.updatedAt as string,
  };
}

function readPayload(record: StoredHandoff): GuestHandoffValue {
  return {
    intent: decodeAuthIntent(record.intent),
    snapshot: record.snapshotJson === null ? null : decodeComparisonSnapshot(JSON.parse(record.snapshotJson)),
    draft: record.draftJson === null ? null : decodeComparisonDraft(JSON.parse(record.draftJson)),
  };
}

function decodeRecovery(value: unknown): StoredRecovery {
  const record = recordOf(value, "guest recovery");
  exactKeys(record, RECOVERY_KEYS, "guest recovery");
  try {
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > GUEST_HANDOFF_MAX_BYTES) {
      contractFail("invalid_shape", "guest recovery data is too large");
    }
  } catch {
    contractFail("invalid_shape", "guest recovery data is not serializable");
  }
  const requestId = uuidValue(record.requestId, "guest recovery.requestId");
  const initiatingTabId = stringValue(record.initiatingTabId, "guest recovery.initiatingTabId", 128);
  const snapshotJson = record.snapshotJson;
  const draftJson = record.draftJson;
  if (snapshotJson !== null && typeof snapshotJson !== "string") contractFail("invalid_shape", "guest recovery snapshot is invalid");
  if (draftJson !== null && typeof draftJson !== "string") contractFail("invalid_shape", "guest recovery draft is invalid");
  if (snapshotJson !== null) decodeComparisonSnapshot(JSON.parse(snapshotJson));
  if (draftJson !== null) decodeComparisonDraft(JSON.parse(draftJson), 2);
  const intentExpiresAt = canonicalTimestamp(record.intentExpiresAt, "guest recovery.intentExpiresAt");
  const expiresAt = canonicalTimestamp(record.expiresAt, "guest recovery.expiresAt");
  const updatedAt = canonicalTimestamp(record.updatedAt, "guest recovery.updatedAt");
  if (!(dateValue(updatedAt) < dateValue(expiresAt)) || dateValue(expiresAt) - dateValue(updatedAt) > GUEST_HANDOFF_RECOVERY_TTL_MS) {
    contractFail("invalid_timestamp", "guest recovery expiry is out of bounds");
  }
  if (record.status !== "pending" && record.status !== "expired" && record.status !== "cancelled") contractFail("invalid_state", "guest recovery status is invalid");
  if (!(dateValue(intentExpiresAt) < dateValue(expiresAt))) contractFail("invalid_timestamp", "guest recovery expiry must outlast the intent");
  return { requestId, initiatingTabId, snapshotJson, draftJson, intentExpiresAt, expiresAt, status: record.status, updatedAt };
}

function recoveryPayload(record: StoredRecovery): { snapshot: Readonly<ComparisonSnapshot> | null; draft: Readonly<CompareDraft> | null } {
  return {
    snapshot: record.snapshotJson === null ? null : decodeComparisonSnapshot(JSON.parse(record.snapshotJson)),
    draft: record.draftJson === null ? null : decodeComparisonDraft(JSON.parse(record.draftJson), 2),
  };
}

function recordBytes(record: object): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

function terminalRecord(record: StoredHandoff, at: string, state: "completed" | "cancelled"): StoredHandoff {
  const next = { ...record.intent, state, completedAt: state === "completed" ? at : null, cancelledAt: state === "cancelled" ? at : null, leaseExpiresAt: null };
  return { ...record, intent: decodeAuthIntent(next), snapshotJson: null, draftJson: null, updatedAt: at };
}

function validatePrepare(input: GuestHandoffPrepareInput, now: string): {
  intent: Readonly<AuthIntent>;
  snapshot: Readonly<ComparisonSnapshot> | null;
  draft: Readonly<CompareDraft> | null;
  snapshotJson: string | null;
  draftJson: string | null;
} {
  const initiatingTabId = stringValue(input.initiatingTabId, "handoff.initiatingTabId", 128);
  const snapshot = input.snapshot === null ? null : decodeComparisonSnapshot(input.snapshot);
  const draft = input.draft === null ? null : decodeComparisonDraft(input.draft, 2);
  if ((input.action === "save" || input.action === "download") && snapshot === null) {
    contractFail("invalid_shape", "save and download require a snapshot");
  }
  if (input.action === "recalculate_existing_draft" && draft === null) {
    contractFail("invalid_shape", "recalculation requires a draft");
  }
  if (input.action !== "recalculate_existing_draft" && draft !== null) {
    contractFail("invalid_shape", "only recalculation may carry a draft");
  }
  const intent = createAuthIntent({
    action: input.action,
    initiatingTabId,
    resultId: snapshot?.resultId ?? null,
    draftId: draft === null ? null : randomUuid(),
    now,
    ttlMs: AUTH_INTENT_TTL_MS,
  });
  const snapshotJson = snapshot === null ? null : serializeComparisonSnapshot(snapshot);
  const draftJson = draft === null ? null : serializeComparisonDraft(draft, 2);
  const record: StoredHandoff = { requestId: intent.requestId, intent: { ...intent }, snapshotJson, draftJson, updatedAt: now };
  if (recordBytes(record) > GUEST_HANDOFF_MAX_BYTES) contractFail("invalid_shape", "handoff payload is too large");
  return { intent, snapshot, draft, snapshotJson, draftJson };
}

function getAllRequest(store: IDBObjectStore): IDBRequest<unknown[]> {
  return store.getAll(null, GUEST_HANDOFF_MAX_RECORDS + 1);
}

function validateRecords(values: unknown[]): StoredHandoff[] {
  return values.map((value) => decodeStored(value));
}

export interface GuestHandoffStorageOptions {
  indexedDB?: IDBFactory;
  now?: () => string;
}

export class GuestHandoffStorage {
  private readonly indexedDb: IDBFactory | undefined;
  private readonly now: () => string;

  constructor(options: GuestHandoffStorageOptions = {}) {
    this.indexedDb = options.indexedDB ?? (typeof globalThis.indexedDB === "undefined" ? undefined : globalThis.indexedDB);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private async withTransaction<T>(mode: IDBTransactionMode, operation: (stores: HandoffStores, finish: (value: T) => void) => void): Promise<T> {
    if (!this.indexedDb) throw new Error("IndexedDB is unavailable");
    const db = await openDatabase(this.indexedDb);
    try {
      return await transaction(db, mode, operation);
    } finally {
      db.close();
    }
  }

  async prepare(input: GuestHandoffPrepareInput): Promise<HandoffResult<GuestHandoffValue>> {
    let prepared: ReturnType<typeof validatePrepare>;
    let now: string;
    try {
      now = nowValue(this.now);
      prepared = validatePrepare(input, now);
    } catch (error) {
      return classifyContract(error);
    }
    const record: StoredHandoff = {
      requestId: prepared.intent.requestId,
      intent: { ...prepared.intent },
      snapshotJson: prepared.snapshotJson,
      draftJson: prepared.draftJson,
      updatedAt: now,
    };
    const recovery: StoredRecovery = {
      requestId: prepared.intent.requestId,
      initiatingTabId: prepared.intent.initiatingTabId,
      snapshotJson: prepared.snapshotJson,
      draftJson: prepared.draftJson,
      intentExpiresAt: prepared.intent.expiresAt,
      expiresAt: new Date(dateValue(now) + GUEST_HANDOFF_RECOVERY_TTL_MS).toISOString(),
      status: "pending",
      updatedAt: now,
    };
    if (recordBytes(recovery) > GUEST_HANDOFF_MAX_BYTES) return failure("invalid", "handoff payload is too large");
    try {
      const result = await this.withTransaction<HandoffResult<GuestHandoffValue>>("readwrite", (stores, finish) => {
        const request = getAllRequest(stores.handoffs);
        const recoveryRequest = stores.recovery.getAll(null, GUEST_HANDOFF_MAX_RECORDS + 1);
        let records: StoredHandoff[] | null = null;
        let recoveries: StoredRecovery[] | null = null;
        const proceed = () => {
          if (records === null || recoveries === null) return;
          const active = records.filter((candidate) => candidate.intent.state === "pending" || candidate.intent.state === "claimed");
          const expiredIds = new Set(active.filter((candidate) => dateValue(now) >= dateValue(candidate.intent.expiresAt)).map((candidate) => candidate.requestId));
          for (const requestId of expiredIds) stores.handoffs.delete(requestId);
          const retained = records.filter((candidate) => !expiredIds.has(candidate.requestId));
          const liveActive = retained.filter((candidate) => candidate.intent.state === "pending" || candidate.intent.state === "claimed");
          if (liveActive.length >= GUEST_HANDOFF_MAX_RECORDS) {
            finish(failure("quota", "too many pending handoffs"));
            return;
          }
          if (retained.length >= GUEST_HANDOFF_MAX_RECORDS) {
            const terminal = retained.find((candidate) => candidate.intent.state === "completed" || candidate.intent.state === "cancelled");
            if (!terminal) {
              finish(failure("quota", "too many saved handoffs"));
              return;
            }
            stores.handoffs.delete(terminal.requestId);
            stores.recovery.delete(terminal.requestId);
          }
          const expiredRecoveries = recoveries.filter((candidate) => dateValue(now) >= dateValue(candidate.expiresAt));
          for (const candidate of expiredRecoveries) stores.recovery.delete(candidate.requestId);
          const retainedRecoveries = recoveries.filter((candidate) => dateValue(now) < dateValue(candidate.expiresAt));
          const recyclableRecovery = retainedRecoveries.find((candidate) => candidate.status !== "pending" || dateValue(now) >= dateValue(candidate.intentExpiresAt));
          if (retainedRecoveries.length >= GUEST_HANDOFF_MAX_RECORDS && !recyclableRecovery) {
            finish(failure("quota", "too many guest recovery records"));
            return;
          }
          if (retainedRecoveries.length >= GUEST_HANDOFF_MAX_RECORDS) {
            stores.recovery.delete(recyclableRecovery!.requestId);
          }
          stores.handoffs.add(record);
          stores.recovery.add(recovery);
          finish({ kind: "ok", value: readPayload(record) });
        };
        request.onsuccess = () => {
          try {
            records = validateRecords(request.result);
          } catch {
            finish(failure("storage-unavailable", "saved handoff data is invalid"));
            return;
          }
          proceed();
        };
        request.onerror = () => finish(failure("storage-unavailable", "handoff persistence failed"));
        recoveryRequest.onsuccess = () => {
          try {
            recoveries = recoveryRequest.result.map((value) => decodeRecovery(value));
          } catch {
            finish(failure("storage-unavailable", "guest recovery data is invalid"));
            return;
          }
          proceed();
        };
        recoveryRequest.onerror = () => finish(failure("storage-unavailable", "guest recovery read failed"));
      });
      return result;
    } catch {
      return failure("storage-unavailable", "handoff persistence is unavailable");
    }
  }

  async read(requestId: string, context: string | IntentContext): Promise<HandoffResult<GuestHandoffValue>> {
    try { uuidValue(requestId, "handoff.requestId"); } catch (error) { return classifyContract(error); }
    let now: string;
    try { now = nowValue(this.now); } catch (error) { return classifyContract(error); }
    try {
      return await this.withTransaction<HandoffResult<GuestHandoffValue>>("readonly", (stores, finish) => {
        const request = stores.handoffs.get(requestId);
        request.onsuccess = () => {
          if (request.result === undefined) { finish(failure("not-found", "handoff was not found")); return; }
          let record: StoredHandoff;
          try { record = decodeStored(request.result); } catch { finish(failure("storage-unavailable", "saved handoff data is invalid")); return; }
          if (record.intent.state === "completed" || record.intent.state === "cancelled") { finish(failure("terminal", "handoff is already terminal")); return; }
          if (dateValue(now) < dateValue(record.intent.createdAt) || dateValue(now) >= dateValue(record.intent.expiresAt)) { finish(failure("expired", "handoff has expired")); return; }
          if (typeof context === "string") {
            try { stringValue(context, "handoff.initiatingTabId", 128); } catch (error) { finish(classifyContract(error)); return; }
            if (context !== record.intent.initiatingTabId) { finish(failure("locked", "handoff belongs to another tab")); return; }
            if (record.intent.state !== "pending") { finish(failure("locked", "claimed handoff requires verified account context")); return; }
          } else {
            let identity: string;
            try {
              identity = stringValue(context.accountKeyHash, "context.accountKeyHash", 128);
            } catch (error) { finish(classifyContract(error)); return; }
            if (context.initiatingTabId !== record.intent.initiatingTabId || record.intent.state !== "claimed" || record.intent.accountKeyHash !== identity || record.intent.authEpoch !== context.authEpoch) {
              finish(failure("locked", "handoff is bound to another tab or account")); return;
            }
          }
          finish({ kind: "ok", value: readPayload(record) });
        };
        request.onerror = () => finish(failure("storage-unavailable", "handoff read failed"));
      });
    } catch {
      return failure("storage-unavailable", "handoff persistence is unavailable");
    }
  }

  /**
   * Recovers only the public guest payload for the original tab. A successful
   * claim removes this record, so a member cannot read it through this method.
   * Recovery does not execute the action or bind an account.
   */
  async recover(requestId: string, initiatingTabId: string): Promise<HandoffResult<{ snapshot: Readonly<ComparisonSnapshot> | null; draft: Readonly<CompareDraft> | null }>> {
    try {
      uuidValue(requestId, "handoff.requestId");
      stringValue(initiatingTabId, "handoff.initiatingTabId", 128);
    } catch (error) { return classifyContract(error); }
    let now: string;
    try { now = nowValue(this.now); } catch (error) { return classifyContract(error); }
    try {
      return await this.withTransaction<HandoffResult<{ snapshot: Readonly<ComparisonSnapshot> | null; draft: Readonly<CompareDraft> | null }>>("readonly", (stores, finish) => {
        const request = stores.recovery.get(requestId);
        request.onsuccess = () => {
          if (request.result === undefined) { finish(failure("not-found", "guest recovery was not found")); return; }
          let record: StoredRecovery;
          try { record = decodeRecovery(request.result); } catch { finish(failure("storage-unavailable", "guest recovery data is invalid")); return; }
          if (record.initiatingTabId !== initiatingTabId) { finish(failure("locked", "guest recovery belongs to another tab")); return; }
          if (dateValue(now) >= dateValue(record.expiresAt)) { finish(failure("expired", "guest recovery has expired")); return; }
          finish({ kind: "ok", value: recoveryPayload(record) });
        };
        request.onerror = () => finish(failure("storage-unavailable", "guest recovery read failed"));
      });
    } catch {
      return failure("storage-unavailable", "handoff persistence is unavailable");
    }
  }

  async claim(requestId: string, context: IntentContext): Promise<HandoffResult<GuestHandoffValue & { status: "claimed" | "already_claimed" }>> {
    try { uuidValue(requestId, "handoff.requestId"); } catch (error) { return classifyContract(error) as HandoffResult<GuestHandoffValue & { status: "claimed" | "already_claimed" }>; }
    let operationContext: IntentContext;
    try { operationContext = { ...context, now: context.now ?? nowValue(this.now) }; } catch (error) { return classifyContract(error) as HandoffResult<GuestHandoffValue & { status: "claimed" | "already_claimed" }>; }
    try {
      const result = await this.withTransaction<HandoffResult<GuestHandoffValue & { status: "claimed" | "already_claimed" }>>("readwrite", (stores, finish) => {
        const request = stores.handoffs.get(requestId);
        request.onsuccess = () => {
          if (request.result === undefined) { finish(failure("not-found", "handoff was not found")); return; }
          let record: StoredHandoff;
          try { record = decodeStored(request.result); } catch { finish(failure("storage-unavailable", "saved handoff data is invalid")); return; }
          const transition = claimAuthIntent(record.intent, operationContext);
          if (!transition.ok) {
            const code = transition.error.code;
            const kind: HandoffFailureKind = code === "expired" ? "expired" : code === "invalid_state" ? "terminal" : code === "tab_mismatch" || code === "account_mismatch" || code === "stale_epoch" ? "locked" : "invalid";
            finish(failure(kind, kind === "expired" ? "handoff has expired" : kind === "terminal" ? "handoff is already terminal" : kind === "locked" ? "handoff cannot be claimed in this context" : "handoff claim input is invalid"));
            return;
          }
          const next: StoredHandoff = { ...record, intent: { ...transition.intent }, updatedAt: operationContext.now ?? record.updatedAt };
          if (next.intent.state === "claimed") {
            stores.handoffs.put(next);
            stores.recovery.delete(requestId);
          }
          finish({ kind: "ok", value: { ...readPayload(next), status: transition.status as "claimed" | "already_claimed" } });
        };
        request.onerror = () => finish(failure("storage-unavailable", "handoff claim failed"));
      });
      return result;
    } catch {
      return failure("storage-unavailable", "handoff persistence is unavailable");
    }
  }

  async complete(requestId: string, context: IntentContext): Promise<HandoffResult<{ intent: Readonly<AuthIntent>; status: "completed" }>> {
    return this.finish(requestId, context, "complete") as Promise<HandoffResult<{ intent: Readonly<AuthIntent>; status: "completed" }>>;
  }

  async cancel(requestId: string, context: IntentContext | PendingIntentContext): Promise<HandoffResult<{ intent: Readonly<AuthIntent>; status: "cancelled" }>> {
    return this.finish(requestId, context, "cancel") as Promise<HandoffResult<{ intent: Readonly<AuthIntent>; status: "cancelled" }>>;
  }

  private async finish(
    requestId: string,
    context: IntentContext | PendingIntentContext,
    operation: "complete" | "cancel",
  ): Promise<HandoffResult<{ intent: Readonly<AuthIntent>; status: "completed" | "cancelled" }>> {
    try { uuidValue(requestId, "handoff.requestId"); } catch (error) { return classifyContract(error) as HandoffResult<{ intent: Readonly<AuthIntent>; status: "completed" | "cancelled" }>; }
    let operationContext: IntentContext | PendingIntentContext;
    try { operationContext = { ...context, now: context.now ?? nowValue(this.now) }; } catch (error) { return classifyContract(error) as HandoffResult<{ intent: Readonly<AuthIntent>; status: "completed" | "cancelled" }>; }
    try {
      return await this.withTransaction<HandoffResult<{ intent: Readonly<AuthIntent>; status: "completed" | "cancelled" }>>("readwrite", (stores, finish) => {
        const request = stores.handoffs.get(requestId);
        request.onsuccess = () => {
          if (request.result === undefined) { finish(failure("not-found", "handoff was not found")); return; }
          let record: StoredHandoff;
          try { record = decodeStored(request.result); } catch { finish(failure("storage-unavailable", "saved handoff data is invalid")); return; }
          const transition = operation === "complete"
            ? completeAuthIntent(record.intent, operationContext as IntentContext)
            : cancelAuthIntent(record.intent, operationContext);
          if (!transition.ok) {
            const kind: HandoffFailureKind = transition.error.code === "expired" || transition.error.code === "lease_expired"
              ? "expired"
              : transition.error.code === "invalid_state" ? "terminal" : transition.error.code === "tab_mismatch" || transition.error.code === "account_mismatch" || transition.error.code === "stale_epoch" || transition.error.code === "claim_mismatch" ? "locked" : "invalid";
            finish(failure(kind, kind === "terminal" ? "handoff is already terminal" : "handoff transition was rejected"));
            return;
          }
          const at = operationContext.now ?? record.updatedAt;
          const next = terminalRecord(record, at, operation === "complete" ? "completed" : "cancelled");
          stores.handoffs.put(next);
          if (operation === "cancel" && record.intent.state === "pending") {
            const recoveryRequest = stores.recovery.get(requestId);
            recoveryRequest.onsuccess = () => {
              if (recoveryRequest.result === undefined) {
                finish({ kind: "ok", value: { intent: next.intent, status: "cancelled" } });
                return;
              }
              try {
                const existing = decodeRecovery(recoveryRequest.result);
                stores.recovery.put({ ...existing, status: "cancelled", updatedAt: at });
                finish({ kind: "ok", value: { intent: next.intent, status: "cancelled" } });
              } catch {
                finish(failure("storage-unavailable", "guest recovery data is invalid"));
              }
            };
            recoveryRequest.onerror = () => finish(failure("storage-unavailable", "guest recovery update failed"));
          } else {
            stores.recovery.delete(requestId);
            finish({ kind: "ok", value: { intent: next.intent, status: operation === "complete" ? "completed" : "cancelled" } });
          }
        };
        request.onerror = () => finish(failure("storage-unavailable", "handoff transition failed"));
      });
    } catch {
      return failure("storage-unavailable", "handoff persistence is unavailable");
    }
  }
}
