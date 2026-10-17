import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBObjectStore, indexedDB } from "fake-indexeddb";
import { compareOffers } from "../lib/finance/comparison";
import { createComparisonSnapshot } from "../lib/contracts/snapshot";
import { ComparisonWorkspace, COMPARISON_PRIVATE_DB } from "../lib/comparison/private-workspace";
import { PRIVATE_DB_NAME, PrivateStorage } from "../lib/private-storage/storage";
import { runDeletionRecoveryCleanup } from "../lib/privacy/deletion-recovery-cleanup";
import type { DeletionJournalRecord } from "../lib/privacy/deletion-journal";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const payload = {
  loan: { lender: "Example Bank", original: 2_000_000, outstanding: 1_650_000, ratePct: 8.5, basis: "repo" as const, spreadPct: 2.75, cycle: "quarterly" as const, lastReset: "", monthsLeft: 214 },
  quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5_000, keepTenure: true, newTenureMonths: 214 },
  surplus: 100_000, bufferMonths: 6, rateResolvedAt: null,
};
const offers = [
  { id: "offer-a", lender: "Example Bank", loanType: "home" as const, amount: 2_000_000, ratePct: 8.5, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.35 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "financed" as const, otherFees: [] },
  { id: "offer-b", lender: "Second Bank", loanType: "home" as const, amount: 2_000_000, ratePct: 8.6, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.35 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "financed" as const, otherFees: [] },
];
const snapshot = createComparisonSnapshot(offers, compareOffers(offers), { createdAt: "2026-09-17T12:00:00.000Z" });
const draft = { loanType: "home" as const, offers };
const journal: DeletionJournalRecord = { version: 1, requestId: REQUEST_ID, grantId: "grant-1", subject: "subject-a", sessionId: "session-a", createdAt: Date.now(), phase: "accepted" };

function context(profileId: string, subject = `subject-${profileId}`, sessionId = `session-${profileId}`) {
  return { profileId, subject, sessionId, authEpoch: 1, verifiedOnline: true as const };
}
function access(profileId: string) {
  const current = context(profileId);
  return { identity: current, getToken: async () => "token", isCurrent: () => true };
}
async function deleteDatabase(name: string) {
  await new Promise<void>((resolve) => { const req = indexedDB.deleteDatabase(name); req.onsuccess = () => resolve(); req.onerror = () => resolve(); req.onblocked = () => resolve(); });
}
async function seed(profileId: string) {
  const store = new PrivateStorage({ indexedDB });
  await store.unlock(context(profileId));
  const guard = store.captureGuard()!;
  await store.applyServerState({ revision: 1, payload }, guard);
  await store.queueSaveLoan({ requestId: `00000000-0000-4000-8000-${profileId === "owner-a" ? "000000000101" : "000000000102"}`, expectedRevision: 1, createdAt: new Date().toISOString(), payload }, guard);
  const workspace = new ComparisonWorkspace({ access: access(profileId), tabId: `tab-${profileId}`, indexedDB });
  await workspace.open();
  await workspace.setWorking({ draft, snapshot });
  await workspace.queueSave({ snapshot, source: "member", requestId: `00000000-0000-4000-8000-${profileId === "owner-a" ? "000000000201" : "000000000202"}` });
  return { store, workspace, guard };
}

beforeEach(async () => { await deleteDatabase(PRIVATE_DB_NAME); await deleteDatabase(COMPARISON_PRIVATE_DB); });
afterEach(async () => { await deleteDatabase(PRIVATE_DB_NAME); await deleteDatabase(COMPARISON_PRIVATE_DB); });

