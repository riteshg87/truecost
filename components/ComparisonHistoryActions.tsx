"use client";

import { useEffect, useRef, useState } from "react";
import type { ComparisonHistoryRecord } from "@/lib/comparison/history-transport";

export function ComparisonHistoryActions({
  record,
  onDelete,
}: {
  record: ComparisonHistoryRecord;
  onDelete: () => Promise<{ kind: "ok" } | { kind: "error"; message?: string }>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  if (!confirming) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="min-h-11 shrink-0 rounded-lg px-2 text-[13px] font-medium text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => { setError(null); setConfirming(true); }}
      >
        Delete
      </button>
    );
  }

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onDelete();
      if (result.kind === "ok") return;
      setError(result.message ?? "The deletion could not be queued. Try again.");
    } catch {
      setError("The deletion could not be queued. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={`Confirm deletion of ${record.title ?? "this comparison"}`} className="min-w-0 rounded-xl border border-warn-line bg-warn-soft px-3 py-3 text-[12.5px] leading-relaxed text-ink-2">
      <p>Delete this saved comparison? It will remain visible on other devices until the account confirms the deletion.</p>
      {error ? <p role="alert" className="mt-2 text-danger">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          ref={cancelRef}
          type="button"
          disabled={busy}
          className="min-h-11 rounded-lg px-2.5 font-medium text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          onClick={() => {
            setConfirming(false);
            window.setTimeout(() => triggerRef.current?.focus(), 0);
          }}
        >
          Keep it
        </button>
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-lg px-2.5 font-medium text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          onClick={() => void confirm()}
        >
          {busy ? "Queueing…" : "Confirm deletion"}
        </button>
      </div>
    </section>
  );
}
