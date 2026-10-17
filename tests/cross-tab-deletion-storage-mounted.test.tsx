// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import type { TransportIdentity } from "../lib/private-storage/transport";
import type { SavedLoanPayload } from "../lib/contracts/saved-loan";
import { compareOffers } from "../lib/finance/comparison";
import { createComparisonSnapshot } from "../lib/contracts/snapshot";
import { ComparisonWorkspace, COMPARISON_PRIVATE_DB } from "../lib/comparison/private-workspace";
import { LoanProvider, useLoan } from "../lib/loanStore";
import { CompareProvider, useCompare } from "../lib/store";
import { PrivateStorage, PRIVATE_DB_NAME } from "../lib/private-storage/storage";
import {
  DELETION_SIGNAL_KEY,
  getAccountDeletionCleanupScope,
  getAccountDeletionCleanupSnapshot,
  subscribeToAccountDeletionSignal,
} from "../lib/privacy/deletion-signal";

const mocks = vi.hoisted(() => ({
  auth: null as unknown as AuthValue,
  savedLoanTransport: vi.fn(),
  comparisonTransport: vi.fn(),
  historyTransport: vi.fn(),
}));
let testIndexedDB: IDBFactory;

vi.mock("../lib/auth/provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("../lib/auth/config", () => ({ AUTH_CONFIG: { convexUrl: "https://test.convex.cloud" } }));
vi.mock("../lib/private-storage/transport", () => ({
  createSessionBoundSavedLoanTransport: (...args: unknown[]) => mocks.savedLoanTransport(...args),
}));
vi.mock("../lib/comparison/transport", () => ({
  createSessionBoundComparisonTransport: (...args: unknown[]) => mocks.comparisonTransport(...args),
}));
vi.mock("../lib/comparison/history-transport", () => ({
  createSessionBoundComparisonHistoryTransport: (...args: unknown[]) => mocks.historyTransport(...args),
}));

const createdAt = new Date().toISOString();
const payload: SavedLoanPayload = {
  loan: { lender: "Synthetic Bank", original: 2_000_000, outstanding: 1_650_000, ratePct: 8.5, basis: "repo", spreadPct: 2.75, cycle: "quarterly", lastReset: "", monthsLeft: 214 },
  quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5_000, keepTenure: true, newTenureMonths: 214 },
  surplus: 100_000, bufferMonths: 6, rateResolvedAt: null,
};
const offers = [
  { id: "offer-a", lender: "Synthetic Bank", loanType: "home" as const, amount: 2_000_000, ratePct: 8.5, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.35 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "financed" as const, otherFees: [] },
  { id: "offer-b", lender: "Other Bank", loanType: "home" as const, amount: 2_000_000, ratePct: 8.6, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.35 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "financed" as const, otherFees: [] },
];
const comparison = {
  draft: { loanType: "home" as const, offers },
  snapshot: createComparisonSnapshot(offers, compareOffers(offers), { createdAt }),
};

