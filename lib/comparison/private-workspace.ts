import {
  canonicalTimestamp,
  ContractValidationError,
  uuidValue,
} from "../contracts/errors";
import {
  decodeComparisonSnapshot,
  serializeComparisonSnapshot,
  type ComparisonSnapshot,
} from "../contracts/snapshot";
import { decodeComparisonDraft, serializeComparisonDraft, type CompareDraft } from "../contracts/comparison-draft";
import type { PrivateSessionAccess } from "../auth/private-session";
import type { ComparisonHistoryDeleteAcknowledgement, ComparisonHistoryTransport } from "./history-transport";
import {
  ComparisonTransportError,
  type ComparisonSaveAcknowledgement,
  type ComparisonSaveInput,
  type ComparisonSource,
  type ComparisonTransport,
} from "./transport";

export const COMPARISON_PRIVATE_DB = "truecost-private-comparisons-v1";
export const COMPARISON_PRIVATE_STORE = "partitions";
export const COMPARISON_META_STORE = "browserMeta";
export const COMPARISON_BROWSER_EPOCH_KEY = "browserEpoch";
export const COMPARISON_DATABASE_VERSION = 2;
export const COMPARISON_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const COMPARISON_LEASE_MS = 30_000;
export const COMPARISON_MAX_SAVES = 50;
const COMPARISON_MAX_SAVED_HISTORY = 50;
export const COMPARISON_MAX_ATTEMPTS = 8;
export const COMPARISON_MAX_DELETIONS = 50;
const COMPARISON_DB_OPEN_TIMEOUT_MS = 5_000;
const WORKSPACE_SIGNAL_KEY = "truecost-private-comparison-workspace-signal";

export type FormerComparisonCleanupResult =
  | { kind: "cleared"; generation: number }
  | { kind: "retry"; reason: "storage-failure" | "runtime-changed" };

export interface CapturedFormerComparisonCleanup {
  run(): Promise<FormerComparisonCleanupResult>;
}

export interface ComparisonBrowserEpochRecord {
  key: typeof COMPARISON_BROWSER_EPOCH_KEY;
  epoch: number;
}

function readBrowserEpoch(value: unknown): number {
  if (value === undefined) return 0;
  if (!value || typeof value !== "object") throw new Error("invalid browser epoch");
  const record = value as Partial<ComparisonBrowserEpochRecord>;
  if (record.key !== COMPARISON_BROWSER_EPOCH_KEY || typeof record.epoch !== "number" || !Number.isSafeInteger(record.epoch) || record.epoch < 0) throw new Error("invalid browser epoch");
  return record.epoch;
}

export function openComparisonDatabase(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let open: IDBOpenDBRequest;
    const finishError = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error("IndexedDB open failed"));
    };
    try { open = factory.open(COMPARISON_PRIVATE_DB, COMPARISON_DATABASE_VERSION); }
    catch (error) { finishError(error); return; }
    timeout = setTimeout(() => {
      settled = true;
      timeout = undefined;
      try { open.transaction?.abort(); } catch { /* request may already be terminal */ }
      reject(new Error("IndexedDB open timed out"));
    }, COMPARISON_DB_OPEN_TIMEOUT_MS);
    open.onupgradeneeded = () => {
      if (settled) {
        try { open.transaction?.abort(); } catch { /* request may already be terminal */ }
        return;
      }
      const database = open.result;
      if (!database.objectStoreNames.contains(COMPARISON_PRIVATE_STORE)) {
        const store = database.createObjectStore(COMPARISON_PRIVATE_STORE, { keyPath: "key" });
        store.createIndex("by_profile", "profileId", { unique: false });
      }
      if (!database.objectStoreNames.contains(COMPARISON_META_STORE)) database.createObjectStore(COMPARISON_META_STORE, { keyPath: "key" });
    };
    open.onsuccess = () => {
      if (settled) { open.result.close(); return; }
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () => finishError(open.error ?? new Error("IndexedDB open failed"));
    open.onblocked = () => finishError(new Error("IndexedDB open blocked"));
  });
}

export async function removeComparisonPartitionForRecovery(
  profileId: string,
  factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
  isCurrent: () => boolean,
): Promise<FormerComparisonCleanupResult> {
  if (!profileId || !isCurrent()) return { kind: "retry", reason: "runtime-changed" };
  if (!factory) return { kind: "retry", reason: "storage-failure" };
  let db: IDBDatabase | null = null;
  let transaction: IDBTransaction | null = null;
  try {
    db = await openComparisonDatabase(factory);
    if (!isCurrent()) return { kind: "retry", reason: "runtime-changed" };
    transaction = db.transaction([COMPARISON_PRIVATE_STORE, COMPARISON_META_STORE], "readwrite");
    const done = transactionDone(transaction);
    done.catch(() => undefined);
    const store = transaction.objectStore(COMPARISON_PRIVATE_STORE);
    const account = await request(store.get(accountKey(profileId))) as unknown;
    let generation = 0;
    if (account !== undefined) {
      if (!account || typeof account !== "object" || !Number.isSafeInteger((account as { generation?: unknown }).generation) || ((account as { generation: number }).generation < 1)) throw new Error("invalid generation");
      generation = (account as { generation: number }).generation;
    }
    if (!isCurrent() || generation >= Number.MAX_SAFE_INTEGER) {
      try { transaction.abort(); } catch { /* already aborted */ }
      await done.catch(() => undefined);
      return { kind: "retry", reason: "runtime-changed" };
    }
    const keys = await request(store.index("by_profile").getAllKeys(profileId));
    for (const key of keys) store.delete(key);
    store.put({ kind: "account", key: accountKey(profileId), profileId, generation: Math.max(1, generation + 1), saves: [], deletions: [] });
    if (!isCurrent()) {
      try { transaction.abort(); } catch { /* already aborted */ }
      await done.catch(() => undefined);
      return { kind: "retry", reason: "runtime-changed" };
    }
    await done;
    return isCurrent() ? { kind: "cleared", generation: Math.max(1, generation + 1) } : { kind: "retry", reason: "runtime-changed" };
  } catch {
    try { transaction?.abort(); } catch { /* already completed */ }
    return isCurrent() ? { kind: "retry", reason: "storage-failure" } : { kind: "retry", reason: "runtime-changed" };
  } finally {
    db?.close();
  }
}

export type WorkspaceStatus = "opening" | "ready" | "locked" | "storage-error";
export type SaveJobStatus = "queued" | "sending" | "paused" | "saved";
export type SavePauseReason = "unauthorized" | "conflict" | "request_reuse" | "deleted" | "retry-exhausted" | "expired" | "invalid";
export type DeleteJobStatus = "queued" | "sending" | "paused" | "deleted";
export type DeletePauseReason = "unauthorized" | "conflict" | "request_reuse" | "deleted" | "retry-exhausted" | "expired" | "invalid";

