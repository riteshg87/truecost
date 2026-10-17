import { describe, expect, it } from "vitest";
import { IDBObjectStore, indexedDB } from "fake-indexeddb";
import { createComparisonSnapshot } from "../lib/contracts/snapshot";
import { compareOffers } from "../lib/finance/comparison";
import type { Offer } from "../lib/finance/types";
import { commitFirstGuestSnapshot, createIndexedDbBackend, GUEST_DB_NAME, readGuestState } from "../lib/guest/storage";
import type { GuestStateBackend, GuestStoredRecord } from "../lib/guest/types";

const offer = (id: string, ratePct: number): Offer => ({
  id,
  lender: id.toUpperCase(),
  loanType: "home",
  amount: 5_000_000,
  ratePct,
  rateType: "reducing",
  rateStructure: "floating",
  tenureValue: 20,
  tenureUnit: "years",
  processingFee: { mode: "percent", value: 0.35 },
  gstPct: 18,
  insurancePremium: 0,
  insuranceFunding: "financed",
  otherFees: [{ id: `${id}-other`, label: "Other fees", amount: 0 }],
});

function snapshot(rate = 8.5) {
  const offers = [offer("a", rate), offer("b", rate + 0.1)];
  return createComparisonSnapshot(offers, compareOffers(offers), { createdAt: "2026-09-15T10:00:00.000Z" });
}

class TransactionalMemoryBackend implements GuestStateBackend {
  record: GuestStoredRecord | null = null;
  failWrite = false;
  async read() { return this.record; }
  async create(record: GuestStoredRecord) {
    await Promise.resolve();
    if (this.failWrite) throw new Error("quota");
    if (this.record) return false;
    this.record = structuredClone(record);
    return true;
  }
}

describe("guest IndexedDB state contract", () => {
  it("uses two independent IndexedDB connections against the shared database", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(GUEST_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    const [first, second] = await Promise.all([
      commitFirstGuestSnapshot(createIndexedDbBackend(indexedDB), snapshot()),
      commitFirstGuestSnapshot(createIndexedDbBackend(indexedDB), snapshot(8.6)),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(["requires-auth", "saved"]);
    const reloaded = await readGuestState(createIndexedDbBackend(indexedDB));
    expect(reloaded.kind).toBe("saved");
    expect(reloaded.snapshot?.offers[0]?.ratePct).toBe(8.5);
  });

  it("rolls back an actual aborted transaction and permits a later retry", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(GUEST_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: any[]) {
      this.transaction.abort();
      return originalAdd.apply(this, args as any);
    };
    let failed;
    try {
      failed = await commitFirstGuestSnapshot(createIndexedDbBackend(indexedDB), snapshot());
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    expect(failed.kind).toBe("storage-unavailable");
    expect((await readGuestState(createIndexedDbBackend(indexedDB))).kind).toBe("empty");
    expect((await commitFirstGuestSnapshot(createIndexedDbBackend(indexedDB), snapshot())).kind).toBe("saved");
  });

  it("serializes two tab completions and spends the allowance once", async () => {
    const backend = new TransactionalMemoryBackend();
    const [first, second] = await Promise.all([commitFirstGuestSnapshot(backend, snapshot()), commitFirstGuestSnapshot(backend, snapshot(8.6))]);
    expect([first.kind, second.kind].sort()).toEqual(["requires-auth", "saved"]);
    expect((await readGuestState(backend)).kind).toBe("saved");
    expect(backend.record?.allowanceSpent).toBe(true);
  });

  it("replays the unchanged immutable snapshot and gates a second calculation", async () => {
    const backend = new TransactionalMemoryBackend();
    const original = snapshot();
    expect((await commitFirstGuestSnapshot(backend, original)).kind).toBe("saved");
    const loaded = await readGuestState(backend);
    expect(loaded.snapshot && JSON.stringify(loaded.snapshot)).toBe(JSON.stringify(original));
    const changed = await commitFirstGuestSnapshot(backend, snapshot(9));
    expect(changed.kind).toBe("requires-auth");
    expect(backend.record && JSON.parse(backend.record.snapshotJson).offers[0].ratePct).toBe(8.5);
  });

  it("keeps an invalid record visible as a recoverable state", async () => {
    const backend = new TransactionalMemoryBackend();
    backend.record = { version: 1, snapshotJson: "{\"bad\":true}", committedAt: "2026-09-15T10:00:00.000Z", allowanceSpent: true };
    const state = await readGuestState(backend);
    expect(state).toMatchObject({ kind: "invalid", persisted: true, reason: "invalid-record" });
  });

  it("does not consume the allowance when the transaction fails", async () => {
    const backend = new TransactionalMemoryBackend();
    backend.failWrite = true;
    const result = await commitFirstGuestSnapshot(backend, snapshot());
    expect(result.kind).toBe("storage-unavailable");
    expect(backend.record).toBeNull();
  });

  it("rejects malformed snapshots before a backend write", async () => {
    const backend = new TransactionalMemoryBackend();
    const malformed = { ...snapshot(), resultId: "bad" };
    await expect(commitFirstGuestSnapshot(backend, malformed as any)).rejects.toThrow();
    expect(backend.record).toBeNull();
  });
});
