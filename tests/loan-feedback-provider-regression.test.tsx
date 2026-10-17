// @vitest-environment jsdom
import "fake-indexeddb/auto";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
const mocks = vi.hoisted(() => ({ session: null as PrivateSessionAccess | null, factory: vi.fn() }));
vi.mock("../lib/auth/provider", () => ({ useAuth: () => ({ privateSession: mocks.session }) }));
vi.mock("../lib/auth/config", () => ({ AUTH_CONFIG: { convexUrl: "https://test.convex.cloud" } }));
vi.mock("../lib/private-storage/transport", () => ({ createSessionBoundSavedLoanTransport: mocks.factory }));
import { LoanProvider, useLoan } from "../lib/loanStore";

function Probe() {
  const value = useLoan();
  return <>
    <output data-testid="suggestion">{value.loanHealthSuggestionId}</output>
    <output data-testid="loaded">{String(value.hydrated && Boolean(value.loan))}</output>
    <output data-testid="pending">{value.sync.pendingCount}</output>
    <output data-testid="status">{value.sync.status}</output>
    <button onClick={() => void value.setQuote({ newRatePct: 7.5 })}>First edit</button>
    <button onClick={() => void value.setQuote({ newRatePct: 8.25 })}>Second edit</button>
    <button onClick={() => void value.saveDraft()}>Save draft</button>
    <button onClick={() => void value.resolveConflict("keep-server").then((result) => { document.body.dataset.conflictResult = result.kind; document.body.dataset.conflictCode = result.kind === "invalid" ? result.code : ""; })}>Keep server</button>
  </>;
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

it("assigns a new feedback context for each changed visible Loan health draft", async () => {
  sessionStorage.clear();
  const identity = { profileId: "feedback-regression", subject: "feedback-regression", sessionId: "test-session", authEpoch: 1, verifiedOnline: true as const };
  mocks.session = { identity, isCurrent: () => true, getToken: async () => "test" };
  mocks.factory.mockReturnValue({ currentLoan: async () => ({ revision: 1, payload: {
    loan: { lender: "Synthetic", original: 2000000, outstanding: 1800000, ratePct: 8.5, basis: "repo", spreadPct: 2.5, cycle: "quarterly", lastReset: "2026-01-01", monthsLeft: 120 },
    quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5000, keepTenure: true, newTenureMonths: 120 },
    surplus: 100000, bufferMonths: 8, rateResolvedAt: null,
  } }), saveLoan: vi.fn(), deleteLoan: vi.fn() });
  render(<LoanProvider><Probe /></LoanProvider>);
  await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"));
  const original = screen.getByTestId("suggestion").textContent;
  fireEvent.click(screen.getByText("First edit"));
  await waitFor(() => expect(screen.getByTestId("suggestion").textContent).not.toBe(original));
  const firstEdit = screen.getByTestId("suggestion").textContent;
  fireEvent.click(screen.getByText("Second edit"));
  await waitFor(() => expect(screen.getByTestId("suggestion").textContent).not.toBe(firstEdit));
});

it("keeps the same suggestion identity only across an acknowledged queued save", async () => {
  sessionStorage.clear();
  const identity = { profileId: "feedback-ack", subject: "feedback-ack", sessionId: "test-session", authEpoch: 1, verifiedOnline: true as const };
  mocks.session = { identity, isCurrent: () => true, getToken: async () => "test" };
  mocks.factory.mockReturnValue({
    currentLoan: async () => ({ revision: 1, payload: {
      loan: { lender: "Synthetic", original: 2000000, outstanding: 1800000, ratePct: 8.5, basis: "repo", spreadPct: 2.5, cycle: "quarterly", lastReset: "2026-01-01", monthsLeft: 120 },
      quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5000, keepTenure: true, newTenureMonths: 120 },
      surplus: 100000, bufferMonths: 8, rateResolvedAt: null,
    } }),
    saveLoan: async (input: { requestId: string; expectedRevision: number }) => ({ requestId: input.requestId, kind: "saveLoan", revision: input.expectedRevision + 1 }),
    deleteLoan: vi.fn(),
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  render(<LoanProvider><Probe /></LoanProvider>);
  await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  fireEvent.click(screen.getByText("First edit"));
  await waitFor(() => expect(screen.getByTestId("suggestion").textContent).not.toBeNull());
  const suggestion = screen.getByTestId("suggestion").textContent;
  fireEvent.click(screen.getByText("Save draft"));
  await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("1"));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await act(async () => { window.dispatchEvent(new Event("online")); });
  await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
  expect(screen.getByTestId("suggestion").textContent).toBe(suggestion);
});

