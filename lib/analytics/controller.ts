import { randomUuid } from "../contracts/errors";
import { buildAnalyticsEvent, parseAnalyticsEvent, type AnalyticsEvent, type AnalyticsResult } from "./events";

export type AnalyticsConsent = "unknown" | "declined" | "accepted";
export type AnalyticsAuthState = "guest" | "member";
export type AnalyticsControllerStatus = "unknown" | "declined" | "ready" | "queued" | "sending" | "paused";
export type AnalyticsControllerError = "not_consented" | "invalid_event" | "auth_mismatch" | "invalid_member_context" | "invalid_join" | "queue_full" | "offline" | "network" | "limited" | "unknown" | "expired" | "retry_exhausted";

export interface AnalyticsIdentity {
  readonly anonymousId: string | null;
  readonly memberAnalyticsId: string | null;
}

export interface AnalyticsTransport {
  send(event: Readonly<AnalyticsEvent>, identity: Readonly<AnalyticsIdentity>): Promise<void>;
  /** Live provider grant check after an asynchronous factory resolves. */
  isCurrent?(): boolean;
  /** Stop future delivery when consent or account scope ends. */
  dispose?(): void | Promise<void>;
}

export type AnalyticsTransportFactory = (identity: Readonly<AnalyticsIdentity>) => Promise<AnalyticsTransport>;

export interface AnalyticsControllerOptions {
  readonly transportFactory: AnalyticsTransportFactory;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly maxQueue?: number;
  readonly maxAttempts?: number;
  readonly maxAgeMs?: number;
}

export interface VerifiedMemberAnalyticsContext {
  readonly analyticsAccountId: string;
  readonly consent: AnalyticsConsent;
}

export interface GuestMemberJoinToken {
  readonly flowId: string;
  readonly tokenId: string;
  readonly anonymousId: string;
  readonly generation: number;
}

export interface AnalyticsSnapshot {
  readonly status: AnalyticsControllerStatus;
  readonly consent: AnalyticsConsent;
  readonly authState: AnalyticsAuthState;
  readonly hasIdentity: boolean;
  readonly queueLength: number;
  readonly pausedCount: number;
  readonly nextRetryAt: number | null;
  readonly errorCode: AnalyticsControllerError | null;
}

export type AnalyticsControllerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: AnalyticsControllerError };

interface QueuedEvent {
  readonly event: Readonly<AnalyticsEvent>;
  readonly businessKey: string;
  readonly queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  paused: boolean;
  pauseReason: AnalyticsControllerError | null;
}

const DEFAULT_MAX_QUEUE = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBER_EVENTS = new Set(["auth_completed", "auth_intent_resumed", "comparison_save_status", "comparison_saved", "report_generation_status", "report_download_initiated", "feedback_submitted"]);

function isUuid(value: unknown): value is string { return typeof value === "string" && UUID_RE.test(value); }
function isConsent(value: unknown): value is AnalyticsConsent { return value === "unknown" || value === "declined" || value === "accepted"; }
function boundedPositive(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? Math.min(value as number, maximum) : fallback;
}

function transportError(error: unknown): AnalyticsControllerError {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown";
  if (code === "network" || code === "limited") return code;
  return "unknown";
}

function disposeTransport(transport: AnalyticsTransport | null | undefined): void {
  if (!transport?.dispose) return;
  try {
    const result = transport.dispose();
    if (result && typeof result === "object" && "catch" in result && typeof result.catch === "function") {
      result.catch(() => undefined);
    }
  } catch {
    // Disposal must never make sign-out, withdrawal, or account switching fail.
  }
}

const MEMBER_RUNTIME_DISPOSE_TIMEOUT_MS = 5_000;

async function disposeTransportObserved(transport: AnalyticsTransport | null | undefined): Promise<boolean> {
  if (!transport?.dispose) return true;
  try {
    const result = transport.dispose();
    if (!result || typeof result !== "object" || !("then" in result) || typeof result.then !== "function") return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), MEMBER_RUNTIME_DISPOSE_TIMEOUT_MS); });
    const disposed = await Promise.race([Promise.resolve(result).then(() => true, () => false), timeout]);
    if (timer !== undefined) clearTimeout(timer);
    return disposed;
  } catch { return false; }
}

