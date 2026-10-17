import { describe, expect, it, vi } from "vitest";
import { AnalyticsController, type AnalyticsIdentity, type AnalyticsTransport } from "../lib/analytics/controller";
import type { AnalyticsEvent } from "../lib/analytics/events";

const id = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const flowId = id("90");

function eventId(n: string): string { return id(n); }

function guestStarted(draft = "2", event = "1") {
  return {
    event: "comparison_started",
    properties: {
      event_version: 1,
      environment: "development",
      release: "0.1.0",
      auth_state: "guest",
      feature: "comparison",
      route_name: "compare_results",
      event_id: eventId(event),
      occurred_at: "2026-09-16T12:00:00.000Z",
      draft_id: id(draft),
    },
  };
}

function memberSaved(request = "6", event = "10") {
  return {
    event: "comparison_saved",
    properties: {
      event_version: 1,
      environment: "development",
      release: "0.1.0",
      auth_state: "member",
      feature: "comparison",
      route_name: "account",
      event_id: eventId(event),
      occurred_at: "2026-09-16T12:00:00.000Z",
      request_id: id(request),
      path: "queued",
    },
  };
}

function controller(overrides: Partial<ConstructorParameters<typeof AnalyticsController>[0]> = {}) {
  let clock = Date.parse("2026-09-16T12:00:00.000Z");
  let nextId = 100;
  const sends: Array<{ eventId: string; identity: AnalyticsIdentity }> = [];
  const factory = vi.fn(async (_identity: Readonly<AnalyticsIdentity>): Promise<AnalyticsTransport> => ({
    send: vi.fn(async (event, identity) => {
      sends.push({ eventId: event.properties.event_id, identity: { ...identity } });
    }),
  }));
  const instance = new AnalyticsController({
    transportFactory: factory,
    now: () => clock,
    randomId: () => id(String(nextId++)),
    ...overrides,
  });
  return {
    instance,
    factory,
    sends,
    advance(ms: number) { clock += ms; },
    setTime(ms: number) { clock = ms; },
  };
}

