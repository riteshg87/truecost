"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, NoLoan, Screen, Verdict } from "@/components/health";
import { monthsLabel } from "@/lib/finance/comparison";
import { formatCompactINR, formatINR, formatPct } from "@/lib/finance/format";
import { prepaySnapshot, rateVerdict, transferResult } from "@/lib/health/analyse";
import { isoToday } from "@/lib/health/repo";
import { useLoan } from "@/lib/loanStore";

/**
 * What a returning user lands on.
 *
 * The rate verdict leads because it is the only thing here that can be wrong
 * without anyone noticing — a prepayment decision waits patiently, a missed
 * reset quietly bills you every month.
 */
export default function LoanHealthPage() {
  const { loan, quote, surplus, bufferMonths, rateResolvedAt, hydrated } = useLoan();
  const today = isoToday();

  const verdict = useMemo(
    () => (loan ? rateVerdict(loan, today) : null),
    [loan, today],
  );
  const prepay = useMemo(
    () => (loan ? prepaySnapshot(loan, surplus) : null),
    [loan, surplus],
  );
  const transfer = useMemo(
    () => (loan && quote.newRatePct > 0 ? transferResult(loan, quote) : null),
    [loan, quote],
  );

  if (!hydrated) {
    return (
      <Screen title="Loan health">
        <div className="h-72 animate-pulse rounded-2xl border border-line bg-surface-2" />
      </Screen>
    );
  }

  if (!loan || !verdict || !prepay) {
    return (
      <Screen title="Loan health">
        <NoLoan />
      </Screen>
    );
  }

  const resolved = rateResolvedAt !== null;
  const paid = Math.max(0, loan.original - loan.outstanding);
  const paidPct = loan.original > 0 ? (paid / loan.original) * 100 : 0;

  return (
    <Screen title="Loan health" eyebrow="On device">
      {/* The loan itself, so every figure below has its source in view. */}
      <section className="mb-4 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[13.5px] font-medium text-ink">
            {loan.lender || "Your lender"} · Home loan
          </p>
          <span className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink-3">
            {loan.basis === "repo"
              ? "repo-linked"
              : loan.basis === "mclr"
                ? "MCLR"
                : loan.basis === "tbill"
                  ? "T-bill"
                  : "fixed"}
          </span>
        </div>
        <dl className="mt-3 flex gap-4">
          {[
            ["Outstanding", formatCompactINR(loan.outstanding)],
            ["Rate", formatPct(loan.ratePct)],
            ["EMI", formatINR(verdict.emi)],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0 flex-1">
              <dt className="text-[10.5px] text-ink-3">{k}</dt>
              <dd className="tnum mt-0.5 text-[15px] font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid items-start gap-3.5 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <RateCard verdict={verdict} loan={loan} resolved={resolved} />
        </div>

        <Card
          label="Prepay or invest"
          title={surplus > 0 ? `Your ${formatCompactINR(surplus)} surplus` : "A lump sum spare?"}
          action={{ href: "/prepay", label: "Run the four scenarios" }}
        >
          {surplus > 0 ? (
            bufferMonths > 0 && bufferMonths < 6 ? (
              <>
                Prepaying would save {formatCompactINR(prepay.interestSaved)} and clear
                the loan {monthsLabel(prepay.monthsSaved)} early — but your buffer is{" "}
                {bufferMonths} months, and below six neither route is right yet.
              </>
            ) : (
              <>
                Prepaying saves {formatCompactINR(prepay.interestSaved)} in interest and
                clears the loan {monthsLabel(prepay.monthsSaved)} early — a guaranteed{" "}
                {formatPct(loan.ratePct)}, tax-free. Investing has to beat that after tax.
              </>
            )
          ) : (
            <>
              When one turns up, this weighs prepaying against investing it —
              post-tax on both sides, with your balance and rate already known.
            </>
          )}
        </Card>

        <Card
          label="Transfer check"
          title={
            transfer
              ? `Another lender at ${formatPct(quote.newRatePct)}`
              : "Seen a better rate?"
          }
          action={{ href: "/loan/transfer", label: "Run the transfer maths" }}
        >
          {transfer ? (
            transfer.monthlySaving <= 0 ? (
              <>Their rate is no better than yours once the fees are counted.</>
            ) : transfer.worthIt ? (
              <>
                Saves {formatCompactINR(transfer.netSaving)} net over the remaining
                term, breaking even in month {transfer.breakEvenMonth}.
              </>
            ) : (
              <>
                {formatINR(transfer.costToSwitch)} of fees outrun the saving until month{" "}
                {transfer.breakEvenMonth} — longer than most people keep a loan.
              </>
            )
          ) : (
            <>
              Enter it and we do the arithmetic — fees, GST and break-even. We do not
              send you to anyone.
            </>
          )}
        </Card>

        <div className="lg:col-span-2">
          <Card
            label="Progress"
            title={`${formatCompactINR(paid)} of ${formatCompactINR(loan.original)} principal cleared`}
          >
            <div className="mt-1 h-[7px] overflow-hidden rounded-full bg-surface-inset">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.max(0, Math.min(100, paidPct)).toFixed(1)}%` }}
              />
            </div>
            <div className="tnum mt-2 flex justify-between text-[11.5px] text-ink-3">
              <span>{paidPct.toFixed(0)}% paid down</span>
              <span>{monthsLabel(loan.monthsLeft)} left</span>
            </div>
            <p className="mt-2.5">
              At today&apos;s rate another{" "}
              {formatCompactINR(verdict.emi * loan.monthsLeft - loan.outstanding)} of
              interest runs before this closes.
            </p>
          </Card>
        </div>
      </div>

      <p className="mt-5 text-[11.5px] leading-relaxed text-ink-3">
        Held in this browser and nowhere else — no account, no lender connection,
        nothing sent anywhere.{" "}
        <Link href="/loan/setup" className="text-accent hover:underline">
          Edit or clear it
        </Link>
        . Benchmark figures are the published RBI repo rate; the rate your lender
        actually applied is on your statement.
      </p>
    </Screen>
  );
}

function RateCard({
  verdict,
  loan,
  resolved,
}: {
  verdict: NonNullable<ReturnType<typeof rateVerdict>>;
  loan: NonNullable<ReturnType<typeof useLoan>["loan"]>;
  resolved: boolean;
}) {
  if (verdict.kind === "fixed") {
    return (
      <Verdict tone="neutral" label="Rate basis" title="Fixed rate — nothing to track.">
        <p>
          A fixed loan does not follow the benchmark, so there is no reset to chase.
          The trade is certainty now against a costly exit later: fixed loans sit
          outside the RBI ban on foreclosure charges.
        </p>
      </Verdict>
    );
  }

  if (verdict.kind === "mclr") {
    return (
      <Verdict
        tone="warn"
        label="Rate basis"
        title="You're still on MCLR."
        caveat="Switching inside your own bank is a conversion, not a transfer — ask for their current external-benchmark rate before you shop elsewhere."
        action={{ href: "/loan/rate", label: "What switching involves" }}
      >
        <p>
          MCLR loans re-price on the bank&apos;s own schedule and pass cuts on slowly.
          A repo-linked rate moves with the benchmark and is usually free to switch to.
        </p>
      </Verdict>
    );
  }

  if (verdict.kind === "unknown") {
    return (
      <Verdict tone="neutral" label="Rate check" title="We can't track this benchmark.">
        <p>
          T-bill linked loans follow a benchmark we don&apos;t carry a history for, so
          we won&apos;t guess at what your rate should be. Everything else on this
          screen still works.
        </p>
      </Verdict>
    );
  }

  if (verdict.kind === "ontrack" || resolved) {
    return (
      <Verdict
        tone="good"
        label="Rate check"
        title="You're on the right rate."
        caveat="We'll flag it again if the benchmark moves and your rate doesn't follow within a quarter."
      >
        <p>
          At {formatPct(loan.ratePct)} you&apos;re paying the repo (
          {formatPct(verdict.repoNow ?? 0)}) plus your {formatPct(loan.spreadPct)}{" "}
          spread — exactly what your last reset implies.
        </p>
      </Verdict>
    );
  }

  return (
    <Verdict
      tone="warn"
      label="Rate check"
      title="Your rate looks stale."
      caveat="We can't see the rate your bank actually applied — check your latest statement, then ask for the reset in writing."
      action={{ href: "/loan/rate", label: "See how to get it reset" }}
    >
      <p>
        The repo has fallen {formatPct((verdict.repoThen ?? 0) - (verdict.repoNow ?? 0))}{" "}
        since your last reset, but your rate hasn&apos;t moved.
      </p>
      <p>
        On {formatCompactINR(loan.outstanding)} that is about{" "}
        <span className="tnum font-semibold text-ink">
          {formatINR(verdict.monthlyExcess ?? 0)} a month
        </span>{" "}
        you may not owe.
        {verdict.resetOverdue
          ? ` A ${loan.cycle === "half" ? "half-yearly" : loan.cycle} reset has fallen due since.`
          : ""}
      </p>
    </Verdict>
  );
}
