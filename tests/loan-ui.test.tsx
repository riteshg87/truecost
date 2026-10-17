// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { useLoan } from "../lib/loanStore";
import { LoanSyncStatus } from "../components/LoanSyncStatus";
import { RouteGuard } from "../components/RouteGuard";
import AccountPage from "../app/account/page";
import LoanHealthPage from "../app/loan/page";
import LoanSetupPage from "../app/loan/setup/page";
import RateResetPage from "../app/loan/rate/page";
import PrepayPage from "../app/prepay/page";
import { canonicalTimestamp } from "../lib/contracts/errors";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const pathname = vi.hoisted(() => ({ value: "/account" }));
const comparisonDiscard = vi.hoisted(() => vi.fn(async (_confirmed: boolean) => ({ kind: "ok" as const })));
const values = vi.hoisted(() => ({ auth: null as unknown as AuthValue, loan: null as unknown as ReturnType<typeof useLoan> }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => pathname.value }));
vi.mock("../lib/auth/provider", () => ({ useAuth: () => values.auth }));
vi.mock("../lib/store", () => ({ useCompare: () => ({ pendingCount: 0, signOutReady: true, discardPrivateData: comparisonDiscard }) }));
vi.mock("../lib/loanStore", () => ({
  useLoan: () => values.loan,
  blankLoan: () => ({ lender: "", original: 0, outstanding: 0, ratePct: 0, basis: "repo", spreadPct: 0, cycle: "quarterly", lastReset: "", monthsLeft: 0 }),
}));
vi.mock("../lib/analytics/provider", () => ({ useAnalytics: () => ({ withdraw: vi.fn(async () => undefined) }), useOptionalAnalytics: () => null }));
vi.mock("../components/ThemeToggle", () => ({ ThemeToggle: () => null }));

