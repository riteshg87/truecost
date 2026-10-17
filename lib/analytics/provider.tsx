"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/provider";
import { randomUuid } from "../contracts/errors";
import { AnalyticsController, type AnalyticsControllerResult, type AnalyticsIdentity, type AnalyticsSnapshot, type AnalyticsTransport, type AnalyticsTransportFactory, type GuestMemberJoinToken } from "./controller";
import { ANALYTICS_CONFIG, type AnalyticsRuntimeConfig } from "./config";
import { AnalyticsPreferenceError, createSessionBoundAnalyticsPreferenceTransport, markAnalyticsDiagnostic, type AnalyticsPreference, type AnalyticsPreferenceTransport, type AnalyticsPreferenceWrite } from "./preference-transport";
import { clearPendingAnalyticsDecline, consumeConfirmedAnalyticsLogout, notifyAnalyticsPreference, readLocalAnalyticsPreference, readPendingAnalyticsDecline, writeLocalAnalyticsPreference, writePendingAnalyticsDecline, CONFIRMED_LOGOUT_STORAGE_KEY } from "./storage";
import { subscribeToPrivateBrowserClearSignal } from "../privacy/private-browser-clear-signal";
import { clearRememberedFeedbackContexts } from "../feedback/context";

const GUEST_JOIN_MARKER_KEY = "truecost.analytics.guest-join.v1";
const GUEST_JOIN_MARKER_TTL_MS = 10 * 60 * 1000;
type GuestJoinMarker = { readonly flowId: string; readonly anonymousId: string; readonly createdAt: number; readonly sessionId?: string };

function readGuestJoinMarker(): GuestJoinMarker | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(GUEST_JOIN_MARKER_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { flowId?: unknown; anonymousId?: unknown; createdAt?: unknown; sessionId?: unknown };
    const validSession = value.sessionId === undefined || (typeof value.sessionId === "string" && value.sessionId.length > 0 && value.sessionId.length <= 256);
    const valid = typeof value.flowId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.flowId) && typeof value.anonymousId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.anonymousId) && typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && value.createdAt <= Date.now() + 60_000 && Date.now() - value.createdAt <= GUEST_JOIN_MARKER_TTL_MS && validSession;
    if (!valid) window.sessionStorage.removeItem(GUEST_JOIN_MARKER_KEY);
    return valid ? { flowId: value.flowId as string, anonymousId: value.anonymousId as string, createdAt: value.createdAt as number, ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}) } : null;
  } catch { return null; }
}
function writeGuestJoinMarker(flowId: string, anonymousId: string): void { try { if (typeof window !== "undefined") window.sessionStorage.setItem(GUEST_JOIN_MARKER_KEY, JSON.stringify({ flowId, anonymousId, createdAt: Date.now() })); } catch { /* optional continuity marker */ } }
function bindGuestJoinMarker(sessionId: string): GuestJoinMarker | null {
  const marker = readGuestJoinMarker();
  if (!marker || marker.sessionId || !sessionId) return marker;
  try { window.sessionStorage.setItem(GUEST_JOIN_MARKER_KEY, JSON.stringify({ ...marker, sessionId })); } catch { return marker; }
  return { ...marker, sessionId };
}
function clearGuestJoinMarker(): void { try { if (typeof window !== "undefined") window.sessionStorage.removeItem(GUEST_JOIN_MARKER_KEY); } catch { /* optional */ } }

export type AnalyticsProviderStatus = "disabled" | "loading" | "unknown" | "declined" | "accepted" | "error" | "pending";
export interface AnalyticsCorrelationFactory { readonly eventId: string; readonly newCorrelationId: () => string; }

export type MemberAnalyticsLocalCleanupResult = { readonly kind: "cleared" } | { readonly kind: "retry"; readonly reason: "storage-unavailable" };

/**
 * Local-only cleanup boundary for the browser clear coordinator. The
 * controller disposal is supplied by the provider; this function only removes
 * namespaced member retry/context markers and never touches consent.
 */
export function clearMemberAnalyticsTransientStorage(): MemberAnalyticsLocalCleanupResult {
  const feedback = clearRememberedFeedbackContexts();
  return feedback ? { kind: "cleared" } : { kind: "retry", reason: "storage-unavailable" };
}

/** Dispose a supplied controller and clear the namespaced member context. */
export async function disposeMemberAnalyticsLocally(controller: AnalyticsController | null): Promise<MemberAnalyticsLocalCleanupResult> {
  let sdkDisposed = true;
  try { if (controller) sdkDisposed = await controller.disposeMemberRuntime(); }
  catch { sdkDisposed = false; }
  const storage = clearMemberAnalyticsTransientStorage();
  return sdkDisposed && storage.kind === "cleared" ? { kind: "cleared" } : { kind: "retry", reason: "storage-unavailable" };
}

