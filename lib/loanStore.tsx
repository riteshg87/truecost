"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TransferQuote, LoanRecord } from "./health/types";
import { AUTH_CONFIG } from "./auth/config";
import { useAuth, type AuthValue } from "./auth/provider";
import type { PrivateSessionAccess } from "./auth/private-session";
import { parseSavedLoanPayload, type SavedLoanPayload } from "./contracts/saved-loan";
import { ContractValidationError, randomUuid } from "./contracts/errors";
import {
  loanHealthContextSlot,
  loanHealthFeedbackContext,
  forgetRememberedFeedbackContexts,
  readRememberedFeedbackContext,
  rememberFeedbackContext,
} from "./feedback/context";
import { createSessionBoundSavedLoanTransport } from "./private-storage/transport";
import { PrivateStorage } from "./private-storage/storage";
import { registerAccountDeletionCleanup, type AccountDeletionCleanup, type DeletionCleanupRegistration } from "./privacy/deletion-signal";
import { SavedLoanSyncController, type SyncSnapshot } from "./private-storage/sync";
import type { PrivateResult } from "./private-storage/types";
import { parseLegacyDeviceLoan } from "./legacy-device-loan";

const LEGACY_DEVICE_LOAN_KEY = "truecost.loan.v1";
const LEGACY_ADOPTION_KEY = "truecost.loan.adoption.v1";
type LegacyDeviceLoanState = "none" | "available" | "kept" | "adopted-pending" | "adopted" | "removed";
type LegacyAdoptionRecord = { profileId: string; requestId: string; status: "pending" | "acknowledged"; legacyFingerprint: string };

function fallbackLegacyFingerprint(value: string): string {
  let left = 2166136261;
  let right = 2654435761;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619);
    right = Math.imul(right ^ (code + index), 2246822519);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

async function legacyFingerprint(payload: SavedLoanPayload): Promise<string> {
  const input = JSON.stringify(payload);
  try {
    if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  } catch { /* Fall back to a non-sensitive local digest when Web Crypto is unavailable. */ }
  return fallbackLegacyFingerprint(input);
}

function readLegacyAdoptionRecord(profileId: string): LegacyAdoptionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(`${LEGACY_ADOPTION_KEY}:${profileId}`) ?? "null");
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return record.profileId === profileId && typeof record.requestId === "string" && typeof record.legacyFingerprint === "string" && (record.status === "pending" || record.status === "acknowledged")
      ? { profileId, requestId: record.requestId, status: record.status, legacyFingerprint: record.legacyFingerprint }
      : null;
  } catch {
    return null;
  }
}

function writeLegacyAdoptionRecord(record: LegacyAdoptionRecord): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(`${LEGACY_ADOPTION_KEY}:${record.profileId}`, JSON.stringify(record)); } catch { /* Local metadata is only a reload hint. */ }
}

function clearLegacyAdoptionRecord(profileId: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(`${LEGACY_ADOPTION_KEY}:${profileId}`); } catch { /* Local metadata is only a reload hint. */ }
}

export interface LoanState {
  loan: LoanRecord | null;
  quote: TransferQuote;
  surplus: number;
  bufferMonths: number;
  rateResolvedAt: string | null;
}

export function blankLoan(): LoanRecord {
  return { lender: "", original: 0, outstanding: 0, ratePct: 0, basis: "repo", spreadPct: 0, cycle: "quarterly", lastReset: "", monthsLeft: 0 };
}

function initialState(): LoanState {
  return { loan: null, quote: { newRatePct: 0, feePct: 0.25, legalCharges: 5000, keepTenure: true, newTenureMonths: 240 }, surplus: 0, bufferMonths: 0, rateResolvedAt: null };
}

const EMPTY_SYNC: SyncSnapshot = { status: "locked", revision: 0, cachedLoan: null, pendingLoan: undefined, pendingCount: 0, nextRetryAt: null, errorCode: null, notice: null };
type AuthWithPrivateSession = AuthValue & { readonly privateSession: PrivateSessionAccess | null };
type VoidResult = PrivateResult<void>;

interface LoanContextValue extends LoanState {
  hydrated: boolean;
  scopeKey: string | null;
  draftDirty: boolean;
  sync: SyncSnapshot;
  legacyDeviceLoanAvailable: boolean;
  legacyDeviceLoanState: LegacyDeviceLoanState;
  /** Opaque context identity for the current Loan Health suggestion. */
  loanHealthSuggestionId: string | null;
  saveLoan: (loan: LoanRecord, extras?: { surplus: number; bufferMonths: number }) => Promise<PrivateResult<{ requestId: string }>>;
  saveDraft: () => Promise<PrivateResult<{ requestId: string }>>;
  setQuote: (patch: Partial<TransferQuote>) => Promise<VoidResult>;
  setSurplus: (value: number) => Promise<VoidResult>;
  setBufferMonths: (value: number) => Promise<VoidResult>;
  markRateResolved: (iso: string) => Promise<VoidResult>;
  clearAll: () => Promise<VoidResult>;
  retrySync: () => Promise<VoidResult>;
  resolveConflict: (choice: "keep-server" | "resubmit-local") => Promise<PrivateResult<{ requestId?: string }>>;
  discardPrivateData: (confirmed: boolean) => Promise<VoidResult>;
  adoptLegacyDeviceLoan: () => Promise<PrivateResult<{ requestId: string }>>;
  keepLegacyDeviceLoan: () => void;
  removeLegacyDeviceLoan: () => Promise<void>;
  captureAccountDeletionCleanup: (confirmed: boolean) => AccountDeletionCleanup | null;
}

