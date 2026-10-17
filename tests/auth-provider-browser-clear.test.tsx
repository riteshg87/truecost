// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const clerk = {
    isLoaded: true,
    isSignedIn: true,
    userId: "user-a" as string | null,
    sessionId: "session-a" as string | null,
    sessionClaims: { aud: "convex" },
    getToken: vi.fn(async () => "token-a"),
    signOut: vi.fn(async () => undefined),
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
import { publishPrivateBrowserClearSignal } from "../lib/privacy/private-browser-clear-signal";

function Probe() {
  const auth = useAuth();
  return <output data-testid="private-state">{auth.privateSession ? "granted" : "empty"}</output>;
}

afterEach(() => cleanup());

describe("AuthProvider browser-clear suspension", () => {
  it("tears down the active grant and allows a new verified Clerk identity after sign-out", async () => {
    const view = render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("private-state").textContent).toBe("granted"));

    publishPrivateBrowserClearSignal();
    await waitFor(() => expect(screen.getByTestId("private-state").textContent).toBe("empty"));

    // Clerk can briefly report an unloaded/null identity while the original
    // session is returning. That transient must not clear the browser-clear
    // suspension or reopen the old private grant.
    state.clerk.isLoaded = false;
    state.clerk.isSignedIn = false;
    state.clerk.userId = null;
    state.clerk.sessionId = null;
    view.rerender(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("private-state").textContent).toBe("empty"));
    state.clerk.isLoaded = true;
    state.clerk.isSignedIn = true;
    state.clerk.userId = "user-a";
    state.clerk.sessionId = "session-a";
    view.rerender(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("private-state").textContent).toBe("empty"));

    // A genuine new Clerk session is allowed to establish a new grant.
    state.clerk.isSignedIn = true;
    state.clerk.userId = "user-a";
    state.clerk.sessionId = "session-fresh";
    view.rerender(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("private-state").textContent).toBe("granted"));
  });
});
