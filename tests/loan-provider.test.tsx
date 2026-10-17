// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import type { TransportIdentity } from "../lib/private-storage/transport";
import type { SavedLoanTransport } from "../lib/private-storage/sync";
import type { SavedLoanPayload } from "../lib/contracts/saved-loan";
import { PrivateStorage } from "../lib/private-storage/storage";
import { LoanProvider, useLoan } from "../lib/loanStore";

const mocks = vi.hoisted(() => ({
  auth: null as unknown as { privateSession: PrivateSessionAccess | null },
  transportFactory: vi.fn(),
}));

vi.mock("../lib/auth/provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("../lib/auth/config", () => ({ AUTH_CONFIG: { convexUrl: "https://test.convex.cloud" } }));
vi.mock("../lib/private-storage/transport", () => ({ createSessionBoundSavedLoanTransport: mocks.transportFactory }));

const id = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const loan = { lender: "", original: 2_000_000, outstanding: 1_800_000, ratePct: 8.5, basis: "repo", spreadPct: 2.5, cycle: "quarterly", lastReset: "2026-01-01", monthsLeft: 120 } as const;
const renderLog: Array<{ scope: string; loan: string; quote: string; dirty: string }> = [];

function session(profileId: string, sessionId = `${profileId}-session`, authEpoch = 1): PrivateSessionAccess {
  const identity: TransportIdentity = { profileId, sessionId, authEpoch, verifiedOnline: true, subject: `${profileId}-subject` };
  return { identity, getToken: async () => "token", isCurrent: () => mocks.auth.privateSession?.identity === identity };
}

function Probe() {
  const value = useLoan();
  renderLog.push({ scope: value.scopeKey ?? "none", loan: value.loan?.outstanding ? String(value.loan.outstanding) : "none", quote: String(value.quote.newRatePct), dirty: String(value.draftDirty) });
  return <div>
    <output data-testid="hydrated">{String(value.hydrated)}</output>
    <output data-testid="scope">{value.scopeKey ?? "none"}</output>
    <output data-testid="status">{value.sync.status}</output>
    <output data-testid="pending">{String(value.sync.pendingCount)}</output>
    <output data-testid="draft-dirty">{String(value.draftDirty)}</output>
    <output data-testid="legacy-available">{String(value.legacyDeviceLoanAvailable)}</output>
    <output data-testid="legacy-state">{value.legacyDeviceLoanState}</output>
    <output data-testid="loan">{value.loan?.outstanding ?? "none"}</output>
    <output data-testid="quote">{value.quote.newRatePct}</output>
    <button onClick={() => void value.saveLoan(loan, { surplus: 100_000, bufferMonths: 8 }).then((result) => { document.body.dataset.saveResult = result.kind; })}>save</button>
    <button onClick={() => void value.setQuote({ newRatePct: 7.5 }).then((result) => { document.body.dataset.quoteResult = result.kind; })}>quote</button>
    <button onClick={() => void value.setQuote({ newRatePct: 8.25 }).then((result) => { document.body.dataset.quoteLaterResult = result.kind; })}>quote-later</button>
    <button onClick={() => void value.markRateResolved("2026-09-16T00:00:00.000Z").then((result) => { document.body.dataset.rateResult = result.kind; document.body.dataset.rateCode = result.kind === "invalid" ? result.code : result.kind === "locked" ? result.reason : ""; })}>mark-rate</button>
    <button onClick={() => void value.saveDraft().then((result) => { document.body.dataset.draftResult = result.kind; document.body.dataset.draftCode = result.kind === "invalid" ? result.code : result.kind === "locked" ? result.reason : ""; })}>save-draft</button>
    <button onClick={() => void value.retrySync().then((result) => { document.body.dataset.retryResult = result.kind; })}>retry</button>
    <button onClick={() => void value.clearAll().then((result) => { document.body.dataset.clearResult = result.kind; })}>clear</button>
    <button onClick={() => void value.discardPrivateData(false).then((result) => { document.body.dataset.discardCancel = result.kind; })}>discard-cancel</button>
     <button onClick={() => void value.discardPrivateData(true).then((result) => { document.body.dataset.discardConfirm = result.kind; })}>discard-confirm</button>
     <button onClick={() => void value.adoptLegacyDeviceLoan().then((result) => { document.body.dataset.legacyResult = result.kind; })}>adopt-legacy</button>
     <button onClick={() => value.keepLegacyDeviceLoan()}>keep-legacy</button>
     <button onClick={() => value.removeLegacyDeviceLoan()}>remove-legacy</button>
  </div>;
}

function makeTransport(initial: { revision: number; payload: SavedLoanPayload | null } = { revision: 0, payload: null }) {
  let state: { revision: number; payload: SavedLoanPayload | null } = initial;
  let currentError: unknown = null;
  const transport: SavedLoanTransport = {
    currentLoan: async () => { if (currentError) throw currentError; return state; },
    saveLoan: async (input) => { state = { revision: input.expectedRevision + 1, payload: input.payload }; return { requestId: input.requestId, kind: "saveLoan", revision: state.revision }; },
    deleteLoan: async (input) => { state = { revision: input.expectedRevision + 1, payload: null }; return { requestId: input.requestId, kind: "deleteLoan", revision: state.revision }; },
  };
  return { transport, state: () => state, setCurrentError: (error: unknown) => { currentError = error; } };
}

function renderProvider() { return render(<StrictMode><LoanProvider><Probe /></LoanProvider></StrictMode>); }
function renderProviderProduction() { return render(<LoanProvider><Probe /></LoanProvider>); }

beforeEach(async () => {
  cleanup();
  renderLog.length = 0;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("truecost-private-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  vi.clearAllMocks();
  mocks.auth = { privateSession: null };
  mocks.transportFactory.mockImplementation(() => makeTransport().transport);
  document.body.removeAttribute("data-save-result");
  document.body.removeAttribute("data-quote-result");
  document.body.removeAttribute("data-quote-later-result");
  document.body.removeAttribute("data-draft-result");
  document.body.removeAttribute("data-draft-code");
  document.body.removeAttribute("data-retry-result");
  document.body.removeAttribute("data-rate-result");
  document.body.removeAttribute("data-rate-code");
  document.body.removeAttribute("data-clear-result");
  document.body.removeAttribute("data-discard-cancel");
  document.body.removeAttribute("data-discard-confirm");
   document.body.removeAttribute("data-legacy-result");
  for (const key of Object.keys(localStorage)) if (key.startsWith("truecost.loan.adoption.v1:")) localStorage.removeItem(key);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  localStorage.setItem("truecost.loan.v1", JSON.stringify({ loan, quote: {}, surplus: 999, bufferMonths: 99, rateResolvedAt: null }));
});

afterEach(() => { vi.restoreAllMocks(); cleanup(); });

describe("account-bound LoanProvider", () => {
  it("starts blank and performs no private or legacy read without a verified session", async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(screen.getByTestId("status").textContent).toBe("locked");
    expect(mocks.transportFactory).not.toHaveBeenCalled();
    expect(localStorage.getItem("truecost.loan.v1")).not.toBeNull();
  });

  it("mounts an empty account in production mode without claiming a saved loan", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    mocks.auth.privateSession = session("empty-production");
    renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("pending").textContent).toBe("0");
  });

  it("offers legacy device data only after account verification and imports it explicitly", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    mocks.auth.privateSession = session("legacy-adopter");
    const view = renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    await waitFor(() => expect(screen.getByTestId("legacy-available").textContent).toBe("true"));
    expect(screen.getByTestId("loan").textContent).toBe("none");
    fireEvent.click(screen.getByText("adopt-legacy"));
    await waitFor(() => expect(document.body.dataset.legacyResult).toBe("ok"));
    expect(screen.getByTestId("legacy-state").textContent).toBe("adopted");
    expect(screen.getByTestId("loan").textContent).toBe("1800000");
    expect(h.state().payload?.loan.outstanding).toBe(1_800_000);
    expect(localStorage.getItem("truecost.loan.v1")).not.toBeNull();
    view.unmount();
    renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("legacy-state").textContent).toBe("adopted"));
    fireEvent.click(screen.getByText("remove-legacy"));
    await waitFor(() => expect(screen.getByTestId("legacy-state").textContent).toBe("removed"));
    expect(localStorage.getItem("truecost.loan.v1")).toBeNull();
  });

  it("keeps the legacy copy pending until the account save is acknowledged", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    const a = session("legacy-offline-adopter");
    mocks.auth.privateSession = a;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const view = renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    await waitFor(() => expect(screen.getByTestId("legacy-available").textContent).toBe("true"));
    fireEvent.click(screen.getByText("adopt-legacy"));
    await waitFor(() => expect(document.body.dataset.legacyResult).toBe("ok"));
    expect(screen.getByTestId("legacy-state").textContent).toBe("adopted-pending");
    expect(localStorage.getItem("truecost.loan.v1")).not.toBeNull();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    await waitFor(() => expect(screen.getByTestId("legacy-state").textContent).toBe("adopted"));
    expect(localStorage.getItem("truecost.loan.v1")).not.toBeNull();
    view.unmount();
    renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("legacy-state").textContent).toBe("adopted"));
  });

  it("does not bind an acknowledged adoption to a replacement device payload after reload", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    const a = session("replacement-guard");
    mocks.auth.privateSession = a;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const view = renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("legacy-available").textContent).toBe("true"));
    fireEvent.click(screen.getByText("adopt-legacy"));
    await waitFor(() => expect(screen.getByTestId("legacy-state").textContent).toBe("adopted-pending"));
    localStorage.setItem("truecost.loan.v1", JSON.stringify({ loan: { ...loan, outstanding: 1_700_000 }, quote: {}, surplus: 999, bufferMonths: 99, rateResolvedAt: null }));
    view.unmount();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    expect(screen.getByTestId("legacy-state").textContent).toBe("none");
    expect(localStorage.getItem("truecost.loan.v1")).not.toBeNull();
    expect(localStorage.getItem("truecost.loan.adoption.v1:replacement-guard")).toBeNull();
    expect(h.state().payload?.loan.outstanding).toBe(1_800_000);
  });

  it("keeps adoption metadata isolated when another account keeps its device copy", async () => {
    const aTransport = makeTransport();
    const bTransport = makeTransport();
    mocks.transportFactory.mockImplementation((options: { identity: TransportIdentity }) => options.identity.profileId === "legacy-a" ? aTransport.transport : bTransport.transport);
    const a = session("legacy-a");
    const b = session("legacy-b");
    mocks.auth.privateSession = a;
    const view = renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("legacy-available").textContent).toBe("true"));
    fireEvent.click(screen.getByText("adopt-legacy"));
    await waitFor(() => expect(screen.getByTestId("legacy-state").textContent).toBe("adopted"));
    expect(localStorage.getItem("truecost.loan.adoption.v1:legacy-a")).not.toBeNull();
    mocks.auth.privateSession = b;
    view.rerender(<LoanProvider><Probe /></LoanProvider>);
    await waitFor(() => expect(screen.getByTestId("legacy-available").textContent).toBe("true"));
    fireEvent.click(screen.getByText("keep-legacy"));
    expect(localStorage.getItem("truecost.loan.adoption.v1:legacy-a")).not.toBeNull();
    mocks.auth.privateSession = a;
    view.rerender(<LoanProvider><Probe /></LoanProvider>);
    await waitFor(() => expect(screen.getByTestId("legacy-state").textContent).toBe("adopted"));
    fireEvent.click(screen.getByText("remove-legacy"));
    await waitFor(() => expect(localStorage.getItem("truecost.loan.v1")).toBeNull());
  });

  it("shows blank immediately when account A is replaced by B before A opens", async () => {
    const aBase = makeTransport();
    const pendingA: Array<(state: { revision: number; payload: SavedLoanPayload | null }) => void> = [];
    const aTransport: SavedLoanTransport = { ...aBase.transport, currentLoan: () => new Promise((resolve) => pendingA.push(resolve)) };
    const a = session("profile-a");
    const b = session("profile-b");
    mocks.transportFactory.mockImplementation((options: { identity: TransportIdentity }) => options.identity.profileId === "profile-a" ? aTransport : makeTransport().transport);
    mocks.auth.privateSession = a;
    const view = renderProvider();
    await act(async () => { await Promise.resolve(); });
    mocks.auth.privateSession = b;
    view.rerender(<StrictMode><LoanProvider><Probe /></LoanProvider></StrictMode>);
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(screen.getByTestId("scope").textContent).toBe("profile-b:profile-b-session:1");
    for (const release of pendingA) release({ revision: 0, payload: null });
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(screen.getByTestId("loan").textContent).toBe("none");
  });

  it("opens a warm offline session, queues one complete payload, then acknowledges it online", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    const a = session("offline-profile");
    mocks.auth.privateSession = a;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(screen.getByTestId("status").textContent).toBe("ready");
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(document.body.dataset.saveResult).toBe("ok"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("1"));
    expect(screen.getByTestId("loan").textContent).toBe("1800000");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    expect(h.state().payload?.surplus).toBe(100_000);
    expect(h.state().payload?.bufferMonths).toBe(8);
  });

  it("clears a dirty A draft synchronously when the verified lifetime changes to B", async () => {
    const aTransport = makeTransport();
    const bTransport = makeTransport();
    mocks.transportFactory.mockImplementation((options: { identity: TransportIdentity }) => options.identity.profileId === "dirty-a" ? aTransport.transport : bTransport.transport);
    const a = session("dirty-a");
    const b = session("dirty-b");
    mocks.auth.privateSession = a;
    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(document.body.dataset.saveResult).toBe("ok"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    await waitFor(() => expect(screen.getByTestId("loan").textContent).toBe("1800000"));
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(screen.getByTestId("draft-dirty").textContent).toBe("true"));
    mocks.auth.privateSession = b;
    view.rerender(<StrictMode><LoanProvider><Probe /></LoanProvider></StrictMode>);
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(screen.getByTestId("draft-dirty").textContent).toBe("false");
    expect(screen.getByTestId("scope").textContent).toBe("dirty-b:dirty-b-session:1");
  });

  it("hides old dirty state on the first render of a fresh grant with the same identity", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    const firstGrant = session("fresh-grant");
    mocks.auth.privateSession = firstGrant;
    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    await waitFor(() => expect(screen.getByTestId("loan").textContent).toBe("1800000"));
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(screen.getByTestId("draft-dirty").textContent).toBe("true"));

    const freshGrant = session("fresh-grant");
    mocks.auth.privateSession = freshGrant;
    const beforeFreshRender = renderLog.length;
    view.rerender(<StrictMode><LoanProvider><Probe /></LoanProvider></StrictMode>);
    const firstFreshRender = renderLog.slice(beforeFreshRender).find((entry) => entry.scope === "fresh-grant:fresh-grant-session:1");
    expect(firstFreshRender).toEqual({ scope: "fresh-grant:fresh-grant-session:1", loan: "none", quote: "0", dirty: "false" });
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(screen.getByTestId("quote").textContent).toBe("0");
    expect(screen.getByTestId("draft-dirty").textContent).toBe("false");
  });

  it("keeps a newer quote draft while an earlier saveDraft transaction is delayed", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    const originalQueueSaveLoan = PrivateStorage.prototype.queueSaveLoan;
    let queueCalls = 0;
    let releaseSecond!: () => void;
    let secondStarted!: () => void;
    const secondCall = new Promise<void>((resolve) => { secondStarted = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    vi.spyOn(PrivateStorage.prototype, "queueSaveLoan").mockImplementation(async function (this: PrivateStorage, input, guard) {
      queueCalls += 1;
      if (queueCalls === 2) {
        secondStarted();
        await secondGate;
      }
      return originalQueueSaveLoan.call(this, input, guard);
    });
    mocks.auth.privateSession = session("delayed-draft");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("1"));
    await waitFor(() => expect(screen.getByTestId("loan").textContent).toBe("1800000"));
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(screen.getByTestId("quote").textContent).toBe("7.5"));
    fireEvent.click(screen.getByText("save-draft"));
    await secondCall;
    fireEvent.click(screen.getByText("quote-later"));
    await waitFor(() => expect(screen.getByTestId("quote").textContent).toBe("8.25"));
    releaseSecond();
    await waitFor(() => expect(document.body.dataset.draftResult).toBe("ok"));
    expect(screen.getByTestId("draft-dirty").textContent).toBe("true");
    expect(screen.getByTestId("quote").textContent).toBe("8.25");
  });

  it("does not let a delayed A discard clear or publish over B", async () => {
    const aTransport = makeTransport();
    const bTransport = makeTransport();
    const originalDiscard = PrivateStorage.prototype.confirmDiscardFormerMember;
    let releaseDiscard!: () => void;
    let discardStarted!: () => void;
    const discardCall = new Promise<void>((resolve) => { discardStarted = resolve; });
    const discardGate = new Promise<void>((resolve) => { releaseDiscard = resolve; });
    vi.spyOn(PrivateStorage.prototype, "confirmDiscardFormerMember").mockImplementation(async function (this: PrivateStorage, guard, confirmed) {
      discardStarted();
      await discardGate;
      return originalDiscard.call(this, guard, confirmed);
    });
    mocks.transportFactory.mockImplementation((options: { identity: TransportIdentity }) => options.identity.profileId === "discard-a" ? aTransport.transport : bTransport.transport);
    const a = session("discard-a");
    const b = session("discard-b");
    mocks.auth.privateSession = a;
    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    fireEvent.click(screen.getByText("discard-confirm"));
    await discardCall;

    mocks.auth.privateSession = b;
    view.rerender(<StrictMode><LoanProvider><Probe /></LoanProvider></StrictMode>);
    expect(screen.getByTestId("loan").textContent).toBe("none");
    releaseDiscard();
    await waitFor(() => expect(document.body.dataset.discardConfirm).toBe("locked"));
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(bTransport.state().payload).toBeNull();
  });

  it("clears dirty private fields and locks methods after currentLoan authorization failure", async () => {
    const h = makeTransport({
      revision: 1,
      payload: {
        loan,
        quote: { newRatePct: 0, feePct: 0.25, legalCharges: 5000, keepTenure: true, newTenureMonths: 240 },
        surplus: 100_000,
        bufferMonths: 8,
        rateResolvedAt: null,
      },
    });
    mocks.transportFactory.mockReturnValue(h.transport);
    mocks.auth.privateSession = session("unauthorized-refresh");
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    await waitFor(() => expect(screen.getByTestId("loan").textContent).toBe("1800000"));
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(screen.getByTestId("draft-dirty").textContent).toBe("true"));

    h.setCurrentError({ code: "unauthorized" });
    fireEvent.click(screen.getByText("retry"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("locked"));
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(screen.getByTestId("quote").textContent).toBe("0");
    expect(screen.getByTestId("draft-dirty").textContent).toBe("false");
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(document.body.dataset.quoteResult).toBe("invalid"));
    expect(screen.getByTestId("loan").textContent).toBe("none");
  });

  it("keeps confirmed discard safe while a production refresh is still in flight", async () => {
    const h = makeTransport();
    let currentCalls = 0;
    let releaseRefresh!: () => void;
    let refreshStarted!: () => void;
    const refreshCall = new Promise<void>((resolve) => { refreshStarted = resolve; });
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const transport: SavedLoanTransport = {
      ...h.transport,
      currentLoan: async () => {
        currentCalls += 1;
        if (currentCalls > 1) {
          refreshStarted();
          await refreshGate;
        }
        return h.state();
      },
    };
    mocks.transportFactory.mockReturnValue(transport);
    mocks.auth.privateSession = session("discard-refresh");
    renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    fireEvent.click(screen.getByText("retry"));
    await refreshCall;
    fireEvent.click(screen.getByText("discard-confirm"));
    await waitFor(() => expect(document.body.dataset.discardConfirm).toBe("ok"));
    expect(screen.getByTestId("status").textContent).toBe("locked");
    expect(screen.getByTestId("loan").textContent).toBe("none");
    releaseRefresh();
    await waitFor(() => expect(document.body.dataset.retryResult).toBe("locked"));
    expect(screen.getByTestId("loan").textContent).toBe("none");
  });

  it("coalesces concurrent refreshes for an empty production account", async () => {
    const h = makeTransport();
    let currentCalls = 0;
    let releaseRefresh!: () => void;
    let refreshStarted!: () => void;
    const refreshCall = new Promise<void>((resolve) => { refreshStarted = resolve; });
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const transport: SavedLoanTransport = {
      ...h.transport,
      currentLoan: async () => {
        currentCalls += 1;
        if (currentCalls > 1) {
          refreshStarted();
          await refreshGate;
        }
        return { revision: 0, payload: null };
      },
    };
    mocks.transportFactory.mockReturnValue(transport);
    mocks.auth.privateSession = session("empty-refresh");
    renderProviderProduction();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(screen.getByTestId("loan").textContent).toBe("none");
    fireEvent.click(screen.getByText("retry"));
    fireEvent.click(screen.getByText("retry"));
    await refreshCall;
    releaseRefresh();
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(currentCalls).toBe(2);
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(screen.getByTestId("pending").textContent).toBe("0");
  });

  it("keeps the same lifetime across rerenders and treats quote edits as a local draft", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    const a = session("stable-profile");
    mocks.auth.privateSession = a;
    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    // StrictMode may construct the memoized runtime twice during its probe;
    // the rerender itself must not create another lifetime.
    expect(mocks.transportFactory).toHaveBeenCalledTimes(2);
    expect(screen.getByText("quote")).toBeTruthy();
    expect(document.body.dataset.quoteResult).toBeUndefined();
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(document.body.dataset.quoteResult).toBe("invalid"));
    view.rerender(<StrictMode><LoanProvider><Probe /></LoanProvider></StrictMode>);
    expect(mocks.transportFactory).toHaveBeenCalledTimes(2);
  });

  it("rejects quote drafts until a saved loan exists, then saves the edited draft explicitly", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    mocks.auth.privateSession = session("draft-profile");
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(document.body.dataset.quoteResult).toBe("invalid"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(document.body.dataset.saveResult).toBe("ok"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    await waitFor(() => expect(screen.getByTestId("loan").textContent).toBe("1800000"));
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(document.body.dataset.quoteResult).toBe("ok"));
    await waitFor(() => expect(screen.getByTestId("quote").textContent).toBe("7.5"));
    expect(screen.getByTestId("draft-dirty").textContent).toBe("true");
    fireEvent.click(screen.getByText("save-draft"));
    await waitFor(() => expect(document.body.dataset.draftResult).toBe("ok"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    await waitFor(() => expect(screen.getByTestId("draft-dirty").textContent).toBe("false"));
    expect(h.state().payload?.quote.newRatePct).toBe(7.5);
  });

  it("reports an IndexedDB failure without claiming a saved loan", async () => {
    const previous = globalThis.indexedDB;
    vi.stubGlobal("indexedDB", undefined);
    mocks.auth.privateSession = session("storage-failure");
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(screen.getByTestId("status").textContent).toBe("storage-error");
    expect(screen.getByTestId("loan").textContent).toBe("none");
    expect(mocks.transportFactory).toHaveBeenCalledTimes(2);
    vi.stubGlobal("indexedDB", previous);
  });

  it("persists rate resolution as a complete payload before reporting success", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    mocks.auth.privateSession = session("rate-profile");
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(document.body.dataset.saveResult).toBe("ok"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    fireEvent.click(screen.getByText("mark-rate"));
    await waitFor(() => expect(document.body.dataset.rateResult).toBe("ok"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    expect(h.state().payload?.rateResolvedAt).toBe("2026-09-16T00:00:00.000Z");
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(screen.getByTestId("quote").textContent).toBe("7.5"));
    fireEvent.click(screen.getByText("save-draft"));
    await waitFor(() => expect(document.body.dataset.draftResult).toBe("ok"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
    expect(h.state().payload?.rateResolvedAt).toBe("2026-09-16T00:00:00.000Z");
  });

  it("does not expose rate resolution before an online save is acknowledged", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    mocks.auth.privateSession = session("rate-immediate-profile");
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(document.body.dataset.saveResult).toBe("ok"));
    fireEvent.click(screen.getByText("mark-rate"));
    await waitFor(() => expect(document.body.dataset.rateResult).toBe("ok"));
    expect(h.state().payload?.rateResolvedAt).toBe("2026-09-16T00:00:00.000Z");
  });

  it("keeps a quote edit made immediately after online save success as a local draft", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    mocks.auth.privateSession = session("quote-immediate-profile");
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(document.body.dataset.saveResult).toBe("ok"));
    fireEvent.click(screen.getByText("quote"));
    await waitFor(() => expect(document.body.dataset.quoteResult).toBe("ok"));
    await waitFor(() => expect(screen.getByTestId("quote").textContent).toBe("7.5"));
    expect(screen.getByTestId("draft-dirty").textContent).toBe("true");
    expect(h.state().payload?.quote.newRatePct).toBe(0);
  });

  it("keeps a cancelled discard side-effect free and locks after confirmed discard", async () => {
    const h = makeTransport();
    mocks.transportFactory.mockReturnValue(h.transport);
    mocks.auth.privateSession = session("discard-profile");
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(document.body.dataset.saveResult).toBe("ok"));
    fireEvent.click(screen.getByText("discard-cancel"));
    await waitFor(() => expect(document.body.dataset.discardCancel).toBe("ok"));
    expect(screen.getByTestId("loan").textContent).toBe("1800000");
    fireEvent.click(screen.getByText("discard-confirm"));
    await waitFor(() => expect(document.body.dataset.discardConfirm).toBe("ok"));
    expect(screen.getByTestId("status").textContent).toBe("locked");
    expect(screen.getByTestId("loan").textContent).toBe("none");
    // Confirmed discard clears the local private partition. The server remains
    // authoritative and is not mutated by this local privacy action.
    expect(h.state().payload).not.toBeNull();
    fireEvent.click(screen.getByText("discard-confirm"));
    await waitFor(() => expect(document.body.dataset.discardConfirm).toBe("ok"));
  });
});
