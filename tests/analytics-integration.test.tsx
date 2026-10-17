// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import { AnalyticsProvider, useAnalytics } from "../lib/analytics/provider";
import type { AnalyticsPreference, AnalyticsPreferenceTransport } from "../lib/analytics/preference-transport";
import type { AnalyticsEvent } from "../lib/analytics/events";
import { CompareProvider, useCompare } from "../lib/store";

const analytics = vi.hoisted(() => ({ config: { enabled: true, token: "0123456789abcdef0123456789abcdef", environment: "development" as const } }));
const config = analytics.config;
let authValue: AuthValue;

vi.mock("../lib/auth/provider", () => ({ useAuth: () => authValue }));
vi.mock("../lib/analytics/config", () => ({ ANALYTICS_CONFIG: analytics.config }));

function auth(viewer: "guest" | "member", privateSession: PrivateSessionAccess | null = null): AuthValue {
  return {
    viewer, guestIntent: viewer === "guest", privateSession, ready: true, configured: true, gating: "enforced", demoMode: false,
    account: null, accountKey: privateSession?.identity.profileId ?? null, authEpoch: 1, authCompletionEpoch: 0, authCompletionSessionId: null,
    initiatingTabId: "analytics-test-tab", pendingEmail: null, pendingNext: "/home",
    verificationReady: false, verificationPhase: "idle", unavailableReason: null,
    retryProvisioning: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), continueAsGuest: vi.fn(),
    signOut: vi.fn(async () => undefined), cancelVerification: vi.fn(),
  } as AuthValue;
}

function memberSession(current: () => boolean): PrivateSessionAccess {
  return {
    identity: { profileId: "profile-analytics-test", subject: "subject-analytics-test", sessionId: "session-analytics-test", authEpoch: 1, verifiedOnline: true },
    getToken: async () => "test-token",
    isCurrent: current,
  };
}

function preference(consent: AnalyticsPreference["consent"], revision = 0): AnalyticsPreference {
  return { consent, policyVersion: "v1", revision, analyticsAccountId: consent === "accepted" ? "00000000-0000-4000-8000-000000000101" : null, sendPermission: consent === "accepted" };
}

function TrackProbe() {
  const value = useAnalytics();
  const track = () => value.track(({ eventId, newCorrelationId }) => ({
    event: "comparison_started",
    properties: {
      event_version: 1, environment: "development", release: "0.1.0", auth_state: authValue.viewer === "member" ? "member" : "guest",
      feature: "comparison", route_name: "compare", event_id: eventId, occurred_at: new Date().toISOString(), draft_id: newCorrelationId(),
    },
  }));
  return <><output data-testid="status">{value.status}</output><output data-testid="queue">{value.snapshot?.queueLength ?? 0}</output><button onClick={() => void value.accept()}>accept</button><button onClick={() => void value.withdraw()}>withdraw</button><button onClick={track}>track</button></>;
}

let compareValue: ReturnType<typeof useCompare>;
function CompareProbe() {
  const value = useCompare();
  const consent = useAnalytics();
  compareValue = value;
  const edit = () => value.offers.forEach((offer, index) => value.updateOffer(offer.id, { lender: index ? "Synthetic B" : "Synthetic A", amount: 1_000_000, ratePct: index ? 9 : 8 }));
  return <><output data-testid="status">{consent.status}</output><output data-testid="queue">{consent.snapshot?.queueLength ?? 0}</output><button onClick={() => void consent.accept()}>accept</button><button onClick={() => void consent.withdraw()}>withdraw</button><button onClick={edit}>edit</button><button onClick={() => void value.calculate()}>calculate</button></>;
}

