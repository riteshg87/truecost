"use client";

import { usePathname } from "next/navigation";
import { useAuth as useClerkAuth } from "@clerk/nextjs";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { PrivateBrowserClearPanel, type PrivateBrowserClearAvailability, type PrivateBrowserClearOutcome } from "@/components/PrivateBrowserClearPanel";
import { useAuth } from "@/lib/auth/provider";
import { useOptionalAnalytics, type MemberAnalyticsLocalCleanupResult } from "@/lib/analytics/provider";
import { clearAllMemberPrivateBrowserData } from "./private-browser-clear";
import { publishPrivateBrowserClearSignal } from "./private-browser-clear-signal";

export interface PrivateBrowserClearProviderProps {
  children: ReactNode;
  /** Matches AuthShell's configured/unconfigured branch without conditional hooks. */
  configured?: boolean;
  /** Test-only factories; production uses the browser IndexedDB implementation. */
  privateIndexedDB?: IDBFactory;
  comparisonIndexedDB?: IDBFactory;
}

export interface PrivateBrowserClearContextValue {
  readonly availability: () => PrivateBrowserClearAvailability;
  readonly onClear: () => Promise<PrivateBrowserClearOutcome>;
  readonly notificationUnavailable: boolean;
}

const PrivateBrowserClearContext = createContext<PrivateBrowserClearContextValue | null>(null);

interface BrowserClearState {
  readonly loaded: boolean;
  readonly signedOut: boolean;
  readonly key: string;
}

function BrowserClearRuntime({ children, pathname, state, privateIndexedDB, comparisonIndexedDB }: {
  children: ReactNode;
  pathname: string | null;
  state: BrowserClearState;
  privateIndexedDB?: IDBFactory;
  comparisonIndexedDB?: IDBFactory;
}) {
  const analytics = useOptionalAnalytics();
  const stateRef = useRef(state);
  stateRef.current = state;
  const lifecycleRef = useRef(state.key);
  const generationRef = useRef(0);
  const [notificationUnavailable, setNotificationUnavailable] = useState(false);
  if (lifecycleRef.current !== state.key) {
    lifecycleRef.current = state.key;
    generationRef.current += 1;
  }

  const availability = useCallback((): PrivateBrowserClearAvailability => {
    const current = stateRef.current;
    return { isLoaded: current.loaded, isSignedOut: current.signedOut, isCurrent: current.loaded && current.signedOut };
  }, []);

  const onClear = useCallback(async (): Promise<PrivateBrowserClearOutcome> => {
    const before = availability();
    if (!before.isLoaded || !before.isSignedOut || !before.isCurrent) return { kind: "retry" };
    const generation = generationRef.current;
    const current = () => {
      const next = availability();
      return generationRef.current === generation && next.isLoaded && next.isSignedOut && next.isCurrent;
    };

    // This synchronous call fences private runtime capabilities before any
    // async analytics or IndexedDB work begins.
    const notified = publishPrivateBrowserClearSignal();
    setNotificationUnavailable(!notified);
    let analyticsResult: MemberAnalyticsLocalCleanupResult = { kind: "retry", reason: "storage-unavailable" };
    try {
      if (analytics?.clearPrivateRuntime) analyticsResult = await analytics.clearPrivateRuntime();
    } catch { /* a failed analytics stage remains retryable */ }
    const storage = await clearAllMemberPrivateBrowserData({
      confirmed: true,
      isCurrent: current,
      privateIndexedDB,
      comparisonIndexedDB,
    });
    if (!current() || analyticsResult.kind === "retry" || storage.kind !== "cleared" || !notified) return { kind: "retry" };
    return { kind: "cleared" };
  }, [analytics, availability, comparisonIndexedDB, privateIndexedDB]);

  const value: PrivateBrowserClearContextValue = { availability, onClear, notificationUnavailable };
  const showPublicPanel = pathname === "/";
  return <PrivateBrowserClearContext.Provider value={value}>
    {children}
    {showPublicPanel ? <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <PrivateBrowserClearPanel availability={availability} onClear={onClear} />
      {notificationUnavailable ? <p role="alert" className="mt-2 text-center text-xs leading-relaxed text-warn">Other open tabs may not have received this browser-clear notice. Close them or try again.</p> : null}
    </div> : null}
  </PrivateBrowserClearContext.Provider>;
}

function ConfiguredBrowserClearRuntime(props: Omit<Parameters<typeof BrowserClearRuntime>[0], "state">) {
  const auth = useAuth();
  const clerk = useClerkAuth();
  const state: BrowserClearState = {
    loaded: Boolean(auth.ready && clerk.isLoaded),
    signedOut: Boolean(auth.ready && clerk.isLoaded && clerk.isSignedIn === false),
    key: `${auth.ready}:${clerk.isLoaded}:${clerk.isSignedIn}:${clerk.userId ?? ""}:${clerk.sessionId ?? ""}`,
  };
  return <BrowserClearRuntime {...props} state={state} />;
}

function UnconfiguredBrowserClearRuntime(props: Omit<Parameters<typeof BrowserClearRuntime>[0], "state">) {
  const auth = useAuth();
  const state: BrowserClearState = {
    loaded: auth.ready,
    signedOut: auth.ready && (auth.viewer === "anonymous" || auth.viewer === "guest"),
    key: `${auth.ready}:${auth.viewer}`,
  };
  return <BrowserClearRuntime {...props} state={state} />;
}

export function PrivateBrowserClearProvider({ children, configured = false, privateIndexedDB, comparisonIndexedDB }: PrivateBrowserClearProviderProps) {
  const pathname = usePathname();
  const props = { children, pathname, privateIndexedDB, comparisonIndexedDB };
  return configured ? <ConfiguredBrowserClearRuntime {...props} /> : <UnconfiguredBrowserClearRuntime {...props} />;
}

export function usePrivateBrowserClear(): PrivateBrowserClearContextValue {
  const value = useContext(PrivateBrowserClearContext);
  if (!value) throw new Error("usePrivateBrowserClear must be used inside PrivateBrowserClearProvider");
  return value;
}
