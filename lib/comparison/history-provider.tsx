"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AUTH_CONFIG } from "@/lib/auth/config";
import { useAuth } from "@/lib/auth/provider";
import type { PrivateSessionAccess } from "@/lib/auth/private-session";
import {
  ComparisonWorkspace,
  type ComparisonWorkspaceState,
  type DeleteJob,
  type WorkspaceResult,
} from "@/lib/comparison/private-workspace";
import {
  createSessionBoundComparisonHistoryTransport,
  type ComparisonHistoryRecord,
  type ComparisonHistoryTransport,
} from "@/lib/comparison/history-transport";

export type HistoryStatus = "locked" | "loading" | "ready" | "offline" | "error";
export type HistoryDetailStatus = "loading" | "ready" | "missing" | "offline" | "error";

export interface HistoryReadResult {
  kind: "ok" | "missing" | "offline" | "error";
  record?: ComparisonHistoryRecord;
}

export interface ComparisonHistoryContextValue {
  status: HistoryStatus;
  workspaceReady: boolean;
  records: readonly ComparisonHistoryRecord[];
  pendingDeletions: readonly DeleteJob[];
  hasMore: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
  readComparison: (comparisonId: string) => Promise<HistoryReadResult>;
  queueDelete: (record: ComparisonHistoryRecord) => Promise<WorkspaceResult<{ requestId: string }>>;
  retryDeletion: (requestId: string) => Promise<WorkspaceResult<{ requestId: string }>>;
  pump: () => void;
}

const lockedContext: ComparisonHistoryContextValue = {
  status: "locked",
  workspaceReady: false,
  records: [],
  pendingDeletions: [],
  hasMore: false,
  error: null,
  refresh: () => undefined,
  loadMore: () => undefined,
  readComparison: async () => ({ kind: "error" }),
  queueDelete: async (): Promise<WorkspaceResult<{ requestId: string }>> => ({ kind: "error", code: "locked" }),
  retryDeletion: async (): Promise<WorkspaceResult<{ requestId: string }>> => ({ kind: "error", code: "locked" }),
  pump: () => undefined,
};

const HistoryContext = createContext<ComparisonHistoryContextValue>(lockedContext);

type HistoryWorkspace = ComparisonWorkspace & {
  queueDelete: (input: { resultId: string; comparisonId?: string | null; requestId?: string; createdAt?: string }) => Promise<WorkspaceResult<{ requestId: string }>>;
  retryPausedDelete: (requestId: string) => Promise<WorkspaceResult<{ requestId: string }>>;
};

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function readErrorMessage(code: string): string {
  if (code === "offline" || code === "network" || code === "timeout") return "Your saved comparisons could not be reached. Check your connection and try again.";
  if (code === "unauthorized" || code === "locked") return "Your account session changed. Verify your account and try again.";
  if (code === "deleted") return "This comparison has already been deleted.";
  if (code === "rate_limited") return "Too many requests. Wait a moment and try again.";
  return "Saved comparisons could not be opened. Try again.";
}

