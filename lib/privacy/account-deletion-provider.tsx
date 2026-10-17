"use client";

import { useAuth as useClerkAuth, useReverification } from "@clerk/nextjs";
import { makeFunctionReference } from "convex/server";
import { useAction, useConvex, useMutation } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth/provider";
import type { PrivateSessionAccess } from "../auth/private-session";
import { createDeletionRequestCoordinator, type DeletionRequestCoordinator, type DeletionRequestResult, type DeletionRequestState, type CurrentClerkSession } from "./deletion-request";
import type { CapturedDeletionCleanup } from "./deletion-cleanup";
import type { CapturedDeletionSignal } from "./deletion-signal";
import { createDeletionJournal, type DeletionJournal, type DeletionJournalRecord } from "./deletion-journal";
import { createDeletionRecovery, type DeletionRecovery, type DeletionRecoveryResult, type RecoveryReceipt } from "./deletion-recovery";
import { runDeletionRecoveryCleanup } from "./deletion-recovery-cleanup";
import { getAccountDeletionCleanupScope, retryAccountDeletionCleanup, subscribeToAccountDeletionCleanup, type DeletionCleanupScope, type DeletionCleanupSnapshot, type DeletionSignalSubscription } from "./deletion-signal";

type ApprovalExchange =
  | { readonly grantId: string }
  | { readonly status: "limited"; readonly message: string };
type DeletionMutationResult = { readonly status: "accepted" | "replayed"; readonly requestId: string };
type DeletionStatus = "app_pending" | "providers_pending" | "completed";
type ServerStatus = { readonly status: DeletionStatus; readonly needsAttention: boolean; readonly createdAt: number; readonly updatedAt: number };
type CleanupSubscription = { readonly scope: DeletionCleanupScope; readonly subscription: DeletionSignalSubscription };

const approvalRef = makeFunctionReference<"action", { proof: string; purpose: "account_delete" }, ApprovalExchange>("privacyApprovals:exchange");
const requestRef = makeFunctionReference<"mutation", { grantId: string; requestId: string }, DeletionMutationResult>("accountDeletion:requestDeletion");
const statusRef = makeFunctionReference<"query", Record<string, never>, ServerStatus | null>("accountDeletionStatus:current");
const recoveryReceiptRef = makeFunctionReference<"query", { requestId: string; grantId: string }, RecoveryReceipt | null>("accountDeletionRecovery:recoveryReceipt");

export interface AccountDeletionStartOptions {
  /** Captures the former account's browser partitions before submit. */
  captureCleanup: () => CapturedDeletionCleanup | null;
  /** Captures the former profile scope before submit. */
  captureSignal: () => CapturedDeletionSignal | null;
  /** Stops analytics for this same account before the server mutation. */
  stopAnalytics: () => Promise<void>;
}

export interface AccountDeletionContextValue {
  readonly state: DeletionRequestState;
  readonly serverStatus: ServerStatus | null | undefined;
  readonly visibleForCurrent: boolean;
  readonly recovery: DeletionRecoveryResult | null;
  readonly start: (confirmed: boolean, options: AccountDeletionStartOptions) => Promise<DeletionRequestResult>;
  readonly retry: () => Promise<DeletionRequestResult>;
  readonly retryLocalCleanup: () => Promise<LocalCleanupRetryResult>;
}

export type LocalCleanupRetryResult = Readonly<{ kind: "cleared" | "retry" | "unavailable" }>;

const emptyState: DeletionRequestState = { kind: "idle" };
const AccountDeletionContext = createContext<AccountDeletionContextValue>({
  state: emptyState,
  serverStatus: null,
  visibleForCurrent: false,
  recovery: null,
  start: async () => ({ kind: "cancelled", reason: "account_changed" }),
  retry: async () => ({ kind: "idle" }),
  retryLocalCleanup: async () => ({ kind: "unavailable" }),
});

function isApprovalExchange(value: unknown): value is ApprovalExchange {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { grantId?: unknown; status?: unknown; message?: unknown };
  return (typeof candidate.grantId === "string" && candidate.grantId.length > 0) ||
    (candidate.status === "limited" && typeof candidate.message === "string");
}

