"use client";

import { useMemo } from "react";
import {
  Callout,
  Ledger,
  NoLoan,
  PageHead,
  Screen,
  Verdict,
  type LedgerRow,
} from "@/components/health";
import { DecimalInput, Field, MoneyInput, Segmented } from "@/components/inputs";
import { monthsLabel } from "@/lib/finance/comparison";
import { formatCompactINR, formatINR, formatPct } from "@/lib/finance/format";
import { BREAK_EVEN_LIMIT_MONTHS, transferResult } from "@/lib/health/analyse";
import { useLoan } from "@/lib/loanStore";

/**
 * A calculator, not a referral.
 *
 * The screen ends at a verdict and goes nowhere. No outbound link to a bank or
 * an NBFC, which is what keeps the no-commission promise on the front page
 * true and keeps this out of lead-generation territory entirely.
 */
export default function TransferPage() {
  const { loan, quote, hydrated, setQuote } = useLoan();

  const result = useMemo(
    () => (loan && quote.newRatePct > 0 ? transferResult(loan, quote) : null),
    [loan, quote],
  );

  if (!hydrated) {
    return (
      <Screen back={{ href: "/loan", label: "Loan Health Monitor" }} title="Transfer">
        <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface-2" />
      </Screen>
    );
  }
  if (!loan) {
    return (
      <Screen back={{ href: "/loan", label: "Loan Health Monitor" }} title="Transfer">
        <NoLoan />
      </Screen>
    );
  }

  return (
    <Screen back={{ href: "/loan", label: "Loan Health Monitor" }} title="Transfer">
      <PageHead
        title="Is a transfer worth it?"
        sub="Enter another lender's offer. We do the arithmetic — we don't send you to anyone."
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-6">
        {/* ---- the offer ---- */}
        <div className="flex flex-col gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="New lender's rate" htmlFor="newrate">
              <DecimalInput
                id="newrate"
                suffix="%"
                value={quote.newRatePct}
                onChange={(newRatePct) => setQuote({ newRatePct })}
                placeholder="7.90"
              />
            </Field>

            <Field label="Processing fee" hint="GST at 18% is added on top." htmlFor="fee">
              <DecimalInput
                id="fee"
                suffix="%"
                value={quote.feePct}
                onChange={(feePct) => setQuote({ feePct })}
                placeholder="0.25"
              />
            </Field>

            <Field label="Legal & valuation" htmlFor="legal">
              <MoneyInput
                id="legal"
                value={quote.legalCharges}
                onChange={(legalCharges) => setQuote({ legalCharges })}
                placeholder="5,000"
              />
            </Field>

            <Field
              label="Tenure"
              hint="Keeping your term is what makes the comparison fair."
            >
              <Segmented
                size="sm"
                ariaLabel="Tenure on the new loan"
                value={quote.keepTenure ? "keep" : "reset"}
                onChange={(v) => setQuote({ keepTenure: v === "keep" })}
                options={[
                  { value: "keep", label: `Keep ${loan.monthsLeft} mo` },
                  { value: "reset", label: "Reset to 20 yrs" },
                ]}
              />
            </Field>
          </div>

          <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
            <p className="text-[12px] leading-relaxed text-ink-3">
              Your loan today: {formatCompactINR(loan.outstanding)} at{" "}
              {formatPct(loan.ratePct)} over {monthsLabel(loan.monthsLeft)}. Pulled from
              your saved record — nothing to re-enter.
            </p>
          </div>
        </div>

        {/* ---- the answer ---- */}
        <div className="flex flex-col gap-3.5 lg:sticky lg:top-[68px]">
          {result ? <Result result={result} loan={loan} quote={quote} /> : (
            <div className="rounded-2xl border border-dashed border-line bg-surface-2 px-5 py-8 text-center">
              <p className="text-[14px] font-medium text-ink-2">Enter their rate</p>
              <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-ink-3">
                Fees, GST, break-even and the net over your remaining term — worked out
                here, sent nowhere.
              </p>
            </div>
          )}
        </div>
      </div>
    </Screen>
  );
}

function Result({
  result,
  loan,
  quote,
}: {
  result: NonNullable<ReturnType<typeof transferResult>>;
  loan: NonNullable<ReturnType<typeof useLoan>["loan"]>;
  quote: ReturnType<typeof useLoan>["quote"];
}) {
  const noGain = result.monthlySaving <= 0;

  const rows: LedgerRow[] = [
    { k: "Saving each month", v: formatINR(result.monthlySaving) },
    { k: "Cost to switch", v: formatINR(result.costToSwitch) },
    {
      k: "Break-even",
      v: result.breakEvenMonth ? `month ${result.breakEvenMonth}` : "never",
    },
    {
      k: `Net over ${monthsLabel(loan.monthsLeft)}`,
      v: formatCompactINR(result.netSaving),
      tone: result.netSaving > 0 ? "good" : "warn",
    },
  ];

  return (
    <>
      <Verdict
        tone={result.worthIt ? "good" : "neutral"}
        label="Verdict"
        title={noGain ? "No gain here." : result.worthIt ? "Worth it." : "Not yet."}
        caveat={
          !noGain && !result.worthIt ? (
            <>
              Fees outrun the saving until month {result.breakEvenMonth}. Past about{" "}
              {BREAK_EVEN_LIMIT_MONTHS} months that is a bet on still holding this loan,
              not a saving.
            </>
          ) : undefined
        }
      >
        {noGain ? (
          <p>
            At {formatPct(quote.newRatePct)} their EMI is no lower than yours. There is
            nothing to recover, so the fees are pure cost.
          </p>
        ) : (
          <div className="mt-1">
            <Ledger rows={rows} />
          </div>
        )}
      </Verdict>

      <div>
        <Callout>
          Leaving costs almost nothing: RBI bars foreclosure and part-payment fees on
          floating-rate home loans to individual borrowers. Challenge any exit fee in
          writing.
        </Callout>

        {result.lengthened ? (
          <Callout>
            This restarts you on a fresh 20-year term. The EMI drops further, but you
            would pay {formatCompactINR(result.interestNew)} in interest against{" "}
            {formatCompactINR(result.interestNow)} now — a lower rate down a longer road.
          </Callout>
        ) : (
          <Callout>
            This offer keeps your tenure, which is what makes the comparison fair. A
            fresh 20-year term would cut the EMI and raise the total interest.
          </Callout>
        )}

        <Callout>
          Ask the new lender for the spread, not just the headline rate. The spread is
          fixed for the life of the loan; the benchmark is the only part that moves.
        </Callout>
      </div>
    </>
  );
}
