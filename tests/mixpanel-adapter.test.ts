// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Mixpanel } from "mixpanel-browser/src/index";
import { buildAnalyticsEvent, type AnalyticsEvent } from "../lib/analytics/events";
import { createMixpanelTransportFactory } from "../lib/analytics/mixpanel-adapter";

const anonymousId = "00000000-0000-4000-8000-000000000101";
const memberId = "00000000-0000-4000-8000-000000000102";
const eventId = "00000000-0000-4000-8000-000000000103";

function fixture(): AnalyticsEvent {
  const result = buildAnalyticsEvent({
    event: "comparison_started",
    properties: {
      event_version: 1,
      environment: "development",
      release: "0.1.0",
      auth_state: "guest",
      feature: "comparison",
      route_name: "compare_results",
      event_id: eventId,
      occurred_at: "2026-09-16T12:00:00.000Z",
      draft_id: "00000000-0000-4000-8000-000000000104",
    },
  });
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

function malformedFixture(): AnalyticsEvent {
  return { ...fixture(), properties: { ...fixture().properties, draft_id: "user-entered-label" } } as unknown as AnalyticsEvent;
}

function memberFixture(nextEventId: string, nextDraftId: string): AnalyticsEvent {
  const result = buildAnalyticsEvent({
    event: "comparison_started",
    properties: {
      event_version: 1,
      environment: "development",
      release: "0.1.0",
      auth_state: "member",
      feature: "comparison",
      route_name: "compare",
      event_id: nextEventId,
      occurred_at: "2026-09-16T12:00:00.000Z",
      draft_id: nextDraftId,
    },
  });
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

function fakeSdk() {
  const track = vi.fn((_name: string, _properties: Record<string, unknown>, _options: unknown, callback: (response: 1 | 0) => void) => callback(1));
  const client = {
    track,
    opt_in_tracking: vi.fn(),
    opt_out_tracking: vi.fn(),
    disable: vi.fn(),
    register: vi.fn(),
  } as unknown as Mixpanel;
  const init = vi.fn((_token: string, _config: Record<string, unknown>, _name: string) => client);
  return { client, sdk: { init } as unknown as Mixpanel, init, track };
}

describe("Mixpanel SDK adapter", () => {
  it("does not load or initialize the SDK until its consent-bound factory runs", async () => {
    const h = fakeSdk();
    const loadSdk = vi.fn(async () => h.sdk);
    const factory = createMixpanelTransportFactory({ token: "test-project-token", loadSdk });
    expect(loadSdk).not.toHaveBeenCalled();
    expect(h.init).not.toHaveBeenCalled();
    await factory({ anonymousId, memberAnalyticsId: null });
    expect(loadSdk).toHaveBeenCalledOnce();
    expect(h.init).toHaveBeenCalledOnce();
  });

  it("initializes every lifetime with restrictive controls and controlled merge IDs", async () => {
    const h = fakeSdk();
    const factory = createMixpanelTransportFactory({ token: "test-project-token", loadSdk: async () => h.sdk });
    await factory({ anonymousId, memberAnalyticsId: memberId });
    const config = h.init.mock.calls[0][1] as Record<string, unknown>;
    expect(h.init.mock.calls[0][2]).toMatch(/^truecost_[0-9]+$/);
    expect(config).toMatchObject({
      api_host: "https://api-js.mixpanel.com",
      api_payload_format: "json",
      autocapture: false,
      track_pageview: false,
      track_marketing: false,
      ip: false,
      opt_out_tracking_by_default: true,
      disable_persistence: true,
      disable_cookie: true,
      batch_requests: false,
      record_heatmap_data: false,
      record_sessions_percent: 0,
      remote_settings_mode: "disabled",
    });
    expect(config.opt_out_tracking_cookie_prefix).toMatch(/^__truecost_mixpanel_opt_truecost_[0-9]+_$/);
    expect((config.hooks as { before_send_events: unknown }).before_send_events).toEqual(expect.any(Function));
    expect(h.client.opt_in_tracking).toHaveBeenCalledWith({ track: undefined, enable_persistence: false });
    expect(h.client.register).toHaveBeenCalledWith(
      { distinct_id: memberId, "$device_id": anonymousId, "$user_id": memberId },
      { persistent: false },
    );
  });

  it("serializes one validated event, maps event_id to $insert_id, and strips SDK defaults", async () => {
    const h = fakeSdk();
    const factory = createMixpanelTransportFactory({ token: "test-project-token", loadSdk: async () => h.sdk });
    const transport = await factory({ anonymousId, memberAnalyticsId: null });
    await transport.send(fixture(), { anonymousId, memberAnalyticsId: null });
    expect(h.track).toHaveBeenCalledWith(
      "comparison_started",
      expect.objectContaining({
        draft_id: "00000000-0000-4000-8000-000000000104",
        "$insert_id": eventId,
        distinct_id: anonymousId,
        time: 1789560000,
      }),
      { send_immediately: true },
      expect.any(Function),
    );
    const props = h.track.mock.calls[0][1] as Record<string, unknown>;
    expect(props.event_id).toBeUndefined();
    expect(JSON.stringify(props)).not.toContain("email");
  });

  it("proves the real core SDK makes no request during import/init and serializes only the complete approved body", async () => {
    type RequestRecord = { url: string; body: string | null };
    const requests: RequestRecord[] = [];
    const OriginalXHR = window.XMLHttpRequest;
    class RecordingXHR {
      readyState = 0;
      status = 0;
      responseText = "1";
      timeout = 0;
      withCredentials = false;
      onreadystatechange: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      private url = "";
      open(_method: string, url: string): void { this.url = url; }
      setRequestHeader(): void {}
      send(body: string | null): void {
        requests.push({ url: this.url, body });
        this.status = 200;
        this.readyState = 4;
        this.onreadystatechange?.();
      }
    }
    Object.defineProperty(window, "XMLHttpRequest", { configurable: true, writable: true, value: RecordingXHR });
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, writable: true, value: RecordingXHR });
    try {
      const sdk = ((await import("mixpanel-browser/src/loaders/loader-module-core")) as unknown as { default: Mixpanel }).default;
      expect(requests).toHaveLength(0);
      const factory = createMixpanelTransportFactory({ token: "test-project-token", requestTimeoutMs: 500, loadSdk: async () => sdk });
      const transport = await factory({ anonymousId, memberAnalyticsId: memberId });
      expect(requests).toHaveLength(0);
      await transport.send(fixture(), { anonymousId, memberAnalyticsId: memberId });
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(new URL(request.url).searchParams.get("ip")).toBe("0");
      const encoded = new URLSearchParams(request.body ?? "").get("data");
      expect(encoded).toBeTruthy();
      const payload = JSON.parse(encoded!) as { event: string; properties: Record<string, unknown> };
      expect(payload.event).toBe("comparison_started");
      expect(Object.keys(payload.properties).sort()).toEqual(["$device_id", "$insert_id", "$user_id", "auth_state", "draft_id", "distinct_id", "environment", "event_version", "feature", "occurred_at", "release", "route_name", "time", "token"].sort());
      expect(payload.properties).toEqual({
        "$device_id": anonymousId,
        "$insert_id": eventId,
        "$user_id": memberId,
        auth_state: "guest",
        draft_id: "00000000-0000-4000-8000-000000000104",
        distinct_id: memberId,
        environment: "development",
        event_version: 1,
        feature: "comparison",
        occurred_at: "2026-09-16T12:00:00.000Z",
        release: "0.1.0",
        route_name: "compare_results",
        time: 1789560000,
        token: "test-project-token",
      });
      expect(requests.some((item) => item.body?.includes("$identify"))).toBe(false);
      transport.dispose?.();
    } finally {
      Object.defineProperty(window, "XMLHttpRequest", { configurable: true, writable: true, value: OriginalXHR });
      Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, writable: true, value: OriginalXHR });
    }
  });

  it("keeps fresh member device identity separate and preserves a joined guest device ID", async () => {
    type RequestRecord = { url: string; body: string | null };
    const requests: RequestRecord[] = [];
    const OriginalXHR = window.XMLHttpRequest;
    class RecordingXHR {
      readyState = 0;
      status = 0;
      responseText = "1";
      timeout = 0;
      withCredentials = false;
      onreadystatechange: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      private url = "";
      open(_method: string, url: string): void { this.url = url; }
      setRequestHeader(): void {}
      send(body: string | null): void {
        requests.push({ url: this.url, body });
        this.status = 200;
        this.readyState = 4;
        this.onreadystatechange?.();
      }
    }
    const payloads = () => requests.map((request) => {
      const encoded = new URLSearchParams(request.body ?? "").get("data");
      return JSON.parse(encoded!) as { properties: Record<string, unknown> };
    });
    Object.defineProperty(window, "XMLHttpRequest", { configurable: true, writable: true, value: RecordingXHR });
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, writable: true, value: RecordingXHR });
    try {
      const sdk = ((await import("mixpanel-browser/src/loaders/loader-module-core")) as unknown as { default: Mixpanel }).default;
      const factory = createMixpanelTransportFactory({ token: "test-project-token", loadSdk: async () => sdk });
      const member = { anonymousId: null, memberAnalyticsId: memberId };
      const first = await factory(member);
      await first.send(memberFixture("00000000-0000-4000-8000-000000000105", "00000000-0000-4000-8000-000000000106"), member);
      await first.send(memberFixture("00000000-0000-4000-8000-000000000107", "00000000-0000-4000-8000-000000000108"), member);
      const firstPayloads = payloads();
      expect(firstPayloads).toHaveLength(2);
      const firstProperties = firstPayloads[0].properties;
      const secondProperties = firstPayloads[1].properties;
      expect(firstProperties.distinct_id).toBe(memberId);
      expect(firstProperties.$user_id).toBe(memberId);
      expect(firstProperties.$device_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(firstProperties.$device_id).not.toBe(memberId);
      expect(secondProperties.distinct_id).toBe(memberId);
      expect(secondProperties.$user_id).toBe(memberId);
      expect(secondProperties.$device_id).toBe(firstProperties.$device_id);
      first.dispose?.();

      const second = await factory(member);
      await second.send(memberFixture("00000000-0000-4000-8000-000000000109", "00000000-0000-4000-8000-000000000110"), member);
      const secondLifetimeProperties = payloads()[2].properties;
      expect(secondLifetimeProperties.distinct_id).toBe(memberId);
      expect(secondLifetimeProperties.$user_id).toBe(memberId);
      expect(secondLifetimeProperties.$device_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(secondLifetimeProperties.$device_id).not.toBe(memberId);
      expect(secondLifetimeProperties.$device_id).not.toBe(firstProperties.$device_id);
      second.dispose?.();

      const joined = { anonymousId, memberAnalyticsId: memberId };
      const joinedTransport = await factory(joined);
      await joinedTransport.send(memberFixture("00000000-0000-4000-8000-000000000111", "00000000-0000-4000-8000-000000000112"), joined);
      const joinedProperties = payloads()[3].properties;
      expect(joinedProperties.distinct_id).toBe(memberId);
      expect(joinedProperties.$user_id).toBe(memberId);
      expect(joinedProperties.$device_id).toBe(anonymousId);
      joinedTransport.dispose?.();
    } finally {
      Object.defineProperty(window, "XMLHttpRequest", { configurable: true, writable: true, value: OriginalXHR });
      Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, writable: true, value: OriginalXHR });
    }
  });

  it("keeps opt-out markers isolated across real SDK instances and names concurrent lifetimes uniquely", async () => {
    const sdk = ((await import("mixpanel-browser/src/loaders/loader-module-core")) as unknown as { default: Mixpanel }).default;
    const old = await createMixpanelTransportFactory({ token: "test-project-token", loadSdk: async () => sdk })({ anonymousId, memberAnalyticsId: null });
    const newer = await createMixpanelTransportFactory({ token: "test-project-token", loadSdk: async () => sdk })({ anonymousId: anonymousId, memberAnalyticsId: memberId });
    const oldClient = (old as unknown as { client: Mixpanel }).client as Mixpanel & { get_config: (key: string) => unknown };
    const newClient = (newer as unknown as { client: Mixpanel }).client as Mixpanel & { _send_request: (...args: unknown[]) => void };
    expect(oldClient.get_config("opt_out_tracking_cookie_prefix")).not.toBe(newClient.get_config("opt_out_tracking_cookie_prefix"));
    const request = vi.spyOn(newClient, "_send_request").mockImplementation((_url, _data, _options, callback) => (callback as (response: 1) => void)(1));
    old.dispose?.();
    await newer.send(fixture(), { anonymousId, memberAnalyticsId: memberId });
    expect(request).toHaveBeenCalledOnce();
    newer.dispose?.();

    let release!: () => void;
    const gate = new Promise<Mixpanel>((resolve) => { release = () => resolve(sdk); });
    const delayedFactory = createMixpanelTransportFactory({ token: "test-project-token", loadSdk: async () => gate });
    const first = delayedFactory({ anonymousId, memberAnalyticsId: null });
    const second = delayedFactory({ anonymousId, memberAnalyticsId: memberId });
    release();
    const [firstTransport, secondTransport] = await Promise.all([first, second]);
    expect((firstTransport as unknown as { client: Mixpanel }).client.get_config("name")).not.toBe((secondTransport as unknown as { client: Mixpanel }).client.get_config("name"));
    firstTransport.dispose?.();
    secondTransport.dispose?.();
  });

  it("rejects SDK failures and disposal prevents future sends", async () => {
    const h = fakeSdk();
    h.track.mockImplementation((_name, _properties, _options, callback) => callback(0));
    const transport = await createMixpanelTransportFactory({ token: "test-project-token", loadSdk: async () => h.sdk })({ anonymousId, memberAnalyticsId: null });
    await expect(transport.send(fixture(), { anonymousId, memberAnalyticsId: null })).rejects.toMatchObject({ code: "network" });
    transport.dispose?.();
    expect(h.client.opt_out_tracking).toHaveBeenCalledWith({ delete_user: false, clear_persistence: true });
    expect(h.client.disable).toHaveBeenCalledOnce();
    await expect(transport.send(fixture(), { anonymousId, memberAnalyticsId: null })).rejects.toMatchObject({ code: "unknown" });
  });

  it("rejects malformed direct events and identity changes at the transport boundary", async () => {
    const h = fakeSdk();
    const factory = createMixpanelTransportFactory({ token: "test-project-token", loadSdk: async () => h.sdk });
    const transport = await factory({ anonymousId, memberAnalyticsId: null });
    await expect(transport.send(malformedFixture(), { anonymousId, memberAnalyticsId: null })).rejects.toMatchObject({ code: "unknown" });
    await expect(transport.send(fixture(), { anonymousId, memberAnalyticsId: memberId })).rejects.toMatchObject({ code: "unknown" });
    expect(h.track).not.toHaveBeenCalled();
  });
});