async function withDisposalDeadline(disposal: Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), MEMBER_RUNTIME_DISPOSE_TIMEOUT_MS); });
  const result = await Promise.race([disposal, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

function observePendingTransport(factoryPromise: Promise<AnalyticsTransport>): Promise<boolean> {
  return factoryPromise.then((transport) => disposeTransportObserved(transport), () => true);
}

function resultCode(result: AnalyticsResult<AnalyticsEvent>): AnalyticsControllerError {
  if (result.ok) return "unknown";
  if (result.code === "auth_mismatch") return "auth_mismatch";
  return "invalid_event";
}

function modePart(properties: Record<string, unknown>): string {
  return typeof properties.mode === "string" ? properties.mode : "";
}

function businessKey(event: AnalyticsEvent): string {
  const properties = event.properties as unknown as Record<string, unknown>;
  switch (event.event) {
    case "comparison_started": return `comparison_started:${properties.draft_id}`;
    case "comparison_completed": return `comparison_completed:${properties.result_id}`;
    case "auth_prompt_viewed": return `auth_prompt_viewed:${properties.result_id}:${properties.action}:${modePart(properties)}:${properties.session_id}`;
    case "auth_completed": return `auth_completed:${properties.flow_id}`;
    case "auth_intent_resumed": return `auth_intent_resumed:${properties.flow_id}:${properties.action}:${modePart(properties)}:${properties.status}`;
    case "comparison_save_status": return `comparison_save_status:${properties.request_id}:${properties.stage}`;
    case "comparison_saved": return `comparison_saved:${properties.request_id}`;
    case "report_generation_status": return `report_generation_status:${properties.request_id}:${properties.stage}`;
    case "report_download_initiated": return `report_download_initiated:${properties.request_id}`;
    case "feedback_submitted": return `feedback_submitted:${properties.result_id}:${properties.context_version}`;
    case "web_vital": return `web_vital:${properties.metric_id}`;
  }
}

export class AnalyticsController {
  private readonly transportFactory: AnalyticsTransportFactory;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly maxQueue: number;
  private readonly maxAttempts: number;
  private readonly maxAgeMs: number;
  private readonly queue: QueuedEvent[] = [];
  private readonly dedup = new Set<string>();
  private readonly deliveredDedup = new Set<string>();
  private readonly joinTokens = new Map<string, { flowId: string; generation: number }>();
  private generation = 0;
  private consent: AnalyticsConsent = "unknown";
  private authState: AnalyticsAuthState = "guest";
  private identity: AnalyticsIdentity = { anonymousId: null, memberAnalyticsId: null };
  private errorCode: AnalyticsControllerError | null = null;
  private consentStartedAt: number | null = null;
  private online = false;
  private flushPromise: Promise<AnalyticsSnapshot> | null = null;
  private flushGeneration: number | null = null;
  private transport: { generation: number; identity: AnalyticsIdentity; value: AnalyticsTransport } | null = null;
  private pendingDisposal: AnalyticsTransport | null = null;
  private pendingTransportFactory: Promise<AnalyticsTransport> | null = null;
  private pendingDisposalFactory: Promise<AnalyticsTransport> | null = null;
  private pendingFactoryDisposal: Promise<boolean> | null = null;
  private pendingDisposalPromise: Promise<boolean> | null = null;

  constructor(options: AnalyticsControllerOptions) {
    this.transportFactory = options.transportFactory;
    this.now = options.now ?? (() => Date.now());
    this.randomId = options.randomId ?? randomUuid;
    this.maxQueue = boundedPositive(options.maxQueue, DEFAULT_MAX_QUEUE, 100);
    this.maxAttempts = boundedPositive(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 5);
    this.maxAgeMs = boundedPositive(options.maxAgeMs, DEFAULT_MAX_AGE_MS, DEFAULT_MAX_AGE_MS);
  }

  getSnapshot(): AnalyticsSnapshot {
    const pausedCount = this.queue.filter((item) => item.paused).length;
    const head = this.queue[0];
    const nextRetryAt = head && !head.paused ? head.nextAttemptAt : null;
    const status: AnalyticsControllerStatus = this.consent === "unknown" ? "unknown" : this.consent === "declined" ? "declined" : this.online && this.flushPromise ? "sending" : pausedCount > 0 ? "paused" : this.queue.length > 0 ? "queued" : "ready";
    return { status, consent: this.consent, authState: this.authState, hasIdentity: this.identity.anonymousId !== null || this.identity.memberAnalyticsId !== null, queueLength: this.queue.length, pausedCount, nextRetryAt, errorCode: this.errorCode };
  }

  acceptGuestConsent(): AnalyticsControllerResult<AnalyticsSnapshot> {
    if (this.authState !== "guest") return { ok: false, code: "invalid_member_context" };
    if (this.consent === "accepted") return { ok: true, value: this.getSnapshot() };
    let anonymousId: string;
    try { anonymousId = this.randomId(); } catch { return { ok: false, code: "invalid_member_context" }; }
    if (!isUuid(anonymousId)) return { ok: false, code: "invalid_member_context" };
    this.resetRuntime("accepted");
    this.consent = "accepted";
    this.identity = { anonymousId, memberAnalyticsId: null };
    this.consentStartedAt = this.now();
    return { ok: true, value: this.getSnapshot() };
  }

  decline(): AnalyticsSnapshot {
    this.resetRuntime("declined");
    this.consent = "declined";
    return this.getSnapshot();
  }

  withdraw(): AnalyticsSnapshot {
    this.resetRuntime("declined");
    this.consent = "declined";
    return this.getSnapshot();
  }

  signOut(): AnalyticsSnapshot {
    this.resetRuntime("unknown");
    this.authState = "guest";
    this.consent = "unknown";
    return this.getSnapshot();
  }

  deleteAccount(): AnalyticsSnapshot {
    return this.signOut();
  }

  /**
   * Dispose only the current member runtime after a browser-private clear.
   * Consent remains accepted/declined in memory; this does not write a
   * preference and never invokes the transport.
   */
  disposeMemberRuntime(): Promise<boolean> {
    if (this.pendingDisposalPromise) return this.pendingDisposalPromise;
    const consent = this.consent;
    const transport = this.pendingDisposal ?? this.transport?.value;
    const factoryPromise = this.pendingDisposalFactory ?? this.pendingTransportFactory;
    this.pendingDisposal = transport ?? null;
    this.pendingDisposalFactory = factoryPromise;
    this.resetRuntime(consent, false);
    this.authState = "member";
    this.consent = consent;
    let disposal: Promise<boolean>;
    if (factoryPromise) {
      // Keep one eventual disposal observer for a delayed factory. A deadline
      // may return retry while the factory is still pending; a later retry
      // must reuse that observer rather than call SDK dispose twice when it
      // eventually resolves.
      const eventual = this.pendingFactoryDisposal ?? observePendingTransport(factoryPromise);
      this.pendingFactoryDisposal = eventual;
      eventual.then((disposed) => {
        if (this.pendingFactoryDisposal === eventual) this.pendingFactoryDisposal = null;
        if (disposed && this.pendingDisposalFactory === factoryPromise) this.pendingDisposalFactory = null;
      });
      disposal = withDisposalDeadline(eventual);
    } else {
      disposal = disposeTransportObserved(transport);
    }
    const result = disposal.then((disposed) => {
      if (disposed && this.pendingDisposal === transport) this.pendingDisposal = null;
      if (disposed && this.pendingDisposalFactory === factoryPromise) this.pendingDisposalFactory = null;
      // Coalesce concurrent callers only while this attempt is in flight.
      // A failed/expired attempt must leave the captured capability available
      // for a later explicit retry instead of returning the same false result.
      this.pendingDisposalPromise = null;
      return disposed;
    });
    this.pendingDisposalPromise = result;
    return result;
  }

  captureGuestJoin(flowId: string): AnalyticsControllerResult<GuestMemberJoinToken> {
    if (this.authState !== "guest" || this.consent !== "accepted" || !isUuid(flowId)) return { ok: false, code: "invalid_join" };
    if (this.joinTokens.size >= this.maxQueue) return { ok: false, code: "queue_full" };
    let tokenId: string;
    try { tokenId = this.randomId(); } catch { return { ok: false, code: "invalid_join" }; }
    if (!isUuid(tokenId)) return { ok: false, code: "invalid_join" };
    const anonymousId = this.identity.anonymousId;
    if (!anonymousId || !isUuid(anonymousId)) return { ok: false, code: "invalid_join" };
    this.joinTokens.set(tokenId, { flowId, generation: this.generation });
    return { ok: true, value: Object.freeze({ flowId, tokenId, anonymousId, generation: this.generation }) };
  }

  /** Restore only a consented guest identity after a full page navigation. */
  restoreGuestJoin(anonymousId: string, flowId: string): AnalyticsControllerResult<GuestMemberJoinToken> {
    if (this.authState !== "guest" || this.consent !== "unknown" || !isUuid(anonymousId) || !isUuid(flowId)) return { ok: false, code: "invalid_join" };
    let tokenId: string;
    try { tokenId = this.randomId(); } catch { return { ok: false, code: "invalid_join" }; }
    if (!isUuid(tokenId)) return { ok: false, code: "invalid_join" };
    this.resetRuntime("accepted");
    this.authState = "guest";
    this.identity = { anonymousId, memberAnalyticsId: null };
    this.joinTokens.set(tokenId, { flowId, generation: this.generation });
    return { ok: true, value: Object.freeze({ flowId, tokenId, anonymousId, generation: this.generation }) };
  }

  setMemberContext(context: VerifiedMemberAnalyticsContext, token?: GuestMemberJoinToken): AnalyticsControllerResult<AnalyticsSnapshot> {
    if (!context || typeof context !== "object" || !isUuid(context.analyticsAccountId) || !isConsent(context.consent)) {
      // A malformed replacement context must revoke the prior runtime before
      // reporting the error. This prevents an old account from continuing to
      // queue or deliver while a new account is being resolved.
      this.resetRuntime("unknown");
      this.authState = "member";
      this.consent = "unknown";
      return { ok: false, code: "invalid_member_context" };
    }
    if (context.consent !== "accepted") {
      this.resetRuntime(context.consent);
      this.authState = "member";
      this.consent = context.consent;
      return { ok: true, value: this.getSnapshot() };
    }
    const joiningGuest = this.authState === "guest" && this.consent === "accepted";
    if (joiningGuest) {
      const tokenValid = !!token && token.generation === this.generation && isUuid(token.tokenId) && isUuid(token.flowId) && isUuid(token.anonymousId) && token.anonymousId === this.identity.anonymousId && this.joinTokens.get(token.tokenId)?.flowId === token.flowId;
      if (tokenValid) this.joinTokens.delete(token!.tokenId);
      else {
        // A verified member context is still valid, but an unproven join must
        // never carry guest activity or its identifier into that member.
        this.resetRuntime("accepted");
        this.authState = "member";
        this.consent = "accepted";
        this.identity = { anonymousId: null, memberAnalyticsId: context.analyticsAccountId };
        this.consentStartedAt = this.now();
        return { ok: true, value: this.getSnapshot() };
      }
    } else {
      if (this.authState === "member" && this.consent === "accepted" && this.identity.memberAnalyticsId === context.analyticsAccountId) return { ok: true, value: this.getSnapshot() };
      this.resetRuntime("accepted");
    }
    // A valid guest-to-member join keeps the queued guest events, but its SDK
    // transport belongs to the previous identity lifetime and must be revoked.
    if (joiningGuest) {
      disposeTransport(this.transport?.value);
      this.transport = null;
    }
    this.generation += 1;
    this.flushPromise = null;
    this.flushGeneration = null;
    this.online = false;
    this.authState = "member";
    this.consent = "accepted";
    this.identity = { anonymousId: joiningGuest ? this.identity.anonymousId : null, memberAnalyticsId: context.analyticsAccountId };
    this.consentStartedAt ??= this.now();
    this.errorCode = null;
    return { ok: true, value: this.getSnapshot() };
  }

  enqueue(event: unknown): AnalyticsControllerResult<{ queued: boolean; eventId?: string }> {
    if (this.consent !== "accepted" || !this.identity.anonymousId && !this.identity.memberAnalyticsId) return { ok: false, code: "not_consented" };
    const parsed = buildAnalyticsEvent(event);
    if (!parsed.ok) { this.errorCode = resultCode(parsed); return { ok: false, code: resultCode(parsed) }; }
    if (parsed.value.properties.auth_state !== this.authState) { this.errorCode = "auth_mismatch"; return { ok: false, code: "auth_mismatch" }; }
    if (MEMBER_EVENTS.has(parsed.value.event) && this.authState !== "member") { this.errorCode = "auth_mismatch"; return { ok: false, code: "auth_mismatch" }; }
    const occurredAt = Date.parse(parsed.value.properties.occurred_at);
    if (this.consentStartedAt === null || occurredAt < this.consentStartedAt || occurredAt > this.now()) { this.errorCode = "invalid_event"; return { ok: false, code: "invalid_event" }; }
    const key = businessKey(parsed.value);
    if (this.dedup.has(key) || this.deliveredDedup.has(key)) return { ok: true, value: { queued: false, eventId: parsed.value.properties.event_id } };
    if (this.queue.length + this.deliveredDedup.size >= this.maxQueue) { this.errorCode = "queue_full"; return { ok: false, code: "queue_full" }; }
    this.dedup.add(key);
    this.queue.push({ event: parsed.value, businessKey: key, queuedAt: this.now(), attempts: 0, nextAttemptAt: this.now(), paused: false, pauseReason: null });
    this.errorCode = null;
    return { ok: true, value: { queued: true, eventId: parsed.value.properties.event_id } };
  }

  async flush(online: boolean): Promise<AnalyticsSnapshot> {
    this.online = online;
    if (!online) { this.errorCode = this.queue.length ? "offline" : null; return this.getSnapshot(); }
    if (this.flushPromise) {
      // A context reset invalidates the old lifetime. Let its in-flight send
      // settle, then start a pump for the current identity rather than
      // returning the stale promise to the new context.
      if (this.flushGeneration === this.generation) return this.flushPromise;
      const previous = this.flushPromise;
      return previous.then(() => this.flush(online), () => this.flush(online));
    }
    if (this.consent !== "accepted" || this.queue.length === 0) return this.getSnapshot();
    const generation = this.generation;
    const identity = Object.freeze({ ...this.identity });
    this.flushGeneration = generation;
    const pump = this.drain(generation, identity).catch(() => this.getSnapshot());
    const finish = (): AnalyticsSnapshot => {
      if (this.flushGeneration === generation) {
        this.flushPromise = null;
        this.flushGeneration = null;
      }
      return this.getSnapshot();
    };
    this.flushPromise = pump.then(finish, finish);
    return this.flushPromise;
  }

  private async drain(generation: number, identity: AnalyticsIdentity): Promise<AnalyticsSnapshot> {
    let transport: AnalyticsTransport | null = null;
    let expired = false;
    try {
      for (;;) {
        if (!this.online || generation !== this.generation || this.consent !== "accepted" || (identity.anonymousId !== this.identity.anonymousId || identity.memberAnalyticsId !== this.identity.memberAnalyticsId)) return this.getSnapshot();
        const item = this.queue[0];
        if (!item) { if (!expired) this.errorCode = null; return this.getSnapshot(); }
        if (this.now() - item.queuedAt > this.maxAgeMs) { this.removeHead(); expired = true; this.errorCode = "expired"; continue; }
        if (item.paused || item.nextAttemptAt > this.now()) return this.getSnapshot();
        if (item.attempts >= this.maxAttempts) { item.paused = true; item.pauseReason = "retry_exhausted"; this.errorCode = "retry_exhausted"; return this.getSnapshot(); }
        const outbound = parseAnalyticsEvent(item.event);
        if (!outbound.ok) { item.paused = true; item.pauseReason = "invalid_event"; this.errorCode = "invalid_event"; return this.getSnapshot(); }
        if (!transport) {
          if (this.transport?.generation === generation && this.transport.identity.anonymousId === identity.anonymousId && this.transport.identity.memberAnalyticsId === identity.memberAnalyticsId) transport = this.transport.value;
          else {
            const factoryPromise = this.transportFactory(identity);
            this.pendingTransportFactory = factoryPromise;
            try {
              transport = await factoryPromise;
            } catch (error) {
              if (this.pendingTransportFactory === factoryPromise) this.pendingTransportFactory = null;
              if (!this.isCurrent(generation, identity)) return this.getSnapshot();
              item.attempts += 1;
              this.recordFailure(item, transportError(error));
              return this.getSnapshot();
            }
            if (this.pendingTransportFactory === factoryPromise) this.pendingTransportFactory = null;
            if (!this.online || !this.isCurrent(generation, identity) || transport.isCurrent?.() === false) {
              if (this.pendingDisposalFactory !== factoryPromise) disposeTransport(transport);
              transport = null;
              return this.getSnapshot();
            }
            if (this.now() - item.queuedAt > this.maxAgeMs) {
              disposeTransport(transport);
              transport = null;
              this.removeHead(); expired = true; this.errorCode = "expired"; continue;
            }
            this.transport = { generation, identity, value: transport };
          }
        }
        if (!this.online || !this.isCurrent(generation, identity)) return this.getSnapshot();
        item.attempts += 1;
        try {
          await transport.send(outbound.value, identity);
        } catch (error) {
          const code = transportError(error);
          if (!this.isCurrent(generation, identity)) return this.getSnapshot();
          this.recordFailure(item, code);
          return this.getSnapshot();
        }
        if (!this.isCurrent(generation, identity)) return this.getSnapshot();
        this.removeHead(true);
        this.errorCode = null;
      }
    } catch (error) {
      if (this.isCurrent(generation, identity)) this.errorCode = transportError(error);
      return this.getSnapshot();
    }
  }

  private isCurrent(generation: number, identity: AnalyticsIdentity): boolean {
    return this.online && generation === this.generation && this.consent === "accepted" && identity.anonymousId === this.identity.anonymousId && identity.memberAnalyticsId === this.identity.memberAnalyticsId;
  }

  private recordFailure(item: QueuedEvent, code: AnalyticsControllerError): void {
    this.errorCode = code;
    if (item.attempts >= this.maxAttempts) { item.paused = true; item.pauseReason = "retry_exhausted"; return; }
    item.nextAttemptAt = this.now() + Math.min(60_000, 1_000 * 2 ** (item.attempts - 1));
  }

  private removeHead(delivered = false): void {
    const item = this.queue.shift();
    if (item) {
      this.dedup.delete(item.businessKey);
      if (delivered) this.deliveredDedup.add(item.businessKey);
    }
  }

  private resetRuntime(consent: AnalyticsConsent, dispose = true): void {
    this.generation += 1;
    this.flushPromise = null;
    this.flushGeneration = null;
    this.online = false;
    this.queue.length = 0;
    this.dedup.clear();
    this.deliveredDedup.clear();
    this.joinTokens.clear();
    if (dispose) {
      this.pendingDisposal = null;
      this.pendingFactoryDisposal = null;
      this.pendingDisposalPromise = null;
      this.pendingDisposalFactory = null;
      disposeTransport(this.transport?.value);
    }
    this.transport = null;
    this.identity = { anonymousId: null, memberAnalyticsId: null };
    this.errorCode = null;
    this.consentStartedAt = consent === "accepted" ? this.now() : null;
    this.consent = consent;
  }
}
