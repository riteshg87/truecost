import "fake-indexeddb/auto";
import { IDBObjectStore, indexedDB } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import { compareOffers } from "../lib/finance/comparison";
import { createComparisonSnapshot } from "../lib/contracts/snapshot";
import { captureDeletionCleanup } from "../lib/privacy/deletion-cleanup";
import { COMPARISON_PRIVATE_DB, ComparisonWorkspace } from "../lib/comparison/private-workspace";
import { PRIVATE_DB_NAME, PrivateStorage } from "../lib/private-storage/storage";
import type { SavedLoanPayload } from "../lib/contracts/saved-loan";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const createdAt = new Date(NOW).toISOString();
const payload: SavedLoanPayload = {
  loan: { lender: "Example Bank", original: 2_000_000, outstanding: 1_650_000, ratePct: 8.5, basis: "repo", spreadPct: 2.75, cycle: "quarterly", lastReset: "", monthsLeft: 214 },
  quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5_000, keepTenure: true, newTenureMonths: 214 },
  surplus: 100_000, bufferMonths: 6, rateResolvedAt: null,
};

function identity(profileId: string, sessionId = `session-${profileId}`, authEpoch = 1) {
  return { profileId, subject: `subject-${profileId}`, sessionId, authEpoch, verifiedOnline: true as const };
}

function setupAccess(profileId: string, current: () => boolean = () => true): PrivateSessionAccess {
  return { identity: identity(profileId), getToken: vi.fn(async () => "token"), isCurrent: current };
}

function storage() {
  return new PrivateStorage({ indexedDB, now: () => NOW });
}

function workspace(access: PrivateSessionAccess, tabId: string) {
  return new ComparisonWorkspace({ access, tabId, indexedDB, now: () => NOW });
}

