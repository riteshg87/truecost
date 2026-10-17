// @vitest-environment jsdom
import { webcrypto, createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import type { AnalyticsEvent } from "../lib/analytics/events";
import type { AnalyticsIdentity } from "../lib/analytics/controller";
import type { AnalyticsPreference, AnalyticsPreferenceTransport } from "../lib/analytics/preference-transport";
import type { ComparisonSaveInput } from "../lib/comparison/transport";
import { AnalyticsProvider, useAnalytics } from "../lib/analytics/provider";
import { CompareProvider, useCompare } from "../lib/store";

const config = vi.hoisted(() => ({ enabled: true, token: "0123456789abcdef0123456789abcdef", environment: "development" as const }));
const transportMock = vi.hoisted(() => ({ factory: vi.fn() }));
let authValue: AuthValue;

vi.mock("../lib/auth/provider", () => ({ useAuth: () => authValue }));
vi.mock("../lib/analytics/config", () => ({ ANALYTICS_CONFIG: config }));
vi.mock("../lib/auth/config", async (importOriginal) => ({ ...await importOriginal<typeof import("../lib/auth/config")>(), AUTH_CONFIG: { convexUrl: "https://test.convex.cloud" } }));
vi.mock("../lib/comparison/transport", () => ({ createSessionBoundComparisonTransport: transportMock.factory }));

function memberSession(profileId = "profile-a", authEpoch = 1): PrivateSessionAccess {
  const session: PrivateSessionAccess = {
    identity: { profileId, subject: `${profileId}-subject`, sessionId: `${profileId}-session`, authEpoch, verifiedOnline: true },
    getToken: async () => "test-token",
    isCurrent: () => authValue.privateSession === session,
  };
  return session;
}

function memberAuth(session: PrivateSessionAccess, authCompletionEpoch = 1): AuthValue {
  return {
    ready: true, viewer: "member", guestIntent: false, privateSession: session, configured: true, gating: "enforced", demoMode: false,
    account: null, accountKey: session.identity.profileId, authEpoch: 1, authCompletionEpoch, authCompletionSessionId: authCompletionEpoch > 0 ? session.identity.sessionId : null, initiatingTabId: "analytics-auth-save-tab",
    pendingEmail: null, pendingNext: "/home", verificationReady: false, verificationPhase: "idle", unavailableReason: null,
    retryProvisioning: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), continueAsGuest: vi.fn(), signOut: vi.fn(async () => undefined), cancelVerification: vi.fn(),
  } as AuthValue;
}

function guestAuth(): AuthValue {
  return {
    ready: true, viewer: "guest", guestIntent: true, privateSession: null, configured: true, gating: "enforced", demoMode: false,
    account: null, accountKey: null, authEpoch: 1, authCompletionEpoch: 0, authCompletionSessionId: null, initiatingTabId: "analytics-auth-save-tab", pendingEmail: null, pendingNext: "/home",
    verificationReady: false, verificationPhase: "idle", unavailableReason: null, retryProvisioning: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(),
    continueAsGuest: vi.fn(), signOut: vi.fn(async () => undefined), cancelVerification: vi.fn(),
  } as AuthValue;
}

function anonymousAuth(ready = false): AuthValue {
  return { ...guestAuth(), viewer: "anonymous", guestIntent: false, ready } as AuthValue;
}

function preference(consent: AnalyticsPreference["consent"], revision = 1): AnalyticsPreference {
  return { consent, policyVersion: "v1", revision, analyticsAccountId: consent === "accepted" ? "00000000-0000-4000-8000-000000000111" : null, sendPermission: consent === "accepted" };
}

function acknowledge(input: ComparisonSaveInput) {
  const snapshot = JSON.parse(input.snapshot) as { resultId: string };
  const serverHash = createHash("sha256").update(JSON.stringify(["comparison", "save", input.snapshot, snapshot.resultId, input.title, input.source, input.createdAt])).digest("hex");
  return { status: "saved" as const, requestId: input.requestId, resultId: snapshot.resultId, serverHash };
}

let compareValue: ReturnType<typeof useCompare>;
function Probe() {
  compareValue = useCompare();
  const analytics = useAnalytics();
  return <>
    <output data-testid="hydrated">{String(compareValue.hydrated)}</output>
    <output data-testid="analytics-status">{analytics.status}</output>
    <output data-testid="joined-flow">{analytics.joinedFlowId ?? "none"}</output>
    <button onClick={() => void analytics.accept()}>accept</button>
    <button onClick={() => analytics.track(({ eventId, newCorrelationId }) => ({ event: "comparison_started", properties: { event_version: 1, environment: "development", release: "0.1.0", auth_state: authValue.viewer === "member" ? "member" : "guest", feature: "comparison", route_name: "compare", event_id: eventId, occurred_at: new Date().toISOString(), draft_id: newCorrelationId() } }))}>track</button>
    <button onClick={() => compareValue.offers.forEach((offer, index) => compareValue.updateOffer(offer.id, { lender: index ? "Synthetic B" : "Synthetic A", amount: 1000000, ratePct: index ? 9 : 8 }))}>edit</button>
    <button onClick={() => void compareValue.calculate()}>calculate</button>
    <button onClick={() => void compareValue.save()}>save</button>
  </>;
}

