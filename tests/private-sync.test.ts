import { beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDB } from "fake-indexeddb";
import type { SavedLoanPayload } from "../lib/contracts/saved-loan";
import { PRIVATE_DB_NAME, PrivateStorage } from "../lib/private-storage/storage";
import { SavedLoanSyncController, type SavedLoanTransport } from "../lib/private-storage/sync";
import type { DeleteAcknowledgement, SaveAcknowledgement, ServerSavedLoanState, QueueSaveInput, QueueDeleteInput } from "../lib/private-storage/types";

const baseNow = Date.parse("2026-09-16T12:00:00.000Z");
let now = baseNow;
const payload: SavedLoanPayload = { loan: { lender: "Example Bank", original: 2_000_000, outstanding: 1_650_000, ratePct: 8.5, basis: "repo", spreadPct: 2.75, cycle: "quarterly", lastReset: "", monthsLeft: 214 }, quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5_000, keepTenure: true, newTenureMonths: 214 }, surplus: 100_000, bufferMonths: 6, rateResolvedAt: null };
const context = { profileId: "profile-sync", sessionId: "session-sync", authEpoch: 1, verifiedOnline: true as const };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function clearDb() { await new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(PRIVATE_DB_NAME); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }); }
function transport(overrides: Partial<SavedLoanTransport> = {}): SavedLoanTransport {
  return { currentLoan: async () => ({ revision: 0, payload: null }), saveLoan: async (input: QueueSaveInput) => ({ requestId: input.requestId, kind: "saveLoan" as const, revision: 1 }), deleteLoan: async (input: QueueDeleteInput) => ({ requestId: input.requestId, kind: "deleteLoan" as const, revision: 1 }), ...overrides };
}
function controller(t: SavedLoanTransport) { return new SavedLoanSyncController(new PrivateStorage({ indexedDB, now: () => now }), t, () => now); }
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => { now = baseNow; await clearDb(); });