function comparisonFixture() {
  const offers = [
    { id: "offer-a", lender: "Example Bank", loanType: "home" as const, amount: 2_000_000, ratePct: 8.5, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.35 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "financed" as const, otherFees: [] },
    { id: "offer-b", lender: "Second Bank", loanType: "home" as const, amount: 2_000_000, ratePct: 8.6, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.35 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "financed" as const, otherFees: [] },
  ];
  const draft = { loanType: "home" as const, offers };
  const snapshot = createComparisonSnapshot(offers, compareOffers(offers), { createdAt });
  return { draft, snapshot };
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

async function prepare(profileId: string, tabId: string, access = setupAccess(profileId), seedComparison = true) {
  const privateStorage = storage();
  const comparisonWorkspace = workspace(access, tabId);
  await expect(privateStorage.unlock({ ...identity(profileId) })).resolves.toMatchObject({ kind: "ok" });
  await expect(comparisonWorkspace.open()).resolves.toMatchObject({ kind: "ok" });
  const guard = privateStorage.captureGuard();
  if (!guard) throw new Error("private storage did not unlock");
  await expect(privateStorage.applyServerState({ revision: 1, payload }, guard)).resolves.toMatchObject({ kind: "ok" });
  await expect(privateStorage.queueDeleteLoan({ requestId: `00000000-0000-4000-8000-${profileId === "former" ? "000000000101" : "000000000102"}`, expectedRevision: 1, createdAt }, guard)).resolves.toMatchObject({ kind: "ok" });
  const comparison = comparisonFixture();
  await expect(comparisonWorkspace.setWorking(comparison)).resolves.toMatchObject({ kind: "ok" });
  if (seedComparison) {
    await expect(comparisonWorkspace.queueSave({ snapshot: comparison.snapshot, source: "member", requestId: `00000000-0000-4000-8000-${profileId === "former" ? "000000000201" : "000000000202"}` })).resolves.toMatchObject({ kind: "ok" });
  }
  return { access, privateStorage, comparisonWorkspace, guard, comparison };
}

beforeEach(async () => {
  await deleteDatabase(PRIVATE_DB_NAME);
  await deleteDatabase(COMPARISON_PRIVATE_DB);
});

afterEach(async () => {
  await deleteDatabase(PRIVATE_DB_NAME);
  await deleteDatabase(COMPARISON_PRIVATE_DB);
});

describe("account-bound browser deletion cleanup", () => {
  it("captures only from a current verified session with explicit confirmation", async () => {
    const prepared = await prepare("capture", "tab-a");
    expect(captureDeletionCleanup({ ...prepared, confirmed: false })).toBeNull();
    const revoked = setupAccess("capture", () => false);
    expect(captureDeletionCleanup({ ...prepared, access: revoked, confirmed: true })).toBeNull();
    expect(captureDeletionCleanup({ ...prepared, confirmed: true })).not.toBeNull();
  });

  it("clears the captured partitions after revocation and never calls a server", async () => {
    let current = true;
    const access = setupAccess("former", () => current);
    const prepared = await prepare("former", "tab-a", access);
    const capability = captureDeletionCleanup({ ...prepared, confirmed: true });
    expect(capability).not.toBeNull();
    current = false;
    prepared.privateStorage.lock();
    prepared.comparisonWorkspace.close();
    await expect(capability!.run()).resolves.toEqual({ kind: "cleared" });
    await expect(capability!.run()).resolves.toEqual({ kind: "cleared" });

    const reloaded = storage();
    await reloaded.unlock({ ...identity("former") });
    const reloadedState = await reloaded.readState();
    expect(reloadedState).toMatchObject({ kind: "ok", value: { cachedLoan: null, outbox: [], revision: 0 } });
    const reloadedWorkspace = workspace(setupAccess("former"), "tab-a");
    await reloadedWorkspace.open();
    expect(reloadedWorkspace.current()).toMatchObject({ status: "ready", draft: null, snapshot: null, saves: [] });
    expect(access.getToken).not.toHaveBeenCalled();
  });

  it("preserves a foreign account and fences an old tab after the generation tombstone", async () => {
    const former = await prepare("former", "tab-a");
    const stale = await prepare("former", "tab-old", setupAccess("former"), false);
    const foreign = await prepare("foreign", "tab-b");
    const foreignGuard = foreign.guard;
    const capability = captureDeletionCleanup({ ...former, confirmed: true });
    expect(capability).not.toBeNull();
    await expect(capability!.run()).resolves.toEqual({ kind: "cleared" });

    await expect(foreign.privateStorage.readState(foreignGuard)).resolves.toMatchObject({ kind: "ok", value: { cachedLoan: { payload } } });
    expect(foreign.comparisonWorkspace.current()).toMatchObject({
      status: "ready",
      draft: foreign.comparison.draft,
      snapshot: foreign.comparison.snapshot,
      saves: [{ status: "queued" }],
    });
    await expect(stale.privateStorage.queueDeleteLoan({ requestId: "00000000-0000-4000-8000-000000000001", expectedRevision: 0, createdAt }, stale.guard)).resolves.toEqual({ kind: "locked", reason: "stale-callback" });
    await expect(stale.comparisonWorkspace.queueSave({ snapshot: stale.comparison.snapshot, source: "member", requestId: "00000000-0000-4000-8000-000000000003" })).resolves.toEqual({ kind: "error", code: "stale-callback" });
  });

  it("cleans the captured account when its storage runtime has switched accounts", async () => {
    const former = await prepare("former", "tab-a");
    const capability = captureDeletionCleanup({ ...former, confirmed: true });
    expect(capability).not.toBeNull();
    const newContext = identity("new", "new-session", 2);
    await expect(former.privateStorage.unlock(newContext)).resolves.toMatchObject({ kind: "ok" });
    const current = former.privateStorage.captureGuard();
    expect(current?.profileId).toBe("new");
    await expect(former.privateStorage.applyServerState({ revision: 1, payload }, current!)).resolves.toMatchObject({ kind: "ok" });

    await expect(capability!.run()).resolves.toEqual({ kind: "cleared" });
    await expect(former.privateStorage.readState(current!)).resolves.toMatchObject({ kind: "ok", value: { cachedLoan: { payload }, outbox: [], revision: 1 } });
    const formerReloaded = storage();
    await formerReloaded.unlock({ ...identity("former") });
    await expect(formerReloaded.readState()).resolves.toMatchObject({ kind: "ok", value: { cachedLoan: null, outbox: [], revision: 0 } });
  });

  it("returns retry on transaction failure and succeeds on the next attempt", async () => {
    const prepared = await prepare("retry", "tab-a");
    const capability = captureDeletionCleanup({ ...prepared, confirmed: true });
    expect(capability).not.toBeNull();
    prepared.privateStorage.lock();
    prepared.comparisonWorkspace.close();
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      this.transaction.abort();
      return originalPut.apply(this, args);
    };
    try {
      await expect(capability!.run()).resolves.toMatchObject({ kind: "retry" });
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    await expect(capability!.run()).resolves.toEqual({ kind: "cleared" });
  });
});
