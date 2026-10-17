"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppBar, FormError, Page, Screen } from "@/components/mobile";
import { ComparisonHistoryActions } from "@/components/ComparisonHistoryActions";
import { useComparisonHistory } from "@/lib/comparison/history-provider";
import type { ComparisonHistoryRecord } from "@/lib/comparison/history-transport";

function recordTitle(record: ComparisonHistoryRecord): string {
  if (record.title) return record.title;
  const lenders = record.snapshot.offers.map((offer) => offer.lender.trim()).filter(Boolean);
  return lenders.length > 0 ? lenders.join(" vs ") : "Saved comparison";
}

function recordDate(record: ComparisonHistoryRecord): string {
  const date = new Date(record.createdAt);
  if (Number.isNaN(date.getTime())) return record.createdAt;
  return `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(date)} IST`;
}

function queueErrorMessage(code: string): string {
  if (code === "expired" || code === "invalid_timestamp") return "This saved comparison is too old to delete from this session.";
  if (code === "queue_full") return "The local deletion queue is full. Try again after it finishes pending work.";
  if (code === "locked" || code === "unauthorized") return "Your account session changed. Verify your account and try again.";
  return "The deletion could not be queued. Try again.";
}

function HistoryRecord({ record, onDelete }: { record: ComparisonHistoryRecord; onDelete: () => Promise<{ kind: "ok" } | { kind: "error"; message?: string }> }) {
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-surface px-4 py-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <Link href={`/comparisons/${encodeURIComponent(record.comparisonId)}`} className="min-w-0 flex-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <h2 className="break-words text-[15px] font-semibold text-ink">{recordTitle(record)}</h2>
          <p className="mt-1 text-[12.5px] text-ink-3">Calculated {recordDate(record)}</p>
          <p className="mt-0.5 break-words text-[11.5px] text-ink-3">Version {record.calculationVersion}</p>
        </Link>
        <ComparisonHistoryActions record={record} onDelete={onDelete} />
      </div>
    </article>
  );
}

export default function ComparisonsPage() {
  const history = useComparisonHistory();
  const [deletionError, setDeletionError] = useState<string | null>(null);

  useEffect(() => {
    history.pump();
  }, [history.pump]);

  const pending = history.pendingDeletions.filter((job) => job.status !== "deleted");

  return (
    <Screen>
      <AppBar back={{ href: "/home" }} title="Saved comparisons" />
      <Page wide>
        {history.status === "locked" ? (
          <p role="status" className="py-8 text-sm leading-relaxed text-ink-2">Verify your account to open saved comparisons.</p>
        ) : history.status === "loading" && history.records.length === 0 ? (
          <p role="status" className="py-8 text-sm leading-relaxed text-ink-2">Opening your saved comparisons…</p>
        ) : history.status === "offline" && history.records.length === 0 ? (
          <section className="rounded-2xl border border-line bg-surface-2 px-4 py-5">
            <h2 className="text-[15px] font-semibold text-ink">You are offline</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">Saved comparisons need a connection to load. Pending deletions stay queued in this browser.</p>
            <button type="button" onClick={history.refresh} className="mt-3 min-h-11 rounded-lg px-2 font-semibold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Try again</button>
          </section>
        ) : history.status === "error" ? (
          <section className="rounded-2xl border border-danger/30 bg-danger-soft px-4 py-5">
            <FormError>{history.error}</FormError>
            <button type="button" onClick={history.refresh} className="mt-3 min-h-11 rounded-lg px-2 font-semibold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Try again</button>
          </section>
        ) : history.records.length === 0 && !history.hasMore ? (
          <section className="rounded-2xl border border-line bg-surface px-4 py-6">
            <h2 className="text-[16px] font-semibold text-ink">No saved comparisons yet</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">Save a result from the comparison screen and it will appear here with the figures you recorded.</p>
            <Link href="/compare" className="mt-4 inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Compare offers</Link>
          </section>
        ) : (
          <div className="min-w-0">
            {history.status === "offline" ? <p role="status" className="rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">You are offline. Your loaded comparisons remain available, and deletion stays queued in this browser.</p> : null}
            <p className="text-[13px] text-ink-2">Your saved results, newest first.</p>
            <div className="mt-4 flex min-w-0 flex-col gap-3">
              {history.records.map((record) => (
                <HistoryRecord key={record.comparisonId} record={record} onDelete={async () => {
                  const result = await history.queueDelete(record);
                  setDeletionError(null);
                  return result.kind === "ok" ? { kind: "ok" as const } : { kind: "error" as const, message: queueErrorMessage(result.code) };
                }} />
              ))}
            </div>
            {history.hasMore ? <button type="button" onClick={history.loadMore} disabled={history.status === "loading"} className="mt-4 min-h-11 w-full rounded-xl border border-line px-4 py-3 text-[13.5px] font-medium text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">{history.status === "loading" ? "Loading…" : "Load older comparisons"}</button> : null}
          </div>
        )}

        {pending.length > 0 ? (
          <section aria-labelledby="pending-deletions" className="mt-6 rounded-xl border border-warn-line bg-warn-soft px-4 py-3.5">
            <h2 id="pending-deletions" className="text-[13.5px] font-semibold text-ink">Deletion pending</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">The selected comparison is hidden here after being queued. Other devices may still show it until the account confirms deletion.</p>
            <ul className="mt-3 space-y-2">
              {pending.map((job) => (
                <li key={job.requestId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-[12px] text-ink-2">
                  <span className="min-w-0 break-words">
                    {job.status === "paused" ? (
                      <>
                        <span className="font-medium text-ink">Needs attention.</span>{" "}
                        {job.pauseReason === "expired" ? "This deletion expired and cannot be retried." : job.pauseReason === "conflict" ? "The saved comparison changed on the server." : job.pauseReason === "deleted" ? "It was already deleted." : "The deletion needs a verified session before it can continue."}
                      </>
                    ) : job.status === "sending" ? "Deleting…" : "Queued"}
                  </span>
                  {job.status === "paused" && (job.pauseReason === "retry-exhausted" || job.pauseReason === "unauthorized") ? <button type="button" onClick={() => void history.retryDeletion(job.requestId).then((result) => { if (result.kind === "error") setDeletionError(result.code === "expired" ? "This deletion expired and cannot be retried." : "The deletion retry could not be started. Try again."); })} className="min-h-11 shrink-0 rounded-lg px-2 font-semibold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Retry</button> : null}
                </li>
              ))}
            </ul>
            {deletionError ? <p role="alert" className="mt-2 text-[12px] text-danger">{deletionError}</p> : null}
          </section>
        ) : null}
      </Page>
    </Screen>
  );
}