export interface SaveJob {
  requestId: string;
  resultId: string;
  createdAt: string;
  source: ComparisonSource;
  snapshot: Readonly<ComparisonSnapshot>;
  status: SaveJobStatus;
  attempts: number;
  nextAttemptAt: number;
  pauseReason: SavePauseReason | null;
}

export interface DeleteJob {
  requestId: string;
  resultId: string;
  comparisonId: string | null;
  createdAt: string;
  status: DeleteJobStatus;
  attempts: number;
  nextAttemptAt: number;
  pauseReason: DeletePauseReason | null;
}

export interface ComparisonWorkspaceState {
  status: WorkspaceStatus;
  draft: Readonly<CompareDraft> | null;
  snapshot: Readonly<ComparisonSnapshot> | null;
  saves: readonly SaveJob[];
  deletions: readonly DeleteJob[];
}

export type WorkspaceErrorCode =
  | "locked"
  | "stale-callback"
  | "storage-unavailable"
  | "invalid_shape"
  | "invalid_timestamp"
  | "invalid_id"
  | "expired"
  | "queue_full"
  | "unavailable"
  | "request_reuse"
  | "unauthorized"
  | "conflict"
  | "result_conflict"
  | "deleted"
  | "network"
  | "timeout"
  | "rate_limited"
  | "retry-exhausted";

export type WorkspaceResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; code: WorkspaceErrorCode };

interface AccountRecord {
  kind: "account";
  key: string;
  profileId: string;
  generation: number;
  saves: PersistedSaveJob[];
  deletions: PersistedDeleteJob[];
}

interface TabRecord {
  kind: "tab";
  key: string;
  profileId: string;
  tabId: string;
  generation: number;
  draftJson: string | null;
  snapshotJson: string | null;
}

interface PersistedSaveJob {
  requestId: string;
  resultId: string;
  createdAt: string;
  source: ComparisonSource;
  snapshotJson: string;
  status: SaveJobStatus;
  attempts: number;
  nextAttemptAt: number;
  leaseId: string | null;
  leaseUntil: number | null;
  pauseReason: SavePauseReason | null;
}

interface PersistedDeleteJob {
  requestId: string;
  resultId: string;
  comparisonId: string | null;
  createdAt: string;
  status: DeleteJobStatus;
  attempts: number;
  nextAttemptAt: number;
  leaseId: string | null;
  leaseUntil: number | null;
  pauseReason: DeletePauseReason | null;
}

type StoredRecord = AccountRecord | TabRecord;

const EMPTY_STATE: ComparisonWorkspaceState = Object.freeze({
  status: "locked",
  draft: null,
  snapshot: null,
  saves: Object.freeze([]),
  deletions: Object.freeze([]),
});

function clone<T>(value: T): T {
  return structuredClone(value);
}

function accountKey(profileId: string): string {
  return `account:${profileId}`;
}

function tabKey(profileId: string, tabId: string): string {
  return `tab:${profileId}:${tabId}`;
}

function nowIso(now: number): string {
  return new Date(now).toISOString();
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function safeCode(error: unknown): WorkspaceErrorCode {
  if (error instanceof ComparisonTransportError) return error.code as WorkspaceErrorCode;
  if (error instanceof ContractValidationError) return error.code as WorkspaceErrorCode;
  if (error instanceof Error && ["invalid_shape", "invalid_timestamp", "invalid_id", "expired", "request_reuse", "result_conflict", "queue_full"].includes(error.message)) return error.message as WorkspaceErrorCode;
  return "storage-unavailable";
}

function parseSaveJob(value: PersistedSaveJob): SaveJob {
  if (!value || typeof value !== "object") throw new Error("invalid_shape");
  const requestId = uuidValue(value.requestId, "save.requestId");
  const resultId = uuidValue(value.resultId, "save.resultId");
  const createdAt = canonicalTimestamp(value.createdAt, "save.createdAt");
  if (value.source !== "guest" && value.source !== "member") throw new Error("invalid_shape");
  if (value.status !== "queued" && value.status !== "sending" && value.status !== "paused" && value.status !== "saved") throw new Error("invalid_shape");
  if (!Number.isSafeInteger(value.attempts) || value.attempts < 0 || value.attempts > COMPARISON_MAX_ATTEMPTS ||
      !Number.isFinite(value.nextAttemptAt) || value.nextAttemptAt < 0 ||
      (value.leaseUntil !== null && (!Number.isFinite(value.leaseUntil) || value.leaseUntil < 0))) throw new Error("invalid_shape");
  if (typeof value.snapshotJson !== "string" || new TextEncoder().encode(value.snapshotJson).byteLength > 256 * 1024) throw new Error("invalid_shape");
  const snapshot = decodeComparisonSnapshot(JSON.parse(value.snapshotJson));
  if (serializeComparisonSnapshot(snapshot) !== value.snapshotJson) throw new Error("invalid_shape");
  if (snapshot.resultId !== resultId) throw new Error("invalid_shape");
  const pauseReasons: SavePauseReason[] = ["unauthorized", "conflict", "request_reuse", "deleted", "retry-exhausted", "expired", "invalid"];
  if (value.pauseReason !== null && !pauseReasons.includes(value.pauseReason)) throw new Error("invalid_shape");
  if (value.status === "sending") {
    if (value.leaseId === null || !uuidValue(value.leaseId, "save.leaseId") || value.leaseUntil === null) throw new Error("invalid_shape");
    if (value.pauseReason !== null) throw new Error("invalid_shape");
  } else if (value.leaseId !== null || value.leaseUntil !== null) {
    throw new Error("invalid_shape");
  }
  if ((value.status === "paused" && value.pauseReason === null) || (value.status !== "paused" && value.pauseReason !== null)) throw new Error("invalid_shape");
  return { requestId, resultId, createdAt, source: value.source, snapshot, status: value.status, attempts: value.attempts, nextAttemptAt: value.nextAttemptAt, pauseReason: value.pauseReason };
}

function serializeSaveJob(job: SaveJob, leaseId: string | null = null, leaseUntil: number | null = null): PersistedSaveJob {
  return {
    requestId: job.requestId,
    resultId: job.resultId,
    createdAt: job.createdAt,
    source: job.source,
    snapshotJson: serializeComparisonSnapshot(job.snapshot),
    status: job.status,
    attempts: job.attempts,
    nextAttemptAt: job.nextAttemptAt,
    leaseId,
    leaseUntil,
    pauseReason: job.pauseReason,
  };
}

function parseDeleteJob(value: PersistedDeleteJob): DeleteJob {
  if (!value || typeof value !== "object") throw new Error("invalid_shape");
  const requestId = uuidValue(value.requestId, "delete.requestId");
  const resultId = uuidValue(value.resultId, "delete.resultId");
  const comparisonId = value.comparisonId === null ? null :
    typeof value.comparisonId === "string" && value.comparisonId.length > 0 && value.comparisonId.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value.comparisonId)
      ? value.comparisonId : (() => { throw new Error("invalid_shape"); })();
  const createdAt = canonicalTimestamp(value.createdAt, "delete.createdAt");
  if (value.status !== "queued" && value.status !== "sending" && value.status !== "paused" && value.status !== "deleted") throw new Error("invalid_shape");
  if (!Number.isSafeInteger(value.attempts) || value.attempts < 0 || value.attempts > COMPARISON_MAX_ATTEMPTS ||
      !Number.isFinite(value.nextAttemptAt) || value.nextAttemptAt < 0 ||
      (value.leaseUntil !== null && (!Number.isFinite(value.leaseUntil) || value.leaseUntil < 0))) throw new Error("invalid_shape");
  const pauseReasons: DeletePauseReason[] = ["unauthorized", "conflict", "request_reuse", "deleted", "retry-exhausted", "expired", "invalid"];
  if (value.pauseReason !== null && !pauseReasons.includes(value.pauseReason)) throw new Error("invalid_shape");
  if (value.status === "sending") {
    if (value.leaseId === null || !uuidValue(value.leaseId, "delete.leaseId") || value.leaseUntil === null || value.pauseReason !== null) throw new Error("invalid_shape");
  } else if (value.leaseId !== null || value.leaseUntil !== null) {
    throw new Error("invalid_shape");
  }
  if ((value.status === "paused" && value.pauseReason === null) || (value.status !== "paused" && value.pauseReason !== null)) throw new Error("invalid_shape");
  return { requestId, resultId, comparisonId, createdAt, status: value.status, attempts: value.attempts, nextAttemptAt: value.nextAttemptAt, pauseReason: value.pauseReason };
}

