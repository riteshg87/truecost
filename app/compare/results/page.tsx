"use client";

import Link from "next/link";
import { useMemo } from "react";
import { OfferBreakdown } from "@/components/OfferBreakdown";
import { ResultsTable } from "@/components/ResultsTable";
import { Notice } from "@/components/inputs";
import { compareOffers, labelFor, monthsLabel } from "@/lib/finance/comparison";
import { formatINR, formatPct } from "@/lib/finance/format";
import { allOffersReady } from "@/lib/finance/validate";
import { useCompare } from "@/lib/store";

export default function ResultsPage() {
  const { offers, hydrated } = useCompare();
  const ready = hydrated && allOffersReady(offers);
  const comparison = useMemo(
    () => (ready ? compareOffers(offers) : null),
    [ready, offers],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/compare"
            className="-ml-1 rounded-lg px-1 py-1 text-[14px] font-medium text-ink-3 transition hover:text-ink"
          >
            ← Edit offers
          </Link>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">Results</h1>
          <span className="w-[70px]" />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-5 pb-14 pt-5">
        {!hydrated ? (
          <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface-2" />
        ) : !comparison ? (
          <div className="rounded-2xl border border-line bg-surface px-5 py-8 text-center">
            <p className="text-[15px] font-semibold text-ink">Nothing to compare yet</p>
            <p className="mx-auto mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-ink-2">
              Each offer needs an amount, a rate and a tenure before the real cost
              can be worked out.
            </p>
            <Link
              href="/compare"
              className="mt-4 inline-block rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-accent-ink"
            >
              Go back to offers
            </Link>
          </div>
        ) : (
          <>
            <Verdict comparison={comparison} />

            {comparison.notices.map((notice) => (
              <Notice key={notice.code} level={notice.level}>
                {notice.message}
              </Notice>
            ))}

            <ResultsTable comparison={comparison} />

            <div className="mt-1">
              <h2 className="mb-2 px-1 text-[13px] font-medium text-ink-2">
                Offer by offer
              </h2>
              <div className="flex flex-col gap-2.5">
                {comparison.rows.map((row, index) => (
                  <OfferBreakdown key={row.offer.id} row={row} index={index} />
                ))}
              </div>
            </div>

            <Methodology />
          </>
        )}
      </main>
    </div>
  );
}

function Verdict({
  comparison,
}: {
  comparison: NonNullable<ReturnType<typeof compareOffers>>;
}) {
  const best = comparison.best;
  const runnerUp = comparison.rows[1];
  if (!best || !runnerUp) return null;

  const aprGap = runnerUp.aprGapVsBest ?? 0;
  const tooClose = Math.abs(aprGap) < 0.05;
  const bestName = labelFor(best.offer, 0);

  return (
    <section className="rounded-2xl border border-accent-line bg-accent-soft px-5 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
        {tooClose ? "Too close to call" : "Cheapest money"}
      </p>

      {tooClose ? (
        <>
          <h2 className="mt-1.5 text-[21px] font-semibold leading-tight tracking-tight text-ink">
            These cost you effectively the same.
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
            The gap is under 0.05 percentage points of APR. Decide on service,
            prepayment terms and how quickly each lender can disburse — not on
            price.
          </p>
        </>
      ) : (
        <>
          <h2 className="mt-1.5 text-[21px] font-semibold leading-tight tracking-tight text-ink">
            {bestName} is the cheaper borrowing.
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
            <span className="tnum font-semibold text-ink">
              {formatPct(best.derived.effectiveAprPct)}
            </span>{" "}
            effective APR against{" "}
            <span className="tnum font-semibold text-ink">
              {formatPct(runnerUp.derived.effectiveAprPct)}
            </span>{" "}
            — a gap of {aprGap.toFixed(2)} percentage points once fees, GST and
            any bundled premium are counted.
          </p>
          <p className="mt-2.5 rounded-xl bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
            {comparison.basis.strict ? (
              <>
                Because the offers differ in size or length, the fair measure is
                per lakh borrowed:{" "}
                <span className="tnum font-semibold text-ink">
                  {formatINR(Math.abs(runnerUp.perLakhGapVsBest))}
                </span>{" "}
                less for every lakh.
              </>
            ) : (
              <>
                Over{" "}
                {monthsLabel(best.derived.tenureMonths)} that is{" "}
                <span className="tnum font-semibold text-ink">
                  {formatINR(Math.abs(runnerUp.costGapVsBest))}
                </span>{" "}
                you keep.
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}

function Methodology() {
  return (
    <details className="rounded-2xl border border-line bg-surface-2 px-4 py-3.5">
      <summary className="cursor-pointer list-none text-[13px] font-medium text-ink-2">
        How these numbers are worked out
      </summary>
      <div className="mt-3 flex flex-col gap-2.5 text-[12.5px] leading-relaxed text-ink-3">
        <p>
          <span className="font-medium text-ink-2">Effective APR</span> is the
          internal rate of return on the actual cash flows — the money that
          reaches you at disbursal, then every EMI you pay out. Fees and GST
          reduce what you receive without reducing what you repay, which is
          exactly why they raise the APR above the quoted rate. It is reported
          as the monthly IRR annualised, so a loan with no fees comes back at
          precisely its quoted rate.
        </p>
        <p>
          <span className="font-medium text-ink-2">Flat rates</span> are
          converted by solving for the reducing-balance rate that produces the
          same EMI. There is no shortcut formula for this, which is why a flat
          quote and a reducing quote are so easy to confuse.
        </p>
        <p>
          <span className="font-medium text-ink-2">A financed premium</span> is
          added to the principal, so it accrues interest for the whole tenure.
          An upfront premium comes out of your pocket at disbursal instead.
        </p>
        <p>
          <span className="font-medium text-ink-2">
            When amounts or tenures differ
          </span>
          , total interest is set aside entirely. A longer loan always shows a
          bigger interest figure even when it is the cheaper money, so ranking
          falls to effective APR and cost per lakh.
        </p>
        <p className="border-t border-line pt-2.5">
          Figures assume EMIs are paid on schedule with no prepayment, and
          exclude any floating-rate reset. This is a calculation tool, not
          financial advice. Check every figure against the lender&apos;s sanction
          letter and Key Facts Statement before you sign.
        </p>
      </div>
    </details>
  );
}
