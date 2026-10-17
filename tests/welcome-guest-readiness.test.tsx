// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import { RouteGuard } from "../components/RouteGuard";
import { CompareProvider, useCompare } from "../lib/store";

const state = vi.hoisted(() => ({
  auth: null as unknown as AuthValue,
  pathname: "/compare",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("@/lib/auth/provider", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/auth/config", () => ({ AUTH_CONFIG: { convexUrl: "https://test.convex.cloud" } }));

function Probe() {
  const value = useCompare();
  return <output data-testid="hydrated">{String(value.hydrated)}</output>;
}

function tree() {
  return <RouteGuard><CompareProvider><Probe /></CompareProvider></RouteGuard>;
}

function auth(overrides: Partial<AuthValue> = {}): AuthValue {
  return {
    ready: false,
    viewer: "anonymous",
    guestIntent: false,
    privateSession: null,
    initiatingTabId: "guest-readiness-tab",
    authCompletionEpoch: 0,
    authCompletionSessionId: null,
    ...overrides,
  } as AuthValue;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  state.pathname = "/compare";
  state.auth = auth();
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("explicit guest readiness", () => {
  it("opens and hydrates the public comparison while auth is still loading", async () => {
    state.auth = auth({ guestIntent: true });
    render(tree());

    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(screen.queryByText("Verifying your account")).toBeNull();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("keeps comparison locked without explicit intent", () => {
    render(tree());

    expect(screen.getByRole("status").textContent).toContain("Verifying your account");
    expect(screen.queryByTestId("hydrated")).toBeNull();
  });

  it("keeps private routes blocked even when guest intent is explicit", () => {
    state.pathname = "/loan";
    state.auth = auth({ guestIntent: true });
    render(tree());

    expect(screen.getByRole("status").textContent).toContain("Verifying your account");
    expect(screen.queryByTestId("hydrated")).toBeNull();
    expect(state.replace).not.toHaveBeenCalled();
  });

  it("allows the same local guest comparison offline without creating private access", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    state.auth = auth({ guestIntent: true });
    render(tree());

    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    expect(state.auth.privateSession).toBeNull();
  });

  it("switches the route gate to a verified member when a private grant arrives", async () => {
    state.pathname = "/loan";
    state.auth = auth({ guestIntent: true });
    const view = render(<RouteGuard><p data-testid="private-child">member workspace</p></RouteGuard>);
    expect(screen.queryByTestId("private-child")).toBeNull();

    state.auth = auth({
      ready: true,
      viewer: "member",
      guestIntent: true,
      privateSession: {
        identity: { profileId: "profile-a", subject: "subject-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true },
        isCurrent: () => true,
        getToken: async () => null,
      },
    });
    view.rerender(<RouteGuard><p data-testid="private-child">member workspace</p></RouteGuard>);
    await waitFor(() => expect(screen.getByTestId("private-child")).toBeTruthy());
  });
});