function serializeDeleteJob(job: DeleteJob, leaseId: string | null = null, leaseUntil: number | null = null): PersistedDeleteJob {
  return { requestId: job.requestId, resultId: job.resultId, comparisonId: job.comparisonId, createdAt: job.createdAt, status: job.status, attempts: job.attempts, nextAttemptAt: job.nextAttemptAt, leaseId, leaseUntil, pauseReason: job.pauseReason };
}

function parseAccount(value: unknown, profileId: string): AccountRecord {
  if (!value || typeof value !== "object") throw new Error("invalid_shape");
  const record = value as AccountRecord;
  if (record.kind !== "account" || record.key !== accountKey(profileId) || record.profileId !== profileId ||
      !Number.isSafeInteger(record.generation) || record.generation < 1 || !Array.isArray(record.saves) || record.saves.length > COMPARISON_MAX_SAVES + COMPARISON_MAX_SAVED_HISTORY ||
      (record.deletions !== undefined && !Array.isArray(record.deletions))) throw new Error("invalid_shape");
  const saves = record.saves.map(parseSaveJob);
  if (new Set(saves.map((item) => item.requestId)).size !== saves.length) throw new Error("invalid_shape");
  const deletions = (record.deletions ?? []).map(parseDeleteJob);
  if (deletions.length > COMPARISON_MAX_DELETIONS || new Set(deletions.map((item) => item.requestId)).size !== deletions.length) throw new Error("invalid_shape");
  return { kind: "account", key: record.key, profileId, generation: record.generation, saves: record.saves.map((item) => ({ ...item })), deletions: record.deletions === undefined ? [] : deletions.map((item) => ({ ...item, leaseId: item.status === "sending" ? record.deletions?.find((raw) => raw.requestId === item.requestId)?.leaseId ?? null : null, leaseUntil: item.status === "sending" ? record.deletions?.find((raw) => raw.requestId === item.requestId)?.leaseUntil ?? null : null })) };
}

function parseTab(value: unknown, profileId: string, tabId: string, generation: number): TabRecord {
  if (!value) return { kind: "tab", key: tabKey(profileId, tabId), profileId, tabId, generation, draftJson: null, snapshotJson: null };
  if (typeof value !== "object") throw new Error("invalid_shape");
  const record = value as TabRecord;
  if (record.kind !== "tab" || record.key !== tabKey(profileId, tabId) || record.profileId !== profileId || record.tabId !== tabId || record.generation !== generation) throw new Error("invalid_shape");
  if (record.draftJson !== null) {
    if (typeof record.draftJson !== "string" || new TextEncoder().encode(record.draftJson).byteLength > 256 * 1024) throw new Error("invalid_shape");
    const draft = decodeComparisonDraft(JSON.parse(record.draftJson));
    if (serializeComparisonDraft(draft) !== record.draftJson) throw new Error("invalid_shape");
  }
  if (record.snapshotJson !== null) {
    if (typeof record.snapshotJson !== "string" || new TextEncoder().encode(record.snapshotJson).byteLength > 256 * 1024) throw new Error("invalid_shape");
    const snapshot = decodeComparisonSnapshot(JSON.parse(record.snapshotJson));
    if (serializeComparisonSnapshot(snapshot) !== record.snapshotJson) throw new Error("invalid_shape");
  }
  return { ...record };
}

function stateFrom(tab: TabRecord, account: AccountRecord, status: WorkspaceStatus): ComparisonWorkspaceState {
  return {
    status,
    draft: tab.draftJson === null ? null : decodeComparisonDraft(JSON.parse(tab.draftJson)),
    snapshot: tab.snapshotJson === null ? null : decodeComparisonSnapshot(JSON.parse(tab.snapshotJson)),
    saves: Object.freeze(account.saves.map((save) => Object.freeze(parseSaveJob(save)))),
    deletions: Object.freeze(account.deletions.map((deletion) => Object.freeze(parseDeleteJob(deletion)))),
  };
}

export interface ComparisonWorkspaceOptions {
  access: PrivateSessionAccess;
  tabId: string;
  indexedDB?: IDBFactory;
  now?: () => number;
  transport?: ComparisonTransport;
  historyTransport?: Pick<ComparisonHistoryTransport, "deleteComparison">;
}

