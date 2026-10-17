// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import { AnalyticsProvider, useAnalytics } from "../lib/analytics/provider";
import { AnalyticsController, type AnalyticsIdentity, type AnalyticsTransport } from "../lib/analytics/controller";
import type { AnalyticsPreference, AnalyticsPreferenceTransport } from "../lib/analytics/preference-transport";

let authValue: AuthValue;
vi.mock("../lib/auth/provider", () => ({ useAuth: () => authValue }));

const id = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const eventTime = "2026-09-16T12:00:00.000Z";
const config = { enabled: true, token: "0123456789abcdef0123456789abcdef", environment: "development" as const };

function memberEvent(requestId: string, eventId: string, authState: "guest" | "member" = "member", occurredAt = eventTime) {
  return {
    event: "comparison_saved",
    properties: {
      event_version: 1,
      environment: "development",
      release: "0.1.0",
      auth_state: authState,
      feature: "comparison",
      route_name: "account",
      event_id: id(eventId),
      occurred_at: occurredAt,
      request_id: id(requestId),
      path: "queued",
    },
  };
}

function guestEvent(draftId: string, eventId: string, authState: "guest" | "member" = "guest", occurredAt = eventTime) {
  return {
    event: "comparison_started",
    properties: {
      event_version: 1,
      environment: "development",
      release: "0.1.0",
      auth_state: authState,
      feature: "comparison",
      route_name: "compare_results",
      event_id: id(eventId),
      occurred_at: occurredAt,
      draft_id: id(draftId),
    },
  };
}

function controller(options: Partial<ConstructorParameters<typeof AnalyticsController>[0]> = {}) {
  let clock = Date.parse(eventTime);
  const sends: Array<{ eventId: string; authState: string; identity: AnalyticsIdentity }> = [];
  const factory = vi.fn(async (_identity: Readonly<AnalyticsIdentity>): Promise<AnalyticsTransport> => ({
    send: vi.fn(async (event, identity) => {
      sends.push({ eventId: event.properties.event_id, authState: event.properties.auth_state, identity: { ...identity } });
    }),
  }));
  const { transportFactory = factory, ...rest } = options;
  const instance = new AnalyticsController({ now: () => clock, randomId: () => id("900"), ...rest, transportFactory });
  return { instance, factory, sends, advance(ms: number) { clock += ms; } };
}

function session(profileId: string, isCurrent: () => boolean = () => true): PrivateSessionAccess {
  return {
    identity: { profileId, subject: `subject-${profileId}`, sessionId: `session-${profileId}`, authEpoch: 1, verifiedOnline: true },
    getToken: async () => null,
    isCurrent,
  };
}

function auth(viewer: "guest" | "member", privateSession: PrivateSessionAccess | null = null, ready = true): AuthValue {
  return {
    viewer,
    guestIntent: viewer === "guest",
    privateSession,
    ready,
    configured: true,
    gating: "enforced",
    demoMode: false,
    account: null,
    accountKey: privateSession?.identity.profileId ?? null,
    authEpoch: 1,
    authCompletionEpoch: 0,
    authCompletionSessionId: null,
    pendingEmail: null,
    pendingNext: "/home",
    verificationReady: false,
    verificationPhase: "idle",
    initiatingTabId: "synthetic-tab",
    unavailableReason: null,
    retryProvisioning: vi.fn(),
    sendCode: vi.fn(),
    verifyCode: vi.fn(),
    continueAsGuest: vi.fn(),
    signOut: vi.fn(),
    cancelVerification: vi.fn(),
  };
}

function preference(consent: AnalyticsPreference["consent"], accountId: string, revision: number): AnalyticsPreference {
  return { consent, policyVersion: "v1", revision, analyticsAccountId: consent === "accepted" ? accountId : null, sendPermission: consent === "accepted" };
}

function transport(read: AnalyticsPreference | Promise<AnalyticsPreference>): AnalyticsPreferenceTransport {
  return { read: vi.fn(() => Promise.resolve(read)), write: vi.fn(async () => preference("declined", id("999"), 99)) };
}

