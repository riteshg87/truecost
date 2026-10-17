import { describe, expect, beforeEach, it } from "vitest";
import { IDBObjectStore, indexedDB } from "fake-indexeddb";
import type { SavedLoanPayload } from "../lib/contracts/saved-loan";
import { PRIVATE_DB_NAME, PrivateStorage } from "../lib/private-storage/storage";
import type { StorageGuard, VerifiedAccountContext } from "../lib/private-storage/types";

const baseNow = Date.parse("2026-09-16T12:00:00.000Z");
let now = baseNow;
const requestId = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const createdAt = () => new Date(now).toISOString();
const legacyPayloadJsonWithBlankReset = '{"loan":{"lender":"Example Bank","original":2000000,"outstanding":1650000,"ratePct":8.5,"basis":"repo","spreadPct":2.75,"cycle":"quarterly","lastReset":"","monthsLeft":214},"quote":{"newRatePct":8,"feePct":0.25,"legalCharges":5000,"keepTenure":true,"newTenureMonths":214},"surplus":100000,"bufferMonths":6,"rateResolvedAt":null}';
function legacyHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const payload: SavedLoanPayload = {
  loan: { lender: "Example Bank", original: 2_000_000, outstanding: 1_650_000, ratePct: 8.5, basis: "repo", spreadPct: 2.75, cycle: "quarterly", lastReset: "", monthsLeft: 214 },
  quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5_000, keepTenure: true, newTenureMonths: 214 },
  surplus: 100_000, bufferMonths: 6, rateResolvedAt: null,
};

function context(profileId: string, sessionId = `session-${profileId}`, authEpoch = 1): VerifiedAccountContext {
  return { profileId, sessionId, authEpoch, verifiedOnline: true };
}
function storage(): PrivateStorage { return new PrivateStorage({ indexedDB, now: () => now, leaseDurationMs: 30_000 }); }
async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(PRIVATE_DB_NAME);
    req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });
}
async function updateRawPartition(profileId: string, update: (record: Record<string, any>) => void): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    // The application schema has a separate metadata upgrade. Open without a
    // requested version so this raw fixture remains compatible with v1 data
    // after the metadata store is added.
    const req = indexedDB.open(PRIVATE_DB_NAME);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("partitions", "readwrite");
    const get = tx.objectStore("partitions").get(profileId);
    get.onsuccess = () => { const record = get.result as Record<string, any>; update(record); tx.objectStore("partitions").put(record); };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  db.close();
}
async function saveAndAck(store: PrivateStorage, guard: StorageGuard, id = requestId("1"), revision = 1) {
  expect((await store.queueSaveLoan({ requestId: id, expectedRevision: revision - 1, createdAt: createdAt(), payload }, guard)).kind).toBe("ok");
  const claim = await store.claimNext(guard, true);
  expect(claim.kind).toBe("ok");
  if (claim.kind !== "ok") throw new Error("claim failed");
  return store.acknowledge({ requestId: id, kind: "saveLoan", leaseId: claim.value.operation.leaseId!, revision }, guard);
}

beforeEach(async () => { now = baseNow; await deleteDatabase(); });

