// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import { AnalyticsProvider, disposeMemberAnalyticsLocally, useAnalytics } from "../lib/analytics/provider";
import { AnalyticsController } from "../lib/analytics/controller";
import { rememberFeedbackContext, comparisonFeedbackContext } from "../lib/feedback/context";
import { publishPrivateBrowserClearSignal } from "../lib/privacy/private-browser-clear-signal";

let authValue: AuthValue;
vi.mock("../lib/auth/provider", () => ({ useAuth: () => authValue }));

const config = { enabled: true, token: "0123456789abcdef0123456789abcdef", environment: "development" as const };
const memberIdentity = { profileId: "profile-a", subject: "subject-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true as const };
const preference = { consent: "accepted" as const, policyVersion: "v1" as const, revision: 4, analyticsAccountId: "00000000-0000-4000-8000-000000000090", sendPermission: true };
let clearRuntime: (() => Promise<{ kind: "cleared" } | { kind: "retry"; reason: "storage-unavailable" }>) | null = null;

function memberSession(): PrivateSessionAccess {
  return { identity: memberIdentity, getToken: vi.fn(async () => "token"), isCurrent: () => true };
}

function memberAuth(session: PrivateSessionAccess): AuthValue {
  return {
    viewer: "member", account: null, accountKey: session.identity.profileId, privateSession: session,
    ready: true, configured: true, gating: "enforced", demoMode: false, guestIntent: false,
    authEpoch: 1, authCompletionEpoch: 0, authCompletionSessionId: null, initiatingTabId: "tab-a",
    unavailableReason: null, pendingEmail: null, pendingNext: "/home", verificationReady: false, verificationPhase: "idle",
    retryProvisioning: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), continueAsGuest: vi.fn(), signOut: vi.fn(async () => undefined), cancelVerification: vi.fn(),
  };
}

function guestAuth(): AuthValue {
  const value = memberAuth(memberSession());
  return { ...value, viewer: "guest", guestIntent: true, privateSession: null, accountKey: null };
}

function Probe() {
  const analytics = useAnalytics();
  clearRuntime = analytics.clearPrivateRuntime;
  const track = () => analytics.track(({ eventId, newCorrelationId }) => ({ event: "comparison_started", properties: { event_version: 1, environment: "development", release: "0.1.0", auth_state: "member", feature: "comparison", route_name: "compare", event_id: eventId, occurred_at: new Date().toISOString(), draft_id: newCorrelationId() } }));
  return <><output data-testid="status">{analytics.status}</output><output data-testid="queue">{analytics.snapshot?.queueLength ?? 0}</output><output data-testid="identity">{String(analytics.snapshot?.hasIdentity ?? false)}</output><button type="button" onClick={track}>track</button></>;
}

class FakeBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {}
  postMessage(): void {}
  close(): void {}
}

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  window.localStorage.clear();
  window.sessionStorage.clear();
  authValue = memberAuth(memberSession());
});