describe("local analytics consent and delivery controller", () => {
  it("starts unknown and creates no identifier or transport before opt-in", async () => {
    const h = controller();
    expect(h.instance.getSnapshot()).toMatchObject({ consent: "unknown", authState: "guest", hasIdentity: false, queueLength: 0 });
    expect((await h.instance.flush(true)).queueLength).toBe(0);
    expect(h.instance.enqueue(guestStarted())).toEqual({ ok: false, code: "not_consented" });
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.instance.decline()).toMatchObject({ consent: "declined", hasIdentity: false, queueLength: 0 });
    expect(h.instance.enqueue(guestStarted("3", "2"))).toEqual({ ok: false, code: "not_consented" });
    expect(h.factory).not.toHaveBeenCalled();
  });

  it("opts in a guest lazily, deduplicates by draft, and sends only on flush", async () => {
    const h = controller();
    expect(h.instance.acceptGuestConsent().ok).toBe(true);
    expect(h.instance.enqueue(guestStarted("2", "1"))).toMatchObject({ ok: true, value: { queued: true, eventId: eventId("1") } });
    expect(h.instance.enqueue(guestStarted("2", "2"))).toMatchObject({ ok: true, value: { queued: false, eventId: eventId("2") } });
    expect(h.factory).not.toHaveBeenCalled();
    expect((await h.instance.flush(true)).queueLength).toBe(0);
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].identity).toEqual({ anonymousId: id("100"), memberAnalyticsId: null });
  });

  it("requires an explicit same-flow join token and preserves consented guest work", () => {
    const h = controller();
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    expect(h.instance.setMemberContext({ analyticsAccountId: id("200"), consent: "accepted" })).toMatchObject({ ok: true, value: { authState: "member", hasIdentity: true, queueLength: 0 } });

    const joined = controller();
    joined.instance.acceptGuestConsent();
    joined.instance.enqueue(guestStarted());
    const token = joined.instance.captureGuestJoin(flowId);
    expect(token.ok).toBe(true);
    if (!token.ok) return;
    expect(joined.instance.setMemberContext({ analyticsAccountId: id("200"), consent: "accepted" }, { ...token.value, flowId: id("91") })).toMatchObject({ ok: true, value: { authState: "member", hasIdentity: true, queueLength: 0 } });

    const valid = controller();
    valid.instance.acceptGuestConsent();
    valid.instance.enqueue(guestStarted());
    const validToken = valid.instance.captureGuestJoin(flowId);
    expect(validToken.ok).toBe(true);
    if (!validToken.ok) return;
    expect(valid.instance.setMemberContext({ analyticsAccountId: id("200"), consent: "accepted" }, validToken.value)).toMatchObject({ ok: true, value: { authState: "member", hasIdentity: true, queueLength: 1 } });
    expect(valid.instance.enqueue(memberSaved())).toMatchObject({ ok: true, value: { queued: true } });
    expect(valid.instance.enqueue({ ...guestStarted("3", "11"), properties: { ...guestStarted("3", "11").properties, auth_state: "guest" } })).toEqual({ ok: false, code: "auth_mismatch" });
  });

  it("resets identity, queue and deduplication on account switch and isolates a late send", async () => {
    let releaseFactory!: (transport: AnalyticsTransport) => void;
    const pendingFactory = new Promise<AnalyticsTransport>((resolve) => { releaseFactory = resolve; });
    const sends: Array<{ eventId: string; identity: AnalyticsIdentity }> = [];
    const factory = vi.fn((identity: Readonly<AnalyticsIdentity>) => {
      if (factory.mock.calls.length === 1) return pendingFactory;
      return Promise.resolve<AnalyticsTransport>({ send: async (event: Readonly<AnalyticsEvent>, sentIdentity: Readonly<AnalyticsIdentity>) => { sends.push({ eventId: event.properties.event_id, identity: { ...sentIdentity } }); } });
    });
    const h = controller({ transportFactory: factory });
    h.instance.setMemberContext({ analyticsAccountId: id("201"), consent: "accepted" });
    h.instance.enqueue(memberSaved("6", "10"));
    const oldFlush = h.instance.flush(true);
    await Promise.resolve();
    expect(factory).toHaveBeenCalledTimes(1);
    h.instance.setMemberContext({ analyticsAccountId: id("202"), consent: "accepted" });
    expect(h.instance.getSnapshot()).toMatchObject({ queueLength: 0, hasIdentity: true, authState: "member" });
    h.instance.enqueue(memberSaved("7", "11"));
    const currentFlush = h.instance.flush(true);
    await currentFlush;
    const lateDispose = vi.fn();
    releaseFactory({ send: async () => { throw new Error("A private payload"); }, dispose: lateDispose });
    await oldFlush;
    expect(sends).toEqual([{ eventId: eventId("11"), identity: { anonymousId: null, memberAnalyticsId: id("202") } }]);
    expect(lateDispose).toHaveBeenCalledOnce();
  });

  it("revokes a cached guest transport when the same consented join becomes a member", async () => {
    const dispose = vi.fn();
    const transport: AnalyticsTransport = { send: async () => undefined, dispose };
    const h = controller({ transportFactory: async () => transport });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    await h.instance.flush(true);
    const token = h.instance.captureGuestJoin(flowId);
    expect(token.ok).toBe(true);
    if (!token.ok) return;
    h.instance.setMemberContext({ analyticsAccountId: id("203"), consent: "accepted" }, token.value);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("does not let an in-flight send leak into A after an A to B to A reset", async () => {
    let releaseSend!: () => void;
    const pendingSend = new Promise<void>((resolve) => { releaseSend = resolve; });
    const sends: Array<{ eventId: string; identity: AnalyticsIdentity }> = [];
    const transport: AnalyticsTransport = { send: async (event, identity) => { sends.push({ eventId: event.properties.event_id, identity: { ...identity } }); await pendingSend; } };
    const h = controller({ transportFactory: async () => transport });
    h.instance.setMemberContext({ analyticsAccountId: id("210"), consent: "accepted" });
    h.instance.enqueue(memberSaved("8", "12"));
    const oldFlush = h.instance.flush(true);
    await Promise.resolve();
    h.instance.setMemberContext({ analyticsAccountId: id("211"), consent: "accepted" });
    h.instance.setMemberContext({ analyticsAccountId: id("210"), consent: "accepted" });
    releaseSend();
    await oldFlush;
    expect(sends).toEqual([{ eventId: eventId("12"), identity: { anonymousId: null, memberAnalyticsId: id("210") } }]);
    expect(h.instance.getSnapshot().queueLength).toBe(0);
  });

  it("keeps a stable event for a lost receipt and retries with bounded backoff", async () => {
    const attempts: string[] = [];
    const h = controller({ transportFactory: async () => ({ send: async (event) => { attempts.push(event.properties.event_id); if (attempts.length === 1) throw { code: "network", detail: "private" }; } }) });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    expect((await h.instance.flush(true)).errorCode).toBe("network");
    expect(h.instance.getSnapshot()).toMatchObject({ queueLength: 1, nextRetryAt: Date.parse("2026-09-16T12:00:00.000Z") + 1000 });
    h.advance(1000);
    expect((await h.instance.flush(true)).queueLength).toBe(0);
    expect(attempts).toEqual([eventId("1"), eventId("1")]);
  });

  it("retains the event at the age boundary, then expires it without creating a transport", async () => {
    const h = controller({ maxAgeMs: 100 });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    h.advance(100);
    expect((await h.instance.flush(true)).queueLength).toBe(0);
    expect(h.instance.getSnapshot().errorCode).toBeNull();
    h.instance.enqueue(guestStarted("3", "2"));
    h.advance(101);
    expect((await h.instance.flush(true)).errorCode).toBe("expired");
    expect(h.factory).toHaveBeenCalledTimes(1);
  });

  it("pauses after the attempt cap and does not spin or discard the event", async () => {
    const send = vi.fn(async () => { throw { code: "limited", detail: "secret" }; });
    const h = controller({ maxAttempts: 2, transportFactory: async () => ({ send }) });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    await h.instance.flush(true);
    h.advance(1000);
    const second = await h.instance.flush(true);
    expect(second).toMatchObject({ status: "paused", queueLength: 1, pausedCount: 1, errorCode: "limited" });
    expect(send).toHaveBeenCalledTimes(2);
    await h.instance.flush(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed events and keeps transport failures privacy-safe", async () => {
    const h = controller({ transportFactory: async () => ({ send: async () => { throw { code: "unexpected", message: "email=person@example.com" }; } }) });
    h.instance.acceptGuestConsent();
    expect(h.instance.enqueue({ ...guestStarted(), properties: { ...guestStarted().properties, lender: "Bank" } })).toEqual({ ok: false, code: "invalid_event" });
    expect(h.instance.enqueue(guestStarted())).toMatchObject({ ok: true });
    const snapshot = await h.instance.flush(true);
    expect(snapshot.errorCode).toBe("unknown");
    expect(JSON.stringify(snapshot)).not.toContain("person@example.com");
  });

  it("accepts only events observed during the current consent lifetime", () => {
    const h = controller();
    h.instance.acceptGuestConsent();
    const before = { ...guestStarted("2", "1"), properties: { ...guestStarted("2", "1").properties, occurred_at: "2026-09-16T11:59:59.999Z" } };
    const future = { ...guestStarted("3", "2"), properties: { ...guestStarted("3", "2").properties, occurred_at: "2026-09-16T12:00:00.001Z" } };
    expect(h.instance.enqueue(before)).toEqual({ ok: false, code: "invalid_event" });
    expect(h.instance.enqueue(future)).toEqual({ ok: false, code: "invalid_event" });
    expect(h.instance.getSnapshot().queueLength).toBe(0);
  });

  it("keeps a verified member context idempotent and rejects invalid runtime context", () => {
    const h = controller();
    h.instance.setMemberContext({ analyticsAccountId: id("220"), consent: "accepted" });
    h.instance.enqueue(memberSaved("9", "13"));
    expect(h.instance.setMemberContext({ analyticsAccountId: id("220"), consent: "accepted" })).toMatchObject({ ok: true, value: { queueLength: 1, hasIdentity: true } });
    expect(h.instance.setMemberContext(null as unknown as { analyticsAccountId: string; consent: "accepted" })).toEqual({ ok: false, code: "invalid_member_context" });
    expect(h.instance.setMemberContext({ analyticsAccountId: id("220"), consent: "maybe" } as unknown as { analyticsAccountId: string; consent: "accepted" })).toEqual({ ok: false, code: "invalid_member_context" });
  });

  it("revokes the active member runtime before reporting a malformed replacement context", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const h = controller({ transportFactory: async () => ({ send: async () => { await pending; } }) });
    h.instance.setMemberContext({ analyticsAccountId: id("221"), consent: "accepted" });
    h.instance.enqueue(memberSaved("14", "15"));
    const oldPump = h.instance.flush(true);
    await Promise.resolve();
    expect(h.instance.setMemberContext(null as unknown as { analyticsAccountId: string; consent: "accepted" })).toEqual({ ok: false, code: "invalid_member_context" });
    expect(h.instance.getSnapshot()).toMatchObject({ authState: "member", consent: "unknown", hasIdentity: false, queueLength: 0 });
    release();
    await oldPump;
    expect(h.instance.getSnapshot()).toMatchObject({ consent: "unknown", hasIdentity: false, queueLength: 0 });
  });

  it("counts transport initialization failures against the same retry cap", async () => {
    const factory = vi.fn(async () => { throw { code: "network", detail: "account=private" }; });
    const h = controller({ maxAttempts: 2, transportFactory: factory });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    expect((await h.instance.flush(true)).errorCode).toBe("network");
    h.advance(1000);
    expect((await h.instance.flush(true)).status).toBe("paused");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(h.instance.getSnapshot().queueLength).toBe(1);
  });

  it("cancels an in-flight pump when the caller reports offline", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async () => { await pending; });
    const h = controller({ transportFactory: async () => ({ send }) });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    const pump = h.instance.flush(true);
    await Promise.resolve();
    expect(await h.instance.flush(false)).toMatchObject({ status: "queued", errorCode: "offline" });
    release();
    await pump;
    expect(send).toHaveBeenCalledTimes(1);
    expect(h.instance.getSnapshot()).toMatchObject({ queueLength: 1, errorCode: "offline" });
  });

  it("honors the attempt cap after an interrupted send has no receipt", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async () => { await pending; });
    const h = controller({ maxAttempts: 1, transportFactory: async () => ({ send }) });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    const pump = h.instance.flush(true);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    await h.instance.flush(false);
    release();
    await pump;
    expect((await h.instance.flush(true)).status).toBe("paused");
    expect(h.instance.getSnapshot()).toMatchObject({ queueLength: 1, pausedCount: 1, errorCode: "retry_exhausted" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send an event whose transport setup crossed the age limit", async () => {
    let releaseFactory!: (transport: AnalyticsTransport) => void;
    const pendingFactory = new Promise<AnalyticsTransport>((resolve) => { releaseFactory = resolve; });
    const send = vi.fn(async () => {});
    const h = controller({ maxAgeMs: 100, transportFactory: async () => pendingFactory });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    const pump = h.instance.flush(true);
    await Promise.resolve();
    h.advance(101);
    const dispose = vi.fn();
    releaseFactory({ send, dispose });
    expect((await pump).errorCode).toBe("expired");
    expect(send).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(h.instance.getSnapshot().queueLength).toBe(0);
  });

  it("keeps successful business keys bounded and deduplicated for the consent lifetime", async () => {
    const h = controller({ maxQueue: 2 });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted("2", "1"));
    await h.instance.flush(true);
    expect(h.instance.enqueue(guestStarted("2", "2"))).toMatchObject({ ok: true, value: { queued: false } });
    expect(h.instance.enqueue(guestStarted("3", "3"))).toMatchObject({ ok: true, value: { queued: true } });
    expect(h.instance.enqueue(guestStarted("4", "4"))).toEqual({ ok: false, code: "queue_full" });
  });

  it("rejects an invalid injected identifier without entering an accepted state", () => {
    const h = controller({ randomId: () => "not-a-uuid" });
    expect(h.instance.acceptGuestConsent()).toEqual({ ok: false, code: "invalid_member_context" });
    expect(h.instance.getSnapshot()).toMatchObject({ consent: "unknown", hasIdentity: false, queueLength: 0 });
  });

  it("resets pending work and identity on withdrawal, signout and deletion", () => {
    const h = controller();
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted());
    expect(h.instance.withdraw()).toMatchObject({ consent: "declined", hasIdentity: false, queueLength: 0 });
    expect(h.instance.signOut()).toMatchObject({ consent: "unknown", authState: "guest", hasIdentity: false, queueLength: 0 });
    h.instance.acceptGuestConsent();
    h.instance.enqueue(guestStarted("3", "2"));
    expect(h.instance.deleteAccount()).toMatchObject({ consent: "unknown", hasIdentity: false, queueLength: 0 });
  });
});