function isDeletionMutationResult(value: unknown): value is DeletionMutationResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { status?: unknown; requestId?: unknown };
  return (candidate.status === "accepted" || candidate.status === "replayed") && typeof candidate.requestId === "string";
}

function isServerStatus(value: unknown): value is ServerStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { status?: unknown; needsAttention?: unknown; createdAt?: unknown; updatedAt?: unknown };
  return (candidate.status === "app_pending" || candidate.status === "providers_pending" || candidate.status === "completed") &&
    typeof candidate.needsAttention === "boolean" && typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt);
}

function recoveryToRequestResult(result: DeletionRecoveryResult): DeletionRequestResult {
  if (result.kind === "accepted") return { kind: "accepted", requestId: result.record.requestId, grantId: result.record.grantId, cleanup: "retry" };
  if (result.kind === "rejected") return { kind: "cancelled", reason: "server_rejected" };
  if (result.kind === "account_changed") return { kind: "cancelled", reason: "account_changed" };
  if (result.kind === "retryable") return { kind: "unknown", requestId: result.record.requestId, grantId: result.record.grantId };
  return { kind: "idle" };
}

function cleanupScopeKey(scope: DeletionCleanupScope): string {
  return JSON.stringify([scope.runtime, scope.profileId, scope.subject, scope.sessionId, scope.authEpoch]);
}

function snapshotForScope(snapshots: ReadonlyMap<string, DeletionCleanupSnapshot>, scope: DeletionCleanupScope | null): DeletionCleanupSnapshot | null {
  return scope ? snapshots.get(cleanupScopeKey(scope)) ?? null : null;
}

function useDeletionStatus(convex: ReturnType<typeof useConvex>, enabled: boolean): ServerStatus | null | undefined {
  const [status, setStatus] = useState<ServerStatus | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      setStatus(undefined);
      return undefined;
    }
    let alive = true;
    let watch: { localQueryResult: () => unknown; onUpdate: (callback: () => void) => () => void } | null = null;
    try {
      watch = convex.watchQuery(statusRef, {});
      const update = () => {
        if (!alive || !watch) return;
        try {
          const result = watch.localQueryResult();
          if (result === undefined || result === null) setStatus(result as null | undefined);
          else if (isServerStatus(result)) setStatus(result);
          else setStatus(undefined);
        } catch {
          if (alive) setStatus(undefined);
        }
      };
      const stop = watch.onUpdate(update);
      update();
      return () => { alive = false; stop(); };
    } catch {
      setStatus(undefined);
      return () => { alive = false; };
    }
  }, [convex, enabled]);
  return status;
}