describe("saved-loan sync controller", () => {
  it("queues offline after explicit unlock and exposes pending optimistic payload", async () => {
    const t = transport(); const c = controller(t);
    await c.open(context, false);
    const result = await c.queueSave(payload);
    expect(result.kind).toBe("ok");
    expect(c.getSnapshot().status).toBe("queued");
    expect(c.getSnapshot().pendingLoan?.loan.lender).toBe("Example Bank");
  });

  it("drains FIFO online and refreshes the authoritative projection after receipt", async () => {
    const calls: string[] = [];
    const t = transport({ saveLoan: async (input) => { calls.push("save"); return { requestId: input.requestId, kind: "saveLoan" as const, revision: 1 }; }, currentLoan: async () => { calls.push("current"); return { revision: calls.includes("save") ? 1 : 0, payload: calls.includes("save") ? payload : null }; } });
    const c = controller(t); await c.open(context, true); await c.queueSave(payload); await c.pump(true);
    expect(calls).toEqual(["current", "save", "current"]);
    expect(c.getSnapshot().status).toBe("ready");
    expect(c.getSnapshot().cachedLoan?.loan.lender).toBe("Example Bank");
    expect(c.getSnapshot().pendingCount).toBe(0);
  });

  it("keeps a transient failure queued with the same operation and bounded retry time", async () => {
    let saves = 0;
    const t = transport({ saveLoan: async () => { saves += 1; throw { code: "network" }; } });
    const c = controller(t); await c.open(context, false); await c.queueSave(payload); await c.pump(true);
    expect(saves).toBe(1); expect(c.getSnapshot().status).toBe("queued"); expect(c.getSnapshot().pendingCount).toBe(1); expect(c.getSnapshot().nextRetryAt).not.toBeNull();
    c.stop();
  });

  it("pauses conflicts and supports keep-server resolution without deleting the whole partition", async () => {
    let currentCalls = 0;
    const t = transport({ saveLoan: async () => { throw { code: "conflict" }; }, currentLoan: async () => { currentCalls += 1; return currentCalls > 1 ? { revision: 2, payload: null } : { revision: 0, payload: null }; } });
    const c = controller(t); await c.open(context, true); const queued = await c.queueSave(payload); await c.pump(true);
    expect(c.getSnapshot().status).toBe("paused");
    const requestId = queued.kind === "ok" ? queued.value.requestId : "";
    expect((await c.resolveConflict(requestId, "keep-server")).kind).toBe("ok");
    expect(c.getSnapshot().status).toBe("ready"); expect(c.getSnapshot().cachedLoan).toBeNull(); expect(c.getSnapshot().pendingCount).toBe(0);
  });

  it("resubmits conflicted local payload under a new request id after fresh server state", async () => {
    let first = true;
    const t = transport({ saveLoan: async (input) => { if (first) { first = false; throw { code: "conflict" }; } return { requestId: input.requestId, kind: "saveLoan" as const, revision: 3 }; }, currentLoan: async () => ({ revision: first ? 0 : 2, payload: null }) });
    const c = controller(t); await c.open(context, true); const queued = await c.queueSave(payload); await c.pump(true);
    const oldId = queued.kind === "ok" ? queued.value.requestId : "";
    const replacement = await c.resolveConflict(oldId, "resubmit-local");
    expect(replacement.kind).toBe("ok");
    if (replacement.kind === "ok") expect(replacement.value.requestId).not.toBe(oldId);
  });

  it("resolves a paused chain from its latest local intent in one guarded replacement", async () => {
    const s = new PrivateStorage({ indexedDB, now: () => now });
    const t = transport({ saveLoan: async () => { throw { code: "conflict" }; }, currentLoan: async () => ({ revision: 2, payload: null }) });
    const c = new SavedLoanSyncController(s, t, () => now);
    await c.open(context, false);
    const first = await c.queueSave(payload);
    await c.queueDelete();
    await c.pump(true);
    expect(first.kind).toBe("ok");
    const guard = s.captureGuard()!;
    const requestId = first.kind === "ok" ? first.value.requestId : "";
    const resolved = await c.resolveConflict(requestId, "resubmit-local");
    expect(resolved.kind).toBe("ok");
    const state = await s.readState(guard);
    if (state.kind === "ok") { expect(state.value.outbox).toHaveLength(1); expect(state.value.outbox[0].kind).toBe("deleteLoan"); expect(state.value.outbox[0].expectedRevision).toBe(2); }
  });

  it("stops a deferred send so its late receipt cannot update a locked controller", async () => {
    const entered = deferred(); const finish = deferred();
    const t = transport({ saveLoan: async (input) => { entered.resolve(); await finish.promise; return { requestId: input.requestId, kind: "saveLoan" as const, revision: 1 }; } });
    const c = controller(t); await c.open(context, false); await c.queueSave(payload);
    const sending = c.pump(true); await entered.promise; c.stop(); finish.resolve(); await sending;
    expect(c.getSnapshot().status).toBe("locked"); expect(c.getSnapshot().cachedLoan).toBeNull();
  });

  it("does not spend a cancelled discard and exposes guarded discard separately", async () => {
    const c = controller(transport()); await c.open(context, false); await c.queueSave(payload);
    expect((await c.discardFormerMember(false)).kind).toBe("ok"); expect(c.getSnapshot().pendingCount).toBe(1);
    expect((await c.discardFormerMember(true)).kind).toBe("ok"); expect(c.getSnapshot().pendingCount).toBe(0); expect(c.getSnapshot().status).toBe("locked");
  });

  it("clears private snapshot fields immediately on stop", async () => {
    const c = controller(transport()); await c.open(context, false); await c.queueSave(payload);
    c.stop();
    expect(c.getSnapshot()).toMatchObject({ status: "locked", revision: 0, cachedLoan: null, pendingLoan: undefined, pendingCount: 0, nextRetryAt: null });
  });

  it("does not carry a queued A callback into B after an account switch", async () => {
    const s = new PrivateStorage({ indexedDB, now: () => now });
    const c = new SavedLoanSyncController(s, transport(), () => now);
    await c.open(context, false);
    const originalRead = s.readState.bind(s);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let hold = true;
    s.readState = async (guard) => { const result = await originalRead(guard); if (hold) { hold = false; await held; } return result; };
    const queued = c.queueSave(payload);
    await Promise.resolve();
    c.stop();
    await c.open({ ...context, profileId: "profile-sync-b" }, false);
    release();
    expect((await queued).kind).toBe("locked");
    const state = await s.readState(s.captureGuard()!);
    if (state.kind === "ok") expect(state.value.outbox).toHaveLength(0);
  });

  it("retries an acknowledged projection refresh without restoring historical payload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let currentCalls = 0;
      const t = transport({
        saveLoan: async (input) => ({ requestId: input.requestId, kind: "saveLoan" as const, revision: 1 }),
        currentLoan: async () => { currentCalls += 1; if (currentCalls === 2) throw { code: "network" }; return currentCalls === 1 ? { revision: 0, payload: null } : { revision: 1, payload }; },
      });
      const c = controller(t); await c.open(context, true); await c.queueSave(payload); await c.pump(true);
      expect(currentCalls).toBe(2); expect(c.getSnapshot().cachedLoan).toBeNull(); expect(c.getSnapshot().nextRetryAt).not.toBeNull();
      now += 1_000;
      await vi.advanceTimersByTimeAsync(1_000);
      await c.pump(true);
      expect(currentCalls).toBe(3);
      expect(c.getSnapshot().cachedLoan?.loan.lender).toBe("Example Bank");
      c.stop();
    } finally { vi.useRealTimers(); }
  });

  it("bounds projection retries and recovers only after an explicit new attempt", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const current = vi.fn<() => Promise<ServerSavedLoanState>>().mockRejectedValue({ code: "network" });
    const c = controller(transport({ currentLoan: current }));
    try {
      await c.open(context, true);
      for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000]) {
        now += delay;
        await vi.advanceTimersByTimeAsync(delay);
        await c.pump(true);
      }
      expect(current).toHaveBeenCalledTimes(8);
      expect(c.getSnapshot()).toMatchObject({ status: "refresh-needed", nextRetryAt: null });
      expect(vi.getTimerCount()).toBe(0);
      await c.pump(true);
      expect(current).toHaveBeenCalledTimes(8);
      current.mockResolvedValue({ revision: 1, payload });
      await c.retry();
      expect(c.getSnapshot()).toMatchObject({ status: "ready", cachedLoan: payload });
    } finally { c.stop(); vi.useRealTimers(); }
  });

  it("locks and clears private data when a projection rejects the session", async () => {
    const current = vi.fn<() => Promise<ServerSavedLoanState>>().mockResolvedValue({ revision: 1, payload });
    const c = controller(transport({ currentLoan: current }));
    await c.open(context, true);
    await c.pump(false);
    await c.queueSave(payload);
    current.mockRejectedValue({ code: "unauthorized" });
    await c.pump(true);
    expect(c.getSnapshot()).toMatchObject({ status: "locked", cachedLoan: null, pendingLoan: undefined, pendingCount: 0, errorCode: "unauthorized", nextRetryAt: null });
  });

  it("reconnects a projection-only failure with no outbox work", async () => {
    const current = vi.fn<() => Promise<ServerSavedLoanState>>().mockRejectedValue({ code: "network" });
    const c = controller(transport({ currentLoan: current }));
    await c.open(context, true);
    await c.pump(false);
    current.mockResolvedValue({ revision: 2, payload });
    await c.pump(true);
    expect(c.getSnapshot()).toMatchObject({ status: "ready", revision: 2, cachedLoan: payload, pendingCount: 0 });
    c.stop();
  });

  it("wakes a persisted retry after reopening without changing the operation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const inputs: QueueSaveInput[] = [];
    let saved = false;
    const t = transport({
      currentLoan: async () => ({ revision: saved ? 1 : 0, payload: saved ? payload : null }),
      saveLoan: async (input) => { inputs.push(input); if (inputs.length === 1) throw { code: "network" }; saved = true; return { kind: "saveLoan", requestId: input.requestId, revision: 1 }; },
    });
    const first = controller(t); const reopened = controller(t);
    try {
      await first.open(context, false); await first.queueSave(payload); await first.pump(true); first.stop();
      await reopened.open(context, true);
      expect(inputs).toHaveLength(1);
      now += 2_000; await vi.advanceTimersByTimeAsync(2_000); await reopened.pump(true);
      expect(inputs).toHaveLength(2); expect(inputs[1]).toEqual(inputs[0]);
      expect(reopened.getSnapshot()).toMatchObject({ status: "ready", pendingCount: 0 });
    } finally { first.stop(); reopened.stop(); vi.useRealTimers(); }
  });

  it("allows B to open while A has an unresolved send and ignores the late A receipt", async () => {
    const entered = deferred(); const receipt = deferred<Omit<SaveAcknowledgement, "leaseId">>();
    let input!: QueueSaveInput;
    const c = controller(transport({ saveLoan: async (value) => { input = value; entered.resolve(); return receipt.promise; } }));
    await c.open(context, false); await c.queueSave(payload);
    const sending = c.pump(true); await entered.promise;
    c.stop();
    await c.open({ ...context, profileId: "profile-b", sessionId: "session-b", authEpoch: 2 }, true);
    expect(c.getSnapshot()).toMatchObject({ status: "ready", pendingCount: 0, cachedLoan: null });
    receipt.resolve({ requestId: input.requestId, kind: "saveLoan", revision: 1 }); await sending;
    expect(c.getSnapshot()).toMatchObject({ status: "ready", pendingCount: 0, cachedLoan: null });
    c.stop();
  });

  it("clears every private field when another tab revokes the stored partition", async () => {
    const c = controller(transport({ currentLoan: async () => ({ revision: 1, payload }) }));
    await c.open(context, true); await c.pump(false); await c.queueSave(payload);
    const other = new PrivateStorage({ indexedDB, now: () => now }); await other.unlock(context);
    await other.confirmDiscardFormerMember(other.captureGuard()!, true);
    expect((await c.queueDelete()).kind).toBe("locked");
    expect(c.getSnapshot()).toMatchObject({ status: "locked", cachedLoan: null, pendingLoan: undefined, pendingCount: 0, revision: 0, nextRetryAt: null });
  });

  it("retains an expired head, tells the user about the loan, and does not send its tail", async () => {
    const save = vi.fn(); const remove = vi.fn();
    const c = controller(transport({ saveLoan: save, deleteLoan: remove }));
    await c.open(context, false); await c.queueSave(payload); await c.queueDelete();
    now += 7 * 24 * 60 * 60 * 1000 + 1;
    await c.pump(true);
    expect(c.getSnapshot()).toMatchObject({ status: "paused", pendingCount: 2, nextRetryAt: null });
    expect(c.getSnapshot().notice).toContain("loan change");
    expect(save).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    c.stop();
  });

  it("uses the original revision chain when a committed write lost its receipt", async () => {
    const s = new PrivateStorage({ indexedDB, now: () => now });
    const c = new SavedLoanSyncController(s, transport(), () => now);
    await c.open(context, false); await c.queueSave(payload);
    await s.applyServerState({ revision: 1, payload }, s.captureGuard()!);
    expect((await c.queueDelete()).kind).toBe("ok");
    const state = await s.readState();
    if (state.kind !== "ok") throw new Error("state unavailable");
    expect(state.value.outbox.map((op) => op.expectedRevision)).toEqual([0, 1]);
    c.stop();
  });

  it("recovers an abandoned lease after reconnect, replays its UUID and then sends the tail", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const entered = deferred(); const finish = deferred(); const inputs: QueueSaveInput[] = [];
    let revision = 0;
    const c = controller(transport({
      currentLoan: async () => ({ revision, payload: revision ? payload : null }),
      saveLoan: async (input) => {
        inputs.push(input);
        if (inputs.length === 1) { revision = 1; entered.resolve(); await finish.promise; }
        if (inputs.length === 3) revision = 2;
        return { requestId: input.requestId, kind: "saveLoan", revision: input.expectedRevision + 1 };
      },
    }));
    try {
      await c.open(context, false); await c.queueSave(payload); await c.queueSave({ ...payload, surplus: 200_000 });
      const sending = c.pump(true); await entered.promise;
      await c.pump(false); finish.resolve(); await sending;
      expect(inputs).toHaveLength(1);
      await c.pump(true);
      expect(inputs).toHaveLength(1);
      expect(c.getSnapshot().nextRetryAt).toBe(baseNow + 30_000);
      now += 30_000; await vi.advanceTimersByTimeAsync(30_000); await c.pump(true);
      expect(inputs).toHaveLength(3); expect(inputs[1]).toEqual(inputs[0]);
      expect(inputs[2].expectedRevision).toBe(1);
      expect(c.getSnapshot()).toMatchObject({ status: "ready", revision: 2, pendingCount: 0 });
    } finally { c.stop(); vi.useRealTimers(); }
  });

  it("lets B queue while A's old enqueue read is still unresolved", async () => {
    const s = new PrivateStorage({ indexedDB, now: () => now });
    const c = new SavedLoanSyncController(s, transport(), () => now);
    await c.open(context, false);
    const originalRead = s.readState.bind(s); const entered = deferred(); const finish = deferred(); let hold = true;
    s.readState = async (guard) => {
      const result = await originalRead(guard);
      if (hold) { hold = false; entered.resolve(); await finish.promise; }
      return result;
    };
    const oldQueue = c.queueSave(payload); await entered.promise;
    c.stop(); await c.open({ ...context, profileId: "profile-b", sessionId: "session-b", authEpoch: 2 }, false);
    expect((await c.queueSave({ ...payload, surplus: 300_000 })).kind).toBe("ok");
    finish.resolve(); expect((await oldQueue).kind).toBe("locked");
    expect(c.getSnapshot().pendingLoan?.surplus).toBe(300_000);
    c.stop();
  });

  it("locks private state on a rejected mutation while retaining the paused queue", async () => {
    const s = new PrivateStorage({ indexedDB, now: () => now });
    const c = new SavedLoanSyncController(s, transport({ saveLoan: async () => { throw { code: "unauthorized" }; } }), () => now);
    await c.open(context, false); await c.queueSave(payload); await c.pump(true);
    expect(c.getSnapshot()).toMatchObject({ status: "locked", pendingCount: 0, pendingLoan: undefined, cachedLoan: null, errorCode: "unauthorized" });
    await s.unlock(context);
    const state = await s.readState();
    if (state.kind !== "ok") throw new Error("state unavailable");
    expect(state.value.outbox).toHaveLength(1);
    expect(state.value.outbox[0].pauseReason).toBe("authorization");
    c.stop();
  });

  it("refuses conflict resolution when another tab appends a newer local intent", async () => {
    const entered = deferred(); const projection = deferred<ServerSavedLoanState>();
    let calls = 0;
    const s = new PrivateStorage({ indexedDB, now: () => now });
    const c = new SavedLoanSyncController(s, transport({
      saveLoan: async () => { throw { code: "conflict" }; },
      currentLoan: async () => { calls += 1; if (calls === 2) { entered.resolve(); return projection.promise; } return { revision: 0, payload: null }; },
    }), () => now);
    await c.open(context, false); const first = await c.queueSave(payload); await c.pump(true);
    if (first.kind !== "ok") throw new Error("queue failed");
    const resolution = c.resolveConflict(first.value.requestId, "keep-server"); await entered.promise;
    const other = new PrivateStorage({ indexedDB, now: () => now }); await other.unlock(context);
    expect((await other.queueDeleteLoan({ requestId: id(80), expectedRevision: 1, createdAt: new Date(now).toISOString() })).kind).toBe("ok");
    projection.resolve({ revision: 2, payload: null });
    expect(await resolution).toEqual({ kind: "invalid", code: "queue_changed" });
    const state = await s.readState();
    if (state.kind !== "ok") throw new Error("state unavailable");
    expect(state.value.outbox.map((op) => op.requestId)).toEqual([first.value.requestId, id(80)]);
    c.stop();
  });
});
