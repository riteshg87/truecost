"use client";

import Link from "next/link";
import { use } from "react";
import { AppBar, Page, Screen } from "@/components/mobile";
import { SavedComparisonView } from "@/components/SavedComparisonView";
import { useComparisonHistoryDetail } from "@/lib/comparison/history-provider";
import { ComparisonReportActions } from "@/components/ComparisonReportActions";
import { MemberComparisonFeedback } from "@/components/MemberComparisonFeedback";

export default function ComparisonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const detail = useComparisonHistoryDetail(id);

  return (
    <Screen>
      <AppBar back={{ href: "/comparisons" }} title="Saved result" />
      <Page wide>
        {detail.status === "loading" ? <p role="status" className="py-8 text-sm leading-relaxed text-ink-2">Opening this saved result…</p> : null}
        {detail.status === "offline" ? (
          <section className="rounded-2xl border border-line bg-surface-2 px-4 py-5"><h2 className="text-[15px] font-semibold text-ink">You are offline</h2><p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">Reconnect to open this saved comparison.</p><button type="button" onClick={detail.retry} className="mt-3 min-h-11 rounded-lg px-2 font-semibold text-accent">Try again</button></section>
        ) : null}
        {detail.status === "error" ? (
          <section className="rounded-2xl border border-danger/30 bg-danger-soft px-4 py-5"><h2 className="text-[15px] font-semibold text-ink">This result could not be opened</h2><button type="button" onClick={detail.retry} className="mt-3 min-h-11 rounded-lg px-2 font-semibold text-accent">Try again</button></section>
        ) : null}
        {detail.status === "missing" ? (
          <section className="rounded-2xl border border-line bg-surface px-4 py-6"><h2 className="text-[16px] font-semibold text-ink">Saved comparison unavailable</h2><p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">It may have been deleted from another device.</p><Link href="/comparisons" className="mt-4 inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-accent">Back to saved comparisons</Link></section>
        ) : null}
        {detail.status === "ready" && detail.record ? <><SavedComparisonView snapshot={detail.record.snapshot} /><ComparisonReportActions snapshot={detail.record.snapshot} source="saved" /><MemberComparisonFeedback resultId={detail.record.snapshot.resultId} /></> : null}
      </Page>
    </Screen>
  );
}