function grant(profileId = "profile-a") {
  return { identity: { profileId, subject: profileId, sessionId: `session-${profileId}`, authEpoch: 1, verifiedOnline: true as const },
    getToken: vi.fn(async () => null), isCurrent: () => true };
}
beforeEach(() => {
  vi.clearAllMocks();
  pathname.value = "/account";
  values.auth = { viewer: "member", ready: true, gating: "enforced", account: { email: "synthetic@example.test" },
    privateSession: grant(), signOut: vi.fn(async () => {}) } as unknown as AuthValue;
  const loan = { lender: "Synthetic lender", original: 1000000, outstanding: 900000, ratePct: 8.5,
    basis: "repo" as const, spreadPct: 3, spreadProvenance: "confirmed" as const, cycle: "quarterly" as const, lastReset: "2026-06-01", lastResetProvenance: "confirmed" as const, monthsLeft: 120 };
  const quote = { newRatePct: 7.5, feePct: 0.25, legalCharges: 5000, keepTenure: true, newTenureMonths: 240 };
  values.loan = { loan, quote, surplus: 50000, bufferMonths: 8, rateResolvedAt: null, hydrated: true,
    scopeKey: "profile-a", draftDirty: false,
    sync: { status: "queued", pendingCount: 1, revision: 0, cachedLoan: null, pendingLoan: { loan, quote, surplus: 50000, bufferMonths: 8, rateResolvedAt: null }, nextRetryAt: null, errorCode: null, notice: null },
    saveLoan: vi.fn(async () => ({ kind: "ok", value: { requestId: "synthetic-request" } })),
    saveDraft: vi.fn(async () => ({ kind: "ok", value: { requestId: "synthetic-request" } })),
    clearAll: vi.fn(async () => ({ kind: "ok", value: undefined })),
    markRateResolved: vi.fn(async (iso: string) => {
      canonicalTimestamp(iso, "rateResolvedAt");
      return { kind: "ok", value: undefined };
    }),
    discardPrivateData: vi.fn(async () => ({ kind: "ok", value: undefined })),
    retrySync: vi.fn(async () => ({ kind: "ok", value: undefined })),
    resolveConflict: vi.fn(async () => ({ kind: "ok", value: {} })),
  } as unknown as ReturnType<typeof useLoan>;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("private loan UI", () => {
  it("shows queued status until server acknowledgement", () => {
    const view = render(<LoanSyncStatus />);
    expect(screen.getByRole("status").textContent).toContain("waiting to sync");
    expect(screen.queryByText("Loan saved to your account.")).toBeNull();
    values.loan.sync = { ...values.loan.sync, status: "ready", pendingCount: 0, cachedLoan: values.loan.sync.pendingLoan!, pendingLoan: undefined };
    view.rerender(<LoanSyncStatus />);
    expect(screen.getByRole("status").textContent).toBe("Loan saved to your account.");
  });

  it("keeps pending work when sign-out confirmation is cancelled", () => {
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByText(/You have pending work/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(values.loan.discardPrivateData).not.toHaveBeenCalled();
    expect(comparisonDiscard).not.toHaveBeenCalled();
    expect(values.auth.signOut).not.toHaveBeenCalled();
  });

  it("discards only after confirmation, before signing out", async () => {
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm sign out" }));
    await waitFor(() => expect(values.auth.signOut).toHaveBeenCalledOnce());
    expect(values.loan.discardPrivateData).toHaveBeenCalledWith(true);
    expect(comparisonDiscard).toHaveBeenCalledWith(true);
    expect(comparisonDiscard.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(values.auth.signOut).mock.invocationCallOrder[0]);
    expect(vi.mocked(values.loan.discardPrivateData).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(values.auth.signOut).mock.invocationCallOrder[0]);
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("waits for private storage to open before accepting sign-out confirmation", async () => {
    values.loan = { ...values.loan, hydrated: false };
    const view = render(<AccountPage />);
    expect((screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Opening your private loan…");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(values.loan.discardPrivateData).not.toHaveBeenCalled();
    values.loan = { ...values.loan, hydrated: true };
    view.rerender(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm sign out" }));
    await waitFor(() => expect(values.auth.signOut).toHaveBeenCalledOnce());
  });

  it("keeps the session when private storage could not be cleared", async () => {
    vi.mocked(values.loan.discardPrivateData).mockResolvedValue({ kind: "storage-unavailable", reason: "transaction-failed" });
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm sign out" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not clear"));
    expect(values.auth.signOut).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("requires deletion confirmation and leaves its queued status visible", async () => {
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete my loan record" }));
    expect(values.loan.clearAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm loan deletion" }));
    await waitFor(() => expect(values.loan.clearAll).toHaveBeenCalledOnce());
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("waiting to sync");
  });

  it("saves the loan, surplus and buffer atomically and navigates only after enqueue", async () => {
    let finish!: (value: { kind: "ok"; value: { requestId: string } }) => void;
    vi.mocked(values.loan.saveLoan).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<LoanSetupPage />);
    fireEvent.click(screen.getByRole("button", { name: "Save loan" }));
    expect(values.loan.saveLoan).toHaveBeenCalledWith(expect.objectContaining({ lender: "Synthetic lender" }), { surplus: 50000, bufferMonths: 8 });
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => finish({ kind: "ok", value: { requestId: "synthetic-request" } }));
    expect(router.push).toHaveBeenCalledWith("/loan");
  });

  it("preserves missing spread and reset as unknown instead of inferring them", async () => {
    values.loan = {
      ...values.loan,
      loan: { ...values.loan.loan!, spreadPct: null, spreadProvenance: "unknown", lastReset: "", lastResetProvenance: "unknown" },
    };
    render(<LoanSetupPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save loan" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save loan" }));
    await waitFor(() => expect(values.loan.saveLoan).toHaveBeenCalled());
    expect(values.loan.saveLoan).toHaveBeenCalledWith(expect.objectContaining({
      spreadPct: null,
      spreadProvenance: "unknown",
      lastReset: "",
      lastResetProvenance: "unknown",
    }), { surplus: 50000, bufferMonths: 8 });
  });

  it("marks an explicitly entered zero spread and reset date as confirmed", async () => {
    values.loan = {
      ...values.loan,
      loan: { ...values.loan.loan!, spreadPct: null, spreadProvenance: "unknown", lastReset: "", lastResetProvenance: "unknown" },
    };
    render(<LoanSetupPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save loan" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Your spread over the benchmark"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Last reset date"), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save loan" }));
    await waitFor(() => expect(values.loan.saveLoan).toHaveBeenCalled());
    expect(values.loan.saveLoan).toHaveBeenCalledWith(expect.objectContaining({
      spreadPct: 0,
      spreadProvenance: "confirmed",
      lastReset: "2026-08-01",
      lastResetProvenance: "confirmed",
    }), { surplus: 50000, bufferMonths: 8 });
  });

  it("explains missing spread evidence without calling it an unsupported T-bill benchmark", () => {
    values.loan = {
      ...values.loan,
      loan: {
        ...values.loan.loan!,
        spreadPct: null,
        spreadProvenance: "unknown",
        lastResetProvenance: "confirmed",
      },
    };
    render(<LoanHealthPage />);
    expect(screen.getByRole("heading", { name: "Rate details need confirming." })).toBeTruthy();
    expect(screen.getByText(/Confirm the contractual spread from your sanction letter/i)).toBeTruthy();
    expect(screen.queryByText(/T-bill linked loans/i)).toBeNull();
    expect(screen.getByRole("link", { name: /add or confirm rate details/i }).getAttribute("href")).toBe(
      "/loan/setup",
    );
  });

  it("explains missing reset evidence and keeps the setup link usable", () => {
    values.loan = {
      ...values.loan,
      loan: {
        ...values.loan.loan!,
        lastReset: "",
        lastResetProvenance: "unknown",
      },
    };
    render(<RateResetPage />);
    expect(screen.getByRole("heading", { name: "Rate details need confirming" })).toBeTruthy();
    expect(screen.getAllByText(/Confirm the last reset date from a statement/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/T-bill linked loans/i)).toBeNull();
    expect(screen.getByRole("link", { name: /add or confirm rate details/i }).getAttribute("href")).toBe(
      "/loan/setup",
    );
  });

  it("keeps the setup form and values on a failed durable write", async () => {
    vi.mocked(values.loan.saveLoan).mockResolvedValue({ kind: "storage-unavailable", reason: "transaction-failed" });
    render(<LoanSetupPage />);
    fireEvent.click(screen.getByRole("button", { name: "Save loan" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not store"));
    expect(router.push).not.toHaveBeenCalled();
    expect((screen.getByDisplayValue("Synthetic lender") as HTMLInputElement).value).toBe("Synthetic lender");
  });

  it("does not navigate back to a setup page after its save finishes late", async () => {
    let finish!: (value: { kind: "ok"; value: { requestId: string } }) => void;
    vi.mocked(values.loan.saveLoan).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<LoanSetupPage />);
    fireEvent.click(screen.getByRole("button", { name: "Save loan" }));
    view.unmount();
    await act(async () => finish({ kind: "ok", value: { requestId: "synthetic-request" } }));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("remounts private page drafts when the account changes", () => {
    function Draft() {
      const [text, setText] = useState("");
      return <input aria-label="Private draft" value={text} onChange={event => setText(event.target.value)} />;
    }
    const view = render(<RouteGuard><Draft /></RouteGuard>);
    fireEvent.change(screen.getByLabelText("Private draft"), { target: { value: "Account A draft" } });
    values.auth = { ...values.auth, privateSession: grant("profile-b") };
    view.rerender(<RouteGuard><Draft /></RouteGuard>);
    expect((screen.getByLabelText("Private draft") as HTMLInputElement).value).toBe("");
  });

  it("remounts a private draft after the same account receives a fresh verification grant", () => {
    function Draft() {
      const [text, setText] = useState("");
      return <input aria-label="Private draft" value={text} onChange={event => setText(event.target.value)} />;
    }
    const view = render(<RouteGuard><Draft /></RouteGuard>);
    fireEvent.change(screen.getByLabelText("Private draft"), { target: { value: "Previous grant draft" } });
    values.auth = { ...values.auth, privateSession: grant("profile-a") };
    view.rerender(<RouteGuard><Draft /></RouteGuard>);
    expect((screen.getByLabelText("Private draft") as HTMLInputElement).value).toBe("");
  });

  it.each(["/signin", "/verify"])("keeps an auth child input through anonymous startup becoming a ready guest on %s", (path) => {
    pathname.value = path;
    function AuthChildDraft() {
      const [text, setText] = useState("");
      return <input aria-label="Auth child draft" value={text} onChange={(event) => setText(event.target.value)} />;
    }
    values.auth = { ...values.auth, viewer: "anonymous", ready: false, privateSession: null };
    const view = render(<RouteGuard><AuthChildDraft /></RouteGuard>);
    fireEvent.change(screen.getByLabelText("Auth child draft"), { target: { value: "unfinished auth input" } });
    values.auth = { ...values.auth, viewer: "guest", ready: true, privateSession: null };
    view.rerender(<RouteGuard><AuthChildDraft /></RouteGuard>);
    expect((screen.getByLabelText("Auth child draft") as HTMLInputElement).value).toBe("unfinished auth input");
  });

  it("shows the source gap instead of offering a resolution action for an unsupported date", () => {
    values.loan.loan = { ...values.loan.loan!, lastReset: "2020-01-01", ratePct: 12 };
    render(<RateResetPage />);
    expect(screen.getByRole("heading", { name: "Rate details need confirming" })).toBeTruthy();
    expect(screen.getAllByText(/available repo-rate observations do not cover one or both dates/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /mark resolved/ })).toBeNull();
    expect(screen.getByRole("link", { name: /add or confirm rate details/i }).getAttribute("href")).toBe("/loan/setup");
    expect(values.loan.markRateResolved).not.toHaveBeenCalled();
  });

  it("isolates prepayment drafts and never adopts or overwrites legacy device data", () => {
    const legacy = JSON.stringify({ outstanding: 777777, surplus: 123456 });
    localStorage.setItem("truecost.prepay.v1", legacy);
    const reads = vi.spyOn(Storage.prototype, "getItem");
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const view = render(<RouteGuard><PrepayPage /></RouteGuard>);
    const input = () => screen.getByLabelText(/Surplus amount/) as HTMLInputElement;
    expect(input().value).toBe("50,000");
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "60000" } });
    fireEvent.blur(input());
    expect(input().value).toBe("60,000");
    values.auth = { ...values.auth, privateSession: grant("profile-b") };
    values.loan = { ...values.loan, surplus: 20000 };
    view.rerender(<RouteGuard><PrepayPage /></RouteGuard>);
    expect(input().value).toBe("20,000");
    expect(reads.mock.calls.some(([key]) => key === "truecost.prepay.v1")).toBe(false);
    expect(writes.mock.calls.some(([key]) => key === "truecost.prepay.v1")).toBe(false);
    expect(localStorage.getItem("truecost.prepay.v1")).toBe(legacy);
  });
});