export interface AnalyticsContextValue {
  readonly status: AnalyticsProviderStatus;
  readonly consent: "unknown" | "declined" | "accepted";
  /** Opaque in-memory lifetime marker for consumers holding account mappings. */
  readonly consentEpoch: number;
  readonly joinedFlowId: string | null;
  readonly error: string | null;
  readonly pendingWrite: boolean;
  readonly snapshot: AnalyticsSnapshot | null;
  readonly accept: () => Promise<void>;
  readonly decline: () => Promise<void>;
  readonly withdraw: () => Promise<void>;
  readonly clearPrivateRuntime: () => Promise<MemberAnalyticsLocalCleanupResult>;
  readonly retry: () => Promise<void>;
  readonly track: (build: (ids: AnalyticsCorrelationFactory) => unknown) => AnalyticsControllerResult<{ queued: boolean; eventId?: string }>;
  readonly captureGuestJoin: (flowId: string) => AnalyticsControllerResult<GuestMemberJoinToken>;
}

type Consent = "unknown" | "declined" | "accepted";
interface ProviderState {
  readonly scope: string;
  readonly status: AnalyticsProviderStatus;
  readonly consent: Consent;
  readonly error: string | null;
  readonly pendingWrite: boolean;
  readonly preference: AnalyticsPreference | null;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);
const UNKNOWN = { consent: "unknown" as const, error: null, pendingWrite: false };

function lazyTransportFactory(config: AnalyticsRuntimeConfig): AnalyticsTransportFactory {
  return async (identity: Readonly<AnalyticsIdentity>) => {
    const module = await import("./mixpanel-adapter");
    if (!config.token) throw new Error("analytics unavailable");
    return module.createMixpanelTransportFactory({ token: config.token })(identity);
  };
}

async function replayPendingDecline(
  transport: AnalyticsPreferenceTransport,
  isCurrent: () => boolean,
): Promise<AnalyticsPreference | null> {
  let fresh = await transport.read();
  if (!isCurrent()) return null;
  // A concurrent preference update can make the first CAS stale. Re-read once
  // and retry, then leave the marker for the next reconnect if it still races.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = await transport.write("declined", fresh.revision);
      return isCurrent() ? next : null;
    } catch (error) {
      if (!(error instanceof AnalyticsPreferenceError) || error.code !== "conflict" || attempt !== 0) throw error;
      fresh = await transport.read();
      if (!isCurrent()) return null;
    }
  }
  return null;
}

export interface AnalyticsProviderProps {
  children: ReactNode;
  /** Test boundary; production uses the verified session and Convex transport. */
  preferenceTransport?: AnalyticsPreferenceTransport;
  /** Test boundary; production uses the consent-bound Mixpanel factory. */
  transportFactory?: AnalyticsTransportFactory;
  config?: AnalyticsRuntimeConfig;
}

