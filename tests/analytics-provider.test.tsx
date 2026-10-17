// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import { AnalyticsProvider, useAnalytics } from "../lib/analytics/provider";
import { AnalyticsConsent } from "../components/AnalyticsConsent";
import { AnalyticsPreferenceError, type AnalyticsPreference, type AnalyticsPreferenceTransport } from "../lib/analytics/preference-transport";
import { markConfirmedAnalyticsLogout, consumeConfirmedAnalyticsLogout, revokeAcceptedLocalAnalyticsPreference } from "../lib/analytics/storage";

let authValue: AuthValue;
vi.mock("../lib/auth/provider", () => ({ useAuth: () => authValue }));

const config = { enabled: true, token: "0123456789abcdef0123456789abcdef", environment: "development" as const };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pref = (consent: AnalyticsPreference["consent"], revision = 0): AnalyticsPreference => ({ consent, policyVersion: "v1", revision, analyticsAccountId: consent === "accepted" ? id(90) : null, sendPermission: consent === "accepted" });

function session(profileId: string): PrivateSessionAccess {
  return { identity: { profileId, subject: `subject-${profileId}`, sessionId: `session-${profileId}`, authEpoch: 1, verifiedOnline: true }, getToken: async () => null, isCurrent: () => true };
}
function auth(viewer: "guest" | "member", value: PrivateSessionAccess | null = null, ready = true): AuthValue {
  return { viewer, guestIntent: viewer === "guest", privateSession: value, ready, configured: true, gating: "enforced", demoMode: false, account: null, accountKey: value?.identity.profileId ?? null, authEpoch: 1, authCompletionEpoch: 0, authCompletionSessionId: null, pendingEmail: null, pendingNext: "/home", verificationReady: false, verificationPhase: "idle", initiatingTabId: "tab", unavailableReason: null, retryProvisioning: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), continueAsGuest: vi.fn(), signOut: vi.fn(), cancelVerification: vi.fn() };
}
function Probe() {
  const analytics = useAnalytics();
  const [, rerender] = useState(0);
  const track = () => { const result = analytics.track(({ eventId, newCorrelationId }) => ({ event: "comparison_started", properties: { event_version: 1, environment: "development", release: "0.1.0", auth_state: authValue.viewer === "member" ? "member" : "guest", feature: "comparison", route_name: "compare", event_id: eventId, occurred_at: new Date().toISOString(), draft_id: newCorrelationId() } })); rerender((value) => value + 1); return result; };
  return <div><output data-testid="status">{analytics.status}</output><output data-testid="error">{analytics.error ?? ""}</output><output data-testid="queue">{analytics.snapshot?.queueLength ?? 0}</output><button onClick={() => void analytics.accept()}>accept</button><button onClick={() => void analytics.decline()}>decline</button><button onClick={() => void analytics.withdraw()}>withdraw</button><button onClick={() => void analytics.retry()}>retry</button><button onClick={track}>track</button></div>;
}
function transport(readValue: AnalyticsPreference | Promise<AnalyticsPreference>, writeValue: AnalyticsPreference | Error = pref("declined", 1)): AnalyticsPreferenceTransport {
  return { read: vi.fn(() => Promise.resolve(readValue)), write: vi.fn(async () => { if (writeValue instanceof Error) throw writeValue; return writeValue; }) };
}