function ConfiguredAccountDeletionProvider({ children }: { children: ReactNode }) {
  const appAuth = useAuth();
  const clerk = useClerkAuth();
  const convex = useConvex();
  const exchange = useAction(approvalRef);
  const requestDeletion = useMutation(requestRef);
  const convexRef = useRef(convex);
  const requestDeletionRef = useRef(requestDeletion);
  convexRef.current = convex;
  requestDeletionRef.current = requestDeletion;
  const clerkRef = useRef<CurrentClerkSession | null>(null);
  const clerkAuthStateRef = useRef({ isLoaded: false, isSignedIn: false });
  const boundSessionRef = useRef<CurrentClerkSession | null>(null);
  const lastVerifiedCleanupScopeRef = useRef<DeletionCleanupScope | null>(null);
  const accessRef = useRef<PrivateSessionAccess | null>(appAuth.privateSession);
  const coordinatorRef = useRef<DeletionRequestCoordinator | null>(null);
  const journalRef = useRef<DeletionJournal | null>(null);
  const recoveryRef = useRef<DeletionRecovery | null>(null);
  const recoveryCleanupInFlightRef = useRef<Promise<DeletionRequestResult> | null>(null);
  const recoveredRecordRef = useRef<DeletionJournalRecord | null>(null);
  const approvalBindingRef = useRef<CurrentClerkSession | null>(null);
  const cleanupSubscriptionsRef = useRef(new Map<string, CleanupSubscription>());
  const cleanupSnapshotsRef = useRef(new Map<string, DeletionCleanupSnapshot>());
  const [boundSession, setBoundSession] = useState<CurrentClerkSession | null>(null);
  const [state, setState] = useState<DeletionRequestState>(emptyState);
  const [recovery, setRecovery] = useState<DeletionRecoveryResult | null>(null);
  const [cleanupSnapshots, setCleanupSnapshots] = useState<ReadonlyMap<string, DeletionCleanupSnapshot>>(new Map());
  const [persistenceError, setPersistenceError] = useState(false);

  const getJournal = useCallback(() => {
    if (!journalRef.current) journalRef.current = createDeletionJournal();
    return journalRef.current;
  }, []);

  const applyRecovery = useCallback((result: DeletionRecoveryResult) => {
    setRecovery(result);
    if (result.kind === "accepted") {
      recoveredRecordRef.current = result.record;
      setBoundSession({ subject: result.record.subject, sessionId: result.record.sessionId });
      setState({ kind: "accepted", requestId: result.record.requestId, grantId: result.record.grantId, cleanup: "retry" });
    } else if (result.kind === "retryable") {
      recoveredRecordRef.current = result.record;
      setBoundSession({ subject: result.record.subject, sessionId: result.record.sessionId });
      setState({ kind: "unknown", requestId: result.record.requestId, grantId: result.record.grantId });
    } else if (result.kind === "rejected") {
      recoveredRecordRef.current = result.record;
      setBoundSession({ subject: result.record.subject, sessionId: result.record.sessionId });
      setState({ kind: "cancelled", reason: "server_rejected" });
    }
  }, []);

  accessRef.current = appAuth.privateSession;
  clerkAuthStateRef.current = { isLoaded: Boolean(clerk.isLoaded), isSignedIn: Boolean(clerk.isSignedIn) };
  boundSessionRef.current = boundSession;
  clerkRef.current = clerk.isLoaded && clerk.isSignedIn && clerk.userId && clerk.sessionId ? { subject: clerk.userId, sessionId: clerk.sessionId } : null;
  const liveClerk = clerkRef.current;
  const previousScope = lastVerifiedCleanupScopeRef.current;
  if (liveClerk && previousScope && (previousScope.subject !== liveClerk.subject || previousScope.sessionId !== liveClerk.sessionId)) {
    lastVerifiedCleanupScopeRef.current = null;
  }
  const verifiedAccessScope = appAuth.privateSession ? getAccountDeletionCleanupScope(appAuth.privateSession) : null;
  if (verifiedAccessScope && liveClerk && verifiedAccessScope.subject === liveClerk.subject && verifiedAccessScope.sessionId === liveClerk.sessionId) {
    lastVerifiedCleanupScopeRef.current = verifiedAccessScope;
  }

  useEffect(() => {
    const access = appAuth.privateSession;
    const scope = access ? getAccountDeletionCleanupScope(access) : null;
    if (!scope) return;
    const key = cleanupScopeKey(scope);
    if (cleanupSubscriptionsRef.current.has(key)) return;
    const subscription = subscribeToAccountDeletionCleanup(scope, (snapshot) => {
      cleanupSnapshotsRef.current.set(key, snapshot);
      setCleanupSnapshots(new Map(cleanupSnapshotsRef.current));
    });
    cleanupSubscriptionsRef.current.set(key, { scope, subscription });
  }, [appAuth.privateSession]);

  useEffect(() => () => {
    for (const entry of cleanupSubscriptionsRef.current.values()) entry.subscription.stop();
    cleanupSubscriptionsRef.current.clear();
    cleanupSnapshotsRef.current.clear();
  }, []);

  const approval = useReverification(async () => {
    const binding = approvalBindingRef.current;
    const current = clerkRef.current;
    if (!binding || !current || current.subject !== binding.subject || current.sessionId !== binding.sessionId) {
      throw new Error("account_changed");
    }
    const response = await fetch("/api/privacy/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "account_delete" }),
    });
    const body = await response.json().catch(() => ({})) as { proof?: unknown };
    const after = clerkRef.current;
    if (!after || after.subject !== binding.subject || after.sessionId !== binding.sessionId) throw new Error("account_changed");
    if (!response.ok) return new Response(JSON.stringify(body), { status: response.status, headers: { "Content-Type": "application/json" } });
    if (typeof body.proof !== "string") throw new Error("approval_failed");
    return { proof: body.proof };
  });

  const makeCoordinator = useCallback((access: PrivateSessionAccess, options: AccountDeletionStartOptions, signal: CapturedDeletionSignal) => {
    const deletionBindingRef: { current: CurrentClerkSession | null } = { current: null };
    let journalRecord: DeletionJournalRecord | null = null;
    let analyticsStopped = false;
    let submissionStarted = false;
    const coordinator = createDeletionRequestCoordinator({
      access,
      getCurrentClerkSession: () => clerkRef.current,
      callbacks: {
        requestApproval: async (binding) => {
          deletionBindingRef.current = binding;
          approvalBindingRef.current = binding;
          const result = await approval();
          if (!result || result instanceof Response || typeof result !== "object" || typeof (result as { proof?: unknown }).proof !== "string") return null;
          return (result as { proof: string }).proof;
        },
        exchangeApproval: async (proof) => {
          const result = await exchange({ proof, purpose: "account_delete" });
          if (!isApprovalExchange(result) || !("grantId" in result)) return null;
          return { grantId: result.grantId };
        },
        submitDeletion: async (input) => {
          const binding = deletionBindingRef.current;
          const current = clerkRef.current;
          if (!binding || !current || current.subject !== binding.subject || current.sessionId !== binding.sessionId) return { status: "rejected" as const, code: "unauthorized" as const };
          setState({ kind: "submitting", requestId: input.requestId, grantId: input.grantId });
          if (!submissionStarted && !access.isCurrent()) return { status: "rejected" as const, code: "unauthorized" as const };
          if (!analyticsStopped) {
            analyticsStopped = true;
            try { await options.stopAnalytics(); } catch { /* deletion must continue; analytics is fenced by scope */ }
          }
          const afterStop = clerkRef.current;
          if (!afterStop || afterStop.subject !== binding.subject || afterStop.sessionId !== binding.sessionId) return { status: "rejected" as const, code: "unauthorized" as const };
          if (!submissionStarted && !access.isCurrent()) return { status: "rejected" as const, code: "unauthorized" as const };
          if (!submissionStarted) {
            if (!journalRecord) journalRecord = Object.freeze({
              version: 1 as const,
              requestId: input.requestId,
              grantId: input.grantId,
              subject: binding.subject,
              sessionId: binding.sessionId,
              createdAt: Date.now(),
              phase: "submitting" as const,
            });
            const persisted = getJournal().write(journalRecord);
            if (persisted.kind !== "written") {
              setPersistenceError(true);
              return { status: "unknown" as const };
            }
            setPersistenceError(false);
            journalRecord = persisted.record;
            submissionStarted = true;
          }
          const result = await requestDeletion({ grantId: input.grantId, requestId: input.requestId });
          if (!isDeletionMutationResult(result) || result.requestId !== input.requestId) return { status: "unknown" as const };
          const acceptedRecord = journalRecord ?? {
            version: 1 as const,
            requestId: input.requestId,
            grantId: input.grantId,
            subject: binding.subject,
            sessionId: binding.sessionId,
            createdAt: Date.now(),
            phase: "submitting" as const,
          };
          getJournal().updatePhase(acceptedRecord, "accepted");
          signal.publish();
          setState({ kind: "accepted", requestId: result.requestId, grantId: input.grantId, cleanup: "retry" });
          return { status: result.status, requestId: result.requestId };
        },
        captureCleanup: options.captureCleanup,
      },
    });
    coordinatorRef.current = coordinator;
    return coordinator;
  }, [approval, exchange, getJournal, requestDeletion]);

  const publishSnapshot = useCallback(() => {
    const next = coordinatorRef.current?.snapshot() ?? emptyState;
    setState(next);
    return next;
  }, []);

  const getRecovery = useCallback(() => {
    if (!recoveryRef.current) {
      recoveryRef.current = createDeletionRecovery({
        journal: getJournal(),
        getCurrentClerkSession: () => clerkRef.current,
        queryReceipt: async (pair) => convexRef.current.query(recoveryReceiptRef, { requestId: pair.requestId, grantId: pair.grantId }),
        replay: async (pair) => {
          const before = clerkRef.current;
          if (!before || before.subject !== pair.subject || before.sessionId !== pair.sessionId) return "unknown";
          let result: unknown;
          try {
            result = await requestDeletionRef.current({ grantId: pair.grantId, requestId: pair.requestId });
          } catch {
            return "unknown";
          }
          const after = clerkRef.current;
          if (!after || after.subject !== pair.subject || after.sessionId !== pair.sessionId) return "unknown";
          if (!isDeletionMutationResult(result) || result.requestId !== pair.requestId) return "unknown";
          return result.status;
        },
      });
    }
    return recoveryRef.current;
  }, [getJournal]);

  const retryRecoveredCleanup = useCallback(async (record: DeletionJournalRecord): Promise<DeletionRequestResult> => {
    if (recoveryCleanupInFlightRef.current) return recoveryCleanupInFlightRef.current;
    const run = async (): Promise<DeletionRequestResult> => {
    const before = clerkRef.current;
    if (!before || before.subject !== record.subject || before.sessionId !== record.sessionId) return { kind: "cancelled", reason: "account_changed" };
    let result: Awaited<ReturnType<typeof runDeletionRecoveryCleanup>>;
    try {
      result = await runDeletionRecoveryCleanup({
        journal: record,
        getCurrentClerkSession: () => clerkRef.current,
        queryReceipt: async (pair) => convexRef.current.query(recoveryReceiptRef, pair),
      });
    } catch {
      result = { kind: "retry", reason: "storage-failure" };
    }
    const after = clerkRef.current;
    if (!after || after.subject !== record.subject || after.sessionId !== record.sessionId) {
      return { kind: "cancelled", reason: "account_changed" };
    }
    if (result.kind === "cleared") {
      const next = { kind: "accepted" as const, requestId: record.requestId, grantId: record.grantId, cleanup: "cleared" as const };
      setState(next);
      return next;
    }
    const next = { kind: "accepted" as const, requestId: record.requestId, grantId: record.grantId, cleanup: "retry" as const };
    setState(next);
    return next;
    };
    const promise = run();
    recoveryCleanupInFlightRef.current = promise;
    void promise.finally(() => {
      if (recoveryCleanupInFlightRef.current === promise) recoveryCleanupInFlightRef.current = null;
    });
    return promise;
  }, []);

  const start = useCallback(async (confirmed: boolean, options: AccountDeletionStartOptions) => {
    if (!confirmed) {
      const result = coordinatorRef.current ? await coordinatorRef.current.request(false) : { kind: "cancelled" as const, reason: "not_confirmed" as const };
      setState(result);
      return result;
    }
    if (recovery && recovery.kind === "accepted") {
      if (state.kind === "accepted" && state.cleanup === "cleared") return state;
      return retryRecoveredCleanup(recovery.record);
    }
    if (recovery && recovery.kind === "retryable") {
      const result = await getRecovery().retry();
      applyRecovery(result);
      return recoveryToRequestResult(result);
    }
    const existing = coordinatorRef.current;
    if (existing && boundSession && (!clerkRef.current || clerkRef.current.subject !== boundSession.subject || clerkRef.current.sessionId !== boundSession.sessionId)) {
      // Keep the former account's coordinator available for a late response or
      // retry. A different signed-in account cannot adopt that request.
      return { kind: "cancelled" as const, reason: "account_changed" as const };
    }
    if (existing && ["approving", "submitting", "unknown", "accepted"].includes(existing.snapshot().kind)) {
      const promise = existing.request(true);
      setState(existing.snapshot());
      const result = await promise;
      if (coordinatorRef.current === existing) publishSnapshot();
      return result;
    }
    const access = accessRef.current;
    if (!access || !access.isCurrent() || !clerkRef.current || access.identity.subject !== clerkRef.current.subject || access.identity.sessionId !== clerkRef.current.sessionId) {
      const result = { kind: "cancelled" as const, reason: "account_changed" as const };
      setState(result);
      return result;
    }
    const signal = options.captureSignal();
    if (!signal) {
      const result = { kind: "cancelled" as const, reason: "account_changed" as const };
      setState(result);
      return result;
    }
    const coordinator = makeCoordinator(access, options, signal);
    coordinatorRef.current = coordinator;
    const binding = { subject: access.identity.subject, sessionId: access.identity.sessionId };
    setBoundSession(binding);
    const promise = coordinator.request(true);
    setState(coordinator.snapshot());
    const result = await promise;
    if (coordinatorRef.current === coordinator) publishSnapshot();
    return result;
  }, [applyRecovery, boundSession, getRecovery, makeCoordinator, publishSnapshot, recovery, retryRecoveredCleanup]);

  const retry = useCallback(async () => {
    if (recovery && recovery.kind === "accepted") {
      if (state.kind === "accepted" && state.cleanup === "cleared") return state;
      return retryRecoveredCleanup(recovery.record);
    }
    if (recovery && recovery.kind === "retryable") {
      const result = await getRecovery().retry();
      applyRecovery(result);
      return recoveryToRequestResult(result);
    }
    const coordinator = coordinatorRef.current;
    if (!coordinator) return emptyState;
    const result = await coordinator.retry();
    if (coordinatorRef.current === coordinator) publishSnapshot();
    return result;
  }, [applyRecovery, getRecovery, publishSnapshot, recovery, retryRecoveredCleanup, state]);

  /**
   * Retries only a captured accepted request's browser cleanup after sign-out.
   * This path has no server or recovery-journal capability and returns no
   * account-bound identifiers to its caller.
  */
  const retryLocalCleanup = useCallback(async (): Promise<LocalCleanupRetryResult> => {
    const authState = clerkAuthStateRef.current;
    if (!authState.isLoaded || authState.isSignedIn) return { kind: "unavailable" };
    const bound = boundSessionRef.current;
    const activeScope = lastVerifiedCleanupScopeRef.current;
    if (!bound || !activeScope || bound.subject !== activeScope.subject || bound.sessionId !== activeScope.sessionId) return { kind: "unavailable" };
    const coordinator = coordinatorRef.current;
    if (!coordinator) return { kind: "unavailable" };
    const before = coordinator.snapshot();
    if (before.kind !== "accepted") return { kind: "unavailable" };
    if (before.cleanup === "cleared") return { kind: "cleared" };
    await coordinator.retryCleanup();
    if (coordinatorRef.current === coordinator) publishSnapshot();
    const after = coordinator.snapshot();
    return after.kind === "accepted" ? { kind: after.cleanup } : { kind: "unavailable" };
  }, [publishSnapshot]);

  const retryRegistryCleanup = useCallback(async (scope: DeletionCleanupScope): Promise<void> => {
    const authState = clerkAuthStateRef.current;
    if (!authState.isLoaded) return;
    const current = clerkRef.current;
    const key = cleanupScopeKey(scope);
    const currentScope = lastVerifiedCleanupScopeRef.current;
    if (!currentScope || cleanupScopeKey(currentScope) !== key) return;
    const allowed = authState.isSignedIn
      ? Boolean(current && current.subject === scope.subject && current.sessionId === scope.sessionId)
      : Boolean(!current);
    if (!allowed) return;
    const retained = cleanupSubscriptionsRef.current.get(key);
    if (!retained || cleanupScopeKey(retained.scope) !== key) return;
    await retryAccountDeletionCleanup(scope);
  }, []);

  useEffect(() => {
    if (!clerk.isLoaded || !clerk.isSignedIn || !clerkRef.current || coordinatorRef.current) return;
    let alive = true;
    const recoveryCoordinator = getRecovery();
    void recoveryCoordinator.reconcile().then((result) => {
      if (alive) applyRecovery(result);
    });
    return () => { alive = false; };
  }, [applyRecovery, clerk.isLoaded, clerk.isSignedIn, clerk.sessionId, clerk.userId, getRecovery]);

  useEffect(() => {
    if (!coordinatorRef.current) return;
    setState(coordinatorRef.current.snapshot());
  }, [appAuth.privateSession, clerk.userId, clerk.sessionId]);

  const currentClerk = clerk.isLoaded && clerk.isSignedIn && clerk.userId && clerk.sessionId ? { subject: clerk.userId, sessionId: clerk.sessionId } : null;
  const visibleForCurrent = Boolean(!boundSession || (currentClerk && currentClerk.subject === boundSession.subject && currentClerk.sessionId === boundSession.sessionId));
  const shouldReadStatus = Boolean(visibleForCurrent && clerk.isLoaded && clerk.isSignedIn && (state.kind === "accepted" || state.kind === "unknown" || state.kind === "submitting"));
  const serverStatus = useDeletionStatus(convex, shouldReadStatus);
  const signedOut = Boolean(clerk.isLoaded && !clerk.isSignedIn);
  const localCleanup = coordinatorRef.current && state.kind === "accepted" ? state.cleanup : null;
  const registryScope = currentClerk && lastVerifiedCleanupScopeRef.current &&
    lastVerifiedCleanupScopeRef.current.subject === currentClerk.subject &&
    lastVerifiedCleanupScopeRef.current.sessionId === currentClerk.sessionId
    ? lastVerifiedCleanupScopeRef.current
    : signedOut ? lastVerifiedCleanupScopeRef.current : null;
  const registrySnapshot = snapshotForScope(cleanupSnapshots, registryScope);
  const signedOutFormerSession = Boolean(signedOut && boundSession && registryScope &&
    boundSession.subject === registryScope.subject && boundSession.sessionId === registryScope.sessionId);
  const displayedLocalCleanup = signedOut ? (signedOutFormerSession ? localCleanup : null) : localCleanup;
  useEffect(() => {
    if (state.kind !== "accepted" || state.cleanup !== "cleared" || serverStatus?.status !== "completed" ||
      !visibleForCurrent || !boundSession || !currentClerk ||
      currentClerk.subject !== boundSession.subject || currentClerk.sessionId !== boundSession.sessionId) return;
    const journal = getJournal();
    const stored = journal.read(currentClerk);
    if (stored.kind !== "ok" || stored.record.requestId !== state.requestId || stored.record.grantId !== state.grantId ||
      stored.record.subject !== boundSession.subject || stored.record.sessionId !== boundSession.sessionId) return;
    journal.clear(stored.record);
  }, [boundSession, currentClerk?.sessionId, currentClerk?.subject, getJournal, serverStatus?.status, state, visibleForCurrent]);
  const value = useMemo<AccountDeletionContextValue>(() => ({ state, serverStatus, visibleForCurrent, recovery, start, retry, retryLocalCleanup }), [recovery, retry, retryLocalCleanup, serverStatus, start, state, visibleForCurrent]);
  return <AccountDeletionContext.Provider value={value}><AccountDeletionProgress persistenceError={persistenceError} signedOut={signedOut} localCleanup={displayedLocalCleanup} registrySnapshot={registrySnapshot} retryLocalCleanup={retryLocalCleanup} retryRegistryCleanup={retryRegistryCleanup} />{children}</AccountDeletionContext.Provider>;
}

