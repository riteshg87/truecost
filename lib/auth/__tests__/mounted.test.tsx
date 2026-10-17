// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseIdentifier } from "../identifier";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  params: new URLSearchParams(),
}));
const authNavigation = vi.hoisted(() => ({ navigateToAuthDestination: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}));
vi.mock("../navigation", () => authNavigation);

const clerk = {
  isLoaded: true,
  isSignedIn: true,
  userId: "user-a" as string | null,
  sessionId: "session-a" as string | null,
  signOut: vi.fn(async () => undefined),
};
let user: { id: string; primaryEmailAddress: { emailAddress: string }; primaryPhoneNumber: null } | null = { id: "user-a", primaryEmailAddress: { emailAddress: "a@example.com" }, primaryPhoneNumber: null };
const signIn = { isTransferable: false, status: "complete", create: vi.fn(), emailCode: { sendCode: vi.fn(), verifyCode: vi.fn() }, finalize: vi.fn() };
const signUp = { status: "complete", create: vi.fn(), verifications: { sendEmailCode: vi.fn(), verifyEmailCode: vi.fn() }, finalize: vi.fn() };
const convexAuth = { isLoading: false, isAuthenticated: true, isRefreshing: false };
let watchResult: unknown = null;
let watchError = false;
let watchUpdates: Array<() => void> = [];
const convex = {
  watchQuery: vi.fn(() => {
    const update = () => undefined;
    watchUpdates.push(update);
    return {
      localQueryResult: () => {
        if (watchError) throw new Error("profile unavailable");
        return watchResult;
      },
      onUpdate: (callback: () => void) => {
        watchUpdates[watchUpdates.length - 1] = callback;
        return () => { watchUpdates = watchUpdates.filter((entry) => entry !== callback); };
      },
    };
  }),
};
let ensureResolve: (() => void) | null = null;
const ensureCurrentUser = vi.fn(() => new Promise<void>((resolve) => { ensureResolve = resolve; }));
let useAuthImpl: typeof import("../provider").useAuth;
let rerenderProvider: (() => void) | null = null;
let rerenderClerk: (() => void) | null = null;
let probeSnapshots: Array<{ clerkUserId: string | null; viewer: string; ready: string; unavailable: string }> = [];

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => {
    const [, setTick] = useState(0);
    rerenderClerk = () => setTick((value) => value + 1);
    return clerk;
  },
  useUser: () => ({ user }),
  useSignIn: () => ({ signIn }),
  useSignUp: () => ({ signUp }),
}));
vi.mock("convex/react", () => ({
  ConvexReactClient: class { constructor(_url: string) {} },
  useConvex: () => convex,
  useConvexAuth: () => convexAuth,
  useMutation: () => ensureCurrentUser,
}));
vi.mock("convex/react-clerk", () => ({ ConvexProviderWithClerk: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/convex/_generated/api", () => ({ api: { users: { currentUser: "currentUser", ensureCurrentUser: "ensureCurrentUser" } } }));

function Probe() {
  // The actual provider value is what the mounted tests assert. Keeping the
  // probe small avoids copying provider decisions into the test itself.
  const auth = useAuthImpl();
  const [, setTick] = useState(0);
  const [authResult, setAuthResult] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  rerenderProvider = () => setTick((value) => value + 1);
  probeSnapshots.push({ clerkUserId: clerk.userId, viewer: auth.viewer, ready: String(auth.ready), unavailable: auth.unavailableReason ?? "" });
  const id = parseIdentifier("a@example.com");
  return <div>
    <output data-testid="viewer">{auth.viewer}</output>
    <output data-testid="ready">{String(auth.ready)}</output>
    <output data-testid="verification-ready">{String(auth.verificationReady)}</output>
    <output data-testid="verification-phase">{auth.verificationPhase}</output>
    <output data-testid="account">{auth.account?.id ?? ""}</output>
    <button onClick={auth.retryProvisioning}>retry</button>
    <button onClick={auth.cancelVerification}>cancel</button>
    <button onClick={auth.continueAsGuest}>guest</button>
    <output data-testid="auth-result">{authResult}</output>
    <button onClick={() => void auth.signOut().catch(() => { if (alive.current) setAuthResult("signout failed"); })}>signout</button>
    <button onClick={() => { if (id.ok) void auth.sendCode(id.id).then((result) => { if (!result.ok && alive.current) setAuthResult(result.error); }); }}>send</button>
    <button onClick={() => { if (id.ok) void auth.verifyCode(id.id, "123456").then((result) => { if (!result.ok && alive.current) setAuthResult(result.error); }); }}>verify</button>
  </div>;
}

async function loadProvider(configured: boolean) {
  vi.resetModules();
  if (configured) {
    const encoded = btoa("dutiful-fly-37.clerk.accounts.dev$").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", `pk_test_${encoded}`);
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://dutiful-fly-37.convex.cloud");
  } else {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
  }
  const provider = await import("../provider");
  useAuthImpl = provider.useAuth;
  return provider;
}

beforeEach(() => {
  cleanup();
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })) as typeof window.matchMedia;
  vi.clearAllMocks();
  watchResult = null;
  watchError = false;
  watchUpdates = [];
  ensureResolve = null;
  rerenderProvider = null;
  rerenderClerk = null;
  probeSnapshots = [];
  navigation.router.push.mockReset();
  navigation.router.replace.mockReset();
  navigation.params = new URLSearchParams();
  signIn.create.mockResolvedValue({});
  signIn.emailCode.sendCode.mockResolvedValue({});
  signIn.emailCode.verifyCode.mockResolvedValue({});
  signIn.finalize.mockResolvedValue({});
  signIn.isTransferable = false;
  signUp.status = "complete";
  signUp.create.mockResolvedValue({});
  signUp.verifications.sendEmailCode.mockResolvedValue({});
  signUp.verifications.verifyEmailCode.mockResolvedValue({});
  signUp.finalize.mockResolvedValue({});
  clerk.userId = "user-a";
  clerk.sessionId = "session-a";
  clerk.isSignedIn = true;
  user = { id: "user-a", primaryEmailAddress: { emailAddress: "a@example.com" }, primaryPhoneNumber: null };
  convexAuth.isAuthenticated = true;
  convexAuth.isRefreshing = false;
  convexAuth.isLoading = false;
  localStorage.clear();
  sessionStorage.clear();
  authNavigation.navigateToAuthDestination.mockReset();
});