function comparisonTree(factory: (identity: { anonymousId: string | null; memberAnalyticsId: string | null }) => Promise<{ send(event: Readonly<AnalyticsEvent>, identity: { anonymousId: string | null; memberAnalyticsId: string | null }): Promise<void> }>) {
  return <AnalyticsProvider config={config} transportFactory={factory}><CompareProvider><CompareProbe /></CompareProvider></AnalyticsProvider>;
}

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  authValue = auth("guest");
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("consent-gated comparison analytics integration", () => {
  it("delivers one started and one completed event without focus or a second interaction", async () => {
    const events: AnalyticsEvent[] = [];
    const factory = vi.fn(async () => ({ send: vi.fn(async (event: AnalyticsEvent) => { events.push(event); }) }));
    render(comparisonTree(factory));
    await waitFor(() => expect(compareValue.hydrated).toBe(true));
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("edit"));
    await waitFor(() => expect(events.map((event) => event.event)).toEqual(["comparison_started"]));
    fireEvent.click(screen.getByText("calculate"));
    await waitFor(() => expect(events.map((event) => event.event)).toEqual(["comparison_started", "comparison_completed"]));
    await act(async () => { fireEvent.click(screen.getByText("calculate")); });
    expect(events.map((event) => event.event)).toEqual(["comparison_started", "comparison_completed"]);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("does not load a tracker or create identifiers before consent, and ignores duplicate calculation", async () => {
    const factory = vi.fn(async () => ({ send: vi.fn(async () => undefined) }));
    render(comparisonTree(factory));
    await waitFor(() => expect(compareValue.hydrated).toBe(true));
    fireEvent.click(screen.getByText("edit"));
    await act(async () => { fireEvent.click(screen.getByText("calculate")); });
    expect(factory).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    expect(factory).not.toHaveBeenCalled();
  });

  it("queues while offline and sends after the online notification", async () => {
    const events: AnalyticsEvent[] = [];
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const factory = vi.fn(async () => ({ send: vi.fn(async (event: AnalyticsEvent) => { events.push(event); }) }));
    render(comparisonTree(factory));
    await waitFor(() => expect(compareValue.hydrated).toBe(true));
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    fireEvent.click(screen.getByText("edit"));
    await waitFor(() => expect(Number(screen.getByTestId("queue").textContent)).toBe(1));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(events).toHaveLength(1));
    expect(events[0].event).toBe("comparison_started");
  });

  it("withdraws offline queued work and does not send it after reconnect", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const send = vi.fn(async () => undefined);
    const factory = vi.fn(async () => ({ send }));
    render(comparisonTree(factory));
    await waitFor(() => expect(compareValue.hydrated).toBe(true));
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    fireEvent.click(screen.getByText("edit"));
    await waitFor(() => expect(Number(screen.getByTestId("queue").textContent)).toBe(1));
    await act(async () => { fireEvent.click(screen.getByText("withdraw")); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("declined"));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(factory).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send a queued member event after the verified grant expires", async () => {
    let current = true;
    const session = memberSession(() => current);
    authValue = auth("member", session);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const factory = vi.fn(async () => ({ send: vi.fn(async () => undefined) }));
    const preferenceTransport: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("accepted", 1)), write: vi.fn() };
    render(<AnalyticsProvider config={config} preferenceTransport={preferenceTransport} transportFactory={factory}><TrackProbe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(Number(screen.getByTestId("queue").textContent)).toBe(1));
    current = false;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(factory).not.toHaveBeenCalled();
  });

  it("disposes a transport created after grant loss before it can send", async () => {
    let current = true;
    const session = memberSession(() => current);
    authValue = auth("member", session);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    let resolveFactory!: (transport: { send: () => Promise<void>; dispose: () => void }) => void;
    const send = vi.fn(async () => undefined);
    const dispose = vi.fn();
    const factory = vi.fn(() => new Promise<{ send: () => Promise<void>; dispose: () => void }>((resolve) => { resolveFactory = resolve; }));
    const preferenceTransport: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("accepted", 1)), write: vi.fn() };
    render(<AnalyticsProvider config={config} preferenceTransport={preferenceTransport} transportFactory={factory}><TrackProbe /></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(Number(screen.getByTestId("queue").textContent)).toBe(1));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(factory).toHaveBeenCalledOnce());
    current = false;
    resolveFactory({ send, dispose });
    await waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(send).not.toHaveBeenCalled();
  });
});
