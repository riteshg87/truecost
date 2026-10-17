// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { viewer: "member", configured: true, accountKey: "account-a", authEpoch: 1, ready: true, account: { email: "synthetic@example.test" }, signOut: vi.fn() },
  exchange: vi.fn(),
  cancelReverification: false,
  mutationCalls: [] as any[],
  beginResolve: null as ((value: any) => void) | null,
}));
vi.mock("@clerk/nextjs", () => ({ useReverification: (fetcher: () => Promise<unknown>) => () => state.cancelReverification ? Promise.resolve(undefined) : fetcher() }));
vi.mock("convex/react", () => ({
  useAction: () => state.exchange,
  useMutation: () => vi.fn(async (args: any) => {
    state.mutationCalls.push(args);
    if (args?.grantId) {
      return new Promise((resolve) => { state.beginResolve = resolve; });
    }
    if (args?.paginationOpts) return { status: "ok", expectedRevision: 0, result: { page: [], isDone: true, continueCursor: "" } };
    return { status: "ok", expectedRevision: 0, payload: null };
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("../lib/auth/provider", () => ({ useAuth: () => state.auth }));
vi.mock("../lib/loanStore", () => ({ useLoan: () => ({ loan: null, hydrated: true, clearAll: vi.fn(), sync: { pendingCount: 0 }, draftDirty: false, discardPrivateData: vi.fn(), scopeKey: null }) }));
vi.mock("../lib/store", () => ({ useCompare: () => ({ pendingCount: 0, signOutReady: true, discardPrivateData: vi.fn() }) }));
vi.mock("../components/AnalyticsConsent", () => ({ AnalyticsConsent: () => null }));
vi.mock("../lib/analytics/provider", () => ({ useAnalytics: () => ({ withdraw: vi.fn(async () => undefined) }) }));
vi.mock("../components/LoanSyncStatus", () => ({ LoanSyncStatus: () => null }));
vi.mock("../components/mobile", () => ({ AppBar: () => null, FormError: ({ children }: any) => children, Page: ({ children }: any) => <div>{children}</div>, Screen: ({ children }: any) => <div>{children}</div> }));
import AccountPage from "../app/account/page";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); state.cancelReverification = false; state.auth = { ...state.auth, accountKey: "account-a", authEpoch: 1 }; state.mutationCalls = []; state.beginResolve = null; state.exchange.mockReset(); });

describe("account export auth fencing", () => {
  it("does not expose provider exception details in the export error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ proof: "proof" }), { status: 200 })));
    state.exchange.mockRejectedValue(new Error("private-person@example.test provider internal trace"));
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("private-person");
    expect(alert.textContent).not.toContain("internal trace");
    expect(state.mutationCalls).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Download my data" })).toHaveProperty("disabled", false);
  });

  it("allows retry after cancelled reverification without starting an export", async () => {
    state.cancelReverification = true;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await screen.findByRole("alert");
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.exchange).not.toHaveBeenCalled();
    expect(state.mutationCalls).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Download my data" })).toHaveProperty("disabled", false);
  });

  it("drops a deferred approval response after the account changes", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    const view = render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    state.auth = { ...state.auth, accountKey: "account-b", authEpoch: 2 };
    view.rerender(<AccountPage />);
    await act(async () => resolveFetch(new Response(JSON.stringify({ proof: "proof" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    expect(state.exchange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops before begin when the account changes during grant exchange", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ proof: "proof" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    let resolveExchange!: (value: any) => void;
    state.exchange.mockReturnValue(new Promise((resolve) => { resolveExchange = resolve; }));
    const view = render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(state.exchange).toHaveBeenCalledTimes(1));
    state.auth = { ...state.auth, accountKey: "account-b", authEpoch: 2 };
    view.rerender(<AccountPage />);
    await act(async () => resolveExchange({ grantId: "grant-a" }));
    expect(state.mutationCalls).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not request the first page after the export view unmounts during begin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ proof: "proof" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    state.exchange.mockResolvedValue({ grantId: "grant-a" });
    const view = render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(state.mutationCalls).toHaveLength(1));
    view.unmount();
    await act(async () => state.beginResolve?.({ status: "started", session: { _id: "session-a", expectedRevision: 0, cutoffAt: Date.now(), createdAt: Date.now(), expiresAt: Date.now() + 60_000, status: "active" } }));
    expect(state.mutationCalls).toHaveLength(1);
  });

  it("keeps the new account export busy when the old account response settles", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ proof: "proof" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    let resolveOldExchange!: (value: any) => void;
    state.exchange.mockImplementationOnce(() => new Promise((resolve) => { resolveOldExchange = resolve; })).mockResolvedValue({ grantId: "grant-b" });
    const view = render(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(state.exchange).toHaveBeenCalledTimes(1));
    state.auth = { ...state.auth, accountKey: "account-b", authEpoch: 2 };
    view.rerender(<AccountPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(state.exchange).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(state.mutationCalls).toHaveLength(1));
    await act(async () => resolveOldExchange({ grantId: "grant-a" }));
    expect(screen.getByRole("button", { name: "Preparing export…" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