describe("reload deletion cleanup", () => {
  it("clears only the validated former account and preserves generation fencing", async () => {
    const former = await seed("owner-a");
    const foreign = await seed("owner-b");
    const stale = new PrivateStorage({ indexedDB });
    await stale.unlock(context("owner-a"));
    const staleWorkspace = new ComparisonWorkspace({ access: access("owner-a"), tabId: "stale-tab", indexedDB });
    await staleWorkspace.open();
    const result = await runDeletionRecoveryCleanup({
      journal,
      getCurrentClerkSession: () => ({ subject: "subject-a", sessionId: "session-a" }),
      queryReceipt: async () => ({ requestId: REQUEST_ID, ownerId: "owner-a", status: "completed" }),
      privateIndexedDB: indexedDB,
      comparisonIndexedDB: indexedDB,
    });
    expect(result.kind).toBe("cleared");
    const reloaded = new PrivateStorage({ indexedDB });
    await reloaded.unlock(context("owner-a"));
    expect(await reloaded.readState()).toMatchObject({ kind: "ok", value: { revision: 0, cachedLoan: null, outbox: [] } });
    const reloadedForeign = new PrivateStorage({ indexedDB });
    await reloadedForeign.unlock(context("owner-b"));
    expect(await reloadedForeign.readState()).toMatchObject({ kind: "ok", value: { revision: 1, cachedLoan: { payload }, outbox: [{ status: "queued" }] } });
    expect(await stale.queueDeleteLoan({ requestId: "00000000-0000-4000-8000-000000000002", expectedRevision: 0, createdAt: new Date().toISOString() }, stale.captureGuard()!)).toEqual({ kind: "locked", reason: "stale-callback" });
    const reloadedWorkspace = new ComparisonWorkspace({ access: access("owner-a"), tabId: "tab-owner-a", indexedDB });
    await reloadedWorkspace.open();
    expect(reloadedWorkspace.current()).toMatchObject({ status: "ready", draft: null, snapshot: null, saves: [], deletions: [] });
    expect(await staleWorkspace.queueSave({ snapshot, source: "member", requestId: "00000000-0000-4000-8000-000000000003" })).toEqual({ kind: "error", code: "stale-callback" });
    const reloadedForeignWorkspace = new ComparisonWorkspace({ access: access("owner-b"), tabId: "tab-owner-b", indexedDB });
    await reloadedForeignWorkspace.open();
    expect(reloadedForeignWorkspace.current()).toMatchObject({ status: "ready", snapshot, saves: [{ status: "queued" }] });
    expect(former.workspace.current().snapshot).not.toBeNull();
    expect(foreign.workspace.current().snapshot).toEqual(snapshot);
  });

  it("does not write for a malformed, missing, or foreign receipt", async () => {
    await seed("owner-a");
    const malformed = await runDeletionRecoveryCleanup({ journal, getCurrentClerkSession: () => ({ subject: "subject-a", sessionId: "session-a" }), queryReceipt: async () => ({ requestId: REQUEST_ID, ownerId: "owner-a", status: "completed", secret: "nope" } as never), privateIndexedDB: indexedDB, comparisonIndexedDB: indexedDB });
    expect(malformed).toEqual({ kind: "skipped", reason: "invalid-receipt" });
    const missing = await runDeletionRecoveryCleanup({ journal, getCurrentClerkSession: () => ({ subject: "subject-a", sessionId: "session-a" }), queryReceipt: async () => null, privateIndexedDB: indexedDB, comparisonIndexedDB: indexedDB });
    expect(missing).toEqual({ kind: "skipped", reason: "missing-receipt" });
    const foreign = await runDeletionRecoveryCleanup({ journal, getCurrentClerkSession: () => ({ subject: "subject-b", sessionId: "session-b" }), queryReceipt: async () => ({ requestId: REQUEST_ID, ownerId: "owner-a", status: "completed" }), privateIndexedDB: indexedDB, comparisonIndexedDB: indexedDB });
    expect(foreign).toEqual({ kind: "skipped", reason: "foreign-session" });
    const untouched = new PrivateStorage({ indexedDB });
    await untouched.unlock(context("owner-a"));
    expect(await untouched.readState()).toMatchObject({ kind: "ok", value: { cachedLoan: { payload }, outbox: [{ status: "queued" }] } });
    const untouchedWorkspace = new ComparisonWorkspace({ access: access("owner-a"), tabId: "tab-owner-a", indexedDB });
    await untouchedWorkspace.open();
    expect(untouchedWorkspace.current()).toMatchObject({ status: "ready", snapshot, saves: [{ status: "queued" }] });
  });

  it("aborts when the account changes while the receipt is loading", async () => {
    await seed("owner-a");
    await seed("owner-b");
    let current = { subject: "subject-a", sessionId: "session-a" };
    const result = await runDeletionRecoveryCleanup({
      journal,
      getCurrentClerkSession: () => current,
      queryReceipt: async () => { current = { subject: "subject-b", sessionId: "session-b" }; return { requestId: REQUEST_ID, ownerId: "owner-a", status: "completed" as const }; },
      privateIndexedDB: indexedDB,
      comparisonIndexedDB: indexedDB,
    });
    expect(result).toEqual({ kind: "retry", reason: "runtime-changed" });
    const stillPresent = new PrivateStorage({ indexedDB });
    await stillPresent.unlock(context("owner-a"));
    expect(await stillPresent.readState()).toMatchObject({ kind: "ok", value: { cachedLoan: { payload } } });
  });

  it("aborts a private partition transaction when the session changes after its read", async () => {
    await seed("owner-a");
    await seed("owner-b");
    let current = { subject: "subject-a", sessionId: "session-a" };
    const options = {
      journal,
      getCurrentClerkSession: () => current,
      queryReceipt: async () => ({ requestId: REQUEST_ID, ownerId: "owner-a", status: "completed" as const }),
      privateIndexedDB: indexedDB,
      comparisonIndexedDB: indexedDB,
    };
    const originalGet = IDBObjectStore.prototype.get;
    const getSpy = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      const request = originalGet.call(this, key);
      if (this.transaction.db.name === "truecost-private-v1" && key === "owner-a") request.addEventListener("success", () => { current = { subject: "subject-b", sessionId: "session-b" }; });
      return request;
    });
    try {
      await expect(runDeletionRecoveryCleanup(options)).resolves.toEqual({ kind: "retry", reason: "runtime-changed" });
    } finally {
      getSpy.mockRestore();
    }
    const beforeRetry = new PrivateStorage({ indexedDB });
    await beforeRetry.unlock(context("owner-a"));
    expect(await beforeRetry.readState()).toMatchObject({ kind: "ok", value: { cachedLoan: { payload }, outbox: [{ status: "queued" }] } });
    current = { subject: "subject-a", sessionId: "session-a" };
    await expect(runDeletionRecoveryCleanup(options)).resolves.toMatchObject({ kind: "cleared" });
  });

  it("aborts a comparison transaction after its account read and leaves both accounts intact", async () => {
    await seed("owner-a");
    await seed("owner-b");
    let current = { subject: "subject-a", sessionId: "session-a" };
    const options = {
      journal,
      getCurrentClerkSession: () => current,
      queryReceipt: async () => ({ requestId: REQUEST_ID, ownerId: "owner-a", status: "completed" as const }),
      privateIndexedDB: indexedDB,
      comparisonIndexedDB: indexedDB,
    };
    const originalGet = IDBObjectStore.prototype.get;
    const getSpy = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      const request = originalGet.call(this, key);
      if (this.transaction.db.name === "truecost-private-comparisons-v1" && key === "account:owner-a") request.addEventListener("success", () => { current = { subject: "subject-b", sessionId: "session-b" }; });
      return request;
    });
    try {
      await expect(runDeletionRecoveryCleanup(options)).resolves.toEqual({ kind: "retry", reason: "runtime-changed" });
    } finally {
      getSpy.mockRestore();
    }
    const beforeRetry = new ComparisonWorkspace({ access: access("owner-a"), tabId: "tab-owner-a", indexedDB });
    await beforeRetry.open();
    expect(beforeRetry.current()).toMatchObject({ status: "ready", snapshot, saves: [{ status: "queued" }] });
    const foreignBeforeRetry = new ComparisonWorkspace({ access: access("owner-b"), tabId: "tab-owner-b", indexedDB });
    await foreignBeforeRetry.open();
    expect(foreignBeforeRetry.current()).toMatchObject({ status: "ready", snapshot, saves: [{ status: "queued" }] });
    current = { subject: "subject-a", sessionId: "session-a" };
    await expect(runDeletionRecoveryCleanup(options)).resolves.toMatchObject({ kind: "cleared" });
  });

  it("returns retry on server or partial storage failure, then clears on retry", async () => {
    await seed("owner-a");
    const options = { journal, getCurrentClerkSession: () => ({ subject: "subject-a", sessionId: "session-a" }), queryReceipt: async () => ({ requestId: REQUEST_ID, ownerId: "owner-a", status: "app_pending" as const }), privateIndexedDB: indexedDB, comparisonIndexedDB: { open: () => { throw new Error("unavailable"); } } as unknown as IDBFactory };
    await expect(runDeletionRecoveryCleanup(options)).resolves.toMatchObject({ kind: "retry", reason: "storage-failure" });
    options.comparisonIndexedDB = indexedDB;
    await expect(runDeletionRecoveryCleanup(options)).resolves.toMatchObject({ kind: "cleared" });
    await expect(runDeletionRecoveryCleanup({ ...options, queryReceipt: async () => { throw new Error("offline"); } })).resolves.toEqual({ kind: "retry", reason: "server-failure" });
  });
});