function Probe() {
  const analytics = useAnalytics();
  const [trackResult, setTrackResult] = useState("");
  const [lastEventId, setLastEventId] = useState("");
  const track = () => {
    const result = analytics.track(({ eventId, newCorrelationId }) => {
      setLastEventId(eventId);
      return ({
      event: "comparison_started",
      properties: {
        event_version: 1,
        environment: "development",
        release: "0.1.0",
        auth_state: authValue.viewer === "member" ? "member" : "guest",
        feature: "comparison",
        route_name: "compare",
        event_id: eventId,
        occurred_at: new Date().toISOString(),
        draft_id: newCorrelationId(),
      },
      });
    });
    setTrackResult(result.ok ? "ok" : result.code);
  };
  return <div>
    <output data-testid="status">{analytics.status}</output>
    <output data-testid="queue">{analytics.snapshot?.queueLength ?? 0}</output>
    <output data-testid="track-result">{trackResult}</output>
    <output data-testid="event-id">{lastEventId}</output>
    <button onClick={track}>track</button>
  </div>;
}

describe("analytics account-switch isolation", () => {
  beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); authValue = auth("guest"); });
  afterEach(() => { cleanup(); Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); });

  it.each(["unknown", "declined"] as const)("drops A's queued work when mounted provider scope becomes %s B", async (consent) => {
    const accountA = id("201");
    const sends: Array<{ identity: AnalyticsIdentity }> = [];
    const factory = vi.fn(async () => ({ send: vi.fn(async (_event: unknown, identity: AnalyticsIdentity) => { sends.push({ identity: { ...identity } }); }) }));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    authValue = auth("member", session("profile-a"));
    const view = render(<AnalyticsProvider config={config} preferenceTransport={transport(preference("accepted", accountA, 1))} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByText("track").click(); });
    await waitFor(() => expect(screen.getByTestId("queue").textContent).toBe("1"));

    authValue = auth("member", session("profile-b"));
    await act(async () => { view.rerender(<AnalyticsProvider config={config} preferenceTransport={transport(preference(consent, id("202"), 2))} transportFactory={factory}><Probe /></AnalyticsProvider>); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe(consent));
    expect(screen.getByTestId("queue").textContent).toBe("0");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled();
    expect(sends).toEqual([]);
  });

  it("delivers only B's accepted event after a mounted A to B switch", async () => {
    const accountB = id("212");
    const sends: Array<{ eventId: string; identity: AnalyticsIdentity }> = [];
    const factory = vi.fn(async () => ({ send: vi.fn(async (event: { properties: { event_id: string } }, identity: AnalyticsIdentity) => { sends.push({ eventId: event.properties.event_id, identity: { ...identity } }); }) }));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    authValue = auth("member", session("profile-a"));
    const view = render(<AnalyticsProvider config={config} preferenceTransport={transport(preference("accepted", id("211"), 1))} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByText("track").click(); });
    await waitFor(() => expect(screen.getByTestId("queue").textContent).toBe("1"));

    authValue = auth("member", session("profile-b"));
    await act(async () => { view.rerender(<AnalyticsProvider config={config} preferenceTransport={transport(preference("accepted", accountB, 2))} transportFactory={factory}><Probe /></AnalyticsProvider>); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => { screen.getByText("track").click(); });
    const eventB = screen.getByTestId("event-id").textContent;
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(sends[0].eventId).toBe(eventB);
    expect(sends[0].identity).toEqual({ anonymousId: null, memberAnalyticsId: accountB });
    expect(factory).toHaveBeenCalledWith({ anonymousId: null, memberAnalyticsId: accountB });
  });

  it("disposes a delayed A factory through the mounted provider after switching to B", async () => {
    const accountA = id("221");
    const accountB = id("222");
    let releaseA!: (transport: AnalyticsTransport) => void;
    const pendingA = new Promise<AnalyticsTransport>((resolve) => { releaseA = resolve; });
    const sends: Array<{ eventId: string; identity: AnalyticsIdentity }> = [];
    const sendA = vi.fn(async () => undefined);
    const disposeA = vi.fn();
    const sendB = vi.fn(async (event: Readonly<{ properties: { event_id: string } }>, identity: Readonly<AnalyticsIdentity>) => { sends.push({ eventId: event.properties.event_id, identity: { ...identity } }); });
    const factory = vi.fn((identity: Readonly<AnalyticsIdentity>) => identity.memberAnalyticsId === accountA
      ? pendingA
      : Promise.resolve<AnalyticsTransport>({ send: sendB }));
    authValue = auth("member", session("profile-a"));
    const view = render(<AnalyticsProvider config={config} preferenceTransport={transport(preference("accepted", accountA, 1))} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByText("track").click(); });
    await waitFor(() => expect(factory).toHaveBeenCalledWith({ anonymousId: null, memberAnalyticsId: accountA }));

    authValue = auth("member", session("profile-b"));
    await act(async () => { view.rerender(<AnalyticsProvider config={config} preferenceTransport={transport(preference("accepted", accountB, 2))} transportFactory={factory}><Probe /></AnalyticsProvider>); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByText("track").click(); });
    await waitFor(() => expect(sends).toHaveLength(1));
    releaseA({ send: sendA, dispose: disposeA });
    await waitFor(() => expect(disposeA).toHaveBeenCalledOnce());

    expect(sendA).not.toHaveBeenCalled();
    expect(sends).toEqual([{ eventId: expect.any(String), identity: { anonymousId: null, memberAnalyticsId: accountB } }]);
  });

  it("preserves valid guest and member event labels with their identities", async () => {
    const sent: Array<{ authState: string; identity: AnalyticsIdentity }> = [];
    const factory = vi.fn(async () => ({ send: vi.fn(async (event: Readonly<{ properties: { auth_state: string } }>, identity: Readonly<AnalyticsIdentity>) => { sent.push({ authState: event.properties.auth_state, identity: { ...identity } }); }) }));
    const h = controller({ transportFactory: factory });
    h.instance.acceptGuestConsent();
    expect(h.instance.enqueue(guestEvent("731", "732"))).toMatchObject({ ok: true });
    await h.instance.flush(true);
    expect(sent[0]).toMatchObject({ authState: "guest", identity: { anonymousId: id("900"), memberAnalyticsId: null } });

    h.instance.setMemberContext({ analyticsAccountId: id("231"), consent: "accepted" });
    expect(h.instance.enqueue(memberEvent("633", "733"))).toMatchObject({ ok: true });
    await h.instance.flush(true);
    expect(sent).toEqual([
      { authState: "guest", identity: { anonymousId: id("900"), memberAnalyticsId: null } },
      { authState: "member", identity: { anonymousId: null, memberAnalyticsId: id("231") } },
    ]);
  });

  it("does not let a stale A preference response activate B", async () => {
    let resolveA!: (value: AnalyticsPreference) => void;
    const delayedA = new Promise<AnalyticsPreference>((resolve) => { resolveA = resolve; });
    const factory = vi.fn(async () => ({ send: vi.fn(), dispose: vi.fn() }));
    authValue = auth("member", session("profile-a"));
    const view = render(<AnalyticsProvider config={config} preferenceTransport={transport(delayedA)} transportFactory={factory}><Probe /></AnalyticsProvider>);

    authValue = auth("member", session("profile-b"));
    view.rerender(<AnalyticsProvider config={config} preferenceTransport={transport(preference("declined", id("241"), 2))} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    await act(async () => {
      resolveA(preference("accepted", id("242"), 1));
      await delayedA;
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    expect(factory).not.toHaveBeenCalled();
    expect(screen.getByTestId("queue").textContent).toBe("0");
  });

  it("does not deliver queued A work after its verified session becomes stale", async () => {
    let currentA = true;
    const sends: unknown[] = [];
    const factory = vi.fn(async () => ({ send: vi.fn(async (event: unknown) => { sends.push(event); }) }));
    authValue = auth("member", session("profile-current", () => currentA));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<AnalyticsProvider config={config} preferenceTransport={transport(preference("accepted", id("251"), 1))} transportFactory={factory}><Probe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    await act(async () => { screen.getByText("track").click(); });
    await waitFor(() => expect(screen.getByTestId("queue").textContent).toBe("1"));

    currentA = false;
    await act(async () => { screen.getByText("track").click(); });
    expect(screen.getByTestId("track-result").textContent).toBe("not_consented");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(factory).not.toHaveBeenCalled();
    expect(sends).toEqual([]);
  });
});