function tree(preferenceTransport: AnalyticsPreferenceTransport, events: AnalyticsEvent[], identities?: AnalyticsIdentity[]) {
  return <AnalyticsProvider config={config} preferenceTransport={preferenceTransport} transportFactory={async () => ({ send: async (event: AnalyticsEvent, identity: AnalyticsIdentity) => { events.push(event); identities?.push({ ...identity }); } })}>
    <CompareProvider><Probe /></CompareProvider>
  </AnalyticsProvider>;
}

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  const session = memberSession(); authValue = memberAuth(session);
  transportMock.factory.mockImplementation(() => ({ saveComparison: async (input: ComparisonSaveInput) => acknowledge(input) }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("auth and acknowledged-save analytics boundaries", () => {
  it("carries only a consented same-flow guest gate into the first verified member context", async () => {
    const events: AnalyticsEvent[] = [];
    const identities: AnalyticsIdentity[] = [];
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("accepted")), write: vi.fn() };
    authValue = guestAuth();
    const view = render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText("edit"));
    await act(async () => { await compareValue.calculate(); });
    await act(async () => { await compareValue.save(); });
    expect(events.filter((event) => event.event === "auth_prompt_viewed")).toHaveLength(1);
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    const guestAnonymousId = identities.at(-1)?.anonymousId;
    expect(guestAnonymousId).toMatch(/^[0-9a-f-]{36}$/i);
    const session = memberSession();
    view.unmount();
    authValue = memberAuth(session);
    render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    await waitFor(() => expect(events.filter((event) => event.event === "auth_completed")).toHaveLength(1));
    const completion = events.find((event) => event.event === "auth_completed");
    expect(completion?.properties.action).toBe("save");
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    expect(identities.at(-1)?.anonymousId).toBe(guestAnonymousId);
    expect(identities.at(-1)?.memberAnalyticsId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("restores the guest identity when member consent is decided after reload", async () => {
    const events: AnalyticsEvent[] = [];
    const identities: AnalyticsIdentity[] = [];
    let remoteConsent: AnalyticsPreference["consent"] = "unknown";
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference(remoteConsent)), write: vi.fn(async () => { remoteConsent = "accepted"; return preference("accepted", 2); }) };
    authValue = guestAuth();
    const guestView = render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("unknown"));
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText("edit"));
    await act(async () => { await compareValue.calculate(); });
    await act(async () => { await compareValue.save(); });
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    const guestAnonymousId = identities.at(-1)?.anonymousId;
    guestView.unmount();

    authValue = memberAuth(memberSession("profile-delayed-consent"));
    render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("unknown"));
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(1));
    expect(identities.at(-1)?.anonymousId).toBe(guestAnonymousId);
  });

  it("preserves the guest identity across a same-tree member transition while consent is unknown", async () => {
    const events: AnalyticsEvent[] = [];
    const identities: AnalyticsIdentity[] = [];
    let remoteConsent: AnalyticsPreference["consent"] = "unknown";
    const preferences: AnalyticsPreferenceTransport = {
      read: vi.fn(async () => preference(remoteConsent)),
      write: vi.fn(async (consent) => {
        remoteConsent = consent;
        return preference(consent, 2);
      }),
    };
    authValue = guestAuth();
    const view = render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("unknown"));
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText("edit"));
    await act(async () => { await compareValue.calculate(); });
    await act(async () => { await compareValue.save(); });
    const guestAnonymousId = identities.at(-1)?.anonymousId;
    expect(guestAnonymousId).toMatch(/^[0-9a-f-]{36}$/i);
    const guestJoinMarker = JSON.parse(sessionStorage.getItem("truecost.analytics.guest-join.v1") ?? "null") as { flowId?: string } | null;
    expect(guestJoinMarker?.flowId).toMatch(/^[0-9a-f-]{36}$/i);

    authValue = memberAuth(memberSession("profile-same-tree"));
    view.rerender(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("unknown"));
    expect(events.some((event) => event.properties.auth_state === "member")).toBe(false);
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(events.some((event) => event.properties.auth_state === "member")).toBe(true));
    const firstMemberEventIndex = events.findIndex((event) => event.properties.auth_state === "member");
    expect(identities[firstMemberEventIndex]?.anonymousId).toBe(guestAnonymousId);
    expect(identities[firstMemberEventIndex]?.memberAnalyticsId).toMatch(/^[0-9a-f-]{36}$/i);
    await waitFor(() => expect(events.some((event) => event.event === "auth_completed" && event.properties.auth_state === "member")).toBe(true));
    const completion = events.find((event) => event.event === "auth_completed" && event.properties.auth_state === "member") as Extract<AnalyticsEvent, { event: "auth_completed" }> | undefined;
    expect(completion?.properties.action).toBe("save");
    expect(completion?.properties.flow_id).toBe(guestJoinMarker?.flowId);
  });

  it("carries a validated guest marker across anonymous hydration before completion", async () => {
    const events: AnalyticsEvent[] = [];
    const identities: AnalyticsIdentity[] = [];
    const anonymousId = "00000000-0000-4000-8000-000000000421";
    const flowId = "00000000-0000-4000-8000-000000000422";
    sessionStorage.setItem("truecost.analytics.guest-join.v1", JSON.stringify({ flowId, anonymousId, createdAt: Date.now() }));
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("accepted")), write: vi.fn() };
    authValue = anonymousAuth(false);
    const view = render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("loading"));

    const session = memberSession("profile-hydration");
    authValue = memberAuth(session, 0);
    view.rerender(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    expect(sessionStorage.getItem("truecost.analytics.guest-join.v1")).not.toBeNull();
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    expect(identities.at(-1)?.anonymousId).toBeNull();
    expect(events.some((event) => event.event === "auth_completed")).toBe(false);

    authValue = memberAuth(session, 1);
    view.rerender(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    const beforeCompletedTrack = identities.length;
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(beforeCompletedTrack));
    expect(identities.at(-1)?.anonymousId).toBe(anonymousId);
  });

  it("carries a guest marker through an anonymous loading render before member completion", async () => {
    const events: AnalyticsEvent[] = [];
    const identities: AnalyticsIdentity[] = [];
    const anonymousId = "00000000-0000-4000-8000-000000000423";
    const flowId = "00000000-0000-4000-8000-000000000424";
    sessionStorage.setItem("truecost.analytics.guest-join.v1", JSON.stringify({ flowId, anonymousId, createdAt: Date.now() }));
    localStorage.setItem("truecost.analytics.preference.v1", JSON.stringify({ consent: "accepted", policyVersion: "v1" }));
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("accepted")), write: vi.fn() };
    authValue = guestAuth();
    const view = render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));

    authValue = anonymousAuth(false);
    view.rerender(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("loading"));
    expect(sessionStorage.getItem("truecost.analytics.guest-join.v1")).not.toBeNull();

    const session = memberSession("profile-guest-hydration");
    authValue = memberAuth(session, 0);
    view.rerender(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    expect(sessionStorage.getItem("truecost.analytics.guest-join.v1")).not.toBeNull();

    authValue = memberAuth(session, 1);
    view.rerender(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    expect(identities.at(-1)?.anonymousId).toBe(anonymousId);
  });

  it("does not reuse a handoff marker after it is bound to another member session", async () => {
    const events: AnalyticsEvent[] = [];
    const identities: AnalyticsIdentity[] = [];
    let consent: AnalyticsPreference["consent"] = "unknown";
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference(consent)), write: vi.fn(async () => preference("accepted", 2)) };
    authValue = guestAuth();
    const guestView = render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("unknown"));
    await act(async () => { fireEvent.click(screen.getByText("accept")); });
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("edit"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    await act(async () => { await compareValue.calculate(); });
    await act(async () => { await compareValue.save(); });
    await waitFor(() => expect(identities.length).toBeGreaterThan(0));
    const guestAnonymousId = identities.at(-1)?.anonymousId;
    guestView.unmount();

    const firstMember = memberSession("profile-first-session");
    authValue = memberAuth(firstMember);
    render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("unknown"));
    consent = "accepted";
    cleanup();
    const secondMember = memberSession("profile-second-session");
    authValue = memberAuth(secondMember);
    render(tree(preferences, events, identities));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    fireEvent.click(screen.getByText("track"));
    await waitFor(() => expect(identities.length).toBeGreaterThan(1));
    expect(identities.at(-1)?.anonymousId).not.toBe(guestAnonymousId);
    expect(sessionStorage.getItem("truecost.analytics.guest-join.v1")).toBeNull();
  });

  it("tracks one verified auth completion and emits saved only after acknowledgement", async () => {
    const events: AnalyticsEvent[] = [];
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("accepted")), write: vi.fn() };
    render(tree(preferences, events));
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    await waitFor(() => expect(events.some((event) => event.event === "auth_completed")).toBe(true));
    fireEvent.click(screen.getByText("edit"));
    let calculated!: Awaited<ReturnType<typeof compareValue.calculate>>;
    await act(async () => { calculated = await compareValue.calculate(); });
    expect(calculated.kind).toBe("ok");
    let saved!: Awaited<ReturnType<typeof compareValue.save>>;
    await act(async () => { saved = await compareValue.save(); });
    expect(saved.kind).toBe("ok");
    await waitFor(() => expect(events.some((event) => event.event === "comparison_saved")).toBe(true));
    expect(events.filter((event) => event.event === "auth_completed")).toHaveLength(1);
    expect(events.filter((event) => event.event === "comparison_save_status").map((event) => event.properties.stage)).toEqual(expect.arrayContaining(["attempted", "queued"]));
    expect(events.filter((event) => event.event === "comparison_saved")).toHaveLength(1);
  });

  it("replays a queued save after its acknowledgement is lost during reload", async () => {
    const events: AnalyticsEvent[] = [];
    const inputs: ComparisonSaveInput[] = [];
    const resolvers: Array<(ack: ReturnType<typeof acknowledge>) => void> = [];
    const send = vi.fn((input: ComparisonSaveInput) => {
      inputs.push(input);
      return new Promise<ReturnType<typeof acknowledge>>((resolve) => { resolvers.push(resolve); });
    });
    transportMock.factory.mockImplementation(() => ({ saveComparison: send }));
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("accepted")), write: vi.fn() };
    const session = memberSession("profile-lost-ack");
    authValue = memberAuth(session);
    const view = render(tree(preferences, events));
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("edit"));
    await act(async () => { await compareValue.calculate(); });
    await act(async () => { await compareValue.save(); });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    const requestId = inputs[0].requestId;
    expect(sessionStorage.getItem("truecost.analytics.save.v1")).toContain(requestId);
    view.unmount();

    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    try {
      authValue = memberAuth(session);
      render(tree(preferences, events));
      await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
      window.dispatchEvent(new Event("online"));
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      expect(inputs[1].requestId).toBe(requestId);
      await act(async () => { resolvers[1](acknowledge(inputs[1])); });
      expect(sessionStorage.getItem("truecost.analytics.save.v1")).toContain(requestId);
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps product actions working with declined consent and loads no tracker", async () => {
    const events: AnalyticsEvent[] = [];
    const factory = vi.fn(async () => ({ send: async (event: AnalyticsEvent) => { events.push(event); } }));
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("declined")), write: vi.fn() };
    render(<AnalyticsProvider config={config} preferenceTransport={preferences} transportFactory={factory}><CompareProvider><Probe /></CompareProvider></AnalyticsProvider>);
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
    fireEvent.click(screen.getByText("edit"));
    await act(async () => { fireEvent.click(screen.getByText("calculate")); });
    expect(factory).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("dedupes a verified refresh while isolating the next account", async () => {
    const events: AnalyticsEvent[] = [];
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("accepted")), write: vi.fn() };
    const first = memberSession("profile-refresh-a");
    authValue = memberAuth(first);
    const view = render(tree(preferences, events));
    await waitFor(() => expect(events.filter((event) => event.event === "auth_completed")).toHaveLength(1));
    const refreshed = memberSession("profile-refresh-a", 2);
    authValue = memberAuth(refreshed);
    view.rerender(tree(preferences, events));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.filter((event) => event.event === "auth_completed")).toHaveLength(1);
    const second = memberSession("profile-refresh-b");
    authValue = memberAuth(second);
    view.rerender(tree(preferences, events));
    await waitFor(() => expect(events.filter((event) => event.event === "auth_completed")).toHaveLength(2));
    const completions = events.filter((event) => event.event === "auth_completed");
    expect(completions[0].properties.flow_id).not.toBe(completions[1].properties.flow_id);
  });

  it("ignores malformed and expired auth metadata instead of reusing a stale flow", async () => {
    sessionStorage.setItem("truecost.analytics.auth-flow.v1", JSON.stringify([
      {},
      { requestId: "old-request", flowId: "00000000-0000-4000-8000-000000000001", action: "save", sessionId: "00000000-0000-4000-8000-000000000002", resultId: "00000000-0000-4000-8000-000000000003", createdAt: Date.now() - 25 * 60 * 60 * 1000 },
    ]));
    const events: AnalyticsEvent[] = [];
    const preferences: AnalyticsPreferenceTransport = { read: vi.fn(async () => preference("accepted")), write: vi.fn() };
    authValue = memberAuth(memberSession(), 0);
    render(tree(preferences, events));
    await waitFor(() => expect(screen.getByTestId("analytics-status").textContent).toBe("accepted"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.filter((event) => event.event === "auth_completed")).toHaveLength(0);
  });
});