describe("analytics consent provider", () => {
  beforeEach(() => { window.localStorage.clear(); authValue = auth("guest"); });
  afterEach(() => { cleanup(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });

  it("is disabled without reading preference or creating a tracker", () => {
    const read = vi.fn();
    render(<AnalyticsProvider config={{ enabled: false, token: null, environment: null }} preferenceTransport={{ read, write: vi.fn() }}><Probe /></AnalyticsProvider>);
    expect(screen.getByTestId("status").textContent).toBe("disabled");
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps guest consent unknown until an explicit choice, then creates a local identity", async () => {
    const factory = vi.fn(async () => ({ send: vi.fn(async () => undefined), dispose: vi.fn() }));
    render(<AnalyticsProvider config={config} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unknown"));
    expect(factory).not.toHaveBeenCalled();
    await act(async () => { screen.getByText("accept").click(); });
    expect(screen.getByTestId("status").textContent).toBe("accepted");
    expect(JSON.parse(window.localStorage.getItem("truecost.analytics.preference.v1")!).consent).toBe("accepted");
  });

  it("does not hydrate guest consent while auth is still becoming ready", async () => {
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    const read = vi.fn(async () => pref("declined", 1));
    const factory = vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }));
    authValue = auth("guest", null, false);
    const view = render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    expect(screen.getByTestId("status").textContent).toBe("loading");
    screen.getByText("track").click();
    expect(screen.getByTestId("queue").textContent).toBe("0");
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();

    const current = session("profile-auth-readiness");
    authValue = auth("member", current, true);
    view.rerender(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    expect(read).toHaveBeenCalledOnce();
    expect(factory).not.toHaveBeenCalled();
  });

  it("does not revive accepted guest tracking after member withdrawal and confirmed sign-out", async () => {
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    const current = session("profile-withdraw-signout");
    let remoteConsent: AnalyticsPreference["consent"] = "accepted";
    const read = vi.fn(async () => pref(remoteConsent, 2));
    const write = vi.fn(async () => { remoteConsent = "declined"; return pref("declined", 3); });
    const factory = vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }));
    authValue = auth("member", current);
    const view = render(<AnalyticsProvider config={config} preferenceTransport={{ read, write }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByText("withdraw").click(); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));

    authValue = auth("guest");
    view.rerender(<AnalyticsProvider config={config} preferenceTransport={{ read, write }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    screen.getByText("track").click();
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled();
  });

  it("keeps a declined member preference after sign-out and a guest remount", async () => {
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    const current = session("profile-declined-signout");
    const read = vi.fn(async () => pref("declined", 4));
    const write = vi.fn();
    const factory = vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }));
    authValue = auth("member", current);
    const view = render(<AnalyticsProvider config={config} preferenceTransport={{ read, write }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));

    authValue = auth("guest");
    view.rerender(<AnalyticsProvider config={config} preferenceTransport={{ read, write }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    view.unmount();

    render(<AnalyticsProvider config={config} preferenceTransport={{ read, write }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    screen.getByText("track").click();
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled();
  });

  it("clears accepted guest consent only after an authoritative logout", async () => {
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    const current = session("profile-ordinary-signout");
    const read = vi.fn(async () => pref("accepted", 2));
    const factory = vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }));
    authValue = auth("member", current);
    const view = render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    expect(JSON.parse(window.localStorage.getItem("truecost.analytics.preference.v1")!).consent).toBe("accepted");

    // This marker is written only by AuthProvider after Clerk.signOut resolves.
    markConfirmedAnalyticsLogout();
    authValue = auth("guest");
    view.rerender(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unknown"));
    expect(window.localStorage.getItem("truecost.analytics.preference.v1")).toBeNull();
    expect(factory).not.toHaveBeenCalled();

    view.unmount();
    render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unknown"));
    expect(factory).not.toHaveBeenCalled();
  });

  it("preserves accepted guest consent when no logout is confirmed", async () => {
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    const current = session("profile-unconfirmed-signout");
    const read = vi.fn(async () => pref("accepted", 2));
    const factory = vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }));
    authValue = auth("member", current);
    const view = render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));

    // Scope loss alone is recoverable and must not erase a consent choice.
    authValue = auth("guest");
    view.rerender(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    expect(JSON.parse(window.localStorage.getItem("truecost.analytics.preference.v1")!).consent).toBe("accepted");
  });

  it("preserves a declined withdrawal when consuming an ordinary logout", () => {
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "declined", policyVersion: "v1" }));
    markConfirmedAnalyticsLogout();
    expect(consumeConfirmedAnalyticsLogout()).toBe("cleared");
    expect(JSON.parse(window.localStorage.getItem("truecost.analytics.preference.v1")!).consent).toBe("declined");
    expect(window.localStorage.getItem("truecost.analytics.confirmed-logout.v1")).toBeNull();
  });

  it("keeps the logout marker when accepted consent cannot be cleared", () => {
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    markConfirmedAnalyticsLogout();
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => { throw new Error("quota"); });
    expect(consumeConfirmedAnalyticsLogout()).toBe("retry");
    expect(window.localStorage.getItem("truecost.analytics.confirmed-logout.v1")).toBeTruthy();
    remove.mockRestore();
  });

  it("revokes accepted consent when the durable logout marker cannot be written", () => {
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("quota"); });
    markConfirmedAnalyticsLogout();
    set.mockRestore();
    expect(revokeAcceptedLocalAnalyticsPreference()).toBe(true);
    expect(window.localStorage.getItem("truecost.analytics.preference.v1")).toBeNull();
  });

  it("mounts an equal guest consent choice without blocking comparison controls", async () => {
    render(<AnalyticsProvider config={config}><AnalyticsConsent /><button type="button">Compare offers</button></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Optional product analytics" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Accept analytics" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline analytics" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compare offers" })).toBeTruthy();
  });

  it("loads a member preference only through the supplied verified session", async () => {
    const current = session("profile-a");
    authValue = auth("member", current);
    const read = vi.fn(async () => pref("accepted", 3));
    render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }))}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    expect(read).toHaveBeenCalledOnce();
  });

  it("does not replay a member event attempted while preference is loading", async () => {
    let resolvePreference!: (value: AnalyticsPreference) => void;
    const pendingPreference = new Promise<AnalyticsPreference>((resolve) => { resolvePreference = resolve; });
    const send = vi.fn(async () => undefined);
    const factory = vi.fn(async () => ({ send, dispose: vi.fn() }));
    authValue = auth("member", session("profile-loading"));
    render(<AnalyticsProvider config={config} preferenceTransport={transport(pendingPreference)} transportFactory={factory}><Probe /></AnalyticsProvider>);
    expect(screen.getByTestId("status").textContent).toBe("loading");
    screen.getByText("track").click();
    expect(screen.getByTestId("queue").textContent).toBe("0");

    await act(async () => { resolvePreference(pref("accepted", 5)); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    expect(send).not.toHaveBeenCalled();

    await act(async () => { screen.getByText("track").click(); });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
  });

  it("revokes immediately and retains a pending decline when the server write fails", async () => {
    const current = session("profile-b");
    authValue = auth("member", current);
    const writes = vi.fn(async () => { throw new Error("offline"); });
    render(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => pref("accepted", 4)), write: writes }} transportFactory={vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }))}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByText("withdraw").click(); });
    expect(screen.getByTestId("status").textContent).toBe("pending");
    expect(window.localStorage.getItem("truecost.analytics.pending-decline.v1.profile-b")).toBeTruthy();
  });

  it("keeps guest consent declined across remounts after a failed member withdrawal", async () => {
    const current = session("profile-withdraw-retry");
    const send = vi.fn(async () => undefined);
    const factory = vi.fn(async () => ({ send, dispose: vi.fn() }));
    const read = vi.fn(async () => pref("accepted", 4));
    const write = vi.fn(async () => { throw new Error("offline"); });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    authValue = auth("member", current);
    const view = render(<AnalyticsProvider config={config} preferenceTransport={{ read, write }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    screen.getByText("track").click();
    await waitFor(() => expect(screen.getByTestId("queue").textContent).toBe("1"));

    await act(async () => { screen.getByText("withdraw").click(); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("pending"));
    expect(write).toHaveBeenCalledWith("declined", 4);
    expect(window.localStorage.getItem("truecost.analytics.preference.v1")).toContain('"declined"');
    expect(window.localStorage.getItem("truecost.analytics.pending-decline.v1.profile-withdraw-retry")).toBeTruthy();

    authValue = auth("guest");
    view.rerender(<AnalyticsProvider config={config} preferenceTransport={{ read, write }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    view.unmount();

    render(<AnalyticsProvider config={config} preferenceTransport={{ read, write }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await act(async () => { screen.getByText("track").click(); });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a member preference write failure and retries the local decline", async () => {
    let blocked = true;
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (blocked && key === "truecost.analytics.preference.v1") throw new Error("storage blocked");
      return originalSetItem.call(this, key, value);
    });
    try {
      const current = session("profile-local-retry");
      let remoteConsent: AnalyticsPreference["consent"] = "accepted";
      const read = vi.fn(async () => pref(remoteConsent, remoteConsent === "accepted" ? 4 : 5));
      const write = vi.fn(async () => { remoteConsent = "declined"; return pref("declined", 5); });
      authValue = auth("member", current);
      render(<AnalyticsProvider config={config} preferenceTransport={{ read, write }}><Probe /></AnalyticsProvider>);
      await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
      await act(async () => { screen.getByText("withdraw").click(); });
      await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
      expect(screen.getByTestId("error").textContent).toBe("This browser could not save your analytics choice.");

      blocked = false;
      await act(async () => { screen.getByText("retry").click(); });
      await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
      expect(write).toHaveBeenCalledWith("declined", 4);
      expect(JSON.parse(window.localStorage.getItem("truecost.analytics.preference.v1")!).consent).toBe("declined");
    } finally {
      setItem.mockRestore();
    }
  });

  it("reports a local mirror failure while hydrating a declined server preference", async () => {
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "truecost.analytics.preference.v1") throw new Error("storage blocked");
      return originalSetItem.call(this, key, value);
    });
    try {
      const read = vi.fn(async () => pref("declined", 5));
      const factory = vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }));
      authValue = auth("member", session("profile-server-declined"));
      render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
      await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
      expect(screen.getByTestId("error").textContent).toBe("This browser could not save your analytics choice.");
      expect(read).toHaveBeenCalledOnce();
      expect(factory).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("truecost.analytics.preference.v1")).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });

  it("drops a late preference response after the verified account changes", async () => {
    let resolve!: (value: AnalyticsPreference) => void;
    const delayed = new Promise<AnalyticsPreference>((done) => { resolve = done; });
    authValue = auth("member", session("profile-c"));
    const { rerender } = render(<AnalyticsProvider config={config} preferenceTransport={transport(delayed)}><Probe /></AnalyticsProvider>);
    authValue = auth("member", session("profile-d"));
    rerender(<AnalyticsProvider config={config} preferenceTransport={transport(pref("declined", 2))}><Probe /></AnalyticsProvider>);
    resolve(pref("accepted", 1));
    await waitFor(() => expect(screen.getByTestId("status").textContent).not.toBe("accepted"));
  });

  it("stays safe when the preference backend is unavailable and survives StrictMode", async () => {
    authValue = auth("member", session("profile-e"));
    const read = vi.fn(async () => { throw new Error("unavailable"); });
    render(<StrictMode><AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }}><Probe /></AnalyticsProvider></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(read.mock.calls.length).toBeGreaterThan(0);
  });

  it("re-reads the current revision before replaying a pending withdrawal", async () => {
    authValue = auth("member", session("profile-f"));
    window.localStorage.setItem("truecost.analytics.pending-decline.v1.profile-f", JSON.stringify({ revision: 2, nonce: id(77) }));
    const read = vi.fn(async () => pref("accepted", 8));
    const write = vi.fn(async (_consent: "accepted" | "declined", expected: number) => { expect(expected).toBe(8); return pref("declined", 9); });
    render(<AnalyticsProvider config={config} preferenceTransport={{ read, write }}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    expect(read).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("truecost.analytics.pending-decline.v1.profile-f")).toBeNull();
  });

  it("revokes a guest controller when storage withdrawal arrives", async () => {
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    const dispose = vi.fn();
    render(<AnalyticsProvider config={config} transportFactory={vi.fn(async () => ({ send: vi.fn(), dispose }))}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    window.localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "declined", policyVersion: "v1" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "truecost.analytics.preference.v1" }));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    expect(dispose).not.toHaveBeenCalled();
  });

  it("fails closed on a corrupt pending withdrawal and does not read server acceptance", async () => {
    authValue = auth("member", session("profile-g"));
    window.localStorage.setItem("truecost.analytics.pending-decline.v1.profile-g", "corrupt");
    const read = vi.fn(async () => pref("accepted", 4));
    render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(read).not.toHaveBeenCalled();
  });

  it("ignores a preference response that settles after unmount", async () => {
    let resolve!: (value: AnalyticsPreference) => void;
    const delayed = new Promise<AnalyticsPreference>((done) => { resolve = done; });
    authValue = auth("member", session("profile-h"));
    const read = vi.fn(() => delayed);
    const view = render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }}><Probe /></AnalyticsProvider>);
    view.unmount();
    resolve(pref("accepted", 2));
    await Promise.resolve();
    expect(read).toHaveBeenCalledOnce();
  });

  it("fails closed when pending withdrawal storage is unavailable", async () => {
    authValue = auth("member", session("profile-i"));
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      const read = vi.fn(async () => pref("accepted", 2));
      render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }}><Probe /></AnalyticsProvider>);
      await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
      expect(read).not.toHaveBeenCalled();
    } finally { if (descriptor) Object.defineProperty(window, "localStorage", descriptor); }
  });

  it("contains an unavailable Convex preference URL without an unhandled rejection", async () => {
    authValue = auth("member", session("profile-url"));
    const saved = process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    try {
      render(<AnalyticsProvider config={config}><Probe /></AnalyticsProvider>);
      await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_CONVEX_URL;
      else process.env.NEXT_PUBLIC_CONVEX_URL = saved;
    }
  });

  it("does not activate an accept response if withdrawal appears while it is pending", async () => {
    authValue = auth("member", session("profile-j"));
    let resolve!: (value: AnalyticsPreference) => void;
    const write = vi.fn(() => new Promise<AnalyticsPreference>((done) => { resolve = done; }));
    render(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => pref("unknown", 3)), write }}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unknown"));
    await act(async () => { screen.getByText("accept").click(); });
    window.localStorage.setItem("truecost.analytics.pending-decline.v1.profile-j", JSON.stringify({ revision: 3, nonce: id(78) }));
    resolve(pref("accepted", 4));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("pending"));
  });

  it("preserves a matching accepted controller on a same-account refresh", async () => {
    authValue = auth("member", session("profile-k"));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const read = vi.fn(async () => pref("accepted", 5));
    const factory = vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }));
    render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    screen.getByText("track").click();
    await waitFor(() => expect(screen.getByTestId("queue").textContent).toBe("1"));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByTestId("queue").textContent).toBe("1");
    screen.getByText("track").click();
    expect(screen.getByTestId("queue").textContent).toBe("1");
    expect(factory).not.toHaveBeenCalled();
  });

  it("clears queued events when the same session receives a replacement analytics account", async () => {
    authValue = auth("member", session("profile-replace"));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const read = vi.fn().mockResolvedValueOnce(pref("accepted", 1)).mockResolvedValueOnce({ ...pref("accepted", 2), analyticsAccountId: id(91) });
    render(<AnalyticsProvider config={config} preferenceTransport={{ read, write: vi.fn() }}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    screen.getByText("track").click();
    await waitFor(() => expect(screen.getByTestId("queue").textContent).toBe("1"));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByTestId("queue").textContent).toBe("0");
  });

  it("does not clear a newer withdrawal marker after an older acknowledgement", async () => {
    authValue = auth("member", session("profile-marker"));
    window.localStorage.setItem("truecost.analytics.pending-decline.v1.profile-marker", JSON.stringify({ revision: 2, nonce: id(81) }));
    let resolve!: (value: AnalyticsPreference) => void;
    const write = vi.fn(() => new Promise<AnalyticsPreference>((done) => { resolve = done; }));
    render(<AnalyticsProvider config={config} preferenceTransport={{ read: vi.fn(async () => pref("accepted", 8)), write }}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    window.localStorage.setItem("truecost.analytics.pending-decline.v1.profile-marker", JSON.stringify({ revision: 9, nonce: id(82) }));
    resolve(pref("declined", 9));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    expect(JSON.parse(window.localStorage.getItem("truecost.analytics.pending-decline.v1.profile-marker")!).nonce).toBe(id(82));
  });

  it("retries one stale pending CAS against a fresh revision", async () => {
    authValue = auth("member", session("profile-cas"));
    window.localStorage.setItem("truecost.analytics.pending-decline.v1.profile-cas", JSON.stringify({ revision: 2, nonce: id(83) }));
    const read = vi.fn().mockResolvedValueOnce(pref("accepted", 8)).mockResolvedValueOnce(pref("accepted", 9));
    const write = vi.fn().mockRejectedValueOnce(new AnalyticsPreferenceError("conflict")).mockResolvedValueOnce(pref("declined", 10));
    render(<AnalyticsProvider config={config} preferenceTransport={{ read, write }}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    expect(read).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem("truecost.analytics.pending-decline.v1.profile-cas")).toBeNull();
  });
});