describe("private account storage", () => {
  it("starts locked on construction and reload, then unlocks only from explicit online context", async () => {
    const first = storage();
    expect(await first.readState()).toEqual({ kind: "locked", reason: "not-unlocked" });
    expect(await first.unlock({ profileId: "a", sessionId: "s", authEpoch: 1, verifiedOnline: false as true })).toEqual({ kind: "invalid", code: "invalid_account_context" });
    await first.unlock(context("a"));
    const guard = first.captureGuard()!;
    expect(guard).toBeTruthy();
    const reloaded = storage();
    expect(await reloaded.readState()).toEqual({ kind: "locked", reason: "not-unlocked" });
  });

  it("reopens a pre-provenance queued payload with a blank reset without changing its receipt hash", async () => {
    const first = storage();
    await first.unlock(context("legacy-queue"));
    const stamp = createdAt();
    const id = requestId("32");
    const oldHash = legacyHash(["saveLoan", 0, new Date(stamp).getTime(), legacyPayloadJsonWithBlankReset].join("|"));
    // Unlock does not create a partition until the first write. Seed one with
    // the upgraded writer, then replace only the outbox bytes with a frozen
    // pre-provenance record.
    await first.queueSaveLoan({ requestId: id, expectedRevision: 0, createdAt: stamp, payload }, first.captureGuard()!);
    await updateRawPartition("legacy-queue", (record) => {
      record.outbox = [{ requestId: id, kind: "saveLoan", expectedRevision: 0, createdAt: stamp, payloadJson: legacyPayloadJsonWithBlankReset, payloadHash: oldHash, status: "queued", attempts: 0, nextAttemptAt: new Date(stamp).getTime(), leaseId: null, leaseUntil: null, pauseReason: null, lastErrorCode: null }];
    });
    const reloaded = storage();
    await reloaded.unlock(context("legacy-queue"));
    const state = await reloaded.readState();
    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.value.outbox[0].payloadHash).toBe(oldHash);
    expect(JSON.parse(state.value.outbox[0].payloadJson!).loan.lastResetProvenance).toBeUndefined();
    const claim = await reloaded.claimNext(reloaded.captureGuard()!, true);
    expect(claim.kind).toBe("ok");
  });

  it("isolates A and B by opaque profile partition and never uses a caller account argument", async () => {
    const a = storage(); const b = storage();
    await a.unlock(context("profile-a")); await b.unlock(context("profile-b"));
    const ga = a.captureGuard()!; const gb = b.captureGuard()!;
    await saveAndAck(a, ga, requestId("10"));
    expect((await b.readState(gb)).kind).toBe("ok");
    expect(((await b.readState(gb)) as { kind: "ok"; value: { cachedLoan: unknown } }).value.cachedLoan).toBeNull();
    const forged = await a.readState({ ...ga, profileId: "profile-b" });
    expect(forged.kind).toBe("locked");
  });

  it("lets two active profiles reuse one request id without crossing partitions", async () => {
    const a = storage(); const b = storage(); await a.unlock(context("a")); await b.unlock(context("b"));
    const id = requestId("11");
    expect((await a.queueSaveLoan({ requestId: id, expectedRevision: 0, createdAt: createdAt(), payload })).kind).toBe("ok");
    expect((await b.queueSaveLoan({ requestId: id, expectedRevision: 0, createdAt: createdAt(), payload })).kind).toBe("ok");
    expect(((await a.readState()) as unknown as { kind: "ok"; value: { outbox: unknown[] } }).value.outbox).toHaveLength(1);
    expect(((await b.readState()) as unknown as { kind: "ok"; value: { outbox: unknown[] } }).value.outbox).toHaveLength(1);
  });

  it("claims one queued item once across two independent connections", async () => {
    const one = storage(); const two = storage(); await one.unlock(context("race")); await two.unlock(context("race"));
    await one.queueSaveLoan({ requestId: requestId("12"), expectedRevision: 0, createdAt: createdAt(), payload });
    const [left, right] = await Promise.all([one.claimNext(undefined, true), two.claimNext(undefined, true)]);
    expect([left.kind, right.kind].sort()).toEqual(["not-found", "ok"]);
  });

  it("atomically rejects two tabs trying to append against the same revision", async () => {
    const one = storage(); const two = storage(); await one.unlock(context("append-race")); await two.unlock(context("append-race"));
    const results = await Promise.all([
      one.queueSaveLoan({ requestId: requestId("90"), expectedRevision: 0, createdAt: createdAt(), payload }),
      two.queueDeleteLoan({ requestId: requestId("91"), expectedRevision: 0, createdAt: createdAt() }),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(["invalid", "ok"]);
    expect(results.find((result) => result.kind === "invalid")).toEqual({ kind: "invalid", code: "queue_changed" });
    const state = await one.readState();
    if (state.kind !== "ok") throw new Error("state unavailable");
    expect(state.value.outbox).toHaveLength(1);
    expect(state.value.outbox[0].expectedRevision).toBe(0);
  });

  it("recovers an expired lease with a new lease id", async () => {
    const store = storage(); await store.unlock(context("lease")); const guard = store.captureGuard()!;
    await store.queueSaveLoan({ requestId: requestId("13"), expectedRevision: 0, createdAt: createdAt(), payload }, guard);
    const first = await store.claimNext(guard, true); expect(first.kind).toBe("ok");
    if (first.kind !== "ok") throw new Error("claim failed");
    now += 30_001;
    const recovered = await store.claimNext(guard, true);
    expect(recovered.kind).toBe("ok");
    if (recovered.kind === "ok") expect(recovered.value.operation.leaseId).not.toBe(first.value.operation.leaseId);
  });

  it("rolls back a failed IndexedDB mutation without losing the sending operation", async () => {
    const store = storage(); await store.unlock(context("rollback")); const guard = store.captureGuard()!;
    await store.queueSaveLoan({ requestId: requestId("14"), expectedRevision: 0, createdAt: createdAt(), payload }, guard);
    const claim = await store.claimNext(guard, true); expect(claim.kind).toBe("ok");
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) { this.transaction.abort(); return originalPut.apply(this, args); };
    if (claim.kind !== "ok") throw new Error("claim failed");
    try { expect((await store.recordTransientFailure(requestId("14"), claim.value.operation.leaseId!, "temporary", guard)).kind).toBe("storage-unavailable"); }
    finally { IDBObjectStore.prototype.put = originalPut; }
    const state = await store.readState(guard);
    expect(state.kind).toBe("ok");
    if (state.kind === "ok") expect(state.value.outbox[0].status).toBe("sending");
  });

  it("rejects stale guards after lock or account switch and keeps the later account clean", async () => {
    const store = storage(); await store.unlock(context("old")); const oldGuard = store.captureGuard()!;
    await store.queueSaveLoan({ requestId: requestId("15"), expectedRevision: 0, createdAt: createdAt(), payload }, oldGuard);
    await store.unlock(context("new", "new-session", 2));
    expect(await store.acknowledge({ requestId: requestId("15"), kind: "saveLoan", leaseId: requestId("lease"), revision: 1 }, oldGuard)).toEqual({ kind: "locked", reason: "stale-callback" });
    const current = await store.readState();
    expect(current.kind).toBe("ok");
    if (current.kind === "ok") expect(current.value).toEqual({ revision: 0, cachedLoan: null, outbox: [] });
  });

  it("keeps retries stable and pauses permanent conflicts", async () => {
    const store = storage(); await store.unlock(context("retry")); const guard = store.captureGuard()!; const id = requestId("16"); const stamp = createdAt();
    expect((await store.queueSaveLoan({ requestId: id, expectedRevision: 0, createdAt: stamp, payload }, guard)).kind).toBe("ok");
    expect((await store.queueSaveLoan({ requestId: id, expectedRevision: 0, createdAt: stamp, payload }, guard)).kind).toBe("ok");
    expect((await store.queueSaveLoan({ requestId: id, expectedRevision: 1, createdAt: stamp, payload }, guard)).kind).toBe("invalid");
    const claim = await store.claimNext(guard, true);
    expect(claim.kind).toBe("ok");
    if (claim.kind !== "ok") throw new Error("claim failed");
    expect((await store.pauseOperation(id, claim.value.operation.leaseId!, "conflict", guard)).kind).toBe("ok");
    expect((await store.claimNext(guard, true)).kind).toBe("not-found");
  });

  it("retains an unsynced request as expired after the seven-day replay window", async () => {
    const store = storage(); await store.unlock(context("age")); const guard = store.captureGuard()!;
    await store.queueDeleteLoan({ requestId: requestId("17"), expectedRevision: 0, createdAt: createdAt() }, guard);
    now += 7 * 24 * 60 * 60 * 1000 + 1;
    expect(await store.claimNext(guard, true)).toEqual({ kind: "expired", requestId: requestId("17") });
    const state = await store.readState(guard);
    if (state.kind === "ok") { expect(state.value.outbox).toHaveLength(1); expect(state.value.outbox[0].pauseReason).toBe("expired"); }
  });

  it("does not change anything when discard is cancelled, and clears only after confirmation", async () => {
    const store = storage(); await store.unlock(context("discard")); const guard = store.captureGuard()!;
    await saveAndAck(store, guard, requestId("18"));
    expect(await store.confirmDiscardFormerMember(guard, false)).toEqual({ kind: "cancelled" });
    expect((await store.readState(guard)).kind).toBe("ok");
    expect((await store.confirmDiscardFormerMember(guard, true)).kind).toBe("discarded");
    expect(store.isUnlocked()).toBe(false);
    const reloaded = storage(); await reloaded.unlock(context("discard"));
    expect((await reloaded.readState()) as unknown as { kind: "ok"; value: { cachedLoan: unknown; outbox: unknown[]; revision: number } }).toEqual({ kind: "ok", value: { cachedLoan: null, outbox: [], revision: 0 } });
  });

  it("persists a discard generation so an already-open second tab cannot write back", async () => {
    const first = storage(); const second = storage(); const untouched = storage();
    await first.unlock(context("shared", "tab-a")); await second.unlock(context("shared", "tab-b")); await untouched.unlock(context("other"));
    const firstGuard = first.captureGuard()!; const secondGuard = second.captureGuard()!;
    await saveAndAck(first, firstGuard, requestId("20"));
    await first.applyServerState({ revision: 1, payload }, firstGuard);
    await second.queueSaveLoan({ requestId: requestId("21"), expectedRevision: 1, createdAt: createdAt(), payload }, secondGuard);
    const staleClaim = await second.claimNext(secondGuard, true);
    expect(staleClaim.kind).toBe("ok");
    expect((await first.confirmDiscardFormerMember(firstGuard, true)).kind).toBe("discarded");
    expect((await second.queueDeleteLoan({ requestId: requestId("22"), expectedRevision: 0, createdAt: createdAt() }, secondGuard)).kind).toBe("locked");
    if (staleClaim.kind === "ok") expect((await second.acknowledge({ requestId: requestId("21"), kind: "saveLoan", leaseId: staleClaim.value.operation.leaseId!, revision: 2 }, secondGuard)).kind).toBe("locked");
    expect(((await untouched.readState()) as unknown as { kind: "ok"; value: { revision: number } }).value.revision).toBe(0);
  });

  it("does not revive a guard across lock and unlock with the same account context", async () => {
    const store = storage(); await store.unlock(context("aba")); const oldGuard = store.captureGuard()!;
    store.lock(); await store.unlock(context("aba")); const newGuard = store.captureGuard()!;
    expect(await store.readState(oldGuard)).toEqual({ kind: "locked", reason: "stale-callback" });
    expect((await store.readState(newGuard)).kind).toBe("ok");
  });

  it("pauses after the bounded retry cap and rejects stale server projections", async () => {
    const store = storage(); await store.unlock(context("cap")); const guard = store.captureGuard()!; const id = requestId("22");
    await store.queueSaveLoan({ requestId: id, expectedRevision: 0, createdAt: createdAt(), payload }, guard);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const claim = await store.claimNext(guard, true); expect(claim.kind).toBe("ok");
      if (claim.kind !== "ok") throw new Error("claim failed");
      expect((await store.recordTransientFailure(id, claim.value.operation.leaseId!, "network", guard)).kind).toBe("ok");
      now += 60_001;
    }
    const state = await store.readState(guard);
    expect(state.kind).toBe("ok");
    if (state.kind === "ok") expect(state.value.outbox[0].pauseReason).toBe("retry-exhausted");
    expect((await store.applyServerState({ revision: 2, payload: null }, guard)).kind).toBe("ok");
    expect((await store.applyServerState({ revision: 1, payload }, guard)).kind).toBe("invalid");
    const finalState = await store.readState(guard);
    expect(finalState.kind).toBe("ok");
    if (finalState.kind === "ok") expect(finalState.value.cachedLoan).toBeNull();
  });

  it("does not exceed the retry cap through repeated crash lease recovery", async () => {
    const store = storage(); await store.unlock(context("crash-cap")); const guard = store.captureGuard()!; const id = requestId("26");
    await store.queueSaveLoan({ requestId: id, expectedRevision: 0, createdAt: createdAt(), payload }, guard);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const claim = await store.claimNext(guard, true);
      expect(claim.kind).toBe("ok");
      now += 30_001;
    }
    expect((await store.claimNext(guard, true)).kind).toBe("not-found");
    const state = await store.readState(guard);
    if (state.kind === "ok") expect(state.value.outbox[0].pauseReason).toBe("retry-exhausted");
  });

  it("rejects stale failure and pause callbacks after another tab reclaims the lease", async () => {
    const first = storage(); const second = storage(); await first.unlock(context("lease-callback")); await second.unlock(context("lease-callback"));
    const guard = first.captureGuard()!; const secondGuard = second.captureGuard()!; const id = requestId("27");
    await first.queueSaveLoan({ requestId: id, expectedRevision: 0, createdAt: createdAt(), payload }, guard);
    const oldClaim = await first.claimNext(guard, true); expect(oldClaim.kind).toBe("ok");
    if (oldClaim.kind !== "ok") throw new Error("claim failed");
    now += 30_001;
    const newClaim = await second.claimNext(secondGuard, true); expect(newClaim.kind).toBe("ok");
    if (newClaim.kind !== "ok") throw new Error("reclaim failed");
    expect((await first.recordTransientFailure(id, oldClaim.value.operation.leaseId!, "network", guard)).kind).toBe("invalid");
    expect((await first.pauseOperation(id, oldClaim.value.operation.leaseId!, "conflict", guard)).kind).toBe("invalid");
  });

  it("drops a held-open transaction when lock and same-context unlock happen during the await", async () => {
    const store = storage(); await store.unlock(context("held-open")); const guard = store.captureGuard()!;
    const originalGet = IDBObjectStore.prototype.get;
    let holdNext = true;
    let release: () => void = () => undefined;
    let readyResolve!: () => void;
    const intercepted = new Promise<void>((resolve) => { readyResolve = resolve; });
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore["get"]>) {
      const request = originalGet.apply(this, args);
      return new Proxy(request, {
        set(target, property, value) {
          if (property === "onsuccess" && holdNext) {
            holdNext = false;
            target.onsuccess = (event) => { release = () => { (value as (event: Event) => void).call(target, event); }; readyResolve(); };
            return true;
          }
          return Reflect.set(target, property, value);
        },
      });
    };
    try {
      const pending = store.readState(guard);
      await intercepted;
      store.lock();
      await store.unlock(context("held-open"));
      release();
      expect(await pending).toEqual({ kind: "locked", reason: "stale-callback" });
    } finally { IDBObjectStore.prototype.get = originalGet; }
  });

  it("stores validated queue fields even when the caller mutates them while IndexedDB is awaiting", async () => {
    const store = storage(); await store.unlock(context("mutable")); const guard = store.captureGuard()!;
    const originalGet = IDBObjectStore.prototype.get;
    let holdNext = true;
    IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore["get"]>) {
      const request = originalGet.apply(this, args);
      return new Proxy(request, { set(target, property, value) { if (property === "onsuccess" && holdNext) { holdNext = false; target.onsuccess = (event) => { input.expectedRevision = 99; input.createdAt = new Date(now - 1_000).toISOString(); input.payload.loan.lender = "Mutated after validation"; (value as (event: Event) => void).call(target, event); }; return true; } return Reflect.set(target, property, value); } });
    };
    const input = { requestId: requestId("31"), expectedRevision: 0, createdAt: createdAt(), payload: structuredClone(payload) };
    try {
      const pending = store.queueSaveLoan(input, guard);
      expect((await pending).kind).toBe("ok");
    } finally { IDBObjectStore.prototype.get = originalGet; }
    const state = await store.readState(guard);
    if (state.kind === "ok") { expect(state.value.outbox[0].expectedRevision).toBe(0); expect(JSON.parse(state.value.outbox[0].payloadJson!).loan.lender).toBe("Example Bank"); }
  });

  it("rejects malformed oversized and duplicate persisted operations before unlock", async () => {
    const store = storage(); await store.unlock(context("malformed")); const guard = store.captureGuard()!;
    await store.queueSaveLoan({ requestId: requestId("28"), expectedRevision: 0, createdAt: createdAt(), payload }, guard);
    await updateRawPartition("malformed", (record) => { record.outbox[0].payloadJson = "x".repeat(20_001); });
    const oversized = storage();
    expect((await oversized.unlock(context("malformed"))).kind).toBe("storage-unavailable");

    const duplicateStore = storage(); await duplicateStore.unlock(context("duplicate")); const duplicateGuard = duplicateStore.captureGuard()!;
    await duplicateStore.queueSaveLoan({ requestId: requestId("29"), expectedRevision: 0, createdAt: createdAt(), payload }, duplicateGuard);
    await duplicateStore.queueSaveLoan({ requestId: requestId("30"), expectedRevision: 1, createdAt: createdAt(), payload }, duplicateGuard);
    await updateRawPartition("duplicate", (record) => { record.outbox[1].requestId = record.outbox[0].requestId; });
    const duplicate = storage();
    expect((await duplicate.unlock(context("duplicate"))).kind).toBe("storage-unavailable");
  });

  it("applies an acknowledgement atomically and removes the operation only after the matching lease", async () => {
    const store = storage(); await store.unlock(context("ack")); const guard = store.captureGuard()!;
    await store.queueSaveLoan({ requestId: requestId("19"), expectedRevision: 0, createdAt: createdAt(), payload }, guard);
    const claim = await store.claimNext(guard, true); expect(claim.kind).toBe("ok");
    if (claim.kind !== "ok") throw new Error("claim failed");
    expect(await store.acknowledge({ requestId: requestId("19"), kind: "saveLoan", leaseId: requestId("wrong"), revision: 1 }, guard)).toEqual({ kind: "invalid", code: "ack_mismatch" });
    expect(await store.acknowledge({ requestId: requestId("19"), kind: "saveLoan", leaseId: claim.value.operation.leaseId!, revision: 2 }, guard)).toEqual({ kind: "invalid", code: "ack_mismatch" });
    expect((await store.applyServerState({ revision: 1, payload }, guard)).kind).toBe("ok");
    expect((await store.acknowledge({ requestId: requestId("19"), kind: "saveLoan", leaseId: claim.value.operation.leaseId!, revision: 1 }, guard)).kind).toBe("ok");
    const state = await store.readState(guard);
    expect(state.kind).toBe("ok");
    if (state.kind === "ok") { expect(state.value.revision).toBe(1); expect(state.value.cachedLoan?.payload.loan.lender).toBe("Example Bank"); expect(state.value.outbox).toHaveLength(0); }
  });

  it("treats historical acknowledgements as receipts and never lets them restore the current cache", async () => {
    const store = storage(); await store.unlock(context("history")); const guard = store.captureGuard()!;
    await store.queueSaveLoan({ requestId: requestId("24"), expectedRevision: 0, createdAt: createdAt(), payload }, guard);
    const first = await store.claimNext(guard, true); expect(first.kind).toBe("ok");
    if (first.kind !== "ok") throw new Error("claim failed");
    await store.acknowledge({ requestId: requestId("24"), kind: "saveLoan", leaseId: first.value.operation.leaseId!, revision: 1 }, guard);
    let state = await store.readState(guard);
    if (state.kind === "ok") { expect(state.value.cachedLoan).toBeNull(); expect(state.value.revision).toBe(0); }

    await store.queueSaveLoan({ requestId: requestId("25"), expectedRevision: 0, createdAt: createdAt(), payload }, guard);
    const second = await store.claimNext(guard, true); expect(second.kind).toBe("ok");
    if (second.kind !== "ok") throw new Error("claim failed");
    await store.applyServerState({ revision: 2, payload: null }, guard);
    await store.acknowledge({ requestId: requestId("25"), kind: "saveLoan", leaseId: second.value.operation.leaseId!, revision: 1 }, guard);
    state = await store.readState(guard);
    if (state.kind === "ok") { expect(state.value.cachedLoan).toBeNull(); expect(state.value.revision).toBe(2); }
  });

  it("rejects a non-null payload at absent revision zero", async () => {
    const store = storage(); await store.unlock(context("zero")); const guard = store.captureGuard()!;
    expect(await store.applyServerState({ revision: 0, payload }, guard)).toEqual({ kind: "invalid", code: "invalid_revision" });
  });
});