function AccountDeletionProgress({
  persistenceError = false,
  signedOut = false,
  localCleanup = null,
  registrySnapshot = null,
  retryLocalCleanup,
  retryRegistryCleanup,
}: {
  persistenceError?: boolean;
  signedOut?: boolean;
  localCleanup?: "retry" | "cleared" | null;
  registrySnapshot?: DeletionCleanupSnapshot | null;
  retryLocalCleanup: () => Promise<LocalCleanupRetryResult>;
  retryRegistryCleanup: (scope: DeletionCleanupScope) => Promise<void>;
}) {
  const { state, serverStatus, visibleForCurrent, retry } = useAccountDeletion();
  const registryRetry = registrySnapshot?.status === "retry";
  const registryPending = registrySnapshot?.status === "pending";
  const registryCleared = registrySnapshot?.status === "cleared";
  const localRetry = localCleanup === "retry";
  const hasSignedOutProgress = Boolean(localCleanup || registryRetry || registryPending || registryCleared);
  if (signedOut && hasSignedOutProgress) {
    const message = registryRetry
      ? "Some private copies still need clearing in this browser."
      : registryPending
        ? "Private cleanup is still in progress in this browser. Server deletion status is unavailable while signed out."
        : localRetry
        ? "Deletion was accepted. This browser still has private copies to clear."
        : registryCleared || localCleanup === "cleared"
          ? "Local browser cleanup completed. Server deletion status is unavailable while signed out."
          : "Private cleanup is still in progress in this browser. Server deletion status is unavailable while signed out.";
    return <aside aria-label="Local deletion cleanup" className="mx-auto w-full max-w-[560px] px-4 pb-3 text-sm text-ink">
      <p role="status" className="leading-relaxed">{message}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {registryRetry && registrySnapshot ? <button type="button" onClick={() => void retryRegistryCleanup(registrySnapshot.scope)} className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">Retry browser cleanup</button> : localRetry ? <button type="button" onClick={() => void retryLocalCleanup()} className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">Retry local cleanup</button> : null}
      </div>
    </aside>;
  }
  const hasStateProgress = state.kind === "accepted" || state.kind === "unknown" || state.kind === "submitting" || state.kind === "approving";
  if (!visibleForCurrent || (!hasStateProgress && !registryRetry && !registryPending && !registryCleared)) return null;
  const coordinatorRetry = state.kind === "accepted" && state.cleanup === "retry";
  const serverDone = serverStatus?.status === "completed";
  const message = state.kind === "approving"
    ? "Verify your identity to continue. Nothing has been submitted yet."
    : state.kind === "unknown"
    ? persistenceError
      ? "This browser could not save the deletion request, so nothing was submitted. Retry to try again."
      : "We could not confirm whether deletion started. Retry this request to check its status."
    : state.kind === "submitting"
      ? "Sending the deletion request…"
      : registryRetry
        ? "Some browser copies still need cleanup."
        : registryPending
          ? "Deletion is pending while browser copies are being cleared across tabs."
          : coordinatorRetry
            ? "The server accepted deletion, but this browser still has private copies to clear."
        : serverDone
          ? "Deletion is complete on the server. This browser has cleared its private copies."
          : registryCleared
            ? "Local browser cleanup completed. Server deletion status is still being confirmed."
          : serverStatus?.needsAttention
            ? "Deletion is pending and needs support attention. Your account access remains restricted while cleanup finishes."
            : "Deletion is pending. Your account access remains restricted while provider cleanup finishes.";
  return <aside aria-label="Account deletion progress" className="mx-auto w-full max-w-[560px] px-4 pb-3 text-sm text-ink">
    <p role="status" className="leading-relaxed">{message}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {registryRetry && registrySnapshot ? <button type="button" onClick={() => void retryRegistryCleanup(registrySnapshot.scope)} className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">Retry browser cleanup</button> : coordinatorRetry || state.kind === "unknown" ? <button type="button" onClick={() => void retry()} className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">Retry</button> : null}
    </div>
  </aside>;
}

export function AccountDeletionProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth.configured) return <AccountDeletionContext.Provider value={{ state: emptyState, serverStatus: null, visibleForCurrent: false, recovery: null, start: async () => ({ kind: "cancelled", reason: "account_changed" }), retry: async () => emptyState, retryLocalCleanup: async () => ({ kind: "unavailable" }) }}>{children}</AccountDeletionContext.Provider>;
  return <ConfiguredAccountDeletionProvider>{children}</ConfiguredAccountDeletionProvider>;
}

export function useAccountDeletion(): AccountDeletionContextValue {
  return useContext(AccountDeletionContext);
}