afterEach(() => { clearRuntime = null; cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

describe("member analytics browser-clear disposal", () => {
  it("disposes the member queue and SDK locally while preserving consent and guest storage", async () => {
    const send = vi.fn(() => new Promise<void>(() => undefined));
    const dispose = vi.fn();
    const factory = vi.fn(async () => ({ send, dispose }));
    const preferenceRead = vi.fn(async () => preference);
    const preferenceWrite = vi.fn();
    render(<AnalyticsProvider config={config} preferenceTransport={{ read: preferenceRead, write: preferenceWrite }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByRole("button", { name: "track" }).click(); });
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    window.localStorage.setItem("truecost.analytics.pending-decline.v1.profile-a", JSON.stringify({ revision: 4, nonce: "00000000-0000-4000-8000-000000000004" }));
    window.sessionStorage.setItem("truecost.analytics.guest-join.v1", JSON.stringify({ flowId: "00000000-0000-4000-8000-000000000005", anonymousId: "00000000-0000-4000-8000-000000000006", createdAt: Date.now(), sessionId: "session-a" }));
    rememberFeedbackContext("profile-a", "comparison", comparisonFeedbackContext("00000000-0000-4000-8000-000000000001"));
    const beforePreference = window.localStorage.getItem("truecost.analytics.preference.v1");
    const sendsBeforeClear = send.mock.calls.length;
    await act(async () => { publishPrivateBrowserClearSignal(); });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.length).toBe(sendsBeforeClear);
    expect(preferenceWrite).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("truecost.analytics.preference.v1")).toBe(beforePreference);
    expect(window.localStorage.getItem("truecost.analytics.pending-decline.v1.profile-a")).toBeTruthy();
    expect(window.sessionStorage.getItem("truecost.analytics.guest-join.v1")).toBeNull();
    expect(window.sessionStorage.getItem("truecost.feedback.context.v1.profile-a.comparison")).toBeNull();
    expect(screen.getByTestId("queue").textContent).toBe("0");
    expect(screen.getByTestId("identity").textContent).toBe("false");
  });

  it("reports unavailable namespaced storage without changing the consent preference", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    const originalSession = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(await disposeMemberAnalyticsLocally(null)).toEqual({ kind: "retry", reason: "storage-unavailable" });
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      if (originalSession) Object.defineProperty(window, "sessionStorage", originalSession);
    }
  });

  it("keeps an unbound guest join marker when a browser clear signal arrives", async () => {
    authValue = guestAuth();
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    render(<AnalyticsProvider config={config}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    const marker = JSON.stringify({ flowId: "00000000-0000-4000-8000-000000000007", anonymousId: "00000000-0000-4000-8000-000000000008", createdAt: Date.now() });
    window.sessionStorage.setItem("truecost.analytics.guest-join.v1", marker);
    await act(async () => { publishPrivateBrowserClearSignal(); });
    expect(window.sessionStorage.getItem("truecost.analytics.guest-join.v1")).toBe(marker);
  });

  it("retains a failed SDK disposal capability for a coordinator retry", async () => {
    let attempts = 0;
    const dispose = vi.fn(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("SDK busy")) : Promise.resolve();
    });
    const timestamp = "2026-09-17T12:00:00.000Z";
    const controller = new AnalyticsController({ now: () => Date.parse(timestamp), transportFactory: async () => ({ send: vi.fn(async () => undefined), dispose }) });
    controller.setMemberContext({ analyticsAccountId: preference.analyticsAccountId, consent: "accepted" });
    controller.enqueue({ event: "comparison_started", properties: { event_version: 1, environment: "development", release: "0.1.0", auth_state: "member", feature: "comparison", route_name: "compare", event_id: "00000000-0000-4000-8000-000000000010", occurred_at: timestamp, draft_id: "00000000-0000-4000-8000-000000000011" } });
    await controller.flush(true);
    expect(await disposeMemberAnalyticsLocally(controller)).toEqual({ kind: "retry", reason: "storage-unavailable" });
    expect(await disposeMemberAnalyticsLocally(controller)).toEqual({ kind: "cleared" });
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("coalesces signal and coordinator cleanup and retries a failed provider disposal", async () => {
    let attempts = 0;
    const dispose = vi.fn(() => attempts++ === 0 ? Promise.reject(new Error("busy")) : Promise.resolve());
    const factory = vi.fn(async () => ({ send: vi.fn(async () => undefined), dispose }));
    render(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => preference), write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByRole("button", { name: "track" }).click(); });
    await waitFor(() => expect(factory).toHaveBeenCalledOnce());
    const first = clearRuntime!();
    const second = clearRuntime!();
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ kind: "retry", reason: "storage-unavailable" });
    await expect(second).resolves.toEqual({ kind: "retry", reason: "storage-unavailable" });
    await expect(clearRuntime!()).resolves.toEqual({ kind: "cleared" });
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("retains a failed member disposer across a member-to-guest transition", async () => {
    let attempts = 0;
    const dispose = vi.fn(() => attempts++ === 0 ? Promise.reject(new Error("busy")) : Promise.resolve());
    const factory = vi.fn(async () => ({ send: vi.fn(async () => undefined), dispose }));
    const view = render(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => preference), write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByRole("button", { name: "track" }).click(); });
    await waitFor(() => expect(factory).toHaveBeenCalledOnce());
    await expect(clearRuntime!()).resolves.toEqual({ kind: "retry", reason: "storage-unavailable" });
    authValue = guestAuth();
    view.rerender(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => preference), write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unknown"));
    await expect(clearRuntime!()).resolves.toEqual({ kind: "cleared" });
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("clears a failed member capability and the active next-member controller together", async () => {
    const sessionB: PrivateSessionAccess = {
      ...memberSession(),
      identity: { ...memberIdentity, profileId: "profile-b", subject: "subject-b", sessionId: "session-b" },
    };
    const disposeA = vi.fn()
      .mockRejectedValueOnce(new Error("A busy"))
      .mockResolvedValueOnce(undefined);
    const disposeB = vi.fn().mockResolvedValue(undefined);
    const factory = vi.fn(async () => factory.mock.calls.length === 1
      ? { send: vi.fn(async () => undefined), dispose: disposeA }
      : { send: vi.fn(async () => undefined), dispose: disposeB });
    const view = render(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => preference), write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByRole("button", { name: "track" }).click(); });
    await waitFor(() => expect(factory).toHaveBeenCalledOnce());
    await expect(clearRuntime!()).resolves.toEqual({ kind: "retry", reason: "storage-unavailable" });

    authValue = memberAuth(sessionB);
    view.rerender(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => preference), write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByRole("button", { name: "track" }).click(); });
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    await expect(clearRuntime!()).resolves.toEqual({ kind: "cleared" });
    expect(disposeA).toHaveBeenCalledTimes(2);
    expect(disposeB).toHaveBeenCalledOnce();
  });

  it("disposes a transport that resolves after the member clear fence", async () => {
    let resolveFactory!: (value: { send: () => Promise<void>; dispose: () => void }) => void;
    const factory = vi.fn(() => new Promise<{ send: () => Promise<void>; dispose: () => void }>((resolve) => { resolveFactory = resolve; }));
    const dispose = vi.fn();
    render(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => preference), write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByRole("button", { name: "track" }).click(); });
    await waitFor(() => expect(factory).toHaveBeenCalledOnce());
    await act(async () => { publishPrivateBrowserClearSignal(); });
    let settled = false;
    const cleanup = clearRuntime!().then((result) => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveFactory({ send: vi.fn(async () => undefined), dispose });
    await waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    await expect(cleanup).resolves.toEqual({ kind: "cleared" });
  });

  it("observes disposal failure when the verified member grant expires during factory creation", async () => {
    let current = true;
    const session: PrivateSessionAccess = { ...memberSession(), isCurrent: () => current };
    authValue = memberAuth(session);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    let resolveFactory!: (value: { send: () => Promise<void>; dispose: () => Promise<void> }) => void;
    const dispose = vi.fn()
      .mockRejectedValueOnce(new Error("SDK busy"))
      .mockResolvedValueOnce(undefined);
    const factory = vi.fn(() => new Promise<{ send: () => Promise<void>; dispose: () => Promise<void> }>((resolve) => { resolveFactory = resolve; }));
    render(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => preference), write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByRole("button", { name: "track" }).click(); });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(factory).toHaveBeenCalledOnce());
    current = false;
    await act(async () => { publishPrivateBrowserClearSignal(); });
    resolveFactory({ send: vi.fn(async () => undefined), dispose });
    await expect(clearRuntime!()).resolves.toEqual({ kind: "retry", reason: "storage-unavailable" });
    await expect(clearRuntime!()).resolves.toEqual({ kind: "cleared" });
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("bounds a never-resolving SDK disposal as retry", async () => {
    vi.useFakeTimers();
    try {
      const dispose = vi.fn(() => new Promise<void>(() => undefined));
      const controller = new AnalyticsController({ transportFactory: async () => ({ send: vi.fn(async () => undefined), dispose }) });
      controller.setMemberContext({ analyticsAccountId: preference.analyticsAccountId, consent: "accepted" });
      controller.enqueue({ event: "comparison_started", properties: { event_version: 1, environment: "development", release: "0.1.0", auth_state: "member", feature: "comparison", route_name: "compare", event_id: "00000000-0000-4000-8000-000000000012", occurred_at: new Date().toISOString(), draft_id: "00000000-0000-4000-8000-000000000013" } });
      // Materialize the transport before exercising its disposal deadline.
      await controller.flush(true);
      const result = disposeMemberAnalyticsLocally(controller);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(result).resolves.toEqual({ kind: "retry", reason: "storage-unavailable" });
      expect(dispose).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
