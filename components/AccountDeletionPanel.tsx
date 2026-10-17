"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@/lib/auth/provider";
import { useLoan } from "@/lib/loanStore";
import { useCompare } from "@/lib/store";
import { useAnalytics } from "@/lib/analytics/provider";
import { useAccountDeletion } from "@/lib/privacy/account-deletion-provider";
import type { CapturedDeletionCleanup } from "@/lib/privacy/deletion-cleanup";
import { captureAccountDeletionSignal } from "@/lib/privacy/deletion-signal";

function captureCleanup(loan: ReturnType<typeof useLoan>, comparisons: ReturnType<typeof useCompare>): CapturedDeletionCleanup | null {
  const loanCleanup = loan.captureAccountDeletionCleanup(true);
  const comparisonCleanup = comparisons.captureAccountDeletionCleanup(true);
  if (!loanCleanup || !comparisonCleanup) return null;
  let completed = false;
  return {
    run: async () => {
      if (completed) return { kind: "cleared" as const };
      const results = await Promise.all([loanCleanup.run(), comparisonCleanup.run()]);
      if (results.some((result) => result.kind === "retry")) return { kind: "retry" as const, reasons: ["storage-failure" as const] };
      completed = true;
      return { kind: "cleared" as const };
    },
  };
}

export function AccountDeletionPanel() {
  const auth = useAuth();
  const loan = useLoan();
  const comparisons = useCompare();
  const analytics = useAnalytics();
  const deletion = useAccountDeletion();
  const [confirmation, setConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (busy || !auth.privateSession) return;
    setBusy(true);
    setError(null);
    const capturedAccess = auth.privateSession;
    const capturedAnalytics = analytics;
    try {
      const result = await deletion.start(true, {
        captureCleanup: () => captureCleanup(loan, comparisons),
        captureSignal: () => captureAccountDeletionSignal(capturedAccess, true),
        stopAnalytics: () => capturedAnalytics.withdraw(),
      });
      if (result.kind === "cancelled") {
        setError(result.reason === "approval_cancelled" ? "Reverification was cancelled. Nothing was submitted." : "Account deletion could not be started. Try again.");
      }
      setConfirmation(false);
    } catch {
      setError("Account deletion could not be started. Try again.");
    } finally {
      setBusy(false);
    }
  }, [analytics, auth.privateSession, busy, comparisons, deletion, loan]);

  if (auth.viewer !== "member" || !auth.configured) return null;
  const active = deletion.visibleForCurrent && (deletion.state.kind === "accepted" || deletion.state.kind === "unknown" || deletion.state.kind === "submitting" || deletion.state.kind === "approving");
  const buttonClass = "min-h-11 w-full rounded-lg px-4 py-3 text-sm font-medium text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

  return <section aria-label="Account deletion" className="mt-6 rounded-2xl border border-line p-4">
    <h2 className="font-semibold text-ink">Delete your account</h2>
    <p className="mt-1 text-sm leading-relaxed text-ink-3">This removes your saved loan, comparisons and feedback. Provider cleanup can take time, and downloaded files remain on your devices.</p>
    {active ? <p role="status" className="mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed text-ink-2">
      {deletion.state.kind === "approving"
        ? "Verify your identity to continue. Nothing has been submitted yet."
        : deletion.state.kind === "unknown"
        ? "We could not confirm whether deletion started. Retry this request to check its status."
        : deletion.state.kind === "submitting"
          ? "Sending the deletion request…"
          : deletion.state.cleanup === "retry"
            ? "The server accepted deletion, but this browser still has private copies to clear."
            : "Deletion is pending while provider cleanup finishes. Your account access remains restricted."}
    </p> : null}
    {!active && !confirmation ? <button type="button" onClick={() => { setError(null); setConfirmation(true); }} className={`${buttonClass} mt-3 text-danger`}>Delete my account</button> : null}
    {confirmation ? <div role="dialog" aria-label="Confirm account deletion" className="mt-3 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2">
      <h3 className="font-semibold text-ink">Confirm account deletion</h3>
      <p className="mt-2">You will need to verify your identity again. We will stop analytics, submit one deletion request, and clear this browser’s private copies after the server accepts it.</p>
      <div className="mt-3 flex flex-col gap-2">
        <button type="button" disabled={busy} className={buttonClass} onClick={() => { setConfirmation(false); setError(null); }}>Cancel</button>
        <button type="button" disabled={busy} className={`${buttonClass} text-danger`} onClick={() => void submit()}>{busy ? "Working…" : "Confirm account deletion"}</button>
      </div>
    </div> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
  </section>;
}
