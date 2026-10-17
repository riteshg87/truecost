"use client";

import { useEffect, useRef, useState } from "react";

export type PrivateBrowserClearOutcome =
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "cleared" }>
  | Readonly<{ kind: "retry" }>;

export interface PrivateBrowserClearAvailability {
  readonly isLoaded: boolean;
  readonly isSignedOut: boolean;
  /** Remains false after an account transition, including a later sign-out. */
  readonly isCurrent: boolean;
}

export interface PrivateBrowserClearPanelProps {
  /** Read the current Clerk availability at the moment an action is invoked. */
  readonly availability: () => PrivateBrowserClearAvailability;
  /** Clears all member private browser data and returns an aggregate outcome. */
  readonly onClear: () => Promise<PrivateBrowserClearOutcome>;
}

type PanelStatus = "retry" | "cleared" | null;

function isAvailable(readAvailability: () => PrivateBrowserClearAvailability): boolean {
  const current = readAvailability();
  return current.isLoaded && current.isSignedOut && current.isCurrent;
}

export function PrivateBrowserClearPanel({ availability, onClear }: PrivateBrowserClearPanelProps) {
  const current = availability();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PanelStatus>(null);
  const inFlightRef = useRef(false);
  const availabilityGenerationRef = useRef(0);
  const previousAvailabilityRef = useRef<PrivateBrowserClearAvailability | null>(null);
  const restoreFocusRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = previousAvailabilityRef.current;
    if (previous && (previous.isLoaded !== current.isLoaded || previous.isSignedOut !== current.isSignedOut || previous.isCurrent !== current.isCurrent)) {
      availabilityGenerationRef.current += 1;
      setStatus(null);
      restoreFocusRef.current = false;
    }
    previousAvailabilityRef.current = current;
    if (!confirming) return;
    if (!isAvailable(availability)) {
      setConfirming(false);
      if (!inFlightRef.current) setBusy(false);
      return;
    }
    cancelRef.current?.focus();
  }, [availability, confirming, current.isCurrent, current.isLoaded, current.isSignedOut]);

  useEffect(() => {
    if (!confirming && !busy && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [busy, confirming]);

  if (!current.isLoaded || !current.isSignedOut || !current.isCurrent) return null;

  const closeConfirmation = () => {
    if (busy) return;
    setConfirming(false);
    setStatus(null);
  };

  const confirmClear = async () => {
    if (busy || inFlightRef.current) return;
    if (!isAvailable(availability)) {
      setConfirming(false);
      return;
    }
    const generation = availabilityGenerationRef.current;
    inFlightRef.current = true;
    setBusy(true);
    setStatus(null);
    try {
      const result = await onClear();
      if (generation !== availabilityGenerationRef.current || !isAvailable(availability)) return;
      if (result.kind === "cleared") {
        setStatus("cleared");
        setConfirming(false);
      } else if (result.kind === "retry") {
        setStatus("retry");
        setConfirming(false);
      } else {
        setConfirming(false);
      }
    } catch {
      if (generation === availabilityGenerationRef.current && isAvailable(availability)) {
        setStatus("retry");
        setConfirming(false);
      }
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  return <section aria-label="Clear private browser data" className="mt-6 rounded-2xl border border-line bg-surface-2 p-4 text-sm leading-relaxed text-ink-2">
    <h2 className="font-semibold text-ink">Clear private browser data</h2>
    <p className="mt-1">Remove member-only saved copies and unsynced queues from this browser. Your guest result stays available.</p>
    {status === "retry" ? <p role="alert" className="mt-3 text-danger">Some private browser data could not be cleared. Try again to finish.</p> : null}
    {status === "cleared" ? <p role="status" className="mt-3 text-ink">Private browser data was cleared. Cloud data and downloaded files are unchanged.</p> : null}
    {!confirming ? <button ref={triggerRef} type="button" onClick={() => { restoreFocusRef.current = true; setStatus(null); setConfirming(true); }} className="mt-3 min-h-11 rounded-lg px-4 py-2 font-medium text-danger hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{status === "retry" ? "Try again" : "Clear private browser data"}</button> : null}
    {confirming ? <div ref={dialogRef} role="dialog" aria-modal="false" aria-labelledby="private-browser-clear-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); closeConfirmation(); } }} className="mt-3 rounded-xl bg-surface p-4 text-ink">
      <h3 id="private-browser-clear-title" className="font-semibold">Confirm browser data removal</h3>
      <p className="mt-2">This removes all member private saved copies and unsynced queues for every account on this browser. Your guest result stays available. Cloud data and downloaded files are unaffected. A minimal deletion recovery record remains.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row-reverse">
        <button ref={confirmRef} type="button" disabled={busy} onClick={() => void confirmClear()} className="min-h-11 rounded-lg bg-danger px-4 py-2 font-medium text-danger-ink hover:bg-danger/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60">{busy ? "Clearing…" : "Confirm and clear"}</button>
        <button ref={cancelRef} type="button" disabled={busy} onClick={closeConfirmation} className="min-h-11 rounded-lg px-4 py-2 font-medium text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60">Cancel</button>
      </div>
    </div> : null}
  </section>;
}
