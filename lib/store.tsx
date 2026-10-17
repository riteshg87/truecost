"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth/provider";
import type { PrivateSessionAccess } from "./auth/private-session";
import { DEFAULT_GST_PCT, ENABLED_LOAN_TYPES, LOAN_TYPES, isLoanTypeEnabled } from "./finance/loanTypes";
import type { LoanTypeId, Offer } from "./finance/types";
import { compareOffers } from "./finance/comparison";
import { allOffersReady } from "./finance/validate";
import { createComparisonSnapshot, decodeComparisonSnapshot, type ComparisonSnapshot } from "./contracts/snapshot";
import { decodeComparisonDraft, type CompareDraft } from "./contracts/comparison-draft";
import { destinationForAuthIntent, type AuthIntentAction } from "./contracts/auth-intent";
import { loadGuestSnapshot, commitGuestSnapshot } from "./guest/storage";
import { GuestHandoffStorage } from "./guest/handoff";
import { ComparisonWorkspace, type SavePauseReason } from "./comparison/private-workspace";
import { createSessionBoundComparisonTransport } from "./comparison/transport";
import { createSessionBoundComparisonHistoryTransport } from "./comparison/history-transport";
import { AUTH_CONFIG } from "./auth/config";
import { useOptionalAnalytics } from "./analytics/provider";
import { ANALYTICS_CONFIG } from "./analytics/config";
import { markAnalyticsDiagnostic } from "./analytics/preference-transport";
import { randomUuid } from "./contracts/errors";
import { registerAccountDeletionCleanup, type AccountDeletionCleanup, type DeletionCleanupRegistration } from "./privacy/deletion-signal";

