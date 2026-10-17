// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const clerk = {
    isLoaded: true,
    isSignedIn: true,
    userId: "user-a" as string | null,
    sessionId: "session-a" as string | null,
    sessionClaims: { aud: "convex" },
    getToken: vi.fn(async () => "token-a"),
    signOut: vi.fn<() => Promise<void>>(async () => undefined),
  };
  const ensureCurrentUser = vi.fn(async () => undefined);
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from("frontend-api.example.com$").toString("base64url")}`;
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  return { clerk, ensureCurrentUser };
});

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => state.clerk,
  useUser: () => ({ user: state.clerk.userId ? { id: state.clerk.userId, primaryEmailAddress: null, primaryPhoneNumber: null } : null }),
  useSignIn: () => ({ signIn: null }),
  useSignUp: () => ({ signUp: null }),
}));

vi.mock("convex/react", () => {
  const convex = {
    watchQuery: () => ({
      localQueryResult: () => ({ _id: "profile-a", status: "active" }),
      onUpdate: (callback: () => void) => { callback(); return () => undefined; },
    }),
  };
  return {
    ConvexReactClient: class { constructor(_url: string) {} },
    ConvexProviderWithClerk: ({ children }: { children: React.ReactNode }) => children,
    useConvexAuth: () => ({ isAuthenticated: true, isLoading: false, isRefreshing: false }),
    useConvex: () => convex,
    useMutation: () => state.ensureCurrentUser,
    useAction: () => vi.fn(async () => undefined),
  };
});

vi.mock("convex/react-clerk", () => ({
  ConvexProviderWithClerk: ({ children }: { children: React.ReactNode }) => children,
}));

import { useAuth, AuthProvider } from "../lib/auth/provider";
import { CONFIRMED_LOGOUT_STORAGE_KEY } from "../lib/analytics/storage";

const PREFERENCE_KEY = "truecost.analytics.preference.v1";

let invokeSignOut: (() => Promise<void>) | null = null;

function Probe() {
  const auth = useAuth();
  invokeSignOut = auth.signOut;
  return <output data-testid="private-state">{auth.privateSession ? "granted" : "empty"}</output>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  state.clerk.isLoaded = true;
  state.clerk.isSignedIn = true;
  state.clerk.userId = "user-a";
  state.clerk.sessionId = "session-a";
  state.clerk.signOut.mockReset();
  state.clerk.signOut.mockResolvedValue(undefined);
  state.ensureCurrentUser.mockReset();
  state.ensureCurrentUser.mockResolvedValue(undefined);
  invokeSignOut = null;
});

afterEach(() => cleanup());

describe("confirmed analytics logout marker", () => {
  it("writes the marker only after Clerk sign-out resolves", async () => {
    const pending = deferred<void>();
    state.clerk.signOut.mockReturnValue(pending.promise);
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("private-state").textContent).toBe("granted"));

    const request = invokeSignOut!();
    await Promise.resolve();
    expect(window.localStorage.getItem(CONFIRMED_LOGOUT_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PREFERENCE_KEY)!).consent).toBe("accepted");

    pending.resolve();
    await request;
    expect(window.localStorage.getItem(CONFIRMED_LOGOUT_STORAGE_KEY)).toMatch(/^\d+$/);
  });

  it("leaves no marker and preserves accepted guest consent when Clerk sign-out rejects", async () => {
    state.clerk.signOut.mockRejectedValue(new Error("Clerk sign-out failed"));
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("private-state").textContent).toBe("granted"));

    await expect(invokeSignOut!()).rejects.toThrow("Clerk sign-out failed");
    expect(window.localStorage.getItem(CONFIRMED_LOGOUT_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PREFERENCE_KEY)!).consent).toBe("accepted");
  });
});