export function AnalyticsProvider({ children, preferenceTransport: injectedPreference, transportFactory: injectedFactory, config = ANALYTICS_CONFIG }: AnalyticsProviderProps) {
  const auth = useAuth();
  const session = auth.privateSession;
  const authReadyRef = useRef(auth.ready);
  authReadyRef.current = auth.ready;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const member = auth.viewer === "member" && session !== null;
  const memberRef = useRef(member);
  memberRef.current = member;
  const scopeKey = member ? `${session.identity.subject}:${session.identity.sessionId}:${session.identity.authEpoch}` : auth.viewer === "guest" ? "guest" : "anonymous";
  const scopeRef = useRef(scopeKey);
  const controllerRef = useRef<AnalyticsController | null>(null);
  const generation = useRef(0);
  const readSerial = useRef(0);
  const consentEpoch = useRef(0);
  const pendingJoin = useRef<GuestMemberJoinToken | null>(null);
  const joinedFlowId = useRef<string | null>(null);
  const browserClearScopeRef = useRef<string | null>(null);
  const pendingBrowserClearControllersRef = useRef<Set<AnalyticsController>>(new Set());
  const pendingBrowserClearRef = useRef<Promise<MemberAnalyticsLocalCleanupResult> | null>(null);
  // A declined member choice is durable browser intent. Keep a retry bit when
  // storage is temporarily unavailable so a later auth transition cannot
  // hydrate an older accepted guest choice.
  const pendingGuestOptOutRef = useRef(false);
  const activePreferenceRef = useRef<{ readonly policyVersion: "v1"; readonly analyticsAccountId: string } | null>(null);
  const [state, setState] = useState<ProviderState>({ scope: scopeKey, status: config.enabled ? "loading" : "disabled", consent: "unknown", error: null, pendingWrite: false, preference: null });
  const [pumpSignal, setPumpSignal] = useState(0);

  // Render-time fence prevents a previous account's accepted state from being
  // painted while React is settling the new auth context.
  if (scopeRef.current !== scopeKey) {
    const marker = readGuestJoinMarker();
    const markerMatchesIncomingSession = !marker?.sessionId || marker.sessionId === session?.identity.sessionId;
    const preserveGuestRuntime = scopeRef.current === "guest" && controllerRef.current?.getSnapshot().consent === "accepted" && (pendingJoin.current !== null || marker !== null);
    // A hard navigation can render anonymous while the verified session is
    // still binding. Carry only the validated continuity marker across that
    // hydration gap; authorization to restore it remains gated by the
    // completed-session epoch in load/activateAcceptedMember.
    const preserveHydrationMarker = marker !== null && markerMatchesIncomingSession && (scopeRef.current === "anonymous" || scopeRef.current === "guest");
    const preserveJoin = preserveGuestRuntime || preserveHydrationMarker;
    scopeRef.current = scopeKey;
    browserClearScopeRef.current = null;
    // A failed member disposal is a private capability that must survive an
    // auth transition so an explicit retry can finish it. It is kept outside
    // the active controller and never used to hydrate the new scope.
    generation.current += 1;
    consentEpoch.current += 1;
    if (!preserveGuestRuntime) {
      controllerRef.current?.signOut();
      controllerRef.current = null;
    }
    if (!preserveJoin) {
      pendingJoin.current = null;
      joinedFlowId.current = null;
      clearGuestJoinMarker();
    }
    activePreferenceRef.current = null;
  }

  const setController = useCallback((controller: AnalyticsController, consent: "accepted" | "declined" | "unknown", preference?: AnalyticsPreference) => {
    controllerRef.current = controller;
    consentEpoch.current += 1;
    activePreferenceRef.current = preference?.consent === "accepted" && preference.analyticsAccountId ? { policyVersion: preference.policyVersion, analyticsAccountId: preference.analyticsAccountId } : null;
    if (consent === "accepted") markAnalyticsDiagnostic("provider.accepted_context_activated");
    setState({ scope: scopeRef.current, status: consent === "accepted" ? "accepted" : consent === "declined" ? "declined" : "unknown", consent, error: null, pendingWrite: false, preference: preference ?? null });
  }, []);

  const preferenceFor = useCallback((): AnalyticsPreferenceTransport | null => {
    if (injectedPreference) return injectedPreference;
    try { return session ? createSessionBoundAnalyticsPreferenceTransport({ session }) : null; } catch { return null; }
  }, [injectedPreference, session]);

  const factory = useMemo(() => injectedFactory ?? lazyTransportFactory(config), [config, injectedFactory]);
  // Keep the provider's verified grant at the transport boundary. The
  // controller also owns its queue generation, but a factory can be pending
  // while auth changes without causing a React render.
  const boundedFactory = useMemo<AnalyticsTransportFactory>(() => async (identity) => {
    if (!authReadyRef.current) throw new Error("auth unavailable");
    if (member && !session?.isCurrent()) throw new Error("verified grant expired");
    const transport = await factory(identity);
    const guarded: AnalyticsTransport = {
      isCurrent: () => authReadyRef.current && (!member || Boolean(session?.isCurrent())),
      send: async (event, outboundIdentity) => {
        if (!authReadyRef.current) throw new Error("auth unavailable");
        if (member && !session?.isCurrent()) throw new Error("verified grant expired");
        await transport.send(event, outboundIdentity);
        if (!authReadyRef.current) throw new Error("auth unavailable");
        if (member && !session?.isCurrent()) throw new Error("verified grant expired");
      },
      dispose: () => transport.dispose?.(),
    };
    // Return the captured transport even when the verified grant expired
    // during factory creation. The controller owns the browser-clear fence
    // and can observe disposal failure/retry; awaiting and swallowing it here
    // made a failed SDK disposal look like a successful factory rejection.
    return guarded;
  }, [factory, member, session]);
  const makeController = useCallback(() => new AnalyticsController({ transportFactory: boundedFactory }), [boundedFactory]);

  const disposeForBrowserClear = useCallback((): Promise<MemberAnalyticsLocalCleanupResult> => {
    if (pendingBrowserClearRef.current) return pendingBrowserClearRef.current;
    const run = (async (): Promise<MemberAnalyticsLocalCleanupResult> => {
      generation.current += 1;
      readSerial.current += 1;
      const controllers = new Set<AnalyticsController>(pendingBrowserClearControllersRef.current);
      const activeController = controllerRef.current;
      if (activeController?.getSnapshot().authState === "member") controllers.add(activeController);
      if (memberRef.current) {
        browserClearScopeRef.current = scopeRef.current;
        pendingJoin.current = null;
        joinedFlowId.current = null;
        consentEpoch.current += 1;
      }
      const memberControllers = [...controllers].filter((candidate) => candidate.getSnapshot().authState === "member");
      if (memberControllers.length > 0) {
        for (const candidate of memberControllers) pendingBrowserClearControllersRef.current.add(candidate);
        if (activeController && memberControllers.includes(activeController)) controllerRef.current = null;
        activePreferenceRef.current = null;
        const marker = readGuestJoinMarker();
        if (marker?.sessionId === sessionRef.current?.identity.sessionId) clearGuestJoinMarker();
        setState((old) => ({ ...old }));
        // Invoke every member cleanup before awaiting any SDK/storage work so
        // all captured runtimes are fenced synchronously in this tab.
        const results = await Promise.all(memberControllers.map((candidate) => disposeMemberAnalyticsLocally(candidate)));
        memberControllers.forEach((candidate, index) => { if (results[index].kind === "cleared") pendingBrowserClearControllersRef.current.delete(candidate); });
        if (results.some((result) => result.kind === "retry")) {
          setState((old) => ({ ...old, error: "Member analytics context could not be fully cleared from this browser." }));
          return { kind: "retry", reason: "storage-unavailable" };
        }
        return { kind: "cleared" };
      }
      const result = clearMemberAnalyticsTransientStorage();
      setState((old) => ({ ...old }));
      if (result.kind === "retry") setState((old) => ({ ...old, error: "Member analytics context could not be fully cleared from this browser." }));
      return result;
    })();
    pendingBrowserClearRef.current = run;
    run.then(() => { if (pendingBrowserClearRef.current === run) pendingBrowserClearRef.current = null; }, () => { if (pendingBrowserClearRef.current === run) pendingBrowserClearRef.current = null; });
    return run;
  }, []);

  const activateAcceptedMember = useCallback((preference: AnalyticsPreference) => {
    if (!authReadyRef.current) throw new Error("auth unavailable");
    if (!member || !session || preference.consent !== "accepted" || !preference.sendPermission || !preference.analyticsAccountId) throw new Error("invalid preference");
    const pending = pendingJoin.current;
    const liveSnapshot = controllerRef.current?.getSnapshot();
    // A join token is valid only while it is still backed by the accepted
    // guest controller that captured it. Consent loading may withdraw that
    // controller before member acceptance resolves; in that case the token
    // cannot be presented to a fresh controller, so restore the session-bound
    // marker instead.
    const join = pending && liveSnapshot?.authState === "guest" && liveSnapshot.consent === "accepted" ? pending : null;
    if (pending && !join) pendingJoin.current = null;
    const marker = !join && auth.authCompletionEpoch > 0 && auth.authCompletionSessionId === session.identity.sessionId ? readGuestJoinMarker() : null;
    const persistedJoin = marker?.sessionId === session.identity.sessionId ? marker : null;
    if (marker?.sessionId && marker.sessionId !== session.identity.sessionId) clearGuestJoinMarker();
    if (!join) {
      controllerRef.current?.signOut();
      controllerRef.current = null;
      activePreferenceRef.current = null;
    }
    const controller = controllerRef.current ?? makeController();
    let memberToken = join;
    if (!memberToken && persistedJoin) {
      const restored = controller.restoreGuestJoin(persistedJoin.anonymousId, persistedJoin.flowId);
      if (!restored.ok) throw new Error("invalid join marker");
      memberToken = restored.value;
    }
    const result = controller.setMemberContext({ analyticsAccountId: preference.analyticsAccountId, consent: "accepted" }, memberToken ?? undefined);
    if (!result.ok) throw new Error("invalid preference");
    pendingJoin.current = null;
    joinedFlowId.current = memberToken?.flowId ?? null;
    if (persistedJoin) clearGuestJoinMarker();
    setController(controller, "accepted", preference);
  }, [auth.authCompletionEpoch, auth.authCompletionSessionId, makeController, member, session, setController]);

  const load = useCallback(async (captured: number) => {
    const serial = ++readSerial.current;
    const currentRead = () => authReadyRef.current && captured === generation.current && serial === readSerial.current;
    if (!config.enabled || !authReadyRef.current) return;
    markAnalyticsDiagnostic("provider.load_started");
    if (member && browserClearScopeRef.current === scopeRef.current) return;
    if (scopeRef.current === "guest") {
      // A successful auth sign-out revokes the former member's local grant.
      // Consume this only in guest scope; anonymous hydration and session
      // suspension must preserve consent for a possible recovery.
      const logoutReset = consumeConfirmedAnalyticsLogout();
      if (logoutReset !== "none") {
        controllerRef.current?.withdraw();
        controllerRef.current = null;
        activePreferenceRef.current = null;
        if (logoutReset === "retry") {
          setState({ scope: scopeRef.current, status: "error", consent: "unknown", error: "Analytics is off. This browser could not save the sign-out reset.", pendingWrite: false, preference: null });
          return;
        }
        setState({ scope: scopeRef.current, status: "unknown", consent: "unknown", error: null, pendingWrite: false, preference: null });
      }
      if (pendingGuestOptOutRef.current) {
        const saved = writeLocalAnalyticsPreference("declined");
        pendingGuestOptOutRef.current = !saved;
        if (!saved) {
          if (currentRead()) setState((old) => ({ ...old, scope: scopeRef.current, status: "error", consent: "unknown", error: "This browser could not save your analytics choice." }));
          return;
        }
      }
      const local = readLocalAnalyticsPreference();
      if (!currentRead()) return;
      if (local.consent === "accepted") {
        if (controllerRef.current?.getSnapshot().consent === "accepted") return;
        const controller = makeController();
        const result = controller.acceptGuestConsent();
        if (result.ok) setController(controller, "accepted");
        else setState((old) => ({ ...old, scope: scopeRef.current, status: "error", error: "Analytics could not be enabled." }));
      } else {
        controllerRef.current?.withdraw();
        controllerRef.current = null;
        clearGuestJoinMarker();
        setState({ scope: scopeRef.current, status: local.consent === "declined" ? "declined" : "unknown", consent: local.consent, error: null, pendingWrite: false, preference: null });
      }
      return;
    }
    if (!member || !session) {
      setState({ scope: scopeRef.current, ...UNKNOWN, status: "unknown", preference: null });
      return;
    }
    if (auth.authCompletionEpoch > 0 && auth.authCompletionSessionId === session.identity.sessionId) {
      const marker = bindGuestJoinMarker(session.identity.sessionId);
      if (marker?.sessionId && marker.sessionId !== session.identity.sessionId) clearGuestJoinMarker();
    }
    const transport = preferenceFor();
    if (!transport) { setState((old) => ({ ...old, scope: scopeRef.current, status: "error", error: "Analytics preference is unavailable." })); return; }
    const pendingBeforeRead = readPendingAnalyticsDecline(session.identity.profileId);
    if (pendingBeforeRead && "invalid" in pendingBeforeRead) {
      controllerRef.current?.withdraw();
      controllerRef.current = null;
      setState({ scope: scopeRef.current, status: "error", consent: "unknown", error: "Analytics preference could not be checked.", pendingWrite: false, preference: null });
      return;
    }
    if (pendingBeforeRead) {
      controllerRef.current?.withdraw();
      controllerRef.current = null;
      try {
        const preference = await replayPendingDecline(transport, () => currentRead() && session.isCurrent());
        if (!preference) return;
        clearPendingAnalyticsDecline(session.identity.profileId, pendingBeforeRead);
        setState({ scope: scopeRef.current, status: "declined", consent: "declined", error: null, pendingWrite: false, preference });
      } catch {
        if (currentRead()) setState({ scope: scopeRef.current, status: "pending", consent: "declined", error: "Your privacy choice is saved in this browser and will retry when connected.", pendingWrite: true, preference: null });
      }
      return;
    }
    try {
      markAnalyticsDiagnostic("provider.preference_read_started");
      const preference = await transport.read();
      markAnalyticsDiagnostic("provider.preference_read_resolved");
      if (!currentRead() || !session.isCurrent()) return;
      markAnalyticsDiagnostic("provider.preference_read_current");
      const pending = readPendingAnalyticsDecline(session.identity.profileId);
      if (pending && "invalid" in pending) {
        controllerRef.current?.withdraw();
        controllerRef.current = null;
        setState({ scope: scopeRef.current, status: "error", consent: "unknown", error: "Analytics preference could not be checked.", pendingWrite: false, preference: null });
        return;
      }
      if (pending) {
        controllerRef.current?.withdraw();
        controllerRef.current = null;
        try {
          const next = await replayPendingDecline(transport, () => currentRead() && session.isCurrent());
          if (!next) return;
          clearPendingAnalyticsDecline(session.identity.profileId, pending);
          setState({ scope: scopeRef.current, status: "declined", consent: "declined", error: null, pendingWrite: false, preference: next });
        } catch {
          if (currentRead()) setState({ scope: scopeRef.current, status: "pending", consent: "declined", error: "Your privacy choice is saved in this browser and will retry when connected.", pendingWrite: true, preference });
        }
        return;
      }
      if (preference.consent === "accepted" && preference.sendPermission && preference.analyticsAccountId) {
        const join = pendingJoin.current;
        const persistedJoin = !join && auth.authCompletionEpoch > 0 && auth.authCompletionSessionId === session.identity.sessionId ? readGuestJoinMarker() : null;
        if (!persistedJoin && controllerRef.current?.getSnapshot().consent === "accepted" && activePreferenceRef.current?.analyticsAccountId === preference.analyticsAccountId && activePreferenceRef.current.policyVersion === preference.policyVersion) {
          setState((old) => ({ ...old, preference, error: null }));
          return;
        }
        activateAcceptedMember(preference);
      } else {
        const localOptOutSaved = preference.consent !== "declined" || writeLocalAnalyticsPreference("declined");
        if (preference.consent === "declined") pendingGuestOptOutRef.current = !localOptOutSaved;
        controllerRef.current?.withdraw();
        controllerRef.current = null;
        activePreferenceRef.current = null;
        setState({ scope: scopeRef.current, status: preference.consent === "declined" && !localOptOutSaved ? "error" : preference.consent === "declined" ? "declined" : "unknown", consent: preference.consent, error: preference.consent === "declined" && !localOptOutSaved ? "This browser could not save your analytics choice." : null, pendingWrite: false, preference });
      }
    } catch {
      if (currentRead()) {
        controllerRef.current?.signOut();
        controllerRef.current = null;
        setState((old) => ({ ...old, scope: scopeRef.current, status: "error", consent: "unknown", error: "Analytics preference could not be checked.", pendingWrite: false }));
      }
    }
  }, [activateAcceptedMember, auth.authCompletionEpoch, auth.authCompletionSessionId, auth.ready, config.enabled, makeController, member, preferenceFor, session, setController]);

  useEffect(() => {
    const captured = generation.current;
    void load(captured);
    if (!config.enabled || typeof window === "undefined") return;
    const refresh = () => { if (document.visibilityState === "visible") void load(generation.current); };
    const onStorage = (event: StorageEvent) => { if (event.key === "truecost.analytics.preference.v1" || event.key === CONFIRMED_LOGOUT_STORAGE_KEY || event.key?.startsWith("truecost.analytics.pending-decline.v1.")) void load(generation.current); };
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel("truecost.analytics.preference.v1"); channel.onmessage = () => void load(generation.current); } catch { channel = null; }
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); channel?.close(); };
  }, [auth.ready, config.enabled, load, scopeKey]);

  useEffect(() => {
    const subscription = subscribeToPrivateBrowserClearSignal(() => { void disposeForBrowserClear(); });
    return () => subscription.stop();
  }, [disposeForBrowserClear]);

  useEffect(() => () => { generation.current += 1; readSerial.current += 1; controllerRef.current?.signOut(); controllerRef.current = null; activePreferenceRef.current = null; }, []);

  // Delivery is best effort and bounded. A queued event schedules only its
  // next retry; consent loss, offline state and unmount clear the pump.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const schedule = (at: number | null) => {
      if (!alive || at === null || typeof window === "undefined") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void pump(); }, Math.max(50, at - Date.now()));
    };
    const pump = async () => {
      const controller = controllerRef.current;
      if (!alive || !authReadyRef.current || state.status !== "accepted" || !controller || typeof navigator === "undefined" || !navigator.onLine || (member && !session?.isCurrent())) return;
      const result = await controller.flush(true);
      if (alive && (!member || session?.isCurrent())) schedule(result.nextRetryAt);
    };
    const wake = () => {
      if (typeof navigator !== "undefined" && navigator.onLine) void pump();
      else if (controllerRef.current) void controllerRef.current.flush(false);
    };
    const pause = () => { if (controllerRef.current) void controllerRef.current.flush(false); };
    void pump();
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("offline", pause);
    return () => { alive = false; window.removeEventListener("online", wake); window.removeEventListener("focus", wake); window.removeEventListener("offline", pause); window.clearTimeout(timer); };
  }, [auth.ready, member, pumpSignal, scopeKey, session, state.status]);

  const write = useCallback(async (consent: AnalyticsPreferenceWrite) => {
    if (!authReadyRef.current || scopeRef.current === "anonymous" || !config.enabled) return;
    if (scopeRef.current === "guest") {
      if (consent === "accepted") {
        const controller = makeController();
        const result = controller.acceptGuestConsent();
        if (!result.ok) { setState((old) => ({ ...old, status: "error", error: "Analytics could not be enabled." })); return; }
        if (!writeLocalAnalyticsPreference("accepted")) {
          controller.signOut();
          setState((old) => ({ ...old, status: "error", consent: "unknown", error: "This browser could not save your analytics choice." }));
          return;
        }
        setController(controller, "accepted");
      } else {
        controllerRef.current?.decline();
        controllerRef.current = null;
        activePreferenceRef.current = null;
        if (!writeLocalAnalyticsPreference("declined")) setState((old) => ({ ...old, status: "error", consent: "unknown", error: "This browser could not save your analytics choice." }));
        else setState((old) => ({ ...old, status: "declined", consent: "declined" }));
      }
      notifyAnalyticsPreference();
      return;
    }
    generation.current += 1;
    const captured = generation.current;
    if (consent === "declined") clearGuestJoinMarker();
    const transport = preferenceFor();
    const pendingRead = member && session ? readPendingAnalyticsDecline(session.identity.profileId) : null;
    if (pendingRead && "invalid" in pendingRead) {
      controllerRef.current?.withdraw();
      controllerRef.current = null;
      activePreferenceRef.current = null;
      setState((old) => ({ ...old, status: "error", consent: "unknown", pendingWrite: false, error: "Analytics preference could not be checked." }));
      return;
    }
    const pending = pendingRead && !((pendingRead as { invalid?: true }).invalid) ? pendingRead : null;
    const expected = pending?.revision ?? state.preference?.revision ?? 0;
    const marker = consent === "declined" && member && session ? (pending ?? { revision: expected, nonce: randomUuid() }) : null;
    controllerRef.current?.withdraw();
    controllerRef.current = null;
    activePreferenceRef.current = null;
    const localOptOutSaved = consent !== "declined" || writeLocalAnalyticsPreference("declined");
    if (consent === "declined") pendingGuestOptOutRef.current = !localOptOutSaved;
    setState((old) => ({ ...old, scope: scopeRef.current, status: "pending", consent: consent, pendingWrite: true, error: consent === "declined" && !localOptOutSaved ? "This browser could not save your analytics choice." : null }));
    const persistedPending = !marker || writePendingAnalyticsDecline(session!.identity.profileId, marker.revision, marker.nonce);
    if (marker) notifyAnalyticsPreference();
    if (marker && !persistedPending) setState((old) => ({ ...old, error: "Analytics is off, but this browser could not save the withdrawal for a reload." }));
    try {
      if (!transport) throw new Error("unavailable");
      const preference = await transport.write(consent, expected);
      if (captured !== generation.current || !authReadyRef.current || !session?.isCurrent()) return;
      if (consent === "accepted" && preference.sendPermission && preference.analyticsAccountId) {
        const withdrawal = session ? readPendingAnalyticsDecline(session.identity.profileId) : null;
        if (withdrawal && "invalid" in withdrawal) {
          const staleController = controllerRef.current as AnalyticsController | null; staleController?.withdraw(); controllerRef.current = null; activePreferenceRef.current = null;
          setState((old) => ({ ...old, status: "error", consent: "unknown", pendingWrite: false, error: "Analytics preference could not be checked." }));
          return;
        }
        if (withdrawal) {
          const staleController = controllerRef.current as AnalyticsController | null; staleController?.withdraw(); controllerRef.current = null; activePreferenceRef.current = null;
          setState((old) => ({ ...old, status: "pending", consent: "declined", pendingWrite: true, error: "Your privacy choice is saved in this browser and will retry when connected." }));
          return;
        }
        if (member && session && pending) clearPendingAnalyticsDecline(session.identity.profileId, pending);
        activateAcceptedMember(preference);
      } else {
        if (member && session && marker) clearPendingAnalyticsDecline(session.identity.profileId, marker);
        let saved = localOptOutSaved;
        if (consent === "declined" && !saved) {
          saved = writeLocalAnalyticsPreference("declined");
          pendingGuestOptOutRef.current = !saved;
        }
        setState({ scope: scopeRef.current, status: saved ? "declined" : "error", consent: preference.consent, error: saved ? null : "This browser could not save your analytics choice.", pendingWrite: false, preference });
      }
      notifyAnalyticsPreference();
    } catch (error) {
      if (captured !== generation.current) return;
      setState((old) => ({ ...old, status: consent === "declined" ? "pending" : "error", consent: consent === "declined" ? "declined" : "unknown", pendingWrite: consent === "declined", error: error instanceof Error && error.message === "conflict" ? "Your privacy choice changed in another tab. Reload this setting to continue." : consent === "declined" && !localOptOutSaved ? "This browser could not save your analytics choice." : consent === "declined" && persistedPending ? "Your privacy choice is saved here and will retry when connected." : consent === "declined" ? "This browser could not save your privacy choice." : "Your privacy choice could not be saved." }));
      notifyAnalyticsPreference();
    }
  }, [activateAcceptedMember, auth.ready, config.enabled, makeController, preferenceFor, session, setController, state.preference?.revision]);

  const accept = useCallback(() => write("accepted"), [write]);
  const decline = useCallback(() => write("declined"), [write]);
  const withdraw = useCallback(() => write("declined"), [write]);
  const retry = useCallback(async () => {
    if (pendingGuestOptOutRef.current) {
      const saved = writeLocalAnalyticsPreference("declined");
      pendingGuestOptOutRef.current = !saved;
      if (!saved) {
        setState((old) => ({ ...old, status: "error", error: "This browser could not save your analytics choice." }));
        return;
      }
      notifyAnalyticsPreference();
    }
    if (scopeRef.current === "guest" || (scopeRef.current !== "anonymous" && session && session.isCurrent())) await load(generation.current);
  }, [load, session]);
  const track = useCallback((build: (ids: AnalyticsCorrelationFactory) => unknown): AnalyticsControllerResult<{ queued: boolean; eventId?: string }> => {
    markAnalyticsDiagnostic("track.invoked");
    const controller = controllerRef.current;
    if (!authReadyRef.current || !controller || state.status !== "accepted" || scopeRef.current !== scopeKey || (member && !session?.isCurrent())) {
      markAnalyticsDiagnostic("track.rejected_not_ready");
      return { ok: false, code: "not_consented" };
    }
    try {
      const eventId = randomUuid();
      const value = build({ eventId, newCorrelationId: randomUuid });
      const result = controller.enqueue(value);
      setState((old) => ({ ...old }));
      if (result.ok) setPumpSignal((value) => value + 1);
      markAnalyticsDiagnostic(result.ok ? "track.queued" : `track.rejected_${result.code}`);
      return result;
    } catch {
      markAnalyticsDiagnostic("track.rejected_invalid_event");
      return { ok: false, code: "invalid_event" };
    }
  }, [member, scopeKey, session, state.status]);
  const captureGuestJoin = useCallback((flowId: string) => {
    const controller = controllerRef.current;
    if (!authReadyRef.current || !controller || scopeRef.current !== "guest" || state.status !== "accepted") return { ok: false as const, code: "invalid_join" as const };
    const result = controller.captureGuestJoin(flowId);
    if (result.ok) pendingJoin.current = result.value;
    if (result.ok) writeGuestJoinMarker(result.value.flowId, result.value.anonymousId);
    return result;
  }, [state.status]);
  const value = useMemo<AnalyticsContextValue>(() => ({ status: !auth.ready || state.scope !== scopeKey ? "loading" : state.status, consent: !auth.ready || state.scope !== scopeKey ? "unknown" : state.consent, consentEpoch: consentEpoch.current, joinedFlowId: joinedFlowId.current, error: !auth.ready || state.scope !== scopeKey ? null : state.error, pendingWrite: auth.ready && state.scope === scopeKey && state.pendingWrite, snapshot: auth.ready ? controllerRef.current?.getSnapshot() ?? null : null, accept, decline, withdraw, clearPrivateRuntime: disposeForBrowserClear, retry, track, captureGuestJoin }), [accept, auth.ready, captureGuestJoin, decline, disposeForBrowserClear, retry, state, scopeKey, track, withdraw, consentEpoch.current, joinedFlowId.current]);
  useEffect(() => {
    if (config.enabled) markAnalyticsDiagnostic(`provider.context_committed_${value.status}`);
  }, [auth.ready, config.enabled, member, value.status]);
  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics(): AnalyticsContextValue {
  const value = useContext(AnalyticsContext);
  if (!value) throw new Error("useAnalytics must be used inside AnalyticsProvider");
  return value;
}

/** Account can also be rendered in isolated shells (for example during auth recovery). */
export function useOptionalAnalytics(): AnalyticsContextValue | null { return useContext(AnalyticsContext); }