export class ComparisonWorkspace {
  private readonly factory: IDBFactory | undefined;
  private readonly now: () => number;
  private readonly access: PrivateSessionAccess;
  private readonly tabId: string;
  private readonly transport: ComparisonTransport | null;
  private readonly historyTransport: Pick<ComparisonHistoryTransport, "deleteComparison"> | null;
  private readonly listeners = new Set<(state: ComparisonWorkspaceState) => void>();
  private readonly instanceId = newUuid();
  private state: ComparisonWorkspaceState = EMPTY_STATE;
  private openPromise: Promise<WorkspaceResult<void>> | null = null;
  private pumpPromise: Promise<void> | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private opened = false;
  private generation = 0;
  private browserEpoch: number | null = null;
  private runtimeNonce = 0;
  private channel: BroadcastChannel | null = null;
  private storageListener: ((event: StorageEvent) => void) | null = null;
  private discardCompleted = false;

  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeTail.then(operation, operation);
    this.writeTail = run.then(() => undefined, () => undefined);
    return run;
  }

  constructor(options: ComparisonWorkspaceOptions) {
    this.factory = options.indexedDB ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    this.now = options.now ?? (() => Date.now());
    this.access = options.access;
    this.tabId = options.tabId;
    this.transport = options.transport ?? null;
    this.historyTransport = options.historyTransport ?? null;
  }

  current(): ComparisonWorkspaceState {
    if (!this.access.isCurrent()) return clone(EMPTY_STATE);
    return clone(this.state);
  }

  subscribe(listener: (state: ComparisonWorkspaceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(next: ComparisonWorkspaceState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  private valid(): boolean {
    return this.opened && this.access.isCurrent();
  }

  private notify(type: "refresh" | "discard"): void {
    const profileId = this.access.identity.profileId;
    const message = { type, profileId, tabId: this.tabId, generation: this.generation, senderId: this.instanceId, nonce: newUuid() };
    this.channel?.postMessage(message);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(WORKSPACE_SIGNAL_KEY, JSON.stringify(message));
        window.localStorage.removeItem(WORKSPACE_SIGNAL_KEY);
      }
    } catch {
      // Some privacy modes deny localStorage. BroadcastChannel remains sufficient there.
    }
  }

  private receiveSignal(value: unknown, profileId: string): void {
    const message = value as { type?: unknown; profileId?: unknown; generation?: unknown; senderId?: unknown };
    if (message.profileId !== profileId || message.senderId === this.instanceId || typeof message.generation !== "number") return;
    if (message.type === "discard" && message.generation >= this.generation) this.close();
    else if (message.type === "refresh" && message.generation === this.generation && this.valid()) void this.refreshState();
  }

  private removeSignalListeners(): void {
    if (this.storageListener && typeof window !== "undefined") window.removeEventListener("storage", this.storageListener);
    this.storageListener = null;
  }

  private dbOpen(): Promise<IDBDatabase> {
    return openComparisonDatabase(this.factory);
  }

  async open(): Promise<WorkspaceResult<void>> {
    if (this.openPromise) return this.openPromise;
    if (this.discardCompleted) {
      this.publish(EMPTY_STATE);
      return { kind: "error", code: "locked" };
    }
    const nonce = ++this.runtimeNonce;
    const profileId = this.access.identity.profileId;
    if (!this.access.isCurrent() || !profileId || !this.factory) {
      this.publish(EMPTY_STATE);
      return { kind: "error", code: !this.factory ? "storage-unavailable" : "locked" };
    }
    this.publish({ ...EMPTY_STATE, status: "opening" });
    this.openPromise = this.readAndOpen(profileId, nonce).finally(() => { this.openPromise = null; });
    return this.openPromise;
  }

  private async readAndOpen(profileId: string, nonce: number): Promise<WorkspaceResult<void>> {
    let db: IDBDatabase | null = null;
    try {
      db = await this.dbOpen();
      if (nonce !== this.runtimeNonce || !this.access.isCurrent()) return { kind: "error", code: "stale-callback" };
      const transaction = db.transaction([COMPARISON_PRIVATE_STORE, COMPARISON_META_STORE], "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(COMPARISON_PRIVATE_STORE);
      const metaStore = transaction.objectStore(COMPARISON_META_STORE);
      const rawEpoch = await request(metaStore.get(COMPARISON_BROWSER_EPOCH_KEY));
      const browserEpoch = readBrowserEpoch(rawEpoch);
      if (rawEpoch === undefined) metaStore.put({ key: COMPARISON_BROWSER_EPOCH_KEY, epoch: browserEpoch });
      const stored = await request(store.get(accountKey(profileId))) as unknown;
      let account: AccountRecord;
      if (stored === undefined) {
        account = { kind: "account", key: accountKey(profileId), profileId, generation: 1, saves: [], deletions: [] };
        store.put(account);
      } else account = parseAccount(stored, profileId);
      const tabStored = await request(store.get(tabKey(profileId, this.tabId))) as unknown;
      const tab = tabStored && (tabStored as TabRecord).generation === account.generation
        ? parseTab(tabStored, profileId, this.tabId, account.generation)
        : { kind: "tab" as const, key: tabKey(profileId, this.tabId), profileId, tabId: this.tabId, generation: account.generation, draftJson: null, snapshotJson: null };
      store.put(tab);
      await done;
      if (nonce !== this.runtimeNonce || !this.access.isCurrent()) return { kind: "error", code: "stale-callback" };
      this.generation = account.generation;
      this.browserEpoch = browserEpoch;
      this.opened = true;
      this.publish(stateFrom(tab, account, "ready"));
      this.channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("truecost-private-comparison-workspace");
      if (this.channel) this.channel.onmessage = (event) => this.receiveSignal(event.data, profileId);
      if (typeof window !== "undefined") {
        this.storageListener = (event) => {
          if (event.key !== WORKSPACE_SIGNAL_KEY || !event.newValue) return;
          try { this.receiveSignal(JSON.parse(event.newValue), profileId); } catch { /* Ignore malformed cross-tab signals. */ }
        };
        window.addEventListener("storage", this.storageListener);
      }
      return { kind: "ok", value: undefined };
    } catch (error) {
      if (nonce === this.runtimeNonce) this.publish({ ...EMPTY_STATE, status: "storage-error" });
      return { kind: "error", code: safeCode(error) };
    } finally {
      db?.close();
    }
  }

  private async mutate<T>(fn: (store: IDBObjectStore, account: AccountRecord, tab: TabRecord) => T | Promise<T>): Promise<WorkspaceResult<T>> {
    if (!this.valid()) return { kind: "error", code: "locked" };
    const nonce = this.runtimeNonce;
    const profileId = this.access.identity.profileId;
    let db: IDBDatabase | null = null;
    try {
      db = await this.dbOpen();
      if (nonce !== this.runtimeNonce || !this.access.isCurrent() || !this.opened) return { kind: "error", code: "stale-callback" };
      const transaction = db.transaction([COMPARISON_PRIVATE_STORE, COMPARISON_META_STORE], "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(COMPARISON_PRIVATE_STORE);
      const browserEpoch = readBrowserEpoch(await request(transaction.objectStore(COMPARISON_META_STORE).get(COMPARISON_BROWSER_EPOCH_KEY)));
      if (this.browserEpoch === null || browserEpoch !== this.browserEpoch) {
        try { transaction.abort(); } catch { /* already aborted */ }
        await done.catch(() => undefined);
        if (nonce === this.runtimeNonce) this.close();
        return { kind: "error", code: "stale-callback" };
      }
      const account = parseAccount(await request(store.get(accountKey(profileId))), profileId);
      if (account.generation !== this.generation) {
        try { transaction.abort(); } catch { /* already aborted */ }
        await done.catch(() => undefined);
        this.opened = false;
        this.runtimeNonce += 1;
        this.publish(EMPTY_STATE);
        return { kind: "error", code: "stale-callback" };
      }
      const tab = parseTab(await request(store.get(tabKey(profileId, this.tabId))), profileId, this.tabId, account.generation);
      const value = await fn(store, account, tab);
      if (nonce !== this.runtimeNonce || !this.access.isCurrent() || !this.opened) {
        try { transaction.abort(); } catch { /* already aborted */ }
        await done.catch(() => undefined);
        return { kind: "error", code: "stale-callback" };
      }
      await done;
      if (nonce !== this.runtimeNonce || !this.access.isCurrent() || !this.opened) return { kind: "error", code: "stale-callback" };
      return { kind: "ok", value };
    } catch (error) {
      return { kind: "error", code: safeCode(error) };
    } finally {
      db?.close();
    }
  }

  async setWorking(input: { draft: CompareDraft; snapshot: ComparisonSnapshot | null }): Promise<WorkspaceResult<void>> {
    let draft: CompareDraft;
    let snapshot: ComparisonSnapshot | null;
    try {
      draft = decodeComparisonDraft(clone(input.draft));
      snapshot = input.snapshot === null ? null : decodeComparisonSnapshot(clone(input.snapshot));
    } catch (error) {
      return { kind: "error", code: safeCode(error) };
    }
    return this.serializeWrite(async () => {
      const result = await this.mutate((_store, _account, tab) => {
        tab.draftJson = JSON.stringify(draft);
        tab.snapshotJson = snapshot === null ? null : serializeComparisonSnapshot(snapshot);
        _store.put(tab);
        return { account: _account, tab };
      });
      if (result.kind === "ok") {
        this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
        return { kind: "ok", value: undefined };
      }
      return result;
    });
  }

  async queueSave(input: { snapshot: ComparisonSnapshot; requestId?: string; createdAt?: string; source: ComparisonSource }): Promise<WorkspaceResult<{ requestId: string }>> {
    let snapshot: ComparisonSnapshot;
    let requestId: string;
    let createdAt: string;
    const explicitRequestId = input.requestId !== undefined;
    try {
      snapshot = decodeComparisonSnapshot(clone(input.snapshot));
      requestId = uuidValue(input.requestId ?? newUuid(), "requestId");
      createdAt = canonicalTimestamp(input.createdAt ?? nowIso(this.now()), "createdAt");
      const createdMs = Date.parse(createdAt);
      const current = this.now();
      if (createdMs > current) return { kind: "error", code: "invalid_timestamp" };
      if (current - createdMs > COMPARISON_REPLAY_WINDOW_MS) return { kind: "error", code: "expired" };
      if (input.source !== "guest" && input.source !== "member") return { kind: "error", code: "invalid_shape" };
    } catch (error) {
      return { kind: "error", code: safeCode(error) };
    }
    return this.serializeWrite(async () => {
      const result = await this.mutate((store, account, tab) => {
        const canonical = serializeComparisonSnapshot(snapshot);
        if (account.deletions.some((deletion) => deletion.resultId === snapshot.resultId)) throw new ComparisonTransportError("deleted");
        const existing = account.saves.find((job) => job.requestId === requestId);
        if (existing) {
          if (existing.snapshotJson !== canonical || existing.resultId !== snapshot.resultId || existing.createdAt !== createdAt || existing.source !== input.source) throw new ComparisonTransportError("request_reuse");
          return { requestId, account, tab };
        }
        if (!explicitRequestId) {
          const duplicate = account.saves.find((job) => job.resultId === snapshot.resultId && job.snapshotJson === canonical && job.source === input.source);
          if (duplicate) return { requestId: duplicate.requestId, account, tab };
        }
        const pendingCount = account.saves.filter((job) => job.status !== "saved").length;
        if (pendingCount >= COMPARISON_MAX_SAVES) throw new Error("queue_full");
        while (account.saves.length >= COMPARISON_MAX_SAVES + COMPARISON_MAX_SAVED_HISTORY) {
          const oldSaved = account.saves.findIndex((job) => job.status === "saved");
          if (oldSaved < 0) throw new Error("queue_full");
          account.saves.splice(oldSaved, 1);
        }
        account.saves.push({ requestId, resultId: snapshot.resultId, createdAt, source: input.source, snapshotJson: canonical, status: "queued", attempts: 0, nextAttemptAt: this.now(), leaseId: null, leaseUntil: null, pauseReason: null });
        store.put(account);
        return { requestId, account, tab };
      });
      if (result.kind === "ok") {
        this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
        this.notify("refresh");
        return { kind: "ok", value: { requestId: result.value.requestId } };
      }
      return result;
    });
  }

  /**
   * Re-open one terminal save for a deliberate, bounded retry. Reusing the
   * request ID and canonical snapshot lets the server return an existing
   * receipt without creating a duplicate. Expired and semantic failures stay
   * terminal because replaying them would be unsafe or misleading.
   */
  async retryPausedSave(requestId: string): Promise<WorkspaceResult<{ requestId: string }>> {
    let id: string;
    try { id = uuidValue(requestId, "requestId"); }
    catch (error) { return { kind: "error", code: safeCode(error) }; }
    return this.serializeWrite(async () => {
      const result = await this.mutate((store, account, tab) => {
        const job = account.saves.find((candidate) => candidate.requestId === id);
        if (!job || job.status !== "paused") return { error: "unavailable" as const, account, tab };
        const age = this.now() - Date.parse(job.createdAt);
        if (age > COMPARISON_REPLAY_WINDOW_MS) return { error: "expired" as const, account, tab };
        if (job.pauseReason !== "retry-exhausted" && job.pauseReason !== "unauthorized") {
          return { error: "unavailable" as const, account, tab };
        }
        job.status = "queued";
        job.attempts = 0;
        job.nextAttemptAt = this.now();
        job.leaseId = null;
        job.leaseUntil = null;
        job.pauseReason = null;
        store.put(account);
        return { requestId: id, account, tab };
      });
      if (result.kind !== "ok") return result;
      if ("error" in result.value) {
        if (result.value.error === "expired") return { kind: "error", code: "expired" };
        return { kind: "error", code: "unavailable" };
      }
      this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
      this.notify("refresh");
      return { kind: "ok", value: { requestId: result.value.requestId } };
    });
  }

  async queueDelete(input: { resultId: string; comparisonId?: string | null; requestId?: string; createdAt?: string }): Promise<WorkspaceResult<{ requestId: string }>> {
    let resultId: string;
    let requestId: string;
    let createdAt: string;
    const comparisonId = input.comparisonId === undefined || input.comparisonId === null ? null : input.comparisonId;
    try {
      resultId = uuidValue(input.resultId, "resultId");
      if (comparisonId !== null && (typeof comparisonId !== "string" || comparisonId.length === 0 || comparisonId.length > 128 || /[\u0000-\u001f\u007f]/.test(comparisonId))) return { kind: "error", code: "invalid_shape" };
      requestId = uuidValue(input.requestId ?? newUuid(), "requestId");
      createdAt = canonicalTimestamp(input.createdAt ?? nowIso(this.now()), "createdAt");
      const createdMs = Date.parse(createdAt);
      const current = this.now();
      if (createdMs > current) return { kind: "error", code: "invalid_timestamp" };
      if (current - createdMs > COMPARISON_REPLAY_WINDOW_MS) return { kind: "error", code: "expired" };
    } catch (error) {
      return { kind: "error", code: safeCode(error) };
    }
    return this.serializeWrite(async () => {
      const result = await this.mutate((store, account, tab) => {
        const requestCollision = account.deletions.find((job) => job.requestId === requestId);
        if ((requestCollision && requestCollision.resultId !== resultId) || account.saves.some((job) => job.requestId === requestId)) {
          throw new ComparisonTransportError("request_reuse");
        }
        const existing = account.deletions.find((job) => job.resultId === resultId);
        if (existing) return { requestId: existing.requestId, account, tab };
        if (account.deletions.length >= COMPARISON_MAX_DELETIONS) {
          const oldDeleted = account.deletions.findIndex((job) => job.status === "deleted");
          if (oldDeleted < 0) throw new Error("queue_full");
          account.deletions.splice(oldDeleted, 1);
        }
        account.saves = account.saves.filter((job) => job.resultId !== resultId);
        account.deletions.push({ requestId, resultId, comparisonId, createdAt, status: "queued", attempts: 0, nextAttemptAt: this.now(), leaseId: null, leaseUntil: null, pauseReason: null });
        store.put(account);
        return { requestId, account, tab };
      });
      if (result.kind === "ok") {
        this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
        this.notify("refresh");
        return { kind: "ok", value: { requestId: result.value.requestId } };
      }
      return result;
    });
  }

  async retryPausedDelete(requestId: string): Promise<WorkspaceResult<{ requestId: string }>> {
    let id: string;
    try { id = uuidValue(requestId, "requestId"); }
    catch (error) { return { kind: "error", code: safeCode(error) }; }
    return this.serializeWrite(async () => {
      const result = await this.mutate((store, account, tab) => {
        const job = account.deletions.find((candidate) => candidate.requestId === id);
        if (!job || job.status !== "paused") return { error: "unavailable" as const, account, tab };
        if (this.now() - Date.parse(job.createdAt) > COMPARISON_REPLAY_WINDOW_MS) {
          job.pauseReason = "expired";
          store.put(account);
          return { error: "expired" as const, account, tab };
        }
        if (job.pauseReason !== "retry-exhausted" && job.pauseReason !== "unauthorized") return { error: "unavailable" as const, account, tab };
        job.status = "queued";
        job.attempts = 0;
        job.nextAttemptAt = this.now();
        job.leaseId = null;
        job.leaseUntil = null;
        job.pauseReason = null;
        store.put(account);
        return { requestId: id, account, tab };
      });
      if (result.kind !== "ok") return result;
      if ("error" in result.value) {
        this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
        this.notify("refresh");
        return { kind: "error", code: result.value.error === "expired" ? "expired" : "unavailable" };
      }
      this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
      this.notify("refresh");
      return { kind: "ok", value: { requestId: result.value.requestId } };
    });
  }

  async pump(): Promise<void> {
    if (this.pumpPromise) return this.pumpPromise;
    if (!this.valid()) return;
    if ((!this.transport && !this.historyTransport) || (typeof navigator !== "undefined" && !navigator.onLine)) {
      await this.refreshState();
      return;
    }
    this.pumpPromise = this.drain().finally(() => { this.pumpPromise = null; });
    return this.pumpPromise;
  }

  private async claimNext(): Promise<{ job: SaveJob; leaseId: string } | null> {
    const result = await this.mutate((store, account, tab) => {
      const now = this.now();
      for (const existing of account.saves) {
        if (!((existing.status === "queued" && existing.nextAttemptAt <= now) ||
          (existing.status === "sending" && existing.leaseUntil !== null && existing.leaseUntil <= now))) continue;
        if (now - Date.parse(existing.createdAt) > COMPARISON_REPLAY_WINDOW_MS) {
          existing.status = "paused";
          existing.pauseReason = "expired";
          existing.leaseId = null;
          existing.leaseUntil = null;
          continue;
        }
        if (existing.attempts >= COMPARISON_MAX_ATTEMPTS) {
          existing.status = "paused";
          existing.pauseReason = "retry-exhausted";
          existing.leaseId = null;
          existing.leaseUntil = null;
          continue;
        }
        const leaseId = newUuid();
        existing.status = "sending";
        existing.attempts += 1;
        existing.leaseId = leaseId;
        existing.leaseUntil = now + COMPARISON_LEASE_MS;
        store.put(account);
        return { claim: { job: parseSaveJob(existing), leaseId }, account, tab };
      }
      store.put(account);
      return { claim: null, account, tab };
    });
    if (result.kind !== "ok") return null;
    this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
    this.notify("refresh");
    return result.value.claim;
  }

  private async claimNextDeletion(): Promise<{ job: DeleteJob; leaseId: string } | null> {
    const result = await this.mutate((store, account, tab) => {
      const now = this.now();
      for (const existing of account.deletions) {
        if (!((existing.status === "queued" && existing.nextAttemptAt <= now) ||
          (existing.status === "sending" && existing.leaseUntil !== null && existing.leaseUntil <= now))) continue;
        if (now - Date.parse(existing.createdAt) > COMPARISON_REPLAY_WINDOW_MS) {
          existing.status = "paused";
          existing.pauseReason = "expired";
          existing.leaseId = null;
          existing.leaseUntil = null;
          continue;
        }
        if (existing.attempts >= COMPARISON_MAX_ATTEMPTS) {
          existing.status = "paused";
          existing.pauseReason = "retry-exhausted";
          existing.leaseId = null;
          existing.leaseUntil = null;
          continue;
        }
        const leaseId = newUuid();
        existing.status = "sending";
        existing.attempts += 1;
        existing.leaseId = leaseId;
        existing.leaseUntil = now + COMPARISON_LEASE_MS;
        store.put(account);
        return { claim: { job: parseDeleteJob(existing), leaseId }, account, tab };
      }
      store.put(account);
      return { claim: null, account, tab };
    });
    if (result.kind !== "ok") return null;
    this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
    this.notify("refresh");
    return result.value.claim;
  }

  private async refreshState(): Promise<void> {
    const result = await this.mutate((_store, account, tab) => ({ account, tab }));
    if (result.kind === "ok") this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
  }

  private async acknowledge(job: SaveJob, leaseId: string, ack: ComparisonSaveAcknowledgement): Promise<void> {
    const result = await this.mutate((store, account, tab) => {
      const current = account.saves.find((candidate) => candidate.requestId === job.requestId);
      if (!current || current.status !== "sending" || current.leaseId !== leaseId || current.resultId !== ack.resultId || ack.requestId !== current.requestId || (ack.status !== "saved" && ack.status !== "replayed")) return;
      current.status = "saved";
      current.leaseId = null;
      current.leaseUntil = null;
      current.pauseReason = null;
      store.put(account);
      return { account, tab };
    });
    if (result.kind === "ok" && result.value) {
      this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
      this.notify("refresh");
    }
  }

  private async acknowledgeDeletion(job: DeleteJob, leaseId: string, ack: ComparisonHistoryDeleteAcknowledgement): Promise<void> {
    const result = await this.mutate((store, account, tab) => {
      const current = account.deletions.find((candidate) => candidate.requestId === job.requestId);
      if (!current || current.status !== "sending" || current.leaseId !== leaseId || current.resultId !== ack.resultId ||
          ack.requestId !== current.requestId || (ack.status !== "deleted" && ack.status !== "replayed") ||
          (current.comparisonId !== null && ack.comparisonId !== null && current.comparisonId !== ack.comparisonId)) return;
      current.status = "deleted";
      current.leaseId = null;
      current.leaseUntil = null;
      current.pauseReason = null;
      store.put(account);
      return { account, tab };
    });
    if (result.kind === "ok" && result.value) {
      this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
      this.notify("refresh");
    }
  }

  private async fail(job: SaveJob, leaseId: string, code: WorkspaceErrorCode, retryAfterMs?: number, publishResult = true): Promise<void> {
    const result = await this.mutate((store, account, tab) => {
      const current = account.saves.find((candidate) => candidate.requestId === job.requestId);
      if (!current || current.status !== "sending" || current.leaseId !== leaseId) return;
      current.leaseId = null;
      current.leaseUntil = null;
      const permanent = code === "unauthorized" || code === "conflict" || code === "result_conflict" || code === "request_reuse" || code === "deleted" || code === "invalid_shape" || code === "expired";
      if (permanent || current.attempts >= COMPARISON_MAX_ATTEMPTS) {
        current.status = "paused";
        current.pauseReason = permanent ? (code === "unauthorized" ? "unauthorized" : code === "conflict" || code === "result_conflict" ? "conflict" : code === "request_reuse" ? "request_reuse" : code === "deleted" ? "deleted" : code === "expired" ? "expired" : "invalid") : "retry-exhausted";
      } else {
        current.status = "queued";
        const retryDelay = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)
          ? Math.max(1_000, Math.min(24 * 60 * 60 * 1000, retryAfterMs))
          : Math.min(60_000, 1_000 * 2 ** Math.min(current.attempts - 1, 6));
        current.nextAttemptAt = this.now() + retryDelay;
      }
      store.put(account);
      return { account, tab };
    });
    if (publishResult && result.kind === "ok" && result.value) {
      this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
      this.notify("refresh");
    }
  }

  private async failDeletion(job: DeleteJob, leaseId: string, code: WorkspaceErrorCode, retryAfterMs?: number, publishResult = true): Promise<void> {
    const result = await this.mutate((store, account, tab) => {
      const current = account.deletions.find((candidate) => candidate.requestId === job.requestId);
      if (!current || current.status !== "sending" || current.leaseId !== leaseId) return;
      current.leaseId = null;
      current.leaseUntil = null;
      const permanent = code === "unauthorized" || code === "conflict" || code === "result_conflict" || code === "request_reuse" || code === "deleted" || code === "invalid_shape" || code === "expired";
      if (permanent || current.attempts >= COMPARISON_MAX_ATTEMPTS) {
        current.status = "paused";
        current.pauseReason = permanent ? (code === "unauthorized" ? "unauthorized" : code === "conflict" || code === "result_conflict" ? "conflict" : code === "request_reuse" ? "request_reuse" : code === "deleted" ? "deleted" : code === "expired" ? "expired" : "invalid") : "retry-exhausted";
      } else {
        current.status = "queued";
        const retryDelay = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)
          ? Math.max(1_000, Math.min(24 * 60 * 60 * 1000, retryAfterMs))
          : Math.min(60_000, 1_000 * 2 ** Math.min(current.attempts - 1, 6));
        current.nextAttemptAt = this.now() + retryDelay;
      }
      store.put(account);
      return { account, tab };
    });
    if (publishResult && result.kind === "ok" && result.value) {
      this.publish(stateFrom(result.value.tab, result.value.account, "ready"));
      this.notify("refresh");
    }
  }

  private async drain(): Promise<void> {
    while (this.valid() && (this.transport || this.historyTransport)) {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (this.historyTransport) {
        const deletion = await this.claimNextDeletion();
        if (deletion) {
          const input = { requestId: deletion.job.requestId, resultId: deletion.job.resultId, comparisonId: deletion.job.comparisonId, createdAt: deletion.job.createdAt };
          try {
            if (!this.valid()) return;
            const ack = await this.historyTransport.deleteComparison(input);
            if (!this.valid()) return;
            if (ack.requestId !== deletion.job.requestId || ack.resultId !== deletion.job.resultId) await this.failDeletion(deletion.job, deletion.leaseId, "invalid_shape");
            else await this.acknowledgeDeletion(deletion.job, deletion.leaseId, ack);
          } catch (error) {
            if (!this.valid()) return;
            const code = safeCode(error);
            await this.failDeletion(deletion.job, deletion.leaseId, code, error instanceof ComparisonTransportError ? error.retryAfterMs : undefined, code !== "unauthorized");
            if (code === "unauthorized" && this.opened) this.close();
          }
          continue;
        }
      }
      if (!this.transport) return;
      const claimed = await this.claimNext();
      if (!claimed || !this.valid()) return;
      const input: ComparisonSaveInput = {
        requestId: claimed.job.requestId,
        snapshot: serializeComparisonSnapshot(claimed.job.snapshot),
        createdAt: claimed.job.createdAt,
        title: null,
        source: claimed.job.source,
      };
      try {
        if (!this.valid()) return;
        const ack = await this.transport.saveComparison(input);
        if (!this.valid()) return;
        if (ack.requestId !== claimed.job.requestId || ack.resultId !== claimed.job.resultId) {
          await this.fail(claimed.job, claimed.leaseId, "invalid_shape");
        } else {
          await this.acknowledge(claimed.job, claimed.leaseId, ack);
        }
      } catch (error) {
        if (!this.valid()) return;
        const code = safeCode(error);
        await this.fail(claimed.job, claimed.leaseId, code, error instanceof ComparisonTransportError ? error.retryAfterMs : undefined, code !== "unauthorized");
        if (code === "unauthorized" && this.opened) this.close();
      }
    }
  }

  async discard(confirmed: boolean): Promise<WorkspaceResult<void>> {
    if (!confirmed) return { kind: "ok", value: undefined };
    if (this.discardCompleted) return { kind: "ok", value: undefined };
      if (!this.valid()) return { kind: "error", code: "locked" };
    const nonce = this.runtimeNonce;
    const profileId = this.access.identity.profileId;
    let db: IDBDatabase | null = null;
    try {
      db = await this.dbOpen();
      if (nonce !== this.runtimeNonce || !this.access.isCurrent()) return { kind: "error", code: "stale-callback" };
      const transaction = db.transaction([COMPARISON_PRIVATE_STORE, COMPARISON_META_STORE], "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(COMPARISON_PRIVATE_STORE);
      const epoch = readBrowserEpoch(await request(transaction.objectStore(COMPARISON_META_STORE).get(COMPARISON_BROWSER_EPOCH_KEY)));
      if (this.browserEpoch === null || epoch !== this.browserEpoch) {
        try { transaction.abort(); } catch { /* already aborted */ }
        await done.catch(() => undefined);
        return { kind: "error", code: "stale-callback" };
      }
      const account = parseAccount(await request(store.get(accountKey(profileId))), profileId);
      if (nonce !== this.runtimeNonce || !this.access.isCurrent() || !this.opened || account.generation !== this.generation) {
        try { transaction.abort(); } catch { /* already aborted */ }
        await done.catch(() => undefined);
        if (nonce === this.runtimeNonce) {
          this.opened = false;
          this.runtimeNonce += 1;
          this.publish(EMPTY_STATE);
        }
        return { kind: "error", code: "stale-callback" };
      }
      const nextGeneration = account.generation + 1;
      store.put({ ...account, generation: nextGeneration, saves: [], deletions: [] });
      const keys = await request(store.index("by_profile").getAllKeys(profileId));
      if (nonce !== this.runtimeNonce || !this.access.isCurrent() || !this.opened) {
        try { transaction.abort(); } catch { /* already aborted */ }
        await done.catch(() => undefined);
        return { kind: "error", code: "stale-callback" };
      }
      for (const key of keys) store.delete(key);
      store.put({ kind: "account", key: accountKey(profileId), profileId, generation: nextGeneration, saves: [], deletions: [] });
      await done;
      if (nonce !== this.runtimeNonce || !this.access.isCurrent()) return { kind: "error", code: "stale-callback" };
      this.generation = nextGeneration;
      this.opened = false;
      this.discardCompleted = true;
      this.runtimeNonce += 1;
      this.notify("discard");
      this.channel?.close();
      this.channel = null;
      this.removeSignalListeners();
      this.publish(EMPTY_STATE);
      return { kind: "ok", value: undefined };
    } catch (error) {
      return { kind: "error", code: safeCode(error) };
    } finally {
      db?.close();
    }
  }

  /**
   * Capture an account-bound local cleanup operation before deletion submits.
   * It retains only the verified partition binding and generation. The
   * operation never opens the workspace or returns private comparison data.
   */
  captureFormerAccountCleanup(
    access: PrivateSessionAccess,
    confirmed: boolean,
  ): CapturedFormerComparisonCleanup | null {
    if (!confirmed || access !== this.access || !access.isCurrent() || access.identity.verifiedOnline !== true) return null;
    const profileId = access.identity.profileId;
    if (!profileId) return null;
    const sessionId = access.identity.sessionId;
    const authEpoch = access.identity.authEpoch;
    const capturedGeneration = this.generation;
    const capturedEpoch = this.browserEpoch ?? 0;
    const capturedRuntimeNonce = this.runtimeNonce;
    let completed: FormerComparisonCleanupResult | null = null;
    return {
      run: async () => {
        if (completed) return completed;
        const result = await this.clearCapturedPartition(profileId, sessionId, authEpoch, capturedRuntimeNonce, capturedGeneration, capturedEpoch);
        if (result.kind === "cleared") completed = result;
        return result;
      },
    };
  }

  private async clearCapturedPartition(
    profileId: string,
    sessionId: string,
    authEpoch: number,
    capturedRuntimeNonce: number,
    capturedGeneration: number,
    capturedEpoch: number,
  ): Promise<FormerComparisonCleanupResult> {
    if (this.opened && this.access.identity.profileId === profileId &&
        (this.access.identity.sessionId !== sessionId || this.access.identity.authEpoch !== authEpoch || this.runtimeNonce !== capturedRuntimeNonce)) {
      return { kind: "retry", reason: "runtime-changed" };
    }
    if (!this.factory) return { kind: "retry", reason: "storage-failure" };
    let db: IDBDatabase | null = null;
    try {
      db = await this.dbOpen();
      const transaction = db.transaction([COMPARISON_PRIVATE_STORE, COMPARISON_META_STORE], "readwrite");
      const completion = transactionDone(transaction);
      completion.catch(() => undefined);
      const store = transaction.objectStore(COMPARISON_PRIVATE_STORE);
      const epoch = readBrowserEpoch(await request(transaction.objectStore(COMPARISON_META_STORE).get(COMPARISON_BROWSER_EPOCH_KEY)));
      if (epoch !== capturedEpoch) {
        try { transaction.abort(); } catch { /* already aborted */ }
        await completion.catch(() => undefined);
        return { kind: "retry", reason: "runtime-changed" };
      }
      const stored = await request(store.get(accountKey(profileId))) as unknown;
      let generation = capturedGeneration;
      if (stored && typeof stored === "object") {
        const storedGeneration = (stored as { generation?: unknown }).generation;
        if (!Number.isSafeInteger(storedGeneration) || (storedGeneration as number) < 1) throw new Error("invalid generation");
        generation = Math.max(generation, storedGeneration as number);
      }
      if (generation >= Number.MAX_SAFE_INTEGER) throw new Error("generation exhausted");
      const nextGeneration = generation + 1;
      const keys = await request(store.index("by_profile").getAllKeys(profileId));
      for (const key of keys) store.delete(key);
      store.put({ kind: "account", key: accountKey(profileId), profileId, generation: nextGeneration, saves: [], deletions: [] });
      await completion;
      if (this.opened && this.access.identity.profileId === profileId &&
          this.access.identity.sessionId === sessionId && this.access.identity.authEpoch === authEpoch && this.runtimeNonce === capturedRuntimeNonce) this.close();
      return { kind: "cleared", generation: nextGeneration };
    } catch {
      return { kind: "retry", reason: "storage-failure" };
    } finally {
      db?.close();
    }
  }

  close(): void {
    this.opened = false;
    this.browserEpoch = null;
    this.runtimeNonce += 1;
    this.channel?.close();
    this.channel = null;
    this.removeSignalListeners();
    this.publish(EMPTY_STATE);
  }
}