function makeAccess(profileId: string, active: Set<string>): PrivateSessionAccess {
  const identity: TransportIdentity = { profileId, subject: `subject-${profileId}`, sessionId: `session-${profileId}`, authEpoch: 1, verifiedOnline: true };
  return { identity, getToken: vi.fn(async () => null), isCurrent: () => active.has(profileId) };
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = testIndexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function seed(profileId: string, access: PrivateSessionAccess): Promise<void> {
  const storage = new PrivateStorage({ indexedDB: testIndexedDB });
  await expect(storage.unlock({ ...access.identity })).resolves.toMatchObject({ kind: "ok" });
  const guard = storage.captureGuard();
  if (!guard) throw new Error("loan guard was not captured");
  await expect(storage.applyServerState({ revision: 1, payload }, guard)).resolves.toMatchObject({ kind: "ok" });
  await expect(storage.queueSaveLoan({ requestId: `00000000-0000-4000-8000-${profileId === "account-a" ? "000000000101" : "000000000102"}`, expectedRevision: 1, createdAt, payload }, guard)).resolves.toMatchObject({ kind: "ok" });
  storage.lock();

  const workspace = new ComparisonWorkspace({ access, tabId: `seed-${profileId}`, indexedDB: testIndexedDB });
  await expect(workspace.open()).resolves.toMatchObject({ kind: "ok" });
  await expect(workspace.setWorking(comparison)).resolves.toMatchObject({ kind: "ok" });
  await expect(workspace.queueSave({ snapshot: comparison.snapshot, source: "member", requestId: `00000000-0000-4000-8000-${profileId === "account-a" ? "000000000201" : "000000000202"}`, createdAt })).resolves.toMatchObject({ kind: "ok" });
  workspace.close();
}

function Probe() {
  const loan = useLoan();
  const compare = useCompare();
  return <div>
    <output data-testid="loan-hydrated">{String(loan.hydrated)}</output>
    <output data-testid="loan">{loan.loan?.lender ?? "none"}</output>
    <output data-testid="compare-hydrated">{String(compare.hydrated)}</output>
    <output data-testid="compare">{compare.snapshot?.offers[0]?.lender ?? "none"}</output>
  </div>;
}

function tree() {
  return <StrictMode><CompareProvider><LoanProvider><Probe /></LoanProvider></CompareProvider></StrictMode>;
}

describe("mounted cross-tab account deletion storage cleanup", () => {
  beforeEach(async () => {
    cleanup();
    testIndexedDB = new IDBFactory();
    vi.stubGlobal("indexedDB", testIndexedDB);
    vi.stubGlobal("BroadcastChannel", undefined);
    await deleteDatabase(PRIVATE_DB_NAME);
    await deleteDatabase(COMPARISON_PRIVATE_DB);
    const active = new Set(["account-a", "account-b"]);
    const accessA = makeAccess("account-a", active);
    const accessB = makeAccess("account-b", active);
    mocks.auth = { privateSession: accessA, viewer: "member", ready: true, initiatingTabId: "seed-account-a" } as AuthValue;
    mocks.savedLoanTransport.mockReset().mockReturnValue({ currentLoan: vi.fn(), saveLoan: vi.fn(), deleteLoan: vi.fn() });
    mocks.comparisonTransport.mockReset().mockReturnValue({ saveComparison: vi.fn() });
    mocks.historyTransport.mockReset().mockReturnValue({ deleteComparison: vi.fn() });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await seed("account-a", accessA);
    await seed("account-b", accessB);
  });

  afterEach(async () => {
    cleanup();
    await deleteDatabase(PRIVATE_DB_NAME);
    await deleteDatabase(COMPARISON_PRIVATE_DB);
    vi.unstubAllGlobals();
  });

  it("clears A through the storage fallback, fences stale writes, and preserves B", async () => {
    const active = new Set(["account-a", "account-b"]);
    // Reuse the seeded A identity so its captured capability is the one the
    // mounted providers register. The mocked auth is switched below only by
    // the signal callback, representing the auth provider's revoke effect.
    const accessA = makeAccess("account-a", active);
    mocks.auth = { privateSession: accessA, viewer: "member", ready: true, initiatingTabId: "seed-account-a" } as AuthValue;
    const scope = getAccountDeletionCleanupScope(accessA);
    if (!scope) throw new Error("A scope was not captured");
    const staleStorage = new PrivateStorage({ indexedDB: testIndexedDB });
    await staleStorage.unlock({ ...accessA.identity });
    const staleGuard = staleStorage.captureGuard();
    expect(staleGuard).not.toBeNull();
    const staleWorkingWorkspace = new ComparisonWorkspace({ access: accessA, tabId: "stale-working-a", indexedDB: testIndexedDB });
    const staleSaveWorkspace = new ComparisonWorkspace({ access: accessA, tabId: "stale-save-a", indexedDB: testIndexedDB });
    await expect(staleWorkingWorkspace.open()).resolves.toMatchObject({ kind: "ok" });
    await expect(staleSaveWorkspace.open()).resolves.toMatchObject({ kind: "ok" });
    const view = render(tree());
    await waitFor(() => {
      expect(screen.getByTestId("loan-hydrated").textContent).toBe("true");
      expect(screen.getByTestId("compare-hydrated").textContent).toBe("true");
    });
    expect(screen.getByTestId("loan").textContent).toBe("Synthetic Bank");
    expect(screen.getByTestId("compare").textContent).toBe("Synthetic Bank");

    const revoke = vi.fn(() => {
      active.delete("account-a");
      mocks.auth = { ...mocks.auth, privateSession: null, viewer: "anonymous" } as AuthValue;
      view.rerender(tree());
    });
    const subscription = subscribeToAccountDeletionSignal({ access: accessA, onRevoke: revoke });
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: DELETION_SIGNAL_KEY, newValue: JSON.stringify({ type: "account-deletion", profileId: "account-a" }) }));
    });
    expect(revoke).toHaveBeenCalledOnce();
    expect(getAccountDeletionCleanupSnapshot(scope).status).toBe("pending");
    await waitFor(() => expect(getAccountDeletionCleanupSnapshot(scope).status).toBe("cleared"));
    expect(active.has("account-a")).toBe(false);
    expect(accessA.getToken).not.toHaveBeenCalled();
    expect(mocks.savedLoanTransport.mock.results[0]?.value?.currentLoan).not.toHaveBeenCalled();
    expect(mocks.savedLoanTransport.mock.results[0]?.value?.saveLoan).not.toHaveBeenCalled();
    expect(mocks.savedLoanTransport.mock.results[0]?.value?.deleteLoan).not.toHaveBeenCalled();
    expect(mocks.comparisonTransport.mock.results[0]?.value?.saveComparison).not.toHaveBeenCalled();
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(screen.getByTestId("compare").textContent).toBe("none");

    const reloadedA = new PrivateStorage({ indexedDB: testIndexedDB });
    await reloadedA.unlock({ ...accessA.identity });
    await expect(reloadedA.readState()).resolves.toMatchObject({ kind: "ok", value: { cachedLoan: null, outbox: [] } });
    reloadedA.lock();
    const reloadedAAccess = makeAccess("account-a", new Set(["account-a"]));
    const reloadedAWorkspace = new ComparisonWorkspace({ access: reloadedAAccess, tabId: "seed-account-a", indexedDB: testIndexedDB });
    await expect(reloadedAWorkspace.open()).resolves.toMatchObject({ kind: "ok" });
    expect(reloadedAWorkspace.current()).toMatchObject({ draft: null, snapshot: null, saves: [], deletions: [] });
    reloadedAWorkspace.close();

    await expect(staleStorage.queueSaveLoan({ requestId: "00000000-0000-4000-8000-000000000301", expectedRevision: 1, createdAt, payload }, staleGuard!)).resolves.toEqual({ kind: "locked", reason: "stale-callback" });
    staleStorage.lock();
    await expect(staleWorkingWorkspace.setWorking(comparison)).resolves.toEqual({ kind: "error", code: "locked" });
    await expect(staleSaveWorkspace.queueSave({ snapshot: comparison.snapshot, source: "member", requestId: "00000000-0000-4000-8000-000000000302", createdAt })).resolves.toEqual({ kind: "error", code: "locked" });
    staleWorkingWorkspace.close();
    staleSaveWorkspace.close();
    const afterStaleA = new PrivateStorage({ indexedDB: testIndexedDB });
    await afterStaleA.unlock({ ...accessA.identity });
    await expect(afterStaleA.readState()).resolves.toMatchObject({ kind: "ok", value: { cachedLoan: null, outbox: [] } });
    afterStaleA.lock();
    const afterStaleAWorkspace = new ComparisonWorkspace({ access: makeAccess("account-a", new Set(["account-a"])), tabId: "seed-account-a", indexedDB: testIndexedDB });
    await expect(afterStaleAWorkspace.open()).resolves.toMatchObject({ kind: "ok" });
    expect(afterStaleAWorkspace.current()).toMatchObject({ draft: null, snapshot: null, saves: [], deletions: [] });
    afterStaleAWorkspace.close();

    const accessB = makeAccess("account-b", active);
    mocks.auth = { privateSession: accessB, viewer: "member", ready: true, initiatingTabId: "seed-account-b" } as AuthValue;
    view.rerender(tree());
    await waitFor(() => expect(screen.getByTestId("loan-hydrated").textContent).toBe("true"));
    expect(screen.getByTestId("loan").textContent).toBe("Synthetic Bank");
    expect(screen.getByTestId("compare").textContent).toBe("Synthetic Bank");
    const reloadedB = new PrivateStorage({ indexedDB: testIndexedDB });
    await reloadedB.unlock({ ...accessB.identity });
    await expect(reloadedB.readState()).resolves.toMatchObject({ kind: "ok", value: { cachedLoan: { payload }, outbox: [{ status: "queued" }] } });
    reloadedB.lock();
    const reloadedBWorkspace = new ComparisonWorkspace({ access: makeAccess("account-b", new Set(["account-b"])), tabId: "seed-account-b", indexedDB: testIndexedDB });
    await expect(reloadedBWorkspace.open()).resolves.toMatchObject({ kind: "ok" });
    expect(reloadedBWorkspace.current()).toMatchObject({ draft: comparison.draft, snapshot: comparison.snapshot, saves: [{ status: "queued" }] });
    reloadedBWorkspace.close();
    subscription.stop();
  });
});