const LoanContext = createContext<LoanContextValue | null>(null);

function scopeFor(session: PrivateSessionAccess | null): string | null {
  if (!session) return null;
  const identity = session.identity;
  return `${identity.profileId}:${identity.sessionId}:${identity.authEpoch}`;
}

function grantFor(session: PrivateSessionAccess | null, serial: number): string | null {
  const scope = scopeFor(session);
  return scope ? `${scope}:${serial}` : null;
}

function asState(payload: SavedLoanPayload): LoanState {
  return { loan: payload.loan, quote: payload.quote, surplus: payload.surplus, bufferMonths: payload.bufferMonths, rateResolvedAt: payload.rateResolvedAt };
}

function invalid(code: string): { kind: "invalid"; code: string } {
  return { kind: "invalid", code };
}

function parsePayload(value: unknown): PrivateResult<SavedLoanPayload> {
  try { return { kind: "ok", value: parseSavedLoanPayload(value) as SavedLoanPayload }; }
  catch (error) { return { kind: "invalid", code: error instanceof ContractValidationError ? error.code : "invalid_shape" }; }
}

export function LoanProvider({ children }: { children: ReactNode }) {
  const auth = useAuth() as AuthWithPrivateSession;
  const privateSession = auth.privateSession;
  const grantRef = useRef<{ session: PrivateSessionAccess | null; serial: number }>({ session: null, serial: 0 });
  if (grantRef.current.session !== privateSession) {
    grantRef.current = { session: privateSession, serial: grantRef.current.serial + 1 };
  }
  const scopeKey = scopeFor(privateSession);
  const grantKey = grantFor(privateSession, grantRef.current.serial);
  const runtime = useMemo(() => {
    if (!privateSession || !AUTH_CONFIG.convexUrl) return null;
    const storage = new PrivateStorage();
    try {
      const transport = createSessionBoundSavedLoanTransport({
        url: AUTH_CONFIG.convexUrl,
        identity: privateSession.identity,
        getToken: privateSession.getToken,
        isCurrent: (identity) => privateSession.isCurrent() && identity.profileId === privateSession.identity.profileId && identity.sessionId === privateSession.identity.sessionId && identity.authEpoch === privateSession.identity.authEpoch,
      });
      return { key: grantKey!, session: privateSession, storage, controller: new SavedLoanSyncController(storage, transport) };
    } catch {
      return { key: grantKey!, session: privateSession, storage, controller: null };
    }
  }, [grantKey]);

  const [sync, setSync] = useState<SyncSnapshot>(EMPTY_SYNC);
  const [draft, setDraft] = useState<LoanState>(initialState);
  const [draftDirtyState, setDraftDirtyState] = useState(false);
  const draftRef = useRef(draft);
  const visibleLoanRef = useRef<LoanRecord | null>(null);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);
  const runtimeRef = useRef(runtime);
  const sessionRef = useRef(privateSession);
  const scopeRef = useRef(grantKey);
  const initializedRef = useRef(initializedKey);
  runtimeRef.current = runtime;
  sessionRef.current = privateSession;
  scopeRef.current = grantKey;
  initializedRef.current = initializedKey;
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const draftDirty = useRef(false);
  const draftVersion = useRef(0);
  const revokedLifetime = useRef<number | null>(null);
  const ownDiscardedLifetime = useRef<number | null>(null);
  const discardChannel = useRef<BroadcastChannel | null>(null);
  const previousAccountRef = useRef<string | null>(null);
  const suggestionContextRef = useRef<{ key: string; id: string; source: "draft" | "pending" | "revision"; pendingRequestId: string | null; revision: number } | null>(null);
  const acknowledgedDraftContextRef = useRef<{ id: string; requestId: string } | null>(null);
  const legacyDeviceLoanRef = useRef<SavedLoanPayload | null>(null);
  const legacyAdoptionRequestIdRef = useRef<string | null>(null);
  const [legacyDeviceLoanState, setLegacyDeviceLoanState] = useState<LegacyDeviceLoanState>("none");

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    const generation = ++lifetime.current;
    const currentRuntime = runtime;
    const key = grantKey;
    const session = privateSession;
    const previousAccount = previousAccountRef.current;
    const nextAccount = session?.identity.profileId ?? null;
    if (previousAccount && previousAccount !== nextAccount) {
      forgetRememberedFeedbackContexts(previousAccount);
    }
    previousAccountRef.current = nextAccount;
    draftDirty.current = false;
    draftVersion.current += 1;
    setDraftDirtyState(false);
    revokedLifetime.current = null;
    ownDiscardedLifetime.current = null;
    discardChannel.current?.close();
    discardChannel.current = null;
    setInitializedKey(null);
    draftRef.current = initialState();
    setDraft(draftRef.current);
    setSync(EMPTY_SYNC);
    suggestionContextRef.current = null;
    acknowledgedDraftContextRef.current = null;
    legacyDeviceLoanRef.current = null;
    legacyAdoptionRequestIdRef.current = null;
    setLegacyDeviceLoanState("none");
    if (!currentRuntime || !session) return undefined;
    let alive = true;
    let deletionRegistration: DeletionCleanupRegistration | null = null;
    const current = () => alive && mounted.current && lifetime.current === generation && currentRuntime === runtimeRef.current && session === sessionRef.current && key === scopeRef.current && session.isCurrent();
    const controller = currentRuntime.controller;
    if (!controller) { setInitializedKey(key); setSync({ ...EMPTY_SYNC, status: "storage-error", errorCode: "transport_unavailable" }); return () => { alive = false; }; }
    let opened = false;
    const adopt = (snapshot: SyncSnapshot) => {
      if (!current()) return;
      // The initial subscription is locked before open() starts. A later lock
      // revokes the whole draft, including edits that were never queued.
      if (snapshot.status !== "locked") opened = true;
      if (opened && snapshot.status === "locked") {
        revokedLifetime.current = generation;
        draftDirty.current = false;
        setDraftDirtyState(false);
      }
      setSync(snapshot);
      if (legacyAdoptionRequestIdRef.current && snapshot.lastAcknowledgedRequestId === legacyAdoptionRequestIdRef.current && snapshot.pendingCount === 0) {
        setLegacyDeviceLoanState("adopted");
        const adoption = readLegacyAdoptionRecord(session.identity.profileId);
        if (adoption?.requestId === legacyAdoptionRequestIdRef.current && adoption.status !== "acknowledged") writeLegacyAdoptionRecord({ ...adoption, status: "acknowledged" });
      }
      if (!draftDirty.current) {
        const payload = snapshot.pendingLoan !== undefined ? snapshot.pendingLoan : snapshot.cachedLoan;
        draftRef.current = payload ? asState(payload) : initialState();
        draftVersion.current += 1;
        setDraft(draftRef.current);
      }
    };
    const unsubscribe = controller.subscribe(adopt);
    if (typeof BroadcastChannel !== "undefined") {
      try {
        const channel = new BroadcastChannel(`truecost.private.discard.${session.identity.profileId}`);
        discardChannel.current = channel;
        channel.onmessage = (event: MessageEvent<unknown>) => {
          const message = event.data;
          if (!message || typeof message !== "object") return;
          const record = message as Record<string, unknown>;
          if (record.type !== "discarded" || record.profileId !== session.identity.profileId || !current()) return;
          revokedLifetime.current = generation;
          controller.stop();
          draftDirty.current = false;
          setDraftDirtyState(false);
          draftVersion.current += 1;
          setSync(EMPTY_SYNC);
          draftRef.current = initialState();
          setDraft(draftRef.current);
        };
      } catch { /* Unsupported or blocked BroadcastChannel is safe fallback. */ }
    }
    const online = typeof navigator !== "undefined" && navigator.onLine;
    const open = async () => {
      try {
        const result = await controller.open({ ...session.identity }, online);
        if (current()) {
          setSync(result);
          setInitializedKey(key);
          const hasAccountData = result.cachedLoan !== null || result.pendingLoan !== undefined || result.pendingCount > 0;
          if (typeof window !== "undefined") {
            try {
              const raw = window.localStorage.getItem(LEGACY_DEVICE_LOAN_KEY);
              const legacy = raw ? parseLegacyDeviceLoan(JSON.parse(raw)) : null;
              const storedAdoption = legacy ? readLegacyAdoptionRecord(session.identity.profileId) : null;
              const digest = legacy ? await legacyFingerprint(legacy) : null;
              if (!current()) return;
              const adoption = storedAdoption && digest === storedAdoption.legacyFingerprint ? storedAdoption : null;
              if (storedAdoption && !adoption) clearLegacyAdoptionRecord(session.identity.profileId);
              legacyDeviceLoanRef.current = legacy;
              legacyAdoptionRequestIdRef.current = adoption?.requestId ?? null;
              const acknowledged = adoption && (adoption.status === "acknowledged" || (result.lastAcknowledgedRequestId === adoption.requestId && result.pendingCount === 0));
              if (adoption && acknowledged && adoption.status !== "acknowledged") writeLegacyAdoptionRecord({ ...adoption, status: "acknowledged" });
              setLegacyDeviceLoanState(adoption && acknowledged ? "adopted" : adoption ? "adopted-pending" : !hasAccountData && legacy ? "available" : "none");
            } catch {
              legacyDeviceLoanRef.current = null;
              legacyAdoptionRequestIdRef.current = null;
              setLegacyDeviceLoanState("none");
            }
          }
          const cleanup = currentRuntime.storage.captureFormerAccountCleanup(session, true);
          deletionRegistration = registerAccountDeletionCleanup(session, cleanup, "loan");
        }
      } catch {
        if (current()) { setSync({ ...EMPTY_SYNC, status: "storage-error", errorCode: "storage_failure" }); setInitializedKey(key); }
      }
    };
    const pump = (value: boolean) => { void controller.pump(value).catch(() => undefined); };
    const onOnline = () => pump(true);
    const onOffline = () => pump(false);
    const onFocus = () => {
      const guard = currentRuntime.storage.captureGuard();
      if (!guard || !current()) return;
      // Even offline, observe another tab's durable discard before rendering
      // or replaying this tab's private draft again.
      void currentRuntime.storage.readState(guard).then((result) => {
        if (!current()) return;
        if (result.kind === "locked") {
          revokedLifetime.current = generation;
          draftDirty.current = false;
          setDraftDirtyState(false);
          draftVersion.current += 1;
          controller.stop();
          draftRef.current = initialState();
          setDraft(draftRef.current);
        } else if (navigator.onLine) pump(true);
      }).catch(() => { if (current()) setSync({ ...EMPTY_SYNC, status: "storage-error", errorCode: "storage_failure" }); });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    void open();
    return () => {
      alive = false;
      deletionRegistration?.stop();
      deletionRegistration = null;
      unsubscribe();
      discardChannel.current?.close();
      discardChannel.current = null;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      controller.stop();
    };
  }, [runtime, grantKey]);

  const currentPayload = sync.pendingLoan !== undefined ? sync.pendingLoan : sync.cachedLoan;
  const visible = initializedKey === grantKey ? currentPayload : null;
  const persistedView = visible ? asState(visible) : initialState();
  const currentView = Boolean(grantKey && initializedKey === grantKey && runtime?.key === grantKey && revokedLifetime.current !== lifetime.current && privateSession?.isCurrent());
  const view = currentView ? (draftDirtyState ? draft : persistedView) : initialState();
  visibleLoanRef.current = view.loan;
  const active = useCallback((capturedRuntime?: typeof runtime, capturedSession?: PrivateSessionAccess | null, capturedScope?: string | null) => {
    const latestRuntime = runtimeRef.current;
    const latestSession = sessionRef.current;
    const latestScope = scopeRef.current;
    return Boolean(mounted.current && latestRuntime && latestRuntime.controller && latestRuntime.key === latestScope && initializedRef.current === latestScope && revokedLifetime.current !== lifetime.current && latestSession?.isCurrent()
      && (!capturedRuntime || capturedRuntime === latestRuntime)
      && (!capturedSession || capturedSession === latestSession)
      && (capturedScope === undefined || capturedScope === latestScope));
  }, []);

  const persistPayload = useCallback(async (payload: SavedLoanPayload, capturedRuntime: NonNullable<typeof runtime>, capturedSession: PrivateSessionAccess, capturedScope: string): Promise<PrivateResult<{ requestId: string }>> => {
    if (!active(capturedRuntime, capturedSession, capturedScope)) return { kind: "locked", reason: "not-unlocked" };
    const result = await capturedRuntime.controller!.queueSave(payload);
    // queueSave durably records the operation before its detached online pump
    // finishes. Keep the public write promise pending until that pump has
    // projected the acknowledged payload, so the next action cannot race a
    // stale revision and overwrite the just-saved draft.
    if (result.kind === "ok" && typeof navigator !== "undefined" && navigator.onLine) {
      await capturedRuntime.controller!.pump(true);
    }
    if (!active(capturedRuntime, capturedSession, capturedScope)) return { kind: "locked", reason: "stale-callback" };
    // queueSave publishes through the controller before React necessarily
    // commits the subscription callback. Mirror its settled snapshot here so
    // the promise and the visible pending state become observable together.
    if (result.kind === "ok") setSync(capturedRuntime.controller!.getSnapshot());
    return result;
  }, [active]);

  const saveLoan = useCallback(async (loan: LoanRecord, extras?: { surplus: number; bufferMonths: number }): Promise<PrivateResult<{ requestId: string }>> => {
    const currentRuntime = runtime;
    const session = currentRuntime?.session;
    if (!currentRuntime?.controller || !session || !active(currentRuntime, session, grantKey)) return { kind: "locked", reason: "not-unlocked" };
    const startedDraftVersion = draftVersion.current;
    const currentDraft = draftRef.current;
    const parsed = parsePayload({ loan: structuredClone(loan), quote: structuredClone(currentDraft.quote), surplus: extras?.surplus ?? currentDraft.surplus, bufferMonths: extras?.bufferMonths ?? currentDraft.bufferMonths, rateResolvedAt: null });
    if (parsed.kind !== "ok") return parsed;
    const payload = parsed.value;
    const result = await persistPayload(payload, currentRuntime, session, grantKey!);
    if (!active(currentRuntime, session, grantKey) || !session.isCurrent()) return { kind: "locked", reason: "stale-callback" };
    if (result.kind === "ok" && draftVersion.current === startedDraftVersion) { draftDirty.current = false; setDraftDirtyState(false); draftRef.current = asState(payload); setDraft(draftRef.current); }
    return result;
  }, [runtime, active, persistPayload, grantKey]);

  const saveDraft = useCallback(async (): Promise<PrivateResult<{ requestId: string }>> => {
    const currentRuntime = runtime;
    const session = currentRuntime?.session;
    if (!currentRuntime?.controller || !session || !active(currentRuntime, session, grantKey)) return { kind: "locked", reason: "not-unlocked" };
    const currentDraft = draftRef.current;
    const sourceLoan = visibleLoanRef.current ?? currentDraft.loan;
    if (!sourceLoan) return invalid("no_saved_loan");
    const parsed = parsePayload({ ...currentDraft, loan: sourceLoan });
    if (parsed.kind !== "ok") return parsed;
    const startedDraftVersion = draftVersion.current;
    const result = await persistPayload(parsed.value, currentRuntime, session, grantKey!);
    if (result.kind === "ok" && draftVersion.current === startedDraftVersion) {
      const currentContext = suggestionContextRef.current;
      if (currentContext?.source === "draft") {
        acknowledgedDraftContextRef.current = { id: currentContext.id, requestId: result.value.requestId };
      }
      draftDirty.current = false;
      setDraftDirtyState(false);
      draftRef.current = asState(parsed.value);
      setDraft(draftRef.current);
    }
    return result;
  }, [runtime, active, persistPayload, grantKey]);

  const adoptLegacyDeviceLoan = useCallback(async (): Promise<PrivateResult<{ requestId: string }>> => {
    const payload = legacyDeviceLoanRef.current;
    const currentRuntime = runtime;
    const session = currentRuntime?.session;
    if (!payload || !currentRuntime?.controller || !session || !active(currentRuntime, session, grantKey)) return { kind: "locked", reason: "not-unlocked" };
    const payloadDigest = await legacyFingerprint(payload);
    if (!active(currentRuntime, session, grantKey)) return { kind: "locked", reason: "stale-callback" };
    const currentSnapshot = currentRuntime.controller.getSnapshot();
    if (view.loan || currentSnapshot.cachedLoan || currentSnapshot.pendingCount > 0) return { kind: "invalid", code: "account_loan_exists" };
    const result = await persistPayload(payload, currentRuntime, session, grantKey!);
    if (result.kind === "ok" && active(currentRuntime, session, grantKey)) {
      draftDirty.current = false;
      setDraftDirtyState(false);
      draftRef.current = asState(payload);
      setDraft(draftRef.current);
      setSync(currentRuntime.controller.getSnapshot());
      legacyAdoptionRequestIdRef.current = result.value.requestId;
      const acknowledged = currentRuntime.controller.getSnapshot().lastAcknowledgedRequestId === result.value.requestId && currentRuntime.controller.getSnapshot().pendingCount === 0;
      writeLegacyAdoptionRecord({ profileId: session.identity.profileId, requestId: result.value.requestId, status: acknowledged ? "acknowledged" : "pending", legacyFingerprint: payloadDigest });
      setLegacyDeviceLoanState(acknowledged ? "adopted" : "adopted-pending");
    }
    return result;
  }, [runtime, active, grantKey, persistPayload, view.loan]);

  const keepLegacyDeviceLoan = useCallback(() => {
    if (legacyDeviceLoanRef.current) {
      const profileId = sessionRef.current?.identity.profileId;
      if (profileId) clearLegacyAdoptionRecord(profileId);
      legacyAdoptionRequestIdRef.current = null;
      setLegacyDeviceLoanState("kept");
    }
  }, []);

  const removeLegacyDeviceLoan = useCallback(async () => {
    const capturedRuntime = runtime;
    const capturedSession = sessionRef.current;
    const capturedScope = grantKey;
    const capturedRequestId = legacyAdoptionRequestIdRef.current;
    if (!legacyDeviceLoanRef.current || typeof window === "undefined" || !capturedRuntime || !capturedSession || !active(capturedRuntime, capturedSession, capturedScope)) return;
    if (legacyDeviceLoanState === "adopted-pending") return;
    if (legacyDeviceLoanState === "adopted" && !capturedRequestId) return;
    const profileId = capturedSession.identity.profileId;
    let initialRaw: string | null;
    try { initialRaw = window.localStorage.getItem(LEGACY_DEVICE_LOAN_KEY); } catch { return; }
    if (!initialRaw) return;
    if (legacyDeviceLoanState === "adopted" && profileId) {
      try {
        const currentLegacy = parseLegacyDeviceLoan(JSON.parse(initialRaw));
        const adoption = readLegacyAdoptionRecord(profileId);
        const digest = currentLegacy ? await legacyFingerprint(currentLegacy) : null;
        if (!active(capturedRuntime, capturedSession, capturedScope) || legacyDeviceLoanState !== "adopted" || legacyAdoptionRequestIdRef.current !== capturedRequestId) return;
        const latestRaw = window.localStorage.getItem(LEGACY_DEVICE_LOAN_KEY);
        if (latestRaw !== initialRaw) {
          clearLegacyAdoptionRecord(profileId);
          legacyDeviceLoanRef.current = latestRaw ? parseLegacyDeviceLoan(JSON.parse(latestRaw)) : null;
          legacyAdoptionRequestIdRef.current = null;
          setLegacyDeviceLoanState("none");
          return;
        }
        if (!currentLegacy || !adoption || adoption.requestId !== capturedRequestId || adoption.legacyFingerprint !== digest) {
          clearLegacyAdoptionRecord(profileId);
          legacyDeviceLoanRef.current = currentLegacy;
          legacyAdoptionRequestIdRef.current = null;
          setLegacyDeviceLoanState("none");
          return;
        }
      } catch {
        clearLegacyAdoptionRecord(profileId);
        legacyDeviceLoanRef.current = null;
        legacyAdoptionRequestIdRef.current = null;
        setLegacyDeviceLoanState("none");
        return;
      }
    }
    let latestRaw: string | null;
    try { latestRaw = window.localStorage.getItem(LEGACY_DEVICE_LOAN_KEY); } catch { return; }
    if (!active(capturedRuntime, capturedSession, capturedScope) || (legacyDeviceLoanState === "adopted" && legacyAdoptionRequestIdRef.current !== capturedRequestId) || latestRaw !== initialRaw) return;
    try { window.localStorage.removeItem(LEGACY_DEVICE_LOAN_KEY); } catch { return; }
    legacyDeviceLoanRef.current = null;
    legacyAdoptionRequestIdRef.current = null;
    if (profileId) clearLegacyAdoptionRecord(profileId);
    setLegacyDeviceLoanState("removed");
  }, [runtime, active, grantKey, legacyDeviceLoanState]);

  const setQuote = useCallback(async (patch: Partial<TransferQuote>): Promise<VoidResult> => {
    const latestLoan = draftRef.current.loan ?? visibleLoanRef.current;
    if (!latestLoan || !active(runtime, runtime?.session, grantKey)) return invalid("no_saved_loan");
    const base = draftRef.current.loan ? draftRef.current : { ...view, loan: latestLoan };
    const nextDraft = { ...base, quote: { ...base.quote, ...structuredClone(patch) } };
    draftDirty.current = true; draftVersion.current += 1; setDraftDirtyState(true); draftRef.current = nextDraft; setDraft(nextDraft); return { kind: "ok", value: undefined };
  }, [view, active, runtime, grantKey]);
  const setSurplus = useCallback(async (value: number): Promise<VoidResult> => {
    const latestLoan = draftRef.current.loan ?? visibleLoanRef.current;
    if (!latestLoan || !active(runtime, runtime?.session, grantKey)) return invalid("no_saved_loan");
    const nextDraft = { ...(draftRef.current.loan ? draftRef.current : { ...view, loan: latestLoan }), surplus: value };
    draftDirty.current = true; draftVersion.current += 1; setDraftDirtyState(true); draftRef.current = nextDraft; setDraft(nextDraft); return { kind: "ok", value: undefined };
  }, [view, active, runtime, grantKey]);
  const setBufferMonths = useCallback(async (value: number): Promise<VoidResult> => {
    const latestLoan = draftRef.current.loan ?? visibleLoanRef.current;
    if (!latestLoan || !active(runtime, runtime?.session, grantKey)) return invalid("no_saved_loan");
    const nextDraft = { ...(draftRef.current.loan ? draftRef.current : { ...view, loan: latestLoan }), bufferMonths: value };
    draftDirty.current = true; draftVersion.current += 1; setDraftDirtyState(true); draftRef.current = nextDraft; setDraft(nextDraft); return { kind: "ok", value: undefined };
  }, [view, active, runtime, grantKey]);
  const markRateResolved = useCallback(async (iso: string): Promise<VoidResult> => {
    const latestLoan = draftRef.current.loan ?? visibleLoanRef.current;
    if (!latestLoan || !active(runtime, runtime?.session, grantKey)) return invalid("no_saved_loan");
    const nextDraft = { ...(draftRef.current.loan ? draftRef.current : { ...view, loan: latestLoan }), rateResolvedAt: iso };
    const parsed = parsePayload(nextDraft);
    if (parsed.kind !== "ok") return parsed;
    const currentRuntime = runtime;
    const session = currentRuntime?.session;
    if (!currentRuntime?.controller || !session || !grantKey) return { kind: "locked", reason: "not-unlocked" };
    const startedDraftVersion = draftVersion.current;
    const result = await persistPayload(parsed.value, currentRuntime, session, grantKey);
    if (!active(currentRuntime, session, grantKey)) return { kind: "locked", reason: "stale-callback" };
    if (result.kind === "ok" && draftVersion.current === startedDraftVersion) {
      const currentContext = suggestionContextRef.current;
      if (currentContext?.source === "draft") {
        acknowledgedDraftContextRef.current = { id: currentContext.id, requestId: result.value.requestId };
      }
      draftDirty.current = false;
      setDraftDirtyState(false);
      draftRef.current = nextDraft;
      setDraft(nextDraft);
    }
    return result.kind === "ok" ? { kind: "ok", value: undefined } : result;
  }, [view, active, runtime, persistPayload, grantKey]);

  const clearAll = useCallback(async (): Promise<VoidResult> => {
    if (!view.loan) return { kind: "ok", value: undefined };
    const currentRuntime = runtime;
    const session = currentRuntime?.session;
    const capturedScope = grantKey;
    if (!currentRuntime?.controller || !session || !active(currentRuntime, session, capturedScope)) return { kind: "locked", reason: "not-unlocked" };
    const result = await currentRuntime.controller.queueDelete();
    if (!active(currentRuntime, session, capturedScope)) return { kind: "locked", reason: "stale-callback" };
    if (result.kind === "ok") { draftDirty.current = false; draftVersion.current += 1; setDraftDirtyState(false); draftRef.current = initialState(); setDraft(draftRef.current); }
    return result.kind === "ok" ? { kind: "ok", value: undefined } : result;
  }, [view.loan, runtime, grantKey, active]);

  const retrySync = useCallback(async (): Promise<VoidResult> => {
    const currentRuntime = runtime;
    const capturedSession = currentRuntime?.session;
    const capturedScope = grantKey;
    if (!currentRuntime?.controller || !capturedSession || !active(currentRuntime, capturedSession, capturedScope)) return { kind: "locked", reason: "not-unlocked" };
    await currentRuntime.controller.retry();
    if (!active(currentRuntime, capturedSession, capturedScope)) return { kind: "locked", reason: "stale-callback" };
    const status = currentRuntime.controller.getSnapshot().status;
    if (status === "locked") return { kind: "locked", reason: "not-unlocked" };
    if (status === "storage-error") return { kind: "storage-unavailable", reason: "transaction-failed" };
    if (status === "refresh-needed") return { kind: "locked", reason: "offline" };
    return { kind: "ok", value: undefined };
  }, [runtime, grantKey, active]);
  const resolveConflict = useCallback(async (choice: "keep-server" | "resubmit-local"): Promise<PrivateResult<{ requestId?: string }>> => {
    const currentRuntime = runtime;
    const capturedSession = currentRuntime?.session;
    const capturedScope = grantKey;
    if (!currentRuntime?.controller || !capturedSession || !active(currentRuntime, capturedSession, capturedScope)) return { kind: "locked", reason: "not-unlocked" };
    const guard = currentRuntime.storage.captureGuard();
    if (!guard) return { kind: "locked", reason: "not-unlocked" };
    const state = await currentRuntime.storage.readState(guard);
    if (!active(currentRuntime, capturedSession, capturedScope)) return { kind: "locked", reason: "stale-callback" };
    if (state.kind !== "ok") return state;
    const head = state.value.outbox[0];
    if (!head || head.status !== "paused") return { kind: "not-found" };
    const result = await currentRuntime.controller.resolveConflict(head.requestId, choice);
    return active(currentRuntime, capturedSession, capturedScope) ? result : { kind: "locked", reason: "stale-callback" };
  }, [runtime, grantKey, active]);
  const captureAccountDeletionCleanup = useCallback((confirmed: boolean): AccountDeletionCleanup | null => {
    const currentRuntime = runtimeRef.current;
    const session = sessionRef.current;
    const scope = scopeRef.current;
    if (!confirmed || !currentRuntime?.controller || !session || !active(currentRuntime, session, scope)) return null;
    return currentRuntime.storage.captureFormerAccountCleanup(session, true);
  }, [active]);
  const discardPrivateData = useCallback(async (confirmed: boolean): Promise<VoidResult> => {
    if (!confirmed) return { kind: "ok", value: undefined };
    if (runtime !== runtimeRef.current || runtime?.session !== sessionRef.current || !runtime?.session.isCurrent()) return { kind: "locked", reason: "stale-callback" };
    if (ownDiscardedLifetime.current === lifetime.current) return { kind: "ok", value: undefined };
    if (!runtime?.controller || !active(runtime, runtime.session, grantKey)) return { kind: "locked", reason: "not-unlocked" };
    const capturedRuntime = runtime;
    const capturedSession = runtime.session;
    const capturedScope = grantKey;
    const capturedGeneration = lifetime.current;
    const result = await capturedRuntime.controller.discardFormerMember(true);
    // A successful discard deliberately stops the controller. Check the
    // captured account lifetime here without requiring its storage to stay open.
    if (!mounted.current || runtimeRef.current !== capturedRuntime || sessionRef.current !== capturedSession || scopeRef.current !== capturedScope || !capturedSession.isCurrent() || lifetime.current !== capturedGeneration) return { kind: "locked", reason: "stale-callback" };
    if (result.kind === "ok") {
      revokedLifetime.current = lifetime.current;
      ownDiscardedLifetime.current = lifetime.current;
      draftDirty.current = false;
      draftVersion.current += 1;
      setDraftDirtyState(false);
      setSync(EMPTY_SYNC);
      draftRef.current = initialState();
      setDraft(draftRef.current);
      forgetRememberedFeedbackContexts(capturedSession.identity.profileId);
      try { discardChannel.current?.postMessage({ type: "discarded", profileId: capturedSession.identity.profileId }); } catch { /* Channel failure does not weaken the durable discard. */ }
    }
    return result;
  }, [runtime, active, grantKey]);

  const accountKey = privateSession?.identity.profileId ?? null;
  const visibleSync = currentView ? sync : EMPTY_SYNC;
  const pendingRequestId = visibleSync.pendingRequestId ?? null;
  const suggestionContext = (() => {
    if (!accountKey || !currentView || !view.loan) return null;
    const previous = suggestionContextRef.current;
    const draftVersionKey = draftVersion.current;
    const draftKey = `draft:${draftVersionKey}`;
    const pendingKey = pendingRequestId ? `pending:${pendingRequestId}` : null;
    const revisionKey = `revision:${visibleSync.revision}`;
    const dirty = draftDirtyState;
    const source = dirty ? "draft" : pendingRequestId ? "pending" : "revision";
    const key = source === "draft" ? draftKey : source === "pending" ? pendingKey! : revisionKey;
    // A pending save may transition to an acknowledged revision between
    // renders. Carry its opaque context across that transition only when the
    // controller reports the exact request was acknowledged. Queue removal
    // caused by discard, conflict, expiry, or lock must not inherit it.
    const acknowledgedDraft = acknowledgedDraftContextRef.current;
    if (source === "revision" && previous?.source === "draft" && acknowledgedDraft?.id === previous.id && !pendingRequestId
      && visibleSync.lastAcknowledgedRequestId === acknowledgedDraft.requestId) {
      acknowledgedDraftContextRef.current = null;
      suggestionContextRef.current = { ...previous, source: "revision", key: revisionKey, pendingRequestId: null, revision: visibleSync.revision };
      rememberFeedbackContext(accountKey, loanHealthContextSlot("revision", visibleSync.revision), loanHealthFeedbackContext(previous.id));
      return suggestionContextRef.current;
    }
    if (source === "revision" && previous?.source === "pending" && previous.pendingRequestId && !pendingRequestId
      && visibleSync.lastAcknowledgedRequestId === previous.pendingRequestId
      && visibleSync.revision >= previous.revision) {
      suggestionContextRef.current = { ...previous, source: "revision", key: revisionKey, pendingRequestId: null, revision: visibleSync.revision };
      rememberFeedbackContext(accountKey, loanHealthContextSlot("revision", visibleSync.revision), loanHealthFeedbackContext(previous.id));
      return suggestionContextRef.current;
    }
    if (previous?.key === key) return previous;
    const remembered = source === "revision"
      ? readRememberedFeedbackContext(accountKey, loanHealthContextSlot("revision", visibleSync.revision))
      : source === "pending"
        ? readRememberedFeedbackContext(accountKey, loanHealthContextSlot("pending", pendingRequestId!))
        : null;
    // When a save is queued from this visible draft, retain its identity under
    // the request slot. A reload with the same queued request can then recover
    // the prompt without persisting any finance data.
    const carriedDraft = source === "pending" && previous && !previous.pendingRequestId
      && (previous.source === "draft" || previous.source === "revision")
      ? previous.id : null;
    const id = carriedDraft ?? remembered?.contextId ?? randomUuid();
    const next = { key, id, source, pendingRequestId: source === "pending" ? pendingRequestId : null, revision: visibleSync.revision } as const;
    suggestionContextRef.current = next;
    if (source === "pending") rememberFeedbackContext(accountKey, loanHealthContextSlot("pending", pendingRequestId!), loanHealthFeedbackContext(id));
    else if (source === "revision") rememberFeedbackContext(accountKey, loanHealthContextSlot("revision", visibleSync.revision), loanHealthFeedbackContext(id));
    return next;
  })();
  const value = useMemo<LoanContextValue>(() => ({ ...view, hydrated: !scopeKey || initializedKey === grantKey, scopeKey, draftDirty: currentView && draftDirtyState, sync: visibleSync, legacyDeviceLoanAvailable: legacyDeviceLoanState === "available", legacyDeviceLoanState, loanHealthSuggestionId: suggestionContext?.id ?? null, saveLoan, saveDraft, setQuote, setSurplus, setBufferMonths, markRateResolved, clearAll, retrySync, resolveConflict, discardPrivateData, adoptLegacyDeviceLoan, keepLegacyDeviceLoan, removeLegacyDeviceLoan, captureAccountDeletionCleanup }), [view, currentView, scopeKey, grantKey, initializedKey, draftDirtyState, visibleSync, legacyDeviceLoanState, suggestionContext, saveLoan, saveDraft, setQuote, setSurplus, setBufferMonths, markRateResolved, clearAll, retrySync, resolveConflict, discardPrivateData, adoptLegacyDeviceLoan, keepLegacyDeviceLoan, removeLegacyDeviceLoan, captureAccountDeletionCleanup]);
  return <LoanContext.Provider value={value}>{children}</LoanContext.Provider>;
}

export function useLoan(): LoanContextValue {
  const context = useContext(LoanContext);
  if (!context) throw new Error("useLoan must be used inside LoanProvider");
  return context;
}