describe("mounted auth lifecycle", () => {
  it("locks the deleted account on a storage signal and leaves a later account usable", async () => {
    watchResult = { _id: "profile-a", status: "active" };
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("member"));
    const notify = (profileId: string) => act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: "truecost.private.deletion.v1",
        newValue: JSON.stringify({ type: "account-deletion", profileId }),
      }));
    });
    notify("profile-b");
    expect(screen.getByTestId("viewer").textContent).toBe("member");
    notify("profile-a");
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("anonymous"));
    expect(screen.getByTestId("account").textContent).toBe("");
    expect(clerk.signOut).not.toHaveBeenCalled();
    // Even a stale active-profile refresh cannot restore the deleted account.
    await act(async () => { watchUpdates.at(-1)?.(); });
    expect(screen.getByTestId("viewer").textContent).toBe("anonymous");

    clerk.userId = "user-b";
    clerk.sessionId = "session-b";
    user = { id: "user-b", primaryEmailAddress: { emailAddress: "b@example.com" }, primaryPhoneNumber: null };
    watchResult = { _id: "profile-b", status: "active" };
    act(() => rerenderClerk?.());
    await waitFor(() => expect(screen.getByTestId("account").textContent).toBe("user-b"));
    notify("profile-a");
    expect(screen.getByTestId("viewer").textContent).toBe("member");
    expect(screen.getByTestId("account").textContent).toBe("user-b");
  });

  it("restores pending verification before deciding a reload needs a sign-in redirect", async () => {
    clerk.isSignedIn = false; clerk.userId = null; clerk.sessionId = null; user = null;
    convexAuth.isAuthenticated = false;
    sessionStorage.setItem("truecost.auth.pending-email", JSON.stringify({
      email: "restored@example.com", next: "/compare/results", expiresAt: Date.now() + 60_000,
    }));
    navigation.params.set("next", "/compare/results");
    const { AuthShell } = await loadProvider(true);
    const { default: VerifyPage } = await import("@/app/verify/page");
    render(<AuthShell><VerifyPage /></AuthShell>);
    await screen.findByRole("heading", { name: "Verification needs a restart" });
    expect(navigation.router.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(navigation.router.replace).toHaveBeenCalledOnce();
    expect(navigation.router.replace).toHaveBeenCalledWith("/signin?next=%2Fcompare%2Fresults");
    navigation.params.delete("next");
  });

  it("keeps the missing-config guest path usable", async () => {
    const { AuthShell } = await loadProvider(false);
    render(<AuthShell><Probe /></AuthShell>);
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(screen.getByTestId("viewer").textContent).toBe("anonymous");
    fireEvent.click(screen.getByText("guest"));
    expect(screen.getByTestId("viewer").textContent).toBe("guest");
    fireEvent.click(screen.getByText("retry"));
    expect(screen.getByTestId("viewer").textContent).toBe("guest");
  });

  it("uses the server validation bit to keep configured client pages in guest mode", async () => {
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell serverConfigured={false}><Probe /></AuthShell>);
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(screen.getByTestId("viewer").textContent).toBe("anonymous");
    fireEvent.click(screen.getByText("guest"));
    expect(screen.getByTestId("viewer").textContent).toBe("guest");
  });

  it.each([
    ["sign-in", false],
    ["sign-up", true],
  ])("activates a guest %s finalize only after the new identity is bound", async (_label, transferable) => {
    clerk.isSignedIn = false;
    clerk.userId = null;
    clerk.sessionId = null;
    user = null;
    convexAuth.isAuthenticated = false;
    // The signUpIfMissing flow keeps the first code on sign-in. Clerk only
    // reports a new account after successful verification, then the provider
    // transfers that verified attempt to sign-up.
    if (transferable) {
      signIn.emailCode.verifyCode.mockResolvedValueOnce({
        error: { errors: [{ code: "sign_up_if_missing_transfer" }] },
      });
    }
    const active = transferable ? signUp : signIn;
    active.finalize.mockImplementationOnce(async ({ navigate }: { navigate: (args: { session: { id: string; currentTask: null }; decorateUrl: (value: string) => string }) => void }) => {
      clerk.isSignedIn = true;
      clerk.userId = "user-new";
      clerk.sessionId = "session-new";
      user = { id: "user-new", primaryEmailAddress: { emailAddress: "new@example.com" }, primaryPhoneNumber: null };
      convexAuth.isAuthenticated = true;
      watchResult = { _id: "profile-new", status: "active" };
      await act(async () => { rerenderClerk?.(); });
      navigate({ session: { id: "session-new", currentTask: null }, decorateUrl: (value) => value });
      return {};
    });
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("verification-ready").textContent).toBe("true"));
    expect(signIn.emailCode.sendCode).toHaveBeenCalledTimes(1);
    if (transferable) expect(signUp.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("verify"));
    await waitFor(() => expect(authNavigation.navigateToAuthDestination).toHaveBeenCalledWith("/home"));
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("member"));
    if (transferable) expect(signUp.create).toHaveBeenCalledWith({ transfer: true });
    expect(screen.getByTestId("verification-phase").textContent).toBe("idle");
  });

  it("keeps a watch-delivered active profile when provisioning resolves later", async () => {
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    await waitFor(() => expect(ensureCurrentUser).toHaveBeenCalled());
    watchResult = { _id: "profile-a", status: "active" };
    await act(async () => { watchUpdates.at(-1)?.(); });
    expect(screen.getByTestId("viewer").textContent).toBe("member");
    await act(async () => { ensureResolve?.(); });
    expect(screen.getByTestId("viewer").textContent).toBe("member");
  });

  it("resubscribes after a profile watch error when retry is explicit", async () => {
    watchError = true;
  const { AuthShell } = await loadProvider(true);
  render(<AuthShell><Probe /></AuthShell>);
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("guest"));
    const firstSubscriptionCount = convex.watchQuery.mock.calls.length;
    watchError = false;
    watchResult = { _id: "profile-a", status: "active" };
    fireEvent.click(screen.getByText("retry"));
    await waitFor(() => expect(convex.watchQuery.mock.calls.length).toBeGreaterThan(firstSubscriptionCount));
    await act(async () => { watchUpdates.at(-1)?.(); });
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("member"));
  });

  it("retries provisioning after a mutation rejection while the profile query is null", async () => {
    // Provisioning only signals completion; the watched profile supplies the
    // member record independently.
    ensureCurrentUser.mockRejectedValueOnce(new Error("temporary provisioning failure")).mockResolvedValueOnce(undefined);
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    await waitFor(() => expect(ensureCurrentUser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("guest"));
    fireEvent.click(screen.getByText("retry"));
    await waitFor(() => expect(ensureCurrentUser).toHaveBeenCalledTimes(2));
  });

  it("does not expose a stale provisioning error as ready guest during an identity switch", async () => {
    watchError = true;
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("guest"));
    const beforeSwitch = probeSnapshots.length;
    watchError = false;
    clerk.userId = "user-b";
    clerk.sessionId = "session-b";
    user = { id: "user-b", primaryEmailAddress: { emailAddress: "b@example.com" }, primaryPhoneNumber: null };
    act(() => rerenderClerk?.());
    const bRenders = probeSnapshots.slice(beforeSwitch).filter((snapshot) => snapshot.clerkUserId === "user-b");
    expect(bRenders).not.toContainEqual(expect.objectContaining({ ready: "true", unavailable: "Your account state is unavailable. Try again." }));
    expect(screen.getByTestId("ready").textContent).toBe("false");
  });

  it("hides member identity while sign-out is pending and restores it after a failed sign-out", async () => {
    let rejectSignOut!: (error: Error) => void;
    clerk.signOut.mockReturnValueOnce(new Promise<undefined>((_resolve, reject) => { rejectSignOut = reject; }));
    watchResult = { _id: "profile-a", status: "active" };
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("member"));
    fireEvent.click(screen.getByText("signout"));
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("anonymous"));
    expect(screen.getByTestId("account").textContent).toBe("");
    expect(screen.getByTestId("ready").textContent).toBe("false");
    await act(async () => { rejectSignOut(new Error("temporary sign-out failure")); });
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("member"));
    expect(screen.getByTestId("account").textContent).toBe("user-a");
  });

  it("survives StrictMode mount cleanup without cancelling the active verify surface", async () => {
    const { AuthShell } = await loadProvider(true);
    watchResult = { _id: "profile-a", status: "active" };
    render(<StrictMode><AuthShell><Probe /></AuthShell></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("member"));
    expect(screen.getByText("cancel")).toBeTruthy();
  });

  it("cancels a deferred send when the user leaves the flow", async () => {
    let release!: (value: object) => void;
    signIn.create.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(signIn.create).toHaveBeenCalled());
    fireEvent.click(screen.getByText("cancel"));
    await act(async () => { release({}); });
    expect(screen.getByTestId("verification-ready").textContent).toBe("false");
    expect(screen.getByTestId("verification-phase").textContent).toBe("idle");
  });

  it("times out a stalled initial code request and ignores its late completion", async () => {
    vi.useFakeTimers();
    try {
      let release!: (value: object) => void;
      signIn.create.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
      const { AuthShell } = await loadProvider(true);
      render(<AuthShell><Probe /></AuthShell>);
      fireEvent.click(screen.getByText("send"));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByTestId("verification-phase").textContent).toBe("sending");
      await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByTestId("auth-result").textContent).toContain("in time");
      expect(screen.getByTestId("verification-phase").textContent).toBe("idle");
      expect(screen.getByTestId("verification-ready").textContent).toBe("false");
      await act(async () => { release({}); await Promise.resolve(); });
      expect(signIn.emailCode.sendCode).not.toHaveBeenCalled();
      expect(screen.getByTestId("verification-phase").textContent).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a stalled email code dispatch and ignores its late completion", async () => {
    vi.useFakeTimers();
    try {
      let release!: (value: object) => void;
      signIn.create.mockResolvedValueOnce({});
      signIn.emailCode.sendCode.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
      const { AuthShell } = await loadProvider(true);
      render(<AuthShell><Probe /></AuthShell>);
      fireEvent.click(screen.getByText("send"));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
      expect(signIn.emailCode.sendCode).toHaveBeenCalledOnce();
      expect(screen.getByTestId("verification-phase").textContent).toBe("sending");
      await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); await Promise.resolve(); });
      expect(screen.getByTestId("auth-result").textContent).toContain("in time");
      expect(screen.getByTestId("verification-phase").textContent).toBe("idle");
      expect(screen.getByTestId("verification-ready").textContent).toBe("false");
      await act(async () => { release({}); await Promise.resolve(); });
      expect(screen.getByTestId("verification-phase").textContent).toBe("idle");
      expect(screen.getByTestId("verification-ready").textContent).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps resend ready after a returned SDK error", async () => {
    signIn.create.mockResolvedValueOnce({}).mockResolvedValueOnce({ error: { code: "too_many_requests_rate_limit" } });
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("verification-ready").textContent).toBe("true"));
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("auth-result").textContent).toContain("Too many attempts"));
    expect(screen.getByTestId("verification-ready").textContent).toBe("true");
    expect(screen.getByTestId("verification-phase").textContent).toBe("ready");
  });

  it("keeps an ordinary verification error on sign-in without transferring", async () => {
    signIn.emailCode.verifyCode.mockResolvedValueOnce({ error: { code: "form_code_incorrect" } });
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("verification-ready").textContent).toBe("true"));
    fireEvent.click(screen.getByText("verify"));
    await waitFor(() => expect(screen.getByTestId("auth-result").textContent).toContain("code did not work"));
    expect(signUp.create).not.toHaveBeenCalled();
    expect(signUp.finalize).not.toHaveBeenCalled();
    expect(screen.getByTestId("verification-phase").textContent).toBe("ready");
  });

  it("does not transfer a held new-account response after cancellation", async () => {
    let release!: (value: { error: { errors: Array<{ code: string }> } }) => void;
    signIn.emailCode.verifyCode.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("verification-ready").textContent).toBe("true"));
    fireEvent.click(screen.getByText("verify"));
    await waitFor(() => expect(signIn.emailCode.verifyCode).toHaveBeenCalled());
    fireEvent.click(screen.getByText("cancel"));
    await act(async () => { release({ error: { errors: [{ code: "sign_up_if_missing_transfer" }] } }); });
    expect(signUp.create).not.toHaveBeenCalled();
    expect(signUp.finalize).not.toHaveBeenCalled();
    expect(authNavigation.navigateToAuthDestination).not.toHaveBeenCalled();
    expect(screen.getByTestId("verification-phase").textContent).toBe("idle");
  });

  it("cancels a deferred send when the Clerk identity switches", async () => {
    let release!: (value: object) => void;
    signIn.create.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(signIn.create).toHaveBeenCalled());
    clerk.userId = "user-b";
    clerk.sessionId = "session-b";
    act(() => rerenderClerk?.());
    await act(async () => { release({}); });
    expect(screen.getByTestId("verification-ready").textContent).toBe("false");
    expect(screen.getByTestId("verification-phase").textContent).toBe("idle");
  });

  it("returns currentTask to a recoverable ready state", async () => {
    signIn.finalize.mockImplementationOnce(async ({ navigate }: { navigate: (args: { session: { id: string; currentTask: object }; decorateUrl: (value: string) => string }) => void }) => {
      navigate({ session: { id: "session-a", currentTask: { key: "setup" } }, decorateUrl: (value) => value });
      return {};
    });
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("verification-ready").textContent).toBe("true"));
    fireEvent.click(screen.getByText("verify"));
    await waitFor(() => expect(screen.getByTestId("auth-result").textContent).toContain("Finish the account setup"));
    expect(screen.getByTestId("verification-phase").textContent).toBe("ready");
  });

  it("shows the actual verification page's restart path for a current task", async () => {
    signIn.finalize.mockImplementationOnce(async ({ navigate }: { navigate: (args: { session: { id: string; currentTask: object }; decorateUrl: (value: string) => string }) => void }) => {
      navigate({ session: { id: "session-a", currentTask: { key: "setup" } }, decorateUrl: (value) => value });
      return {};
    });
    const { AuthShell } = await loadProvider(true);
    const { default: VerifyPage } = await import("@/app/verify/page");
    render(<AuthShell><div><Probe /><VerifyPage /></div></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByLabelText("Six digit code")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Six digit code"), { target: { value: "123456" } });
    await waitFor(() => expect(screen.getByText("Finish the account setup before continuing.")).toBeTruthy());
    fireEvent.click(screen.getByText("Change email"));
    expect(navigation.router.replace).toHaveBeenCalledWith("/signin?next=%2Fhome");
  });

  it("allows the finalize callback after Clerk activates its new session", async () => {
    signIn.finalize.mockImplementationOnce(async ({ navigate }: { navigate: (args: { session: { id: string; currentTask: object }; decorateUrl: (value: string) => string }) => void }) => {
      clerk.sessionId = "session-new";
      await act(async () => { rerenderClerk?.(); });
      navigate({ session: { id: "session-new", currentTask: { key: "setup" } }, decorateUrl: (value) => value });
      return {};
    });
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("verification-ready").textContent).toBe("true"));
    fireEvent.click(screen.getByText("verify"));
    await waitFor(() => expect(screen.getByTestId("auth-result").textContent).toContain("Finish the account setup"));
    expect(screen.getByTestId("verification-phase").textContent).toBe("ready");
  });

  it("does not report success when another account wins a finalize race", async () => {
    signIn.finalize.mockImplementationOnce(async ({ navigate }: { navigate: (args: { session: { id: string; currentTask: null }; decorateUrl: (value: string) => string }) => void }) => {
      clerk.userId = "user-b";
      clerk.sessionId = "session-b";
      await act(async () => { rerenderClerk?.(); });
      navigate({ session: { id: "session-a", currentTask: null }, decorateUrl: (value) => value });
      return {};
    });
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("verification-ready").textContent).toBe("true"));
    fireEvent.click(screen.getByText("verify"));
    await waitFor(() => expect(screen.getByTestId("auth-result").textContent).toContain("account changed"));
    expect(screen.getByTestId("verification-phase").textContent).toBe("ready");
  });

  it("rejects a stale finalize completion after cancellation", async () => {
    let release!: (value: object) => void;
    signIn.finalize.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(screen.getByTestId("verification-ready").textContent).toBe("true"));
    fireEvent.click(screen.getByText("verify"));
    await waitFor(() => expect(signIn.finalize).toHaveBeenCalled());
    fireEvent.click(screen.getByText("cancel"));
    await act(async () => { release({}); });
    expect(authNavigation.navigateToAuthDestination).not.toHaveBeenCalled();
    expect(screen.getByTestId("verification-phase").textContent).toBe("idle");
  });

  it("does not grant member access when the loaded Clerk user lags the current identity", async () => {
    const { AuthShell } = await loadProvider(true);
    watchResult = { _id: "profile-b", status: "active" };
    clerk.userId = "user-b";
    clerk.sessionId = "session-b";
    user = { id: "user-a", primaryEmailAddress: { emailAddress: "a@example.com" }, primaryPhoneNumber: null };
    render(<AuthShell><Probe /></AuthShell>);
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("anonymous"));
    expect(screen.getByTestId("ready").textContent).toBe("false");
  });

  it("holds navigation while a signed-in Clerk session awaits Convex authentication", async () => {
    convexAuth.isAuthenticated = false;
    const { AuthShell } = await loadProvider(true);
    render(<AuthShell><Probe /></AuthShell>);
    expect(screen.getByTestId("viewer").textContent).toBe("anonymous");
    expect(screen.getByTestId("ready").textContent).toBe("false");
    convexAuth.isAuthenticated = true;
    watchResult = { _id: "profile-a", status: "active" };
    act(() => rerenderClerk?.());
    await waitFor(() => expect(screen.getByTestId("viewer").textContent).toBe("member"));
    expect(screen.getByTestId("ready").textContent).toBe("true");
  });

  it("carries a StrictMode sign-in submit into the real verification page", async () => {
    const { AuthShell } = await loadProvider(true);
    const { default: SignInPage } = await import("@/app/signin/page");
    const { default: VerifyPage } = await import("@/app/verify/page");
    const view = render(<StrictMode><AuthShell><SignInPage /></AuthShell></StrictMode>);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "a@example.com" } });
    fireEvent.submit(screen.getByLabelText("Email address").closest("form")!);
    await waitFor(() => expect(navigation.router.push).toHaveBeenCalledWith("/verify?next=%2Fhome"));
    view.rerender(<StrictMode><AuthShell><VerifyPage /></AuthShell></StrictMode>);
    await waitFor(() => expect(screen.getByLabelText("Six digit code")).toBeTruthy());
    expect(screen.getByText(/Sent to/)).toBeTruthy();
  });
});