it("keeps a newer dirty suggestion separate while an older save acknowledges", async () => {
  sessionStorage.clear();
  const identity = { profileId: "feedback-late-ack", subject: "feedback-late-ack", sessionId: "test-session", authEpoch: 1, verifiedOnline: true as const };
  mocks.session = { identity, isCurrent: () => true, getToken: async () => "test" };
  const saveCalls: Array<{ input: { requestId: string; expectedRevision: number }; resolve: (value: { requestId: string; kind: "saveLoan"; revision: number }) => void }> = [];
  mocks.factory.mockReturnValue({
    currentLoan: async () => ({ revision: 1, payload: {
      loan: { lender: "Synthetic", original: 2000000, outstanding: 1800000, ratePct: 8.5, basis: "repo", spreadPct: 2.5, cycle: "quarterly", lastReset: "2026-01-01", monthsLeft: 120 },
      quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5000, keepTenure: true, newTenureMonths: 120 },
      surplus: 100000, bufferMonths: 8, rateResolvedAt: null,
    } }),
    saveLoan: (input: { requestId: string; expectedRevision: number }) => new Promise((resolve) => saveCalls.push({ input, resolve })),
    deleteLoan: vi.fn(),
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  render(<LoanProvider><Probe /></LoanProvider>);
  await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  fireEvent.click(screen.getByText("First edit"));
  await waitFor(() => expect(screen.getByTestId("suggestion").textContent).not.toBeNull());
  fireEvent.click(screen.getByText("Save draft"));
  await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("1"));

  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await act(async () => { window.dispatchEvent(new Event("online")); });
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  fireEvent.click(screen.getByText("Second edit"));
  const newerSuggestion = screen.getByTestId("suggestion").textContent;
  expect(newerSuggestion).not.toBeNull();
  saveCalls[0].resolve({ requestId: saveCalls[0].input.requestId, kind: "saveLoan", revision: 2 });
  await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
  expect(screen.getByTestId("suggestion").textContent).toBe(newerSuggestion);

  fireEvent.click(screen.getByText("Save draft"));
  await waitFor(() => expect(saveCalls).toHaveLength(2));
  await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("1"));
  expect(screen.getByTestId("suggestion").textContent).toBe(newerSuggestion);
  saveCalls[1].resolve({ requestId: saveCalls[1].input.requestId, kind: "saveLoan", revision: 2 });
  await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("0"));
  expect(screen.getByTestId("suggestion").textContent).toBe(newerSuggestion);
});

it("recovers a queued suggestion identity after a provider remount", async () => {
  sessionStorage.clear();
  const identity = { profileId: "feedback-reload", subject: "feedback-reload", sessionId: "test-session", authEpoch: 1, verifiedOnline: true as const };
  mocks.session = { identity, isCurrent: () => true, getToken: async () => "test" };
  mocks.factory.mockReturnValue({
    currentLoan: async () => ({ revision: 1, payload: {
      loan: { lender: "Synthetic", original: 2000000, outstanding: 1800000, ratePct: 8.5, basis: "repo", spreadPct: 2.5, cycle: "quarterly", lastReset: "2026-01-01", monthsLeft: 120 },
      quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5000, keepTenure: true, newTenureMonths: 120 },
      surplus: 100000, bufferMonths: 8, rateResolvedAt: null,
    } }),
    saveLoan: vi.fn(),
    deleteLoan: vi.fn(),
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  const first = render(<LoanProvider><Probe /></LoanProvider>);
  await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  fireEvent.click(screen.getByText("First edit"));
  await waitFor(() => expect(screen.getByTestId("suggestion").textContent).not.toBeNull());
  const suggestion = screen.getByTestId("suggestion").textContent;
  fireEvent.click(screen.getByText("Save draft"));
  await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("1"));
  first.unmount();
  render(<LoanProvider><Probe /></LoanProvider>);
  await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"));
  await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("1"));
  expect(screen.getByTestId("suggestion").textContent).toBe(suggestion);
});

it("does not carry a paused save identity through keep-server resolution", async () => {
  sessionStorage.clear();
  const identity = { profileId: "feedback-conflict", subject: "feedback-conflict", sessionId: "test-session", authEpoch: 1, verifiedOnline: true as const };
  mocks.session = { identity, isCurrent: () => true, getToken: async () => "test" };
  mocks.factory.mockReturnValue({
    currentLoan: async () => ({ revision: 1, payload: {
      loan: { lender: "Synthetic", original: 2000000, outstanding: 1800000, ratePct: 8.5, basis: "repo", spreadPct: 2.5, cycle: "quarterly", lastReset: "2026-01-01", monthsLeft: 120 },
      quote: { newRatePct: 8, feePct: 0.25, legalCharges: 5000, keepTenure: true, newTenureMonths: 120 },
      surplus: 100000, bufferMonths: 8, rateResolvedAt: null,
    } }),
    saveLoan: vi.fn(async () => { throw { code: "conflict" }; }),
    deleteLoan: vi.fn(),
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  render(<LoanProvider><Probe /></LoanProvider>);
  await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("true"));
  fireEvent.click(screen.getByText("First edit"));
  await waitFor(() => expect(screen.getByTestId("suggestion").textContent).not.toBeNull());
  const pausedSuggestion = screen.getByTestId("suggestion").textContent;
  fireEvent.click(screen.getByText("Save draft"));
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("paused"));
  fireEvent.click(screen.getByText("Keep server"));
  await waitFor(() => expect(document.body.dataset.conflictResult).toBeDefined());
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
  expect(screen.getByTestId("suggestion").textContent).not.toBe(pausedSuggestion);
});
