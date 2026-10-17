import { ContractValidationError, randomUuid } from "../contracts/errors";
import { parseSavedLoanPayload, type SavedLoanPayload } from "../contracts/saved-loan";
import type {
  DeleteAcknowledgement,
  PrivateAccountState,
  PrivateResult,
  QueueDeleteInput,
  QueueSaveInput,
  SaveAcknowledgement,
  ServerSavedLoanState,
  StorageGuard,
  VerifiedAccountContext,
} from "./types";
import { PrivateStorage } from "./storage";

export interface SavedLoanTransport {
  /** The adapter must stay bound to this verified profile/session and check token subject/session before every request. */
  currentLoan(): Promise<ServerSavedLoanState>;
  saveLoan(input: QueueSaveInput): Promise<Omit<SaveAcknowledgement, "leaseId">>;
  deleteLoan(input: QueueDeleteInput): Promise<Omit<DeleteAcknowledgement, "leaseId">>;
}

export type SyncStatus = "locked" | "loading" | "ready" | "queued" | "sending" | "paused" | "storage-error" | "refresh-needed";

export interface SyncSnapshot {
  status: SyncStatus;
  revision: number;
  cachedLoan: SavedLoanPayload | null;
  pendingLoan: SavedLoanPayload | null | undefined;
  /** Opaque queued save identity for continuity across a reload. */
  pendingRequestId?: string | null;
  /** The most recent request removed by a verified server acknowledgement. */
  lastAcknowledgedRequestId?: string | null;
  pendingCount: number;
  nextRetryAt: number | null;
  errorCode: string | null;
  notice: string | null;
}

export type SyncListener = (snapshot: SyncSnapshot) => void;

const AUTH_CODES = new Set(["unauthorized", "forbidden", "auth_required", "inactive_account"]);
const CONFLICT_CODES = new Set(["conflict", "stale_revision", "revision_conflict"]);
const VALIDATION_CODES = new Set(["invalid_shape", "invalid_number", "invalid_enum", "invalid_timestamp", "invalid_id", "expired"]);
const TRANSIENT_CODES = new Set(["network", "timeout", "unavailable", "rate_limited"]);

function safeTransportCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "network";
  return AUTH_CODES.has(code) || CONFLICT_CODES.has(code) || VALIDATION_CODES.has(code) || TRANSIENT_CODES.has(code) ? code : "network";
}

function resultError(result: PrivateResult<unknown>): string {
  if (result.kind === "invalid") return result.code;
  if (result.kind === "expired") return "expired";
  if (result.kind === "storage-unavailable") return "storage_unavailable";
  if (result.kind === "locked") return result.reason;
  if (result.kind === "paused") return result.reason;
  return "storage_failure";
}

export class SavedLoanSyncController {
  private readonly listeners = new Set<SyncListener>();
  private snapshot: SyncSnapshot = { status: "locked", revision: 0, cachedLoan: null, pendingLoan: undefined, pendingRequestId: null, lastAcknowledgedRequestId: null, pendingCount: 0, nextRetryAt: null, errorCode: null, notice: null };
  private pumpPromise: Promise<void> | null = null;
  private pumpGeneration: number | null = null;
  private enqueuePromise: Promise<unknown> = Promise.resolve();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private online = false;
  private stopped = true;
  private controllerGeneration = 0;
  private projectionRequired = true;
  private projectionAttempts = 0;
  private projectionRetryAt: number | null = null;
  private readonly now: () => number;

  constructor(private readonly storage: PrivateStorage, private readonly transport: SavedLoanTransport, now: () => number = () => Date.now()) {
    this.now = now;
  }

