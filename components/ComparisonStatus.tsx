"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCompare, type CompareActionResult } from "@/lib/store";
import { useViewLifetime } from "@/lib/use-view-lifetime";

/** One visible status surface for durable work and an interrupted sign-in return. */
export function ComparisonStatus({ actions = false, resume = true }: { actions?: boolean; resume?: boolean }) {
  const comparison = useCompare();
  const router = useRouter();
  const isCurrentView = useViewLifetime();
  const attempted = useRef<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<string | null>(null);
  const finish = (result: CompareActionResult, replace = false) => {
    if (isCurrentView() && result.kind === "ok" && result.href) {
      if (replace) router.replace(result.href); else router.push(result.href);
    }
  };
  useEffect(() => {
    if (!resume || !comparison.member || !comparison.hydrated) return;
    const requestId = new URLSearchParams(window.location.search).get("requestId");
    if (!requestId || attempted.current === requestId) return;
    attempted.current = requestId;
    void comparison.resumeIntent(requestId).then((result) => {
      if (!isCurrentView()) return;
      if (result.kind === "error") setRetryRequest(requestId);
      else { setRetryRequest(null); if (result.href) router.replace(result.href); }
    });
  }, [comparison, router, isCurrentView, resume]);
  const button = "min-h-11 rounded-lg px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
  const canRetryPaused = comparison.savePauseReason === "retry-exhausted" || comparison.savePauseReason === "unauthorized";
  const pausedMessage = comparison.savePauseReason === "retry-exhausted"
    ? "Saving paused after eight attempts. Your result remains here. Try saving again when your connection is working."
    : comparison.savePauseReason === "deleted"
      ? "This comparison has a deletion request. Check Saved comparisons for its status. You can still read these figures here."
    : comparison.savePauseReason === "unauthorized"
      ? "Your account connection needs verification before this save can continue. Your result remains here."
      : comparison.savePauseReason === "expired"
        ? "This save is too old to retry. We could not confirm whether it was saved. Keep this result open, or start a new comparison."
        : "Saving needs your attention. Your result remains here until you choose what to do next.";
  if (!actions && !comparison.message && !retryRequest) return null;
  return <section aria-label="Comparison status" className="flex flex-col gap-3 text-sm leading-relaxed text-ink-2">
    {resume && comparison.message ? <p role="status">{comparison.message}</p> : null}
    {!comparison.hydrated && comparison.message ? <button type="button" className={`${button} hover:bg-surface-2`}
      onClick={() => window.location.reload()}>Reload to verify your account</button> : null}
    {retryRequest ? <button type="button" className={`${button} bg-surface-2 hover:bg-surface-inset`} disabled={comparison.busy}
      onClick={() => void comparison.resumeIntent(retryRequest).then((result) => {
        if (!isCurrentView()) return;
        if (result.kind === "ok") setRetryRequest(null);
        finish(result, true);
      })}>Retry sign-in action</button> : null}
    {actions && comparison.snapshot ? <>
      <p role="status">{comparison.member
        ? comparison.saveStatus === "saved" ? "Saved to your account."
          : comparison.saveStatus === "sending" ? "Sending your comparison. Waiting for confirmation."
          : comparison.saveStatus === "queued" ? "Queued in this browser. It will save when you are online."
          : comparison.saveStatus === "paused" ? pausedMessage
          : "This result is kept in this browser. Save it to your account."
        : "Your first two-offer comparison is free. Sign in to save it or compare again."}</p>
      <button type="button" className={`${button} bg-accent text-accent-ink hover:brightness-95`}
        disabled={comparison.busy || !comparison.hydrated || (comparison.member && comparison.saveStatus !== "idle")}
        onClick={() => void comparison.save().then((result) => finish(result))}>
        {comparison.busy ? "Working…" : comparison.saveStatus === "saved" ? "Saved" : comparison.member ? "Save comparison" : "Sign in to save comparison"}
      </button>
      {comparison.member && comparison.saveStatus === "queued" ? <button type="button" className={`${button} hover:bg-surface-2`}
        disabled={comparison.busy} onClick={() => void comparison.retrySave()}>Retry saving</button> : null}
      {comparison.member && comparison.saveStatus === "paused" && canRetryPaused ? <button type="button" className={`${button} hover:bg-surface-2`}
        disabled={comparison.busy} onClick={() => void comparison.retrySave()}>Try saving again</button> : null}
      <button type="button" className={`${button} hover:bg-surface-2`} disabled={comparison.busy}
        onClick={() => void comparison.reset().then((result) => finish(result))}>New comparison</button>
      {!comparison.member ? <button type="button" className={`${button} hover:bg-surface-2`} disabled={comparison.busy || !comparison.hydrated}
        onClick={() => void comparison.requestReport().then((result) => finish(result))}>Sign in to download report</button> : null}
      {comparison.member ? <Link href="/comparisons" className={`${button} text-center hover:bg-surface-2`}>Saved comparisons</Link> : null}
    </> : null}
  </section>;
}
