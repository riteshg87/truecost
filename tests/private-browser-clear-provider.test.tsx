// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { PrivateBrowserClearResult } from "../lib/privacy/private-browser-clear";

const state = vi.hoisted(() => ({
  auth: { ready: true, viewer: "anonymous" as AuthValue["viewer"] },
  clerk: { isLoaded: true, isSignedIn: false, userId: null as string | null, sessionId: null as string | null },
  pathname: "/",
  order: [] as string[],
  publish: vi.fn(() => { state.order.push("signal"); return true; }),
  analytics: vi.fn<() => { kind: "cleared" } | { kind: "retry"; reason: "storage-unavailable" }>(() => { state.order.push("analytics"); return { kind: "cleared" }; }),
  clear: vi.fn<(options: unknown) => Promise<PrivateBrowserClearResult>>(async (_options) => { state.order.push("storage"); return { kind: "cleared", loanEpoch: 1, comparisonEpoch: 1 }; }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => state.clerk }));
vi.mock("../lib/auth/provider", () => ({ useAuth: () => state.auth }));
vi.mock("../lib/analytics/provider", () => ({ useOptionalAnalytics: () => ({ clearPrivateRuntime: async () => state.analytics() }) }));
vi.mock("../lib/privacy/private-browser-clear-signal", () => ({ publishPrivateBrowserClearSignal: () => state.publish() }));
vi.mock("../lib/privacy/private-browser-clear", () => ({ clearAllMemberPrivateBrowserData: (options: unknown) => state.clear(options) }));

import { PrivateBrowserClearProvider } from "../lib/privacy/private-browser-clear-provider";

beforeEach(() => {
  state.auth = { ready: true, viewer: "anonymous" };
  state.clerk = { isLoaded: true, isSignedIn: false, userId: null, sessionId: null };
  state.pathname = "/";
  state.order.length = 0;
  state.publish.mockClear();
  state.analytics.mockClear();
  state.clear.mockClear();
  state.publish.mockImplementation(() => { state.order.push("signal"); return true; });
  state.analytics.mockImplementation(() => { state.order.push("analytics"); return { kind: "cleared" }; });
  state.clear.mockImplementation(async (_options) => { state.order.push("storage"); return { kind: "cleared", loanEpoch: 1, comparisonEpoch: 1 }; });
});

afterEach(() => cleanup());

function mount(configured = false) {
  return render(<PrivateBrowserClearProvider configured={configured}><div data-testid="app">public app</div></PrivateBrowserClearProvider>);
}

describe("public browser clear integration", () => {
  it("keeps the panel outside the app tree and publishes before local stages", async () => {
    mount();
    expect(screen.getByTestId("app")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and clear" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(state.order).toEqual(["signal", "analytics", "storage"]);
    expect(state.clear.mock.calls[0][0]).toMatchObject({ confirmed: true });
    expect(screen.getByRole("status").textContent).toMatch(/cloud data and downloaded files are unchanged/i);
  });

  it("keeps any local stage failure retryable without false success", async () => {
    state.analytics.mockImplementation(() => { state.order.push("analytics"); return { kind: "retry", reason: "storage-unavailable" }; });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and clear" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/some private browser data could not be cleared/i));
    expect(screen.queryByRole("status")).toBeNull();
    expect(state.order).toEqual(["signal", "analytics", "storage"]);
  });

  it("reports unavailable cross-tab notification instead of claiming completion", async () => {
    state.publish.mockImplementation(() => { state.order.push("signal"); return false; });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and clear" }));
    await waitFor(() => expect(screen.getByText(/other open tabs may not have received this browser-clear notice/i)).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/other open tabs may not have received/i)).toBeTruthy();
  });

  it("maps either database failure to retry and hides outside the public route or signed-out state", async () => {
    state.clear.mockImplementation(async (_options) => { state.order.push("storage"); return { kind: "retry", reason: "storage-unavailable", completed: ["loan"] }; });
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and clear" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    state.pathname = "/home";
    view.rerender(<PrivateBrowserClearProvider><div data-testid="app">private app</div></PrivateBrowserClearProvider>);
    expect(screen.queryByRole("region", { name: "Clear private browser data" })).toBeNull();
    state.pathname = "/";
    state.auth = { ready: true, viewer: "member" };
    view.rerender(<PrivateBrowserClearProvider><div data-testid="app">member app</div></PrivateBrowserClearProvider>);
    expect(screen.queryByRole("region", { name: "Clear private browser data" })).toBeNull();
  });

  it("does not start while auth is loading and rechecks live eligibility at confirmation", async () => {
    state.auth = { ready: false, viewer: "anonymous" };
    const view = mount();
    expect(screen.queryByRole("region", { name: "Clear private browser data" })).toBeNull();
    state.auth = { ready: true, viewer: "anonymous" };
    view.rerender(<PrivateBrowserClearProvider><div data-testid="app">public app</div></PrivateBrowserClearProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    state.auth = { ready: true, viewer: "member" };
    view.rerender(<PrivateBrowserClearProvider><div data-testid="app">member app</div></PrivateBrowserClearProvider>);
    await act(async () => {});
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("does not treat a signed-in guest fallback as signed out when Clerk is configured", () => {
    state.auth = { ready: true, viewer: "guest" };
    state.clerk = { isLoaded: true, isSignedIn: true, userId: "user-a", sessionId: "session-a" };
    mount(true);
    expect(screen.queryByRole("region", { name: "Clear private browser data" })).toBeNull();
  });
});