  getSnapshot(): SyncSnapshot { return this.snapshot; }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(next: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private isCurrent(generation: number, guard?: StorageGuard, requireOnline = false): boolean {
    if (this.controllerGeneration !== generation || this.stopped) return false;
    if (guard && !this.storage.isGuardCurrent(guard)) {
      this.clearIfCurrentGeneration(generation);
      return false;
    }
    return !requireOnline || this.online;
  }

  private publishIfCurrent(next: Partial<SyncSnapshot>, generation: number, guard?: StorageGuard): boolean {
    if (!this.isCurrent(generation, guard)) return false;
    this.publish(next);
    return true;
  }

  private clearSnapshot(status: SyncStatus): void {
    this.publish({ status, revision: 0, cachedLoan: null, pendingLoan: undefined, pendingRequestId: null, lastAcknowledgedRequestId: null, pendingCount: 0, nextRetryAt: null, errorCode: null, notice: null });
  }

  private clearIfCurrentGeneration(generation: number, errorCode = "stale-callback"): void {
    if (this.controllerGeneration !== generation || this.stopped) return;
    this.stop();
    this.publish({ errorCode });
  }

  private isStorageGuardCurrent(generation: number, guard: StorageGuard): boolean {
    if (this.storage.isGuardCurrent(guard)) return true;
    this.clearIfCurrentGeneration(generation);
    return false;
  }

  async open(context: VerifiedAccountContext, online: boolean): Promise<SyncSnapshot> {
    const generation = ++this.controllerGeneration;
    this.clearRetryTimer();
    this.enqueuePromise = Promise.resolve();
    this.online = online;
    this.stopped = false;
    this.projectionRequired = true;
    this.projectionAttempts = 0;
    this.projectionRetryAt = null;
    this.clearSnapshot("loading");
    const unlocked = await this.storage.unlock({ ...context });
    if (!this.isCurrent(generation)) return this.snapshot;
    if (unlocked.kind !== "ok") {
      this.publish({ status: unlocked.kind === "storage-unavailable" ? "storage-error" : "locked", errorCode: resultError(unlocked) });
      return this.snapshot;
    }
    const guard = this.storage.captureGuard();
    if (!guard || !this.isCurrent(generation, guard)) { this.clearSnapshot("locked"); return this.snapshot; }
    await this.refreshSnapshot(guard, generation);
    if (online && this.isCurrent(generation, guard, true)) await this.pump(true);
    return this.snapshot;
  }

  stop(): void {
    this.controllerGeneration += 1;
    this.stopped = true;
    this.online = false;
    this.clearRetryTimer();
    this.enqueuePromise = Promise.resolve();
    this.projectionRequired = true;
    this.projectionAttempts = 0;
    this.projectionRetryAt = null;
    this.storage.lock();
    this.clearSnapshot("locked");
  }

  async queueSave(payload: SavedLoanPayload): Promise<PrivateResult<{ requestId: string }>> {
    const captured = this.captureQueueContext();
    if (captured.kind !== "ok") return captured;
    let stablePayload: SavedLoanPayload;
    try {
      stablePayload = parseSavedLoanPayload(structuredClone(payload)) as SavedLoanPayload;
    } catch (error) {
      return { kind: "invalid", code: error instanceof ContractValidationError ? error.code : "invalid_shape" };
    }
    return this.enqueue(() => this.enqueueSave(stablePayload, captured.value.generation, captured.value.guard));
  }

  async queueDelete(): Promise<PrivateResult<{ requestId: string }>> {
    const captured = this.captureQueueContext();
    if (captured.kind !== "ok") return captured;
    return this.enqueue(() => this.enqueueDelete(captured.value.generation, captured.value.guard));
  }

  private captureQueueContext(): PrivateResult<{ generation: number; guard: StorageGuard }> {
    const guard = this.storage.captureGuard();
    if (!guard || this.stopped) return { kind: "locked", reason: "not-unlocked" };
    return { kind: "ok", value: { generation: this.controllerGeneration, guard } };
  }

  private enqueue<T>(operation: () => Promise<PrivateResult<T>>): Promise<PrivateResult<T>> {
    const next = this.enqueuePromise.then(operation, operation);
    this.enqueuePromise = next.then(() => undefined, () => undefined);
    return next;
  }

  private async enqueueSave(payload: SavedLoanPayload, generation: number, guard: StorageGuard): Promise<PrivateResult<{ requestId: string }>> {
    if (!this.isCurrent(generation, guard)) return { kind: "locked", reason: "stale-callback" };
    const state = await this.storage.readState(guard);
    if (!this.isCurrent(generation, guard)) return { kind: "locked", reason: "stale-callback" };
    if (state.kind !== "ok") return state;
    const expectedRevision = this.plannedRevision(state.value);
    if (expectedRevision === null) return { kind: "paused", reason: "conflict" };
    const input: QueueSaveInput = { requestId: randomUuid(), expectedRevision, createdAt: new Date(this.now()).toISOString(), payload };
    const result = await this.storage.queueSaveLoan(input, guard);
    if (!this.isCurrent(generation, guard)) return { kind: "locked", reason: "stale-callback" };
    if (result.kind === "ok") { await this.refreshSnapshot(guard, generation); if (this.online) void this.pump(true); }
    return result;
  }

  private async enqueueDelete(generation: number, guard: StorageGuard): Promise<PrivateResult<{ requestId: string }>> {
    if (!this.isCurrent(generation, guard)) return { kind: "locked", reason: "stale-callback" };
    const state = await this.storage.readState(guard);
    if (!this.isCurrent(generation, guard)) return { kind: "locked", reason: "stale-callback" };
    if (state.kind !== "ok") return state;
    const expectedRevision = this.plannedRevision(state.value);
    if (expectedRevision === null) return { kind: "paused", reason: "conflict" };
    const input: QueueDeleteInput = { requestId: randomUuid(), expectedRevision, createdAt: new Date(this.now()).toISOString() };
    const result = await this.storage.queueDeleteLoan(input, guard);
    if (!this.isCurrent(generation, guard)) return { kind: "locked", reason: "stale-callback" };
    if (result.kind === "ok") { await this.refreshSnapshot(guard, generation); if (this.online) void this.pump(true); }
    return result;
  }

  private plannedRevision(state: PrivateAccountState): number | null {
    // A committed write may still be queued when its receipt was lost. Start
    // from the immutable queue chain, not a fresher server projection.
    let expected = state.outbox[0]?.expectedRevision ?? state.revision;
    for (const operation of state.outbox) {
      if (operation.status === "paused" || operation.expectedRevision !== expected) return null;
      expected += 1;
    }
    return expected >= state.revision ? expected : null;
  }

  async pump(online = this.online): Promise<void> {
    const reconnecting = online && !this.online;
    this.online = online;
    if (reconnecting) { this.projectionRequired = true; this.projectionAttempts = 0; this.projectionRetryAt = null; }
    if (!online) { this.clearRetryTimer(); this.projectionRequired = true; }
    if (!online || this.stopped) {
      if (!this.stopped) this.publish({ status: this.snapshot.pendingCount ? "queued" : "ready", nextRetryAt: null });
      return;
    }
    if (this.pumpPromise && this.pumpGeneration === this.controllerGeneration) return this.pumpPromise;
    const generation = this.controllerGeneration;
    const guard = this.storage.captureGuard();
    if (!guard) { this.clearSnapshot("locked"); return; }
    this.pumpGeneration = generation;
    this.pumpPromise = this.drain(generation, guard).finally(() => {
      if (this.pumpGeneration === generation) { this.pumpPromise = null; this.pumpGeneration = null; }
    });
    return this.pumpPromise;
  }

  private async drain(generation: number, guard: StorageGuard): Promise<void> {
    if (!this.isCurrent(generation, guard, true)) return;
    for (;;) {
      if (!this.isCurrent(generation, guard, true)) return;
      if (this.projectionRequired && !(await this.refreshProjection(generation, guard))) return;
      const claim = await this.storage.claimNext(guard, true);
      if (!this.isCurrent(generation, guard, true)) { this.isStorageGuardCurrent(generation, guard); return; }
      if (claim.kind === "not-found") { await this.refreshSnapshot(guard, generation); this.scheduleRetry(); return; }
      if (claim.kind === "expired") { await this.refreshSnapshot(guard, generation); this.publishIfCurrent({ notice: "This queued loan change is too old to send. Review it online and choose whether to submit it again." }, generation, guard); return; }
      if (claim.kind !== "ok") { if (claim.kind === "locked") this.clearIfCurrentGeneration(generation, resultError(claim)); else this.publishIfCurrent({ status: "storage-error", errorCode: resultError(claim) }, generation, guard); return; }
      const operation = claim.value.operation;
      if (!this.publishIfCurrent({ status: "sending", errorCode: null }, generation, guard)) return;
      let transportResult: Omit<SaveAcknowledgement, "leaseId"> | Omit<DeleteAcknowledgement, "leaseId">;
      try {
        transportResult = operation.kind === "saveLoan"
          ? await this.transport.saveLoan({ requestId: operation.requestId, expectedRevision: operation.expectedRevision, createdAt: operation.createdAt, payload: parseSavedLoanPayload(JSON.parse(operation.payloadJson!)) })
          : await this.transport.deleteLoan({ requestId: operation.requestId, expectedRevision: operation.expectedRevision, createdAt: operation.createdAt });
      } catch (error) {
        if (!this.isCurrent(generation, guard, true)) { this.isStorageGuardCurrent(generation, guard); return; }
        await this.handleFailure(operation.requestId, operation.leaseId!, safeTransportCode(error), guard, generation);
        return;
      }
      if (!this.isCurrent(generation, guard, true)) { this.isStorageGuardCurrent(generation, guard); return; }
      const acknowledgement: SaveAcknowledgement | DeleteAcknowledgement = { ...transportResult, leaseId: operation.leaseId! } as SaveAcknowledgement | DeleteAcknowledgement;
      if (acknowledgement.requestId !== operation.requestId || acknowledgement.kind !== operation.kind) {
        await this.handleFailure(operation.requestId, operation.leaseId!, "conflict", guard, generation);
        return;
      }
      const acknowledged = await this.storage.acknowledge(acknowledgement, guard);
      if (!this.isCurrent(generation, guard, true)) { this.isStorageGuardCurrent(generation, guard); return; }
      if (acknowledged.kind !== "ok") {
        if (acknowledged.kind === "locked") this.clearIfCurrentGeneration(generation, resultError(acknowledged));
        else this.publishIfCurrent({ status: "storage-error", errorCode: resultError(acknowledged) }, generation, guard);
        return;
      }
      // Keep this runtime-only marker through the projection refresh. It lets
      // consumers distinguish an acknowledged save from a discarded,
      // conflicted, expired, or otherwise removed queue entry.
      this.publishIfCurrent({ lastAcknowledgedRequestId: operation.requestId }, generation, guard);
      if (!this.isCurrent(generation, guard, true)) { this.isStorageGuardCurrent(generation, guard); return; }
      this.projectionRequired = true;
      this.projectionAttempts = 0;
      this.projectionRetryAt = null;
    }
  }

  private async handleFailure(requestId: string, leaseId: string, code: string, guard: StorageGuard, generation: number): Promise<void> {
    if (VALIDATION_CODES.has(code) || AUTH_CODES.has(code) || CONFLICT_CODES.has(code)) {
      const reason = VALIDATION_CODES.has(code) ? "validation" : AUTH_CODES.has(code) ? "authorization" : "conflict";
      const paused = await this.storage.pauseOperation(requestId, leaseId, reason, guard);
      if (AUTH_CODES.has(code)) { this.clearIfCurrentGeneration(generation, code); return; }
      if (paused.kind === "locked") this.clearIfCurrentGeneration(generation, resultError(paused));
      else {
        if (paused.kind === "ok") await this.refreshSnapshot(guard, generation);
        this.publishIfCurrent({ status: paused.kind === "ok" ? "paused" : "storage-error", errorCode: paused.kind === "ok" ? code : resultError(paused), nextRetryAt: null }, generation, guard);
      }
      return;
    }
    const failed = await this.storage.recordTransientFailure(requestId, leaseId, code, guard);
    if (!this.isCurrent(generation, guard, true)) { this.isStorageGuardCurrent(generation, guard); return; }
    if (failed.kind !== "ok") { this.publishIfCurrent({ status: "storage-error", errorCode: resultError(failed) }, generation, guard); return; }
    await this.refreshSnapshot(guard, generation);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.clearRetryTimer();
    const nextRetryAt = this.projectionRequired ? this.projectionRetryAt : this.snapshot.nextRetryAt;
    if (!this.online || this.stopped || nextRetryAt === null) return;
    const generation = this.controllerGeneration;
    const delay = Math.min(60_000, Math.max(0, nextRetryAt - this.now()));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.isCurrent(generation, undefined, true)) void this.pump(true);
    }, delay);
  }

  /** Explicit user retry starts a new bounded attempt window. */
  async retry(): Promise<void> {
    if (this.stopped || !this.online) return;
    this.projectionRequired = true;
    this.projectionAttempts = 0;
    this.projectionRetryAt = null;
    await this.pump(true);
  }

  private async refreshProjection(generation: number, guard: StorageGuard): Promise<boolean> {
    if (!this.isCurrent(generation, guard, true)) return false;
    if (this.projectionAttempts >= 8 || (this.projectionRetryAt !== null && this.projectionRetryAt > this.now())) {
      this.scheduleRetry();
      return false;
    }
    this.projectionAttempts += 1;
    try {
      const current = await this.transport.currentLoan();
      if (!this.isCurrent(generation, guard, true)) return false;
      const applied = await this.storage.applyServerState(current, guard);
      if (!this.isCurrent(generation, guard, true)) return false;
      if (applied.kind !== "ok") {
        if (applied.kind === "locked") this.clearIfCurrentGeneration(generation, resultError(applied));
        else { this.projectionRetryAt = null; this.projectionAttempts = 8; this.publish({ status: "storage-error", errorCode: resultError(applied), nextRetryAt: null }); }
        return false;
      }
      this.projectionRequired = false;
      this.projectionAttempts = 0;
      this.projectionRetryAt = null;
      this.publishIfCurrent({ errorCode: null, notice: null }, generation, guard);
      await this.refreshSnapshot(guard, generation);
      return this.isCurrent(generation, guard, true);
    } catch (error) {
      if (!this.isCurrent(generation, guard, true)) return false;
      const code = safeTransportCode(error);
      if (AUTH_CODES.has(code)) { this.clearIfCurrentGeneration(generation, code); return false; }
      if (!TRANSIENT_CODES.has(code)) this.projectionAttempts = 8;
      this.projectionRetryAt = this.projectionAttempts < 8 ? this.now() + Math.min(60_000, 1_000 * 2 ** (this.projectionAttempts - 1)) : null;
      await this.refreshSnapshot(guard, generation);
      if (!this.publishIfCurrent({ status: "refresh-needed", errorCode: code, nextRetryAt: this.projectionRetryAt,
        notice: "The current account copy could not be confirmed. Your queued changes are retained; retry online." }, generation, guard)) return false;
      this.scheduleRetry();
      return false;
    }
  }

  private clearRetryTimer(): void { if (this.retryTimer !== null) { clearTimeout(this.retryTimer); this.retryTimer = null; } }

  private async refreshSnapshot(guard: StorageGuard | null, generation = this.controllerGeneration): Promise<void> {
    if (!guard || !this.isCurrent(generation, guard)) return;
    const state = await this.storage.readState(guard ?? undefined);
    if (!this.isCurrent(generation, guard)) { this.isStorageGuardCurrent(generation, guard); return; }
    if (state.kind !== "ok") {
      if (state.kind === "locked") this.clearIfCurrentGeneration(generation, resultError(state));
      else this.publishIfCurrent({ status: "storage-error", errorCode: resultError(state) }, generation, guard);
      return;
    }
    const pending = state.value.outbox[state.value.outbox.length - 1];
    let pendingLoan: SavedLoanPayload | null | undefined;
    if (pending) pendingLoan = pending.kind === "deleteLoan" ? null : parseSavedLoanPayload(JSON.parse(pending.payloadJson!));
    const pendingRequestId = pending?.kind === "saveLoan" ? pending.requestId : null;
    const paused = state.value.outbox.some((operation) => operation.status === "paused");
    const head = state.value.outbox[0];
    const nextRetryAt = head?.status === "queued" ? head.nextAttemptAt : head?.status === "sending" ? head.leaseUntil : null;
    this.publishIfCurrent({ status: paused ? "paused" : state.value.outbox.length ? "queued" : "ready", revision: state.value.revision, cachedLoan: state.value.cachedLoan?.payload ?? null, pendingLoan, pendingRequestId, pendingCount: state.value.outbox.length, nextRetryAt }, generation, guard);
  }

  async resolveConflict(requestId: string, choice: "keep-server" | "resubmit-local"): Promise<PrivateResult<{ requestId?: string }>> {
    if (!this.online || this.stopped) return { kind: "locked", reason: "offline" };
    if (choice !== "keep-server" && choice !== "resubmit-local") return { kind: "invalid", code: "invalid_choice" };
    const generation = this.controllerGeneration;
    const guard = this.storage.captureGuard();
    if (!guard || !this.isCurrent(generation, guard, true)) return { kind: "locked", reason: "not-unlocked" };
    const state = await this.storage.readState(guard);
    if (!this.isCurrent(generation, guard, true)) return { kind: "locked", reason: "stale-callback" };
    if (state.kind !== "ok") return state;
    const pausedIndex = state.value.outbox.findIndex((candidate) => candidate.requestId === requestId && candidate.status === "paused");
    if (pausedIndex < 0) return { kind: "not-found" };
    if (pausedIndex !== 0) return { kind: "invalid", code: "queue_changed" };
    const observedRequestIds = state.value.outbox.map((operation) => operation.requestId);
    const latest = state.value.outbox[state.value.outbox.length - 1];
    let current: ServerSavedLoanState;
    try {
      current = await this.transport.currentLoan();
    } catch (error) {
      if (!this.isCurrent(generation, guard, true)) { this.isStorageGuardCurrent(generation, guard); return { kind: "locked", reason: "stale-callback" }; }
      return { kind: "invalid", code: safeTransportCode(error) };
    }
    if (!this.isCurrent(generation, guard, true)) return { kind: "locked", reason: "stale-callback" };
    const applied = await this.storage.applyServerState(current, guard);
    if (!this.isCurrent(generation, guard, true)) return { kind: "locked", reason: "stale-callback" };
    if (applied.kind !== "ok") return applied;
    const fresh = await this.storage.readState(guard);
    if (!this.isCurrent(generation, guard, true)) return { kind: "locked", reason: "stale-callback" };
    if (fresh.kind !== "ok") return fresh;
    if (!latest || fresh.value.outbox[0]?.requestId !== requestId || fresh.value.outbox.map((operation) => operation.requestId).some((id, index) => id !== observedRequestIds[index]) || fresh.value.outbox.length !== observedRequestIds.length) return { kind: "invalid", code: "queue_changed" };
    let replacement: QueueSaveInput | QueueDeleteInput | null = null;
    if (choice === "resubmit-local") {
      const createdAt = new Date(this.now()).toISOString();
      if (latest.kind === "saveLoan") {
        if (!latest.payloadJson) return { kind: "invalid", code: "missing_payload" };
        try {
          replacement = { requestId: randomUuid(), expectedRevision: fresh.value.revision, createdAt, payload: parseSavedLoanPayload(JSON.parse(latest.payloadJson)) as SavedLoanPayload };
        } catch (error) {
          return { kind: "invalid", code: error instanceof ContractValidationError ? error.code : "invalid_shape" };
        }
      } else {
        replacement = { requestId: randomUuid(), expectedRevision: fresh.value.revision, createdAt };
      }
    }
    const resolved = await this.storage.resolvePausedQueue(requestId, observedRequestIds, fresh.value.revision, replacement, guard);
    if (!this.isCurrent(generation, guard, true)) return { kind: "locked", reason: "stale-callback" };
    if (resolved.kind === "ok") await this.refreshSnapshot(guard, generation);
    return resolved;
  }

  async discardFormerMember(confirmed: boolean): Promise<PrivateResult<void>> {
    const generation = this.controllerGeneration;
    const guard = this.storage.captureGuard();
    if (!guard) return { kind: "locked", reason: "not-unlocked" };
    if (!confirmed) return { kind: "ok", value: undefined };
    const result = await this.storage.confirmDiscardFormerMember(guard, true);
    if (generation !== this.controllerGeneration) return { kind: "locked", reason: "stale-callback" };
    this.clearRetryTimer();
    if (result.kind === "discarded") { this.stop(); return { kind: "ok", value: undefined }; }
    return { kind: "storage-unavailable", reason: "transaction-failed" };
  }
}
