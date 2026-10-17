"use client";

import { useState } from "react";
import { FormError } from "@/components/mobile";
import { useLoan } from "@/lib/loanStore";
import { privateWriteError } from "@/lib/private-storage/messages";

/** A queued browser write is never presented as a confirmed account save. */
export function LoanSyncStatus() {
  const { sync, hydrated, retrySync, resolveConflict, draftDirty } = useLoan();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = !hydrated ? "Opening your private loan…" : {
    locked: "Private loan locked. Connect and sign in to open it.",
    loading: "Opening your private loan…",
    ready: sync.cachedLoan ? "Loan saved to your account." : "No saved loan is shown in this browser.",
    queued: `${sync.pendingCount} change${sync.pendingCount === 1 ? "" : "s"} waiting to sync. Keep this tab open when you reconnect.`,
    sending: "Saving changes to your account…",
    paused: "A queued change needs your attention before saving can continue.",
    "storage-error": "This browser could not open private storage. Your changes have not been saved.",
    "refresh-needed": "Checking the latest account version. Your queued changes are still pending.",
  }[sync.status];
  const run = async (choice: "keep-server" | "resubmit-local") => {
    setBusy(true);
    setError(null);
    try {
      const result = await resolveConflict(choice);
      setError(privateWriteError(result));
    } catch {
      setError("The change could not be resolved. Try again when connected.");
    } finally { setBusy(false); }
  };
  const actionClass = "min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-surface-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
  return (
    <section aria-label="Loan save status" className="my-4 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2">
      <p role="status">{text}</p>
      {draftDirty ? <p className="mt-2">Your transfer quote has unsaved edits. Use Save quote to keep them.</p> : null}
      {sync.notice ? <p className="mt-2">{sync.notice}</p> : null}
      {sync.status === "paused" ? (
        <div className="mt-3">
          <p>Using the account version discards this browser’s queued loan changes. Submitting again sends your latest local version.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={actionClass} onClick={() => void run("keep-server")}>Use account version</button>
            <button type="button" disabled={busy} className={actionClass} onClick={() => void run("resubmit-local")}>Submit local version again</button>
          </div>
        </div>
      ) : null}
      {sync.status === "refresh-needed" ? (
        <button type="button" disabled={busy} className={`${actionClass} mt-2`} onClick={async () => {
          setBusy(true);
          setError(null);
          try { setError(privateWriteError(await retrySync())); }
          catch { setError("The connection could not be restored. Try again when online."); }
          finally { setBusy(false); }
        }}>Retry connection</button>
      ) : null}
      {sync.status === "storage-error" ? (
        <div className="mt-3">
          <p>Reloading clears unsaved form edits. Changes already queued in private storage remain there.</p>
          <button type="button" className={`${actionClass} mt-2`} onClick={() => window.location.reload()}>Reload private data</button>
        </div>
      ) : null}
      <FormError>{error}</FormError>
    </section>
  );
}