function useHistoryWorkspace(access: PrivateSessionAccess, tabId: string) {
  const [status, setStatus] = useState<HistoryStatus>("loading");
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [records, setRecords] = useState<readonly ComparisonHistoryRecord[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<readonly DeleteJob[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(isOnline);
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const runtime = useRef({ alive: false, serial: 0 });
  const workspaceRef = useRef<HistoryWorkspace | null>(null);
  const workspaceOpenRef = useRef<Promise<WorkspaceResult<void>> | null>(null);
  const transportRef = useRef<ComparisonHistoryTransport | null>(null);
  const inFlight = useRef<number | null>(null);
  const hiddenResultIds = useRef(new Set<string>());

  const current = useCallback((serial: number) => runtime.current.alive && runtime.current.serial === serial && access.isCurrent(), [access]);

  useEffect(() => {
    runtime.current = { alive: true, serial: runtime.current.serial + 1 };
    const serial = runtime.current.serial;
    let stopWorkspace: (() => void) | undefined;
    const historyTransport = createSessionBoundComparisonHistoryTransport({
      url: AUTH_CONFIG.convexUrl ?? "",
      identity: access.identity,
      getToken: access.getToken,
      isCurrent: access.isCurrent,
    });
    transportRef.current = historyTransport;
    const workspace = new ComparisonWorkspace({
      access,
      tabId,
      historyTransport,
    }) as HistoryWorkspace;
    workspaceRef.current = workspace;
    const publish = (state: ComparisonWorkspaceState) => {
      if (!current(serial)) return;
      setPendingDeletions(state.deletions);
      if (state.status === "storage-error") {
        setStatus("error");
        setError("This browser could not open its private deletion queue. Try again.");
      }
    };
    stopWorkspace = workspace.subscribe(publish);
    const opening = workspace.open();
    workspaceOpenRef.current = opening;
    void opening.then((result) => {
      if (!current(serial) || result.kind !== "ok") {
        if (current(serial)) {
          setStatus("error");
          setError(result.kind === "error" ? readErrorMessage(result.code) : "Saved comparisons could not be opened. Try again.");
        }
        return;
      }
      setWorkspaceReady(true);
      publish(workspace.current());
    });
    const updateOnline = () => {
      if (current(serial)) setOnline(isOnline());
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      const ownsRuntime = runtime.current.serial === serial;
      if (ownsRuntime) {
        runtime.current.alive = false;
        runtime.current.serial += 1;
        inFlight.current = null;
      }
      stopWorkspace?.();
      workspace.close();
      if (workspaceRef.current === workspace) {
        setWorkspaceReady(false);
        workspaceRef.current = null;
        workspaceOpenRef.current = null;
        transportRef.current = null;
      }
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, [access, current, tabId]);

  const readPage = useCallback(async (nextCursor: string | null, append: boolean) => {
    const transport = transportRef.current;
    const serial = runtime.current.serial;
    if (!transport || !current(serial) || inFlight.current !== null) return;
    if (!online || !isOnline()) {
      setOnline(false);
      setStatus("offline");
      return;
    }
    inFlight.current = serial;
    setStatus("loading");
    setError(null);
    try {
      const page = await transport.listComparisons({ cursor: nextCursor, numItems: 50 });
      if (!current(serial)) return;
      setRecords((previous) => {
        const combined = append ? [...previous, ...page.page] : [...page.page];
        const seen = new Set<string>();
        return combined.filter((record) => {
          if (seen.has(record.resultId)) return false;
          seen.add(record.resultId);
          return true;
        });
      });
      setCursor(page.continueCursor || null);
      setHasMore(!page.isDone);
      setStatus("ready");
    } catch (caught) {
      if (!current(serial)) return;
      const code = caught && typeof caught === "object" && "code" in caught ? String((caught as { code: unknown }).code) : "network";
      setStatus(code === "unauthorized" ? "locked" : !isOnline() || code === "offline" ? "offline" : "error");
      setError(readErrorMessage(code));
    } finally {
      if (inFlight.current === serial) inFlight.current = null;
    }
  }, [current, online]);

  useEffect(() => {
    if (online) {
      void readPage(null, false);
      void workspaceRef.current?.pump();
    }
    else setStatus("offline");
  }, [online, readPage]);

  const refresh = useCallback(() => {
    if (!current(runtime.current.serial)) return;
    setCursor(null);
    setHasMore(false);
    void readPage(null, false);
  }, [current, readPage]);

  const loadMore = useCallback(() => {
    if (hasMore && cursor) void readPage(cursor, true);
  }, [cursor, hasMore, readPage]);

  const readComparison = useCallback(async (comparisonId: string): Promise<HistoryReadResult> => {
    const transport = transportRef.current;
    const serial = runtime.current.serial;
    if (!transport || !current(serial)) return { kind: "error" };
    if (!isOnline()) return { kind: "offline" };
    try {
      const record = await transport.getComparison(comparisonId);
      if (!current(serial)) return { kind: "error" };
      return record ? { kind: "ok", record } : { kind: "missing" };
    } catch (caught) {
      if (!current(serial)) return { kind: "error" };
      const code = caught && typeof caught === "object" && "code" in caught ? String((caught as { code: unknown }).code) : "network";
      return { kind: code === "unauthorized" ? "error" : !isOnline() ? "offline" : "error" };
    }
  }, [current]);

  const queueDelete = useCallback(async (record: ComparisonHistoryRecord): Promise<WorkspaceResult<{ requestId: string }>> => {
    const workspace = workspaceRef.current;
    const opening = workspaceOpenRef.current;
    const serial = runtime.current.serial;
    if (!workspace || !opening || !current(serial)) return { kind: "error", code: "locked" as const };
    const opened = await opening;
    if (opened.kind !== "ok" || !current(serial)) return { kind: "error", code: opened.kind === "error" ? opened.code : "locked" };
    const result = await workspace.queueDelete({ resultId: record.resultId, comparisonId: record.comparisonId });
    if (current(serial) && result.kind === "ok") {
      hiddenResultIds.current.add(record.resultId);
      setHiddenVersion((value) => value + 1);
      if (isOnline()) void workspace.pump();
    }
    return result;
  }, [current]);

  const retryDeletion = useCallback(async (requestId: string): Promise<WorkspaceResult<{ requestId: string }>> => {
    const workspace = workspaceRef.current;
    const opening = workspaceOpenRef.current;
    const serial = runtime.current.serial;
    if (!workspace || !opening || !current(serial)) return { kind: "error", code: "locked" as const };
    const opened = await opening;
    if (opened.kind !== "ok" || !current(serial)) return { kind: "error", code: opened.kind === "error" ? opened.code : "locked" };
    const result = await workspace.retryPausedDelete(requestId);
    if (current(serial) && result.kind === "ok") void workspace.pump();
    return result;
  }, [current]);

  const pump = useCallback(() => {
    if (current(runtime.current.serial)) void workspaceRef.current?.pump();
  }, [current]);

  const visibleRecords = useMemo(() => {
    const pending = new Set(pendingDeletions.map((job) => job.resultId));
    return records.filter((record) => !pending.has(record.resultId) && !hiddenResultIds.current.has(record.resultId));
  }, [hiddenVersion, pendingDeletions, records]);

  return useMemo(() => ({ status, workspaceReady, records: visibleRecords, pendingDeletions, hasMore, error, refresh, loadMore, readComparison, queueDelete, retryDeletion, pump }), [error, hasMore, loadMore, pendingDeletions, pump, queueDelete, readComparison, records, refresh, retryDeletion, status, visibleRecords, workspaceReady]);
}

function ScopedHistoryProvider({ children, access, tabId }: { children: ReactNode; access: PrivateSessionAccess; tabId: string }) {
  const value = useHistoryWorkspace(access, tabId);
  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

export function HistoryProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const access = auth.ready && auth.viewer === "member" && auth.privateSession?.isCurrent() ? auth.privateSession : null;
  const scope = access ? `${access.identity.profileId}:${access.identity.sessionId}:${access.identity.authEpoch}` : "locked";
  if (!access) return <HistoryContext.Provider value={lockedContext}>{children}</HistoryContext.Provider>;
  return <ScopedHistoryProvider key={scope} access={access} tabId={auth.initiatingTabId}>{children}</ScopedHistoryProvider>;
}

export function useComparisonHistory(): ComparisonHistoryContextValue {
  return useContext(HistoryContext);
}

export function useComparisonHistoryDetail(comparisonId: string): { status: HistoryDetailStatus; record: ComparisonHistoryRecord | null; retry: () => void } {
  const history = useComparisonHistory();
  const [state, setState] = useState<{ comparisonId: string; status: HistoryDetailStatus; record: ComparisonHistoryRecord | null }>({ comparisonId, status: "loading", record: null });
  const [retryNonce, setRetryNonce] = useState(0);
  const request = useRef(0);
  const retry = useCallback(() => { request.current += 1; setState({ comparisonId, status: "loading", record: null }); setRetryNonce((value) => value + 1); }, [comparisonId]);
  const { readComparison, workspaceReady } = history;

  useEffect(() => {
    const requestId = ++request.current;
    let cancelled = false;
    setState({ comparisonId, status: "loading", record: null });
    if (!workspaceReady) return () => { cancelled = true; };
    void readComparison(comparisonId).then((result) => {
      if (cancelled || request.current !== requestId) return;
      if (result.kind === "ok") setState({ comparisonId, status: "ready", record: result.record ?? null });
      else if (result.kind === "missing") setState({ comparisonId, status: "missing", record: null });
      else if (result.kind === "offline") setState({ comparisonId, status: "offline", record: null });
      else setState({ comparisonId, status: "error", record: null });
    });
    return () => { cancelled = true; };
  }, [comparisonId, readComparison, retryNonce, workspaceReady]);

  if (state.comparisonId !== comparisonId) return { status: "loading", record: null, retry };
  return { status: state.status, record: state.record, retry };
}