export const MAX_OFFERS = 3;
export function makeOffer(loanType: LoanTypeId): Offer {
  const config = LOAN_TYPES[loanType];
  return {
    id: crypto.randomUUID(), lender: "", loanType, amount: 0, ratePct: 0,
    rateType: config.defaultRateType, rateStructure: config.defaultRateStructure,
    tenureValue: config.typicalTenureYears, tenureUnit: "years",
    processingFee: { mode: "percent", value: 0 }, gstPct: DEFAULT_GST_PCT,
    insurancePremium: 0, insuranceFunding: "financed", otherFees: [],
  };
}
function freshDraft(): CompareDraft {
  const loanType = ENABLED_LOAN_TYPES[0] ?? "home";
  return { loanType, offers: [makeOffer(loanType), makeOffer(loanType)] };
}
function draftFrom(snapshot: ComparisonSnapshot): CompareDraft {
  return decodeComparisonDraft({ loanType: snapshot.offers[0].loanType, offers: snapshot.offers });
}
export type CompareActionResult = { kind: "ok"; href?: string } | { kind: "error"; message: string };
interface CompareContextValue extends CompareDraft {
  hydrated: boolean; member: boolean; busy: boolean;
  snapshot: Readonly<ComparisonSnapshot> | null;
  message: string | null;
  saveStatus: "idle" | "queued" | "sending" | "saved" | "paused";
  savePauseReason: SavePauseReason | null;
  saveRequestId: string | null;
  pendingCount: number;
  signOutReady: boolean;
  setLoanType: (loanType: LoanTypeId) => void;
  updateOffer: (id: string, patch: Partial<Offer>) => void;
  addOffer: () => void; removeOffer: (id: string) => void;
  reset: () => Promise<CompareActionResult>;
  calculate: () => Promise<CompareActionResult>;
  save: () => Promise<CompareActionResult>;
  requestReport: () => Promise<CompareActionResult>;
  retrySave: () => Promise<void>;
  resumeIntent: (requestId: string) => Promise<CompareActionResult>;
  discardPrivateData: (confirmed: boolean) => Promise<CompareActionResult>;
  captureAccountDeletionCleanup: (confirmed: boolean) => AccountDeletionCleanup | null;
  canAdd: boolean;
}
const CompareContext = createContext<CompareContextValue | null>(null);
const failure = (message: string): CompareActionResult => ({ kind: "error", message });
const LOCKED = "Your comparison is locked. Reconnect and verify your account to continue.";
const STORAGE = "This browser could not keep your comparison. Keep this tab open and try again.";
const AUTH_ANALYTICS_KEY = "truecost.analytics.auth-flow.v1";
const AUTH_COMPLETED_KEY = "truecost.analytics.auth-completed.v1";
const SAVE_ANALYTICS_KEY = "truecost.analytics.save.v1";
const GUEST_JOIN_KEY = "truecost.analytics.guest-join.v1";
const GUEST_JOIN_MARKER_MAX_AGE_MS = 10 * 60 * 1000;
const ANALYTICS_RECORD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
type AnalyticsAction = "save" | "download" | "compare_again" | "direct";
type AnalyticsMode = "new" | "recalculate";
type SaveAnalyticsStage = "attempted" | "queued" | "failed";
type SaveAnalyticsError = "network" | "auth_required" | "validation" | "conflict" | "limited" | "storage" | "unknown";
interface AuthAnalyticsRecord { requestId: string; flowId: string; action: AnalyticsAction; mode?: AnalyticsMode; sessionId: string; resultId: string; createdAt: number; }
interface AuthCompletedRecord { sessionId: string; flowId: string; createdAt: number; }
interface SaveAnalyticsRecord { scope: string; requestId: string; token: string; flowId?: string; createdAt: number; }
function readAnalyticsSessionValue(key: string): unknown {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as unknown : null; } catch { return null; }
}
function writeAnalyticsSession(key: string, value: unknown): boolean {
  try { sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function clearAnalyticsTransientMetadata(clearConsentMarkers = false, preserveAuthFlow = false): void {
  try {
    if (!preserveAuthFlow) sessionStorage.removeItem(AUTH_ANALYTICS_KEY);
    sessionStorage.removeItem(SAVE_ANALYTICS_KEY);
    if (clearConsentMarkers) {
      sessionStorage.removeItem(AUTH_COMPLETED_KEY);
      sessionStorage.removeItem(GUEST_JOIN_KEY);
    }
  } catch { /* unavailable storage is already fail-closed */ }
}
function boundGuestJoinFlowId(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  try {
    const raw = sessionStorage.getItem(GUEST_JOIN_KEY);
    if (!raw) return null;
    const marker = JSON.parse(raw) as { sessionId?: unknown; flowId?: unknown; anonymousId?: unknown; createdAt?: unknown };
    if (marker.sessionId !== sessionId || !isOpaqueCorrelation(marker.flowId) || !isOpaqueCorrelation(marker.anonymousId) || typeof marker.createdAt !== "number" || !Number.isFinite(marker.createdAt) || marker.createdAt > Date.now() + 60_000 || Date.now() - marker.createdAt > GUEST_JOIN_MARKER_MAX_AGE_MS) return null;
    return marker.flowId;
  } catch { return null; }
}
function isOpaqueCorrelation(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isAnalyticsAction(value: unknown): value is AnalyticsAction {
  return value === "save" || value === "download" || value === "compare_again" || value === "direct";
}
function isAnalyticsMode(value: unknown): value is AnalyticsMode { return value === "new" || value === "recalculate"; }
function isFreshRecord(value: unknown): value is { createdAt: number } {
  if (!value || typeof value !== "object") return false;
  const createdAt = (value as { createdAt?: unknown }).createdAt;
  return typeof createdAt === "number" && Number.isFinite(createdAt) && createdAt >= 0 && createdAt <= Date.now() + 5 * 60 * 1000 && Date.now() - createdAt <= ANALYTICS_RECORD_MAX_AGE_MS;
}
function readAuthAnalyticsRecords(): AuthAnalyticsRecord[] {
  const raw = readAnalyticsSessionValue(AUTH_ANALYTICS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((candidate): candidate is AuthAnalyticsRecord => {
    if (!isFreshRecord(candidate) || !candidate || typeof candidate !== "object") return false;
    const record = candidate as Partial<AuthAnalyticsRecord>;
    return typeof record.requestId === "string" && record.requestId.length > 0 && isOpaqueCorrelation(record.flowId) && isAnalyticsAction(record.action) && (record.mode === undefined || isAnalyticsMode(record.mode)) && isOpaqueCorrelation(record.sessionId) && isOpaqueCorrelation(record.resultId);
  });
}
function readSaveAnalyticsRecords(): SaveAnalyticsRecord[] {
  const raw = readAnalyticsSessionValue(SAVE_ANALYTICS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((candidate): candidate is SaveAnalyticsRecord => {
    if (!isFreshRecord(candidate) || !candidate || typeof candidate !== "object") return false;
    const record = candidate as Partial<SaveAnalyticsRecord>;
    return typeof record.scope === "string" && record.scope.length > 0 && typeof record.requestId === "string" && record.requestId.length > 0 && isOpaqueCorrelation(record.token) && (record.flowId === undefined || isOpaqueCorrelation(record.flowId));
  });
}
function readAuthCompletedRecords(): AuthCompletedRecord[] {
  const raw = readAnalyticsSessionValue(AUTH_COMPLETED_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((candidate): candidate is AuthCompletedRecord => {
    if (!isFreshRecord(candidate) || !candidate || typeof candidate !== "object") return false;
    const record = candidate as Partial<AuthCompletedRecord>;
    return typeof record.sessionId === "string" && record.sessionId.length > 0 && isOpaqueCorrelation(record.flowId);
  });
}
function safeAnalyticsError(value: string | null | undefined): "network" | "auth_required" | "validation" | "conflict" | "limited" | "storage" | "unknown" {
  if (value === "unauthorized") return "auth_required";
  if (value === "conflict" || value === "result_conflict") return "conflict";
  if (value === "invalid" || value === "invalid_shape" || value === "expired") return "validation";
  if (value === "network" || value === "timeout") return "network";
  if (value === "rate_limited") return "limited";
  if (value === "storage-unavailable") return "storage";
  return "unknown";
}
function analyticsActionFor(action: AuthIntentAction): { action: AnalyticsAction; mode?: AnalyticsMode } {
  if (action === "save") return { action: "save" };
  if (action === "download") return { action: "download" };
  return { action: "compare_again", mode: action === "new_comparison" ? "new" : "recalculate" };
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const lifetime = useRef({ access: auth.privateSession, serial: 0 });
  if (lifetime.current.access !== auth.privateSession) lifetime.current = { access: auth.privateSession, serial: lifetime.current.serial + 1 };
  // New grants remount even for the same account: previous private state cannot flash.
  const scope = auth.privateSession ? `member:${lifetime.current.serial}` : "public";
  // Public auth startup must not remount a form while the user is typing.
  // An explicit guest intent can start the public comparison while auth is
  // still settling. The private grant remains the only way to enter member
  // workspace state, and its arrival changes this scope key/remounts safely.
  const guest = !auth.privateSession && Boolean(auth.guestIntent || (auth.ready && auth.viewer === "guest"));
  return <ScopedCompareProvider key={scope} access={auth.privateSession} guest={guest} tabId={auth.initiatingTabId} authCompletionEpoch={auth.authCompletionEpoch ?? 0} authCompletionSessionId={auth.authCompletionSessionId ?? null}>{children}</ScopedCompareProvider>;
}

function ScopedCompareProvider({ children, access, guest, tabId, authCompletionEpoch, authCompletionSessionId }: {
  children: ReactNode; access: PrivateSessionAccess | null; guest: boolean; tabId: string; authCompletionEpoch: number; authCompletionSessionId: string | null;
}) {
  const [draft, setDraft] = useState<CompareDraft>(freshDraft);
  const [snapshot, setSnapshot] = useState<Readonly<ComparisonSnapshot> | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<CompareContextValue["saveStatus"]>("idle");
  const [savePauseReason, setSavePauseReason] = useState<SavePauseReason | null>(null);
  const [saveRequestId, setSaveRequestId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [discarded, setDiscarded] = useState(false);
  const runtime = useRef({ alive: false, serial: 0, busy: false, spent: false, draft, snapshot });
  const workspace = useRef<ComparisonWorkspace | null>(null);
  const handoff = useRef<GuestHandoffStorage | null>(null);
  const member = Boolean(access);
  const analytics = useOptionalAnalytics();
  const analyticsStarted = useRef(false);
  const analyticsDraftId = useRef<string | null>(null);
  const analyticsResults = useRef(new Map<string, string>());
  const analyticsSessionId = useRef<string | null>(null);
  const authCompleted = useRef<string | null>(null);
  const saveStatuses = useRef(new Map<string, string>());
  const trackSaveStatusRef = useRef<(requestId: string, stage: SaveAnalyticsStage, error?: SaveAnalyticsError) => void>(() => undefined);
  const trackSavedRef = useRef<(requestId: string, path: "immediate" | "queued") => void>(() => undefined);
  useEffect(() => {
    if (analytics?.status === "declined" || analytics?.status === "pending" || analytics?.status === "error" || analytics?.status === "disabled") {
      const guestFlowId = boundGuestJoinFlowId(access?.identity.sessionId);
      const preserveAuthFlow = member && analytics.status === "pending" && analytics.consent === "accepted" && authCompletionEpoch > 0 && authCompletionSessionId === access?.identity.sessionId && guestFlowId !== null && readAuthAnalyticsRecords().some((record) => record.flowId === guestFlowId);
      clearAnalyticsTransientMetadata(analytics.consent === "declined", preserveAuthFlow);
      analyticsStarted.current = false;
      analyticsDraftId.current = null;
      analyticsResults.current.clear();
      analyticsSessionId.current = null;
      authCompleted.current = null;
    }
  }, [access, analytics?.consent, analytics?.consentEpoch, analytics?.status, authCompletionEpoch, authCompletionSessionId, member]);
  const current = () => runtime.current.alive && (guest || Boolean(access?.isCurrent()));
  const replaceWorking = (d: CompareDraft, s: Readonly<ComparisonSnapshot> | null) => {
    runtime.current.draft = d; runtime.current.snapshot = s; setDraft(d); setSnapshot(s);
  };
  useEffect(() => {
    const epoch = ++runtime.current.serial;
    runtime.current.alive = true;
    handoff.current = new GuestHandoffStorage();
    let stop: (() => void) | undefined;
    let w: ComparisonWorkspace | null = null;
    let deletionRegistration: DeletionCleanupRegistration | null = null;
    const valid = () => runtime.current.alive && runtime.current.serial === epoch;
    if (access && tabId !== "server" && tabId !== "unavailable") {
      w = new ComparisonWorkspace({ access, tabId, transport: createSessionBoundComparisonTransport({
        url: AUTH_CONFIG.convexUrl!, identity: access.identity, getToken: access.getToken, isCurrent: access.isCurrent,
      }), historyTransport: createSessionBoundComparisonHistoryTransport({
        url: AUTH_CONFIG.convexUrl!, identity: access.identity, getToken: access.getToken, isCurrent: access.isCurrent,
      }) }); workspace.current = w;
      let opened = false;
      stop = w.subscribe((state) => {
        if (!valid()) return;
        if (state.status === "locked" || !access.isCurrent()) {
          replaceWorking(freshDraft(), null); setHydrated(false); setMessage(LOCKED); setSaveStatus("idle"); setSavePauseReason(null); setSaveRequestId(null); setPendingCount(0); return;
        }
        if (state.status === "storage-error") setMessage(STORAGE);
        if (!opened && state.status === "ready") {
          opened = true;
          state.saves.forEach((job) => saveStatuses.current.set(job.requestId, job.status));
          replaceWorking(state.draft ?? freshDraft(), state.snapshot); setHydrated(true);
        } else if (opened && state.status === "ready") {
          for (const job of state.saves) {
            const previous = saveStatuses.current.get(job.requestId);
            if (previous && previous !== job.status) {
              if (job.status === "saved") trackSavedRef.current(job.requestId, "queued");
              else if (job.status === "paused") trackSaveStatusRef.current(job.requestId, "failed", safeAnalyticsError(job.pauseReason));
            }
            saveStatuses.current.set(job.requestId, job.status);
          }
        }
        setPendingCount(state.saves.filter((job) => job.status !== "saved").length +
          state.deletions.filter((job) => job.status !== "deleted").length);
        const job = state.saves.find((item) => item.resultId === runtime.current.snapshot?.resultId);
        const deletion = state.deletions.find((item) => item.resultId === runtime.current.snapshot?.resultId);
        setSaveStatus(deletion ? "paused" : job?.status ?? "idle");
        setSavePauseReason(deletion ? "deleted" : job?.pauseReason ?? null);
        setSaveRequestId(job?.requestId ?? null);
      });
      void w.open().then((result) => {
        if (!valid()) return;
        if (result.kind !== "ok") { setMessage(STORAGE); return; }
        const cleanup = w?.captureFormerAccountCleanup(access, true) ?? null;
        deletionRegistration = registerAccountDeletionCleanup(access, cleanup, "comparison");
        void w?.pump();
      });
    } else if (guest) {
      void loadGuestSnapshot().then(async (state) => {
        if (!valid()) return;
        let recoveryId: string | null = null;
        try { recoveryId = sessionStorage.getItem("truecost.compare.recovery"); } catch { /* first result still works */ }
        const recovered = recoveryId ? await handoff.current!.recover(recoveryId, tabId) : null;
        if (!valid()) return;
        runtime.current.spent = state.kind !== "empty";
        if (state.snapshot) replaceWorking(draftFrom(state.snapshot), state.snapshot);
        if (recovered?.kind === "ok") {
          const saved = state.snapshot ?? recovered.value.snapshot;
          const restoredDraft = recovered.value.draft ?? (saved ? draftFrom(saved) : null);
          if (restoredDraft) replaceWorking(restoredDraft, saved);
          runtime.current.spent = true;
        }
        if (!state.persisted) setMessage(STORAGE);
        if (state.kind === "invalid") setMessage("The guest result in this browser could not be opened. Sign in to make another comparison.");
        setHydrated(true);
      });
    }
    const pump = () => { if (valid()) void w?.pump(); };
    window.addEventListener("online", pump); window.addEventListener("focus", pump);
    const timer = window.setInterval(pump, 5_000);
    return () => {
      runtime.current.alive = false; ++runtime.current.serial; stop?.(); w?.close();
      deletionRegistration?.stop();
      deletionRegistration = null;
      if (workspace.current === w) workspace.current = null;
      window.removeEventListener("online", pump); window.removeEventListener("focus", pump); window.clearInterval(timer);
    };
  }, [access, guest, tabId]);

  function changeDraft(d: CompareDraft) {
    if (!current() || !hydrated || runtime.current.busy) return;
    const changed = JSON.stringify(runtime.current.draft) !== JSON.stringify(d);
    runtime.current.draft = d; setDraft(d);
    if (changed && analytics?.status !== "accepted") markAnalyticsDiagnostic("store.comparison_input_skipped_not_ready");
    if (changed && analytics?.status === "accepted" && !analyticsStarted.current && ANALYTICS_CONFIG.environment) {
      let draftId: string | null = null;
      const tracked = analytics.track(({ eventId, newCorrelationId }) => {
        draftId = newCorrelationId();
        return { event: "comparison_started", properties: {
          event_version: 1, environment: ANALYTICS_CONFIG.environment!, release: "0.1.0",
          auth_state: member ? "member" : "guest", feature: "comparison", route_name: "compare",
          event_id: eventId, occurred_at: new Date().toISOString(), draft_id: draftId,
        } };
      });
      if (tracked.ok && draftId) { analyticsStarted.current = true; analyticsDraftId.current = draftId; }
    }
    if (workspace.current) void workspace.current.setWorking({ draft: d, snapshot: runtime.current.snapshot }).then((result) => {
      if (current() && result.kind !== "ok") setMessage(STORAGE);
    });
  }
  function updateOffer(id: string, patch: Partial<Offer>) {
    const p = runtime.current.draft;
    changeDraft({ ...p, offers: p.offers.map((offer) => offer.id === id ? { ...offer, ...patch, id: offer.id } : offer) });
  }
  function setLoanType(loanType: LoanTypeId) {
    const p = runtime.current.draft;
    if (p.loanType === loanType || !isLoanTypeEnabled(loanType)) return;
    const c = LOAN_TYPES[loanType];
    changeDraft({ loanType, offers: p.offers.map((o) => ({
      ...o, loanType, rateType: c.rateTypeLocked ? c.defaultRateType : o.rateType, rateStructure: c.defaultRateStructure,
      tenureValue: o.tenureUnit === "years" && o.tenureValue === LOAN_TYPES[p.loanType].typicalTenureYears ? c.typicalTenureYears : o.tenureValue,
    })) });
  }
  async function action(run: () => Promise<CompareActionResult>): Promise<CompareActionResult> {
    if (!current() || !hydrated) return failure(LOCKED);
    if (runtime.current.busy) return failure("The previous action is still finishing.");
    runtime.current.busy = true; setBusy(true); setMessage(null);
    try {
      const result = await run();
      if (!current()) return failure(LOCKED);
      if (result.kind === "error") setMessage(result.message);
      return result;
    } catch {
      if (current()) setMessage(STORAGE);
      return failure(STORAGE);
    } finally { runtime.current.busy = false; if (current()) setBusy(false); }
  }
  async function requireSignIn(selected: AuthIntentAction): Promise<CompareActionResult> {
    const prepared = await handoff.current!.prepare({
      action: selected, initiatingTabId: tabId, snapshot: runtime.current.snapshot,
      draft: selected === "recalculate_existing_draft" ? runtime.current.draft : null,
    });
    if (!current()) return failure(LOCKED);
    if (prepared.kind !== "ok") return failure("Sign-in could not safely preserve this comparison. Keep this tab open and retry.");
    try { sessionStorage.setItem("truecost.compare.recovery", prepared.value.intent.requestId); }
    catch { return failure("This browser could not preserve the sign-in return. Keep this tab open and retry."); }
    if (guest && analytics?.status === "accepted" && ANALYTICS_CONFIG.environment) {
      try {
        const detail = analyticsActionFor(selected);
        const flowId = randomUuid();
        const sessionId = analyticsSessionId.current ?? (analyticsSessionId.current = randomUuid());
        const resultId = runtime.current.snapshot ? analyticsResults.current.get(runtime.current.snapshot.resultId) ?? randomUuid() : randomUuid();
        const tracked = analytics.track(({ eventId }) => ({ event: "auth_prompt_viewed", properties: {
          event_version: 1, environment: ANALYTICS_CONFIG.environment!, release: "0.1.0", auth_state: "guest", feature: "comparison", route_name: "compare_results", event_id: eventId, occurred_at: new Date().toISOString(), session_id: sessionId, result_id: resultId, action: detail.action, ...(detail.mode ? { mode: detail.mode } : {}),
        } }));
        const join = analytics.captureGuestJoin(flowId);
        if (tracked.ok && join.ok) {
          const records = readAuthAnalyticsRecords();
          writeAnalyticsSession(AUTH_ANALYTICS_KEY, [...records.filter((record) => record.requestId !== prepared.value.intent.requestId), { requestId: prepared.value.intent.requestId, flowId, action: detail.action, mode: detail.mode, sessionId, resultId, createdAt: Date.now() }].slice(-20));
        }
      } catch { /* Consent remains optional; a missing analytics record cannot block sign-in. */ }
    }
    const next = `${destinationForAuthIntent(selected)}?action=${selected}&requestId=${prepared.value.intent.requestId}`;
    return { kind: "ok", href: `/signin?next=${encodeURIComponent(next)}` };
  }
  async function storeWorking(d: CompareDraft, s: Readonly<ComparisonSnapshot> | null) {
    if (!workspace.current) return false;
    const result = await workspace.current.setWorking({ draft: d, snapshot: s });
    if (!current() || result.kind !== "ok") return false;
    replaceWorking(d, s); setSaveStatus("idle"); setSavePauseReason(null); setSaveRequestId(null); return true;
  }
  function trackCompleted(s: Readonly<ComparisonSnapshot>, d: CompareDraft) {
    if (analytics?.status !== "accepted") markAnalyticsDiagnostic("store.comparison_completed_skipped_not_ready");
    if (analytics?.status !== "accepted" || !ANALYTICS_CONFIG.environment || analyticsResults.current.has(s.resultId)) return;
    let resultId: string | null = null;
    const tracked = analytics.track(({ eventId, newCorrelationId }) => {
      resultId = newCorrelationId();
      return { event: "comparison_completed", properties: {
        event_version: 1, environment: ANALYTICS_CONFIG.environment!, release: "0.1.0",
        auth_state: member ? "member" : "guest", feature: "comparison", route_name: "compare_results",
        event_id: eventId, occurred_at: new Date().toISOString(), draft_id: analyticsDraftId.current ?? newCorrelationId(),
        result_id: resultId, offer_count: d.offers.length, calculation_version: s.calculationVersion,
      } };
    });
    if (tracked.ok && resultId) analyticsResults.current.set(s.resultId, resultId);
  }
  const analyticsScope = access?.identity.profileId ?? "guest";
  function saveAnalyticsRecord(requestId: string, flowId?: string): SaveAnalyticsRecord | null {
    if (analytics?.status !== "accepted") return null;
    const records = readSaveAnalyticsRecords();
    const existing = records.find((record) => record.scope === analyticsScope && record.requestId === requestId);
    if (existing) return existing;
    let token: string;
    try { token = randomUuid(); } catch { return null; }
    const record = { scope: analyticsScope, requestId, token, flowId, createdAt: Date.now() };
    const next = [...records.filter((candidate) => candidate.scope !== analyticsScope || candidate.requestId !== requestId), record].slice(-100);
    writeAnalyticsSession(SAVE_ANALYTICS_KEY, next);
    return record;
  }
  function trackSaveStatus(requestId: string, stage: SaveAnalyticsStage, error?: SaveAnalyticsError) {
    if (analytics?.status !== "accepted" || !access?.isCurrent()) return;
    const record = saveAnalyticsRecord(requestId);
    if (!record) return;
    analytics.track(({ eventId }) => ({ event: "comparison_save_status", properties: {
      event_version: 1, environment: ANALYTICS_CONFIG.environment!, release: "0.1.0", auth_state: "member", feature: "comparison", route_name: "compare_results", event_id: eventId, occurred_at: new Date().toISOString(), request_id: record.token, stage, ...(error ? { error_code: error } : {}),
    } }));
  }
  function trackSaved(requestId: string, path: "immediate" | "queued") {
    if (analytics?.status !== "accepted" || !access?.isCurrent()) return;
    const record = saveAnalyticsRecord(requestId);
    if (!record) return;
    analytics.track(({ eventId }) => ({ event: "comparison_saved", properties: {
      event_version: 1, environment: ANALYTICS_CONFIG.environment!, release: "0.1.0", auth_state: "member", feature: "comparison", route_name: "compare_results", event_id: eventId, occurred_at: new Date().toISOString(), request_id: record.token, path,
    } }));
    const flow = readAuthAnalyticsRecords().find((candidate) => candidate.requestId === requestId && candidate.action === "save");
    if (flow) trackAuthIntent(flow, "succeeded");
  }
  trackSaveStatusRef.current = trackSaveStatus;
  trackSavedRef.current = trackSaved;
  function trackAuthIntent(record: AuthAnalyticsRecord, status: "succeeded" | "failed", error?: "network" | "auth_required" | "validation" | "conflict" | "limited" | "storage" | "unknown") {
    if (analytics?.status !== "accepted" || !access?.isCurrent()) return;
    analytics.track(({ eventId }) => ({ event: "auth_intent_resumed", properties: {
      event_version: 1, environment: ANALYTICS_CONFIG.environment!, release: "0.1.0", auth_state: "member", feature: "comparison", route_name: "compare_results", event_id: eventId, occurred_at: new Date().toISOString(), flow_id: record.flowId, action: record.action, ...(record.mode ? { mode: record.mode } : {}), status, ...(error ? { error_code: error } : {}),
    } }));
  }
  function authRecord(requestId: string): AuthAnalyticsRecord | null {
    return readAuthAnalyticsRecords().find((candidate) => candidate.requestId === requestId) ?? null;
  }
  function trackAuthCompleted() {
    if (!member || authCompletionEpoch <= 0 || authCompletionSessionId !== access?.identity.sessionId || analytics?.status !== "accepted" || !access?.isCurrent() || authCompleted.current) return;
    const pending = readAuthAnalyticsRecords();
    const recent = pending.filter((candidate) => Date.now() - candidate.createdAt <= 10 * 60 * 1000).sort((a, b) => b.createdAt - a.createdAt)[0];
    const record = analytics.joinedFlowId ? pending.find((candidate) => candidate.flowId === analytics.joinedFlowId) : recent;
    const priorDirect = readAuthCompletedRecords().find((candidate) => candidate.sessionId === access.identity.sessionId);
    let flowId: string;
    let action: AnalyticsAction = "direct";
    let mode: AnalyticsMode | undefined;
    try {
      flowId = record?.flowId ?? priorDirect?.flowId ?? randomUuid();
      action = record?.action ?? "direct";
      mode = record?.mode;
    } catch { return; }
    const key = `${access.identity.sessionId}:${flowId}`;
    if (authCompleted.current === key || readAuthCompletedRecords().some((candidate) => candidate.sessionId === access.identity.sessionId && candidate.flowId === flowId)) {
      authCompleted.current = key;
      return;
    }
    const tracked = analytics.track(({ eventId }) => ({ event: "auth_completed", properties: {
      event_version: 1, environment: ANALYTICS_CONFIG.environment!, release: "0.1.0", auth_state: "member", feature: "comparison", route_name: "signin", event_id: eventId, occurred_at: new Date().toISOString(), flow_id: flowId, action, ...(mode ? { mode } : {}), method: "email",
    } }));
    if (tracked.ok) {
      authCompleted.current = key;
      const records = readAuthCompletedRecords().filter((candidate) => !(candidate.sessionId === access.identity.sessionId && candidate.flowId === flowId));
      writeAnalyticsSession(AUTH_COMPLETED_KEY, [...records, { sessionId: access.identity.sessionId, flowId, createdAt: Date.now() }].slice(-40));
    }
  }
  useEffect(() => { trackAuthCompleted(); }, [access, authCompletionEpoch, authCompletionSessionId, member, analytics?.status, analytics?.consentEpoch, analytics?.joinedFlowId]);
  const calculate = () => action(async () => {
    const d = decodeComparisonDraft(runtime.current.draft, member ? 3 : 2);
    if (!allOffersReady(d.offers)) return failure("Add a valid amount, rate and tenure for each offer.");
    const previous = runtime.current.snapshot;
    if (previous && JSON.stringify(previous.offers) === JSON.stringify(d.offers)) return { kind: "ok", href: "/compare/results" };
    if (guest && runtime.current.spent) return requireSignIn("recalculate_existing_draft");
    const s = createComparisonSnapshot(d.offers, compareOffers(d.offers));
    if (member) { if (!await storeWorking(d, s)) return failure(STORAGE); }
    else {
      const result = await commitGuestSnapshot(s);
      if (!current()) return failure(LOCKED);
      runtime.current.spent = true;
      if (result.kind === "requires-auth") {
        runtime.current.snapshot = result.snapshot; setSnapshot(result.snapshot);
        return requireSignIn("recalculate_existing_draft");
      }
      replaceWorking(d, result.snapshot);
      if (!result.persisted) setMessage("Your result is available in this tab. This browser could not keep it after a reload.");
      trackCompleted(result.snapshot, d);
    }
    if (member) trackCompleted(s, d);
    return { kind: "ok", href: "/compare/results" };
  });
  const reset = () => action(async () => {
    if (guest && runtime.current.spent) return requireSignIn("new_comparison");
    const d = freshDraft();
    if (member && !await storeWorking(d, null)) return failure(STORAGE);
    if (guest) replaceWorking(d, null);
    analyticsStarted.current = false;
    analyticsDraftId.current = null;
    analyticsResults.current.clear();
    return { kind: "ok", href: "/compare" };
  });
  const save = () => action(async () => {
    const s = runtime.current.snapshot;
    if (!s) return failure("Calculate a comparison first.");
    if (guest) return requireSignIn("save");
    let requestId: string;
    try { requestId = randomUuid(); } catch { return failure(STORAGE); }
    const w = workspace.current;
    if (!w) return failure(LOCKED);
    trackSaveStatus(requestId, "attempted");
    const queued = await w.queueSave({ snapshot: s, requestId, source: "member" });
    if (!current()) return failure(LOCKED);
    if (queued.kind !== "ok") { trackSaveStatus(requestId, "failed", safeAnalyticsError(queued.code)); return failure(STORAGE); }
    const job = w.current().saves.find((candidate) => candidate.requestId === queued.value.requestId);
    if (job?.status === "queued") trackSaveStatus(queued.value.requestId, "queued");
    // Keep the durable queue action non-blocking. If opening already owns the
    // pump, the chained call drains this save after that refresh settles.
    void w.pump().then(() => { if (current()) void w.pump(); });
    return { kind: "ok" };
  });
  const requestReport = () => action(async () => {
    if (!runtime.current.snapshot) return failure("Compare offers before requesting a report.");
    if (guest) return requireSignIn("download");
    return { kind: "ok", href: "/compare/results#comparison-report" };
  });
  const resumeIntent = (requestId: string) => action(async () => {
    if (!access || !workspace.current) return failure(LOCKED);
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([access.identity.profileId, access.identity.sessionId])));
    if (!current()) return failure(LOCKED);
    const accountKeyHash = Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
    const context = { initiatingTabId: tabId, accountKeyHash, authEpoch: access.identity.authEpoch };
    const claimed = await handoff.current!.claim(requestId, context);
    if (!current()) return failure(LOCKED);
    if (claimed.kind !== "ok") return failure("This sign-in action expired, was cancelled, or belongs to another session. Your guest result remains available in guest mode.");
    if (claimed.value.status === "already_claimed") return failure("This action is already being resumed. If the tab was interrupted, wait two minutes and retry.");
    const { intent, snapshot: guestResult, draft: guestDraft } = claimed.value;
    let d: CompareDraft; let s: Readonly<ComparisonSnapshot> | null;
    if (intent.action === "new_comparison") { d = freshDraft(); s = null; }
    else if (intent.action === "recalculate_existing_draft" && guestDraft) {
      d = guestDraft;
      if (!allOffersReady(d.offers)) return failure("The preserved offers need corrections before calculation.");
      const previous = runtime.current.snapshot;
      s = previous?.resultId === intent.requestId ? previous : decodeComparisonSnapshot({
        ...createComparisonSnapshot(d.offers, compareOffers(d.offers), { createdAt: intent.createdAt }),
        resultId: intent.requestId,
      });
    } else if (guestResult) { d = draftFrom(guestResult); s = guestResult; }
    else return failure("The preserved comparison could not be opened.");
    const flow = authRecord(requestId);
    if (!await storeWorking(d, s)) {
      if (flow && intent.action !== "download") trackAuthIntent(flow, "failed", "storage");
      return failure(STORAGE);
    }
    if (intent.action === "save" && s) {
      trackSaveStatus(intent.requestId, "attempted");
      const queued = await workspace.current.queueSave({ snapshot: s, requestId: intent.requestId, createdAt: intent.createdAt, source: "guest" });
      if (!current()) return failure(LOCKED);
      if (queued.kind !== "ok") {
        if (flow) trackAuthIntent(flow, "failed", safeAnalyticsError(queued.code));
        return failure(STORAGE);
      }
      if (workspace.current.current().saves.find((candidate) => candidate.requestId === queued.value.requestId)?.status === "queued") trackSaveStatus(queued.value.requestId, "queued");
      void workspace.current.pump().then(() => { if (current()) void workspace.current?.pump(); });
    }
    const completed = await handoff.current!.complete(requestId, { ...context, claimId: intent.claimId! });
    if (!current()) return failure(LOCKED);
    if (completed.kind !== "ok") {
      if (flow && intent.action !== "download") trackAuthIntent(flow, "failed", safeAnalyticsError(completed.kind));
      return failure("Your comparison was restored, but the sign-in action could not be closed. Retry to check its status.");
    }
    if (flow && intent.action !== "save" && intent.action !== "download") trackAuthIntent(flow, "succeeded");
    // Completing this handoff means the preserved result is available. PDF
    // generation and download each still require their own user action.
    return { kind: "ok", href: intent.action === "download" ? "/compare/results#comparison-report" : s ? "/compare/results" : "/compare" };
  });
  const discardPrivateData = async (confirmed: boolean): Promise<CompareActionResult> => {
    if (!confirmed || !access) return { kind: "ok" };
    const w = workspace.current;
    if (!w || !current()) return failure(LOCKED);
    const result = await w.discard(true);
    if (result.kind !== "ok") return failure("This browser could not clear your private comparisons. Try again.");
    if (!runtime.current.alive || !access.isCurrent()) return failure(LOCKED);
    setDiscarded(true); replaceWorking(freshDraft(), null); return { kind: "ok" };
  };
  const captureAccountDeletionCleanup = (confirmed: boolean): AccountDeletionCleanup | null => {
    if (!confirmed || !access || !access.isCurrent()) return null;
    return workspace.current?.captureFormerAccountCleanup(access, true) ?? null;
  };
  return <CompareContext.Provider value={{
    ...draft, hydrated, member, busy, snapshot, message, saveStatus, savePauseReason, saveRequestId, pendingCount,
    signOutReady: !member || hydrated || discarded,
    setLoanType, updateOffer, calculate, reset, save, requestReport, resumeIntent, discardPrivateData, captureAccountDeletionCleanup,
    retrySave: async () => {
      await action(async () => {
        if (!workspace.current) return failure(LOCKED);
        if (saveStatus === "paused" && saveRequestId) {
          const recovered = await workspace.current.retryPausedSave(saveRequestId);
          if (!current()) return failure(LOCKED);
          if (recovered.kind !== "ok") {
            return failure(recovered.code === "expired"
              ? "This save is too old to retry. We could not confirm whether it was saved. Keep this result open, or start a fresh comparison."
              : "This save needs review before it can be retried. Your result remains in this browser; start a fresh comparison when ready.");
          }
        }
        await workspace.current.pump();
        return { kind: "ok" };
      });
    },
    addOffer: () => { const d = runtime.current.draft; if (member && d.offers.length < 3) changeDraft({ ...d, offers: [...d.offers, makeOffer(d.loanType)] }); },
    removeOffer: (id) => { const d = runtime.current.draft; if (d.offers.length > 2) changeDraft({ ...d, offers: d.offers.filter((o) => o.id !== id) }); },
    canAdd: hydrated && member && draft.offers.length < 3,
  }}>{children}</CompareContext.Provider>;
}
export function useCompare(): CompareContextValue {
  const value = useContext(CompareContext);
  if (!value) throw new Error("useCompare must be used inside CompareProvider");
  return value;
}
