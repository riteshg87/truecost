import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareOffers } from "../lib/finance/comparison";
import { createComparisonSnapshot } from "../lib/contracts/snapshot";
import {
  ComparisonWorkspace,
  COMPARISON_PRIVATE_DB,
  openComparisonDatabase,
} from "../lib/comparison/private-workspace";
import {
  PRIVATE_DB_NAME,
  PRIVATE_META_STORE_NAME,
  PRIVATE_STORE_NAME,
  PrivateStorage,
  openPrivateDatabase,
} from "../lib/private-storage/storage";
import { clearAllMemberPrivateBrowserData } from "../lib/privacy/private-browser-clear";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import type { SavedLoanPayload } from "../lib/contracts/saved-loan";

const now = Date.parse("2026-09-17T12:00:00.000Z");
const payload: SavedLoanPayload = {
  loan: { lender: "Example Bank", original: 2_000_000, outstanding: 1_650_000, ratePct: 8.5, basis: "repo", spreadPct: 2.75, cycle: "quarterly", lastReset: "", monthsLeft: 214 },
  quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5_000, keepTenure: true, newTenureMonths: 214 },
  surplus: 100_000,
  bufferMonths: 6,
  rateResolvedAt: null,
};

function access(profileId: string, current: () => boolean = () => true): PrivateSessionAccess {
  return {
    identity: { profileId, subject: `subject-${profileId}`, sessionId: `session-${profileId}`, authEpoch: 1, verifiedOnline: true },
    getToken: vi.fn(async () => "token"),
    isCurrent: current,
  };
}

function offer(id: string, ratePct: number) {
  return { id, lender: `Lender ${id}`, loanType: "home" as const, amount: 5_000_000, ratePct, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.35 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "financed" as const, otherFees: [] };
}

function snapshot() {
  const offers = [offer("a", 8.5), offer("b", 8.6)];
  return createComparisonSnapshot(offers, compareOffers(offers), { createdAt: new Date(now).toISOString() });
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

async function seedGuestDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("truecost-public-guest-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("guest", { keyPath: "key" });
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("guest", "readwrite");
      tx.objectStore("guest").put({ key: "guest-result", value: "keep" });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function readGuest(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("truecost-public-guest-v1");
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("guest", "readonly").objectStore("guest").get("guest-result");
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function readPrivateRows(): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PRIVATE_DB_NAME);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("partitions", "readonly").objectStore("partitions").getAll();
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function readComparisonRows(): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(COMPARISON_PRIVATE_DB);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("partitions", "readonly").objectStore("partitions").getAll();
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  });
}

afterEach(async () => {
  await deleteDatabase(PRIVATE_DB_NAME);
  await deleteDatabase(COMPARISON_PRIVATE_DB);
  await deleteDatabase("truecost-public-guest-v1");
});

