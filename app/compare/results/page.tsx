"use client";

import Link from "next/link";
import { useMemo } from "react";
import { OfferBreakdown } from "@/components/OfferBreakdown";
import { ResultsTable } from "@/components/ResultsTable";
import { Notice } from "@/components/inputs";
import { compareOffers, labelFor, monthsLabel } from "@/lib/finance/comparison";
import { formatCompactINR, formatINR, formatPct } from "@/lib/finance/format";
import { recommend } from "@/lib/finance/insight";
import { allOffersReady } from "@/lib/finance/validate";
import { useCompare } from "@/lib/store";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function ResultsPage() {
  const { offers, hydrated } = useCompare();
  const ready = hydrated && allOffersReady(offers);
  const comparison = useMemo(
    () => (ready ? compareOffers(offers) : null),
    [ready, offers],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col lg:max-w-[1180px]">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/compare"
            className="-ml-1 rounded-lg px-1 py-1 text-[14px] font-medium text-ink-3 transition hover:text-ink"
          >
            ← Edit offers
          </Link>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">Results</h1>
          <div className="flex w-[70px] justify-end"><ThemeToggle /></div>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-5 pb-14 pt-5 lg:block">
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
          /* Two tracks on a wide screen, matching the surplus flow: the working
             on the left, the answer pinned on the right. Source order keeps the
             verdict first on a phone, where there is no second column to pin it
             to and burying it under a table would help nobody. */
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:gap-6">
            <div className="flex flex-col gap-3 lg:order-2 lg:sticky lg:top-[68px]">
              <Verdict comparison={comparison} />

              {comparison.notices.map((notice) => (
                <Notice key={notice.code} level={notice.level}>
                  {notice.message}
                </Notice>
              ))}
            </div>

            <div className="flex flex-col gap-4 lg:order-1">
              <ResultsTable comparison={comparison} />

              <div>
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
            </div>
          </div>
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
  const rec = recommend(comparison);
  if (!rec) return null;

  const bestName = labelFor(rec.best.offer, 0);
  const runnerName = labelFor(rec.runnerUp.offer, 1);

  if (rec.tooClose) {
    return (
      <section className="rounded-2xl border border-accent-line bg-accent-soft px-5 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
          Recommendation
        </p>
        <h2 className="mt-1.5 text-[21px] font-semibold leading-tight tracking-tight text-ink">
          These cost you effectively the same.
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
          The gap is under 0.05 percentage points of APR — smaller than the
          rounding on a single EMI. Decide on service, prepayment terms and how
          quickly each lender can disburse, not on price.
        </p>
      </section>
    );
  }

  const savings = comparison.basis.strict ? (
    <>
      Because the offers differ in size or length, the fair measure is per lakh
      borrowed:{" "}
      <span className="tnum font-semibold text-ink">
        {formatINR(Math.abs(rec.runnerUp.perLakhGapVsBest))}
      </span>{" "}
      less for every lakh.
    </>
  ) : (
    <>
      Over {monthsLabel(rec.best.derived.tenureMonths)} that is{" "}
      <span className="tnum font-semibold text-ink">
        {formatCompactINR(Math.abs(rec.runnerUp.costGapVsBest))}
      </span>{" "}
      you keep.
    </>
  );

  return (
    <section className="rounded-2xl border border-accent-line bg-accent-soft px-5 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
        Recommendation
      </p>

      <h2 className="mt-1.5 text-[21px] font-semibold leading-tight tracking-tight text-ink">
        {bestName} is the cheaper borrowing.
      </h2>

      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
        <span className="tnum font-semibold text-ink">
          {formatPct(rec.best.derived.effectiveAprPct)}
        </span>{" "}
        effective APR against{" "}
        <span className="tnum font-semibold text-ink">
          {formatPct(rec.runnerUp.derived.effectiveAprPct)}
        </span>{" "}
        — a gap of {rec.aprGap.toFixed(2)} percentage points once fees, GST and any
        bundled premium are counted.
      </p>

      <p className="mt-2.5 rounded-xl bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
        {savings}
      </p>

      {/* ---- What is actually driving it, and what would change it -------- */}
      <div className="mt-4 border-t border-accent-line/70 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
          What is driving the gap
        </p>

        {rec.headlineMisleads ? (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">
              The lowest advertised rate is not the cheapest loan here.
            </span>{" "}
            {runnerName} quotes{" "}
            <span className="tnum font-semibold text-ink">
              {formatPct(rec.runnerUp.derived.effectiveReducingRatePct)}
            </span>{" "}
            against {bestName}&apos;s{" "}
            <span className="tnum font-semibold text-ink">
              {formatPct(rec.best.derived.effectiveReducingRatePct)}
            </span>
            , and still costs more once its charges are counted. That inversion is
            the entire reason to compute an APR rather than read a brochure.
          </p>
        ) : null}

        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
          <Split rec={rec} />
        </p>

        <Lever rec={rec} bestName={bestName} runnerName={runnerName} />
      </div>
    </section>
  );
}

/** The gap, split into the part the rate causes and the part the charges cause. */
function Split({ rec }: { rec: NonNullable<ReturnType<typeof recommend>> }) {
  const charges = rec.chargesEffect;
  const rate = rec.rateEffect;

  // The runner-up holds the better rate and still loses. Saying "charges cost
  // them X of Y points" would understate it — charges cost them more than the
  // whole gap, and their rate handed some of it back.
  if (rate < -0.005) {
    return (
      <>
        Their rate is the better of the two — worth{" "}
        <span className="tnum font-semibold text-ink">
          {Math.abs(rate).toFixed(2)}
        </span>{" "}
        points in their favour — but upfront charges add{" "}
        <span className="tnum font-semibold text-ink">{charges.toFixed(2)}</span>{" "}
        and swallow it whole. The cheaper-looking loan is the dearer one.
      </>
    );
  }

  if (rec.driver === "charges") {
    return (
      <>
        Almost all of it is upfront money, not interest:{" "}
        <span className="tnum font-semibold text-ink">{charges.toFixed(2)}</span> of
        the {rec.aprGap.toFixed(2)} points comes from fees, GST and any premium
        deducted at disbursal. The rates themselves are close to level.
      </>
    );
  }
  if (rec.driver === "rate") {
    return (
      <>
        This one is the rate itself:{" "}
        <span className="tnum font-semibold text-ink">{rate.toFixed(2)}</span> of the{" "}
        {rec.aprGap.toFixed(2)} points is interest, and charges barely move it.
        Fee-haggling will not rescue the more expensive offer.
      </>
    );
  }
  return (
    <>
      It splits:{" "}
      <span className="tnum font-semibold text-ink">{rate.toFixed(2)}</span> points
      from the rate and{" "}
      <span className="tnum font-semibold text-ink">{charges.toFixed(2)}</span> from
      upfront charges. Both would have to move to change the answer.
    </>
  );
}

/** The negotiating number: what has to change for the ranking to flip. */
function Lever({
  rec,
  bestName,
  runnerName,
}: {
  rec: NonNullable<ReturnType<typeof recommend>>;
  bestName: string;
  runnerName: string;
}) {
  if (rec.feeWaiverToMatch !== null) {
    return (
      <p className="mt-3 rounded-xl border border-accent-line bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">What to ask for.</span> A waiver of{" "}
        <span className="tnum font-semibold text-ink">
          {formatINR(rec.feeWaiverToMatch)}
        </span>{" "}
        on {runnerName}&apos;s upfront charges draws them exactly level with{" "}
        {bestName}. Anything beyond that and they are the cheaper loan — and a
        processing fee is the most negotiable figure on a sanction letter.
      </p>
    );
  }

  if (rec.rateCutToMatch !== null) {
    return (
      <p className="mt-3 rounded-xl border border-accent-line bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">What to ask for.</span> Charges
        alone cannot close this — {runnerName} would need{" "}
        <span className="tnum font-semibold text-ink">
          {rec.rateCutToMatch.toFixed(2)}
        </span>{" "}
        percentage points off the rate to match {bestName}. That is a repricing,
        not a discount, so it is the harder ask.
      </p>
    );
  }

  return (
    <p className="mt-3 rounded-xl border border-accent-line bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
      <span className="font-semibold text-ink">What to ask for.</span> Nothing{" "}
      {runnerName} can waive closes this gap. {bestName} is the cheaper money on
      the terms as quoted.
    </p>
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
        <p>
          <span className="font-medium text-ink-2">Fixed or floating</span> changes
          nothing in the arithmetic here and everything about leaving early. A
          floating home loan to an individual carries no foreclosure charge by
          regulation; a fixed one typically costs 2-4% of the outstanding to close.
          An APR computed over a full schedule cannot show that, which is why it is
          asked for separately.
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