describe("explicit browser private-data clear", () => {
  it("cancels without opening storage and preserves guest data", async () => {
    await seedGuestDatabase();
    const open = vi.fn();
    const result = await clearAllMemberPrivateBrowserData({ confirmed: false, isCurrent: () => true, privateIndexedDB: { open } as unknown as IDBFactory, comparisonIndexedDB: { open } as unknown as IDBFactory });
    expect(result).toEqual({ kind: "cancelled" });
    expect(open).not.toHaveBeenCalled();
    expect(await readGuest()).toMatchObject({ key: "guest-result", value: "keep" });
  });

  it("upgrades v1 private records in place and closes old connections on version change", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(PRIVATE_DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(PRIVATE_STORE_NAME, { keyPath: "partitionKey" });
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(PRIVATE_STORE_NAME, "readwrite");
        tx.objectStore(PRIVATE_STORE_NAME).put({ version: 1, partitionKey: "legacy", generation: 3, revision: 0, cachedLoan: null, outbox: [] });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    const runtime = new PrivateStorage({ indexedDB, now: () => now });
    expect((await runtime.unlock(access("legacy").identity)).kind).toBe("ok");
    expect((await runtime.readState(runtime.captureGuard()!)).kind).toBe("ok");
    const db = await openPrivateDatabase(indexedDB);
    expect(db.objectStoreNames.contains(PRIVATE_META_STORE_NAME)).toBe(true);
    const close = vi.spyOn(db, "close");
    db.onversionchange?.({} as IDBVersionChangeEvent);
    expect(close).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("creates the comparison metadata store without changing existing account rows", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(COMPARISON_PRIVATE_DB, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("partitions", { keyPath: "key" });
        store.createIndex("by_profile", "profileId", { unique: false });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("partitions", "readwrite");
        tx.objectStore("partitions").put({ kind: "account", key: "account:legacy", profileId: "legacy", generation: 2, saves: [], deletions: [] });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
    const db = await openComparisonDatabase(indexedDB);
    expect(db.objectStoreNames.contains("browserMeta")).toBe(true);
    const get = db.transaction("partitions", "readonly").objectStore("partitions").get("account:legacy");
    await new Promise<void>((resolve, reject) => { get.onsuccess = () => { expect(get.result.generation).toBe(2); resolve(); }; get.onerror = () => reject(get.error); });
    db.close();
  });

  it("clears every member partition, fences old writers, and allows a new verified runtime", async () => {
    const a = new PrivateStorage({ indexedDB, now: () => now });
    const b = new PrivateStorage({ indexedDB, now: () => now });
    await a.unlock(access("a").identity);
    await b.unlock(access("b").identity);
    const guardA = a.captureGuard()!;
    const guardB = b.captureGuard()!;
    await a.queueSaveLoan({ requestId: "00000000-0000-4000-8000-000000000001", expectedRevision: 0, createdAt: new Date(now).toISOString(), payload }, guardA);
    await b.queueSaveLoan({ requestId: "00000000-0000-4000-8000-000000000002", expectedRevision: 0, createdAt: new Date(now).toISOString(), payload }, guardB);
    const comparisonA = new ComparisonWorkspace({ access: access("a"), tabId: "tab-a", indexedDB, now: () => now });
    const comparisonB = new ComparisonWorkspace({ access: access("b"), tabId: "tab-b", indexedDB, now: () => now });
    await Promise.all([comparisonA.open(), comparisonB.open()]);
    expect(await comparisonA.setWorking({ draft: { loanType: "home", offers: [offer("a", 8.5), offer("a2", 8.6)] }, snapshot: snapshot() })).toEqual({ kind: "ok", value: undefined });
    expect(await comparisonB.setWorking({ draft: { loanType: "home", offers: [offer("b", 8.6), offer("b2", 8.7)] }, snapshot: snapshot() })).toEqual({ kind: "ok", value: undefined });
    expect((await comparisonA.queueSave({ snapshot: snapshot(), source: "member", requestId: "00000000-0000-4000-8000-000000000011" })).kind).toBe("ok");
    expect((await comparisonB.queueSave({ snapshot: snapshot(), source: "member", requestId: "00000000-0000-4000-8000-000000000012" })).kind).toBe("ok");
    expect((await readPrivateRows()).length).toBe(2);
    expect((await readComparisonRows()).length).toBeGreaterThanOrEqual(4);
    const result = await clearAllMemberPrivateBrowserData({ confirmed: true, isCurrent: () => true, privateIndexedDB: indexedDB, comparisonIndexedDB: indexedDB });
    expect(result.kind).toBe("cleared");
    expect((await readPrivateRows())).toEqual([]);
    expect((await readComparisonRows())).toEqual([]);
    expect((await a.queueSaveLoan({ requestId: "00000000-0000-4000-8000-000000000003", expectedRevision: 0, createdAt: new Date(now).toISOString(), payload }, guardA)).kind).toBe("locked");
    expect((await b.queueSaveLoan({ requestId: "00000000-0000-4000-8000-000000000005", expectedRevision: 0, createdAt: new Date(now).toISOString(), payload }, guardB)).kind).toBe("locked");
    expect(await comparisonA.setWorking({ draft: { loanType: "home", offers: [offer("a", 8.5), offer("a2", 8.6)] }, snapshot: null })).toEqual({ kind: "error", code: "stale-callback" });
    expect(await comparisonB.setWorking({ draft: { loanType: "home", offers: [offer("b", 8.6), offer("b2", 8.7)] }, snapshot: null })).toEqual({ kind: "error", code: "stale-callback" });
    const fresh = new PrivateStorage({ indexedDB, now: () => now });
    expect((await fresh.unlock(access("a").identity)).kind).toBe("ok");
    expect((await fresh.queueSaveLoan({ requestId: "00000000-0000-4000-8000-000000000004", expectedRevision: 0, createdAt: new Date(now).toISOString(), payload }, fresh.captureGuard()!)).kind).toBe("ok");
  });

  it("returns retry after the first database commits and leaves the second for a safe retry", async () => {
    const workspace = new ComparisonWorkspace({ access: access("pending"), tabId: "tab-pending", indexedDB, now: () => now });
    await workspace.open();
    expect(await workspace.setWorking({ draft: { loanType: "home", offers: [offer("pending", 8.5), offer("pending2", 8.6)] }, snapshot: snapshot() })).toEqual({ kind: "ok", value: undefined });
    expect((await workspace.queueSave({ snapshot: snapshot(), source: "member", requestId: "00000000-0000-4000-8000-000000000099" })).kind).toBe("ok");
    expect((await readComparisonRows()).length).toBeGreaterThan(0);
    const failingComparison = { open: vi.fn(() => { throw new Error("offline"); }) } as unknown as IDBFactory;
    const first = await clearAllMemberPrivateBrowserData({ confirmed: true, isCurrent: () => true, privateIndexedDB: indexedDB, comparisonIndexedDB: failingComparison });
    expect(first).toEqual({ kind: "retry", reason: "storage-unavailable", completed: ["loan"] });
    expect((await readComparisonRows()).length).toBeGreaterThan(0);
    const second = await clearAllMemberPrivateBrowserData({ confirmed: true, isCurrent: () => true, privateIndexedDB: indexedDB, comparisonIndexedDB: indexedDB });
    expect(second.kind).toBe("cleared");
  });

  it("aborts before the second database when the caller guard changes", async () => {
    let current = true;
    const comparisonFactory = { open: (...args: Parameters<IDBFactory["open"]>) => { current = false; return indexedDB.open(...args); } } as unknown as IDBFactory;
    const result = await clearAllMemberPrivateBrowserData({ confirmed: true, isCurrent: () => current, privateIndexedDB: indexedDB, comparisonIndexedDB: comparisonFactory });
    expect(result).toEqual({ kind: "retry", reason: "runtime-changed", completed: ["loan"] });
  });

  it("fences an already-open comparison workspace and preserves guest storage", async () => {
    await seedGuestDatabase();
    const workspace = new ComparisonWorkspace({ access: access("a"), tabId: "tab-a", indexedDB, now: () => now });
    await workspace.open();
    expect(await workspace.setWorking({ draft: { loanType: "home", offers: [offer("a", 8.5), offer("a2", 8.6)] }, snapshot: snapshot() })).toEqual({ kind: "ok", value: undefined });
    const result = await clearAllMemberPrivateBrowserData({ confirmed: true, isCurrent: () => true, privateIndexedDB: indexedDB, comparisonIndexedDB: indexedDB });
    expect(result.kind).toBe("cleared");
    expect((await workspace.setWorking({ draft: { loanType: "home", offers: [offer("a", 8.5)] }, snapshot: null })).kind).toBe("error");
    expect(await readGuest()).toMatchObject({ key: "guest-result", value: "keep" });
  });
});
