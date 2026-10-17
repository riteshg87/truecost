"use client";

import { LOAN_TYPES } from "@/lib/finance/loanTypes";
import { formatCompactINR, formatINR, formatPct } from "@/lib/finance/format";
import { labelFor, monthsLabel } from "@/lib/finance/comparison";
import type { Derived, FeeInput, Offer, Warning } from "@/lib/finance/types";
import { materializeComparison, type ComparisonSnapshot } from "@/lib/contracts/snapshot";
import { ResultsTable } from "@/components/ResultsTable";

const createdAtFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

function createdAtLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${createdAtFormatter.format(date)} IST`;
}

function feeInputLabel(fee: FeeInput): string {
  return fee.mode === "percent" ? `${fee.value}% of loan amount` : formatINR(fee.value);
}

function fundingLabel(value: Offer["insuranceFunding"]): string {
  return value === "financed" ? "financed with the loan" : "paid upfront";
}

function rateTypeLabel(value: Offer["rateType"]): string {
  return value === "reducing" ? "reducing balance" : "flat rate";
}

function rateStructureLabel(value: Offer["rateStructure"]): string {
  return value === "floating" ? "floating" : "fixed";
}

function DetailRows({ rows }: { rows: Array<[string, string, string?]> }) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value, note], index) => (
        <div key={`${label}-${index}`} className="min-w-0">
          <dt className="text-[12px] text-ink-3">{label}</dt>
          <dd className="mt-0.5 break-words text-[13.5px] font-medium text-ink">{value}</dd>
          {note ? <p className="mt-0.5 break-words text-[11.5px] leading-snug text-ink-3">{note}</p> : null}
        </div>
      ))}
    </dl>
  );
}

function WarningList({ warnings, label }: { warnings: Warning[]; label: string }) {
  if (warnings.length === 0) {
    return <p className="text-[12.5px] leading-relaxed text-ink-3">No warnings were recorded for this offer.</p>;
  }

  return (
    <ul aria-label={label} className="space-y-2">
      {warnings.map((warning, index) => (
        <li
          key={`${warning.code}:${warning.message}:${index}`}
          className={`rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed ${
            warning.level === "caution"
              ? "border-warn-line bg-warn-soft text-ink-2"
              : "border-accent-line bg-accent-soft text-ink-2"
          }`}
        >
          {warning.message}
        </li>
      ))}
    </ul>
  );
}

function StoredOfferDetails({ offer, derived }: { offer: Offer; derived: Derived }) {
  const apr = derived.effectiveAprPct === null ? "Unavailable" : formatPct(derived.effectiveAprPct);
  const aprNote = derived.effectiveAprPct === null
    ? "The saved calculation could not solve an APR for this offer."
    : "All recorded fees included";

  return (
    <details className="border-t border-line px-4 py-3">
      <summary className="cursor-pointer list-none text-[13.5px] font-semibold text-ink marker:content-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        Stored offer details: <span className="break-words">{labelFor(offer)}</span>
      </summary>
      <div className="mt-4 space-y-5">
        <section aria-labelledby={`inputs-${offer.id}`}>
          <h3 id={`inputs-${offer.id}`} className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            Saved inputs
          </h3>
          <DetailRows
            rows={[
              ["Loan type", LOAN_TYPES[offer.loanType].label],
              ["Loan amount", formatINR(offer.amount)],
              ["Quoted rate", `${offer.ratePct}% (${rateTypeLabel(offer.rateType)})`],
              ["Rate structure", rateStructureLabel(offer.rateStructure)],
              ["Tenure", `${offer.tenureValue} ${offer.tenureUnit}`],
              ["Processing fee", feeInputLabel(offer.processingFee)],
              ["GST on processing fee", `${offer.gstPct}%`],
              ["Insurance premium", formatINR(offer.insurancePremium), fundingLabel(offer.insuranceFunding)],
              ...offer.otherFees.map((fee) => [`Other fee: ${fee.label}`, formatINR(fee.amount)] as [string, string]),
            ]}
          />
        </section>

        <section aria-labelledby={`recorded-${offer.id}`}>
          <h3 id={`recorded-${offer.id}`} className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            Recorded figures
          </h3>
          <DetailRows
            rows={[
              ["Effective APR", apr, aprNote],
              ["Monthly EMI", formatINR(derived.emi)],
              ["Total repayment", formatCompactINR(derived.totalRepayment)],
              ["Total interest", formatCompactINR(derived.totalInterest)],
              ["Processing fee charged", formatINR(derived.processingFeeAmount)],
              ["GST charged", formatINR(derived.gstAmount)],
              ["Other fees total", formatINR(derived.otherFeesTotal)],
              ["Insurance paid upfront", formatINR(derived.upfrontInsurance)],
              ["Upfront fees", formatINR(derived.upfrontFees)],
              ["Net disbursal", formatINR(derived.netDisbursal)],
              ["Money in hand", formatINR(derived.cashInHand)],
              ["Total borrowing cost", formatCompactINR(derived.totalCostOfBorrowing)],
              ["Cost per lakh", formatINR(derived.costPerLakh)],
              ["Effective annual rate", formatPct(derived.effectiveAnnualRatePct)],
              ["Stored tenure", monthsLabel(derived.tenureMonths)],
            ]}
          />
        </section>

        <section aria-labelledby={`warnings-${offer.id}`}>
          <h3 id={`warnings-${offer.id}`} className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            Saved warnings
          </h3>
          <WarningList warnings={derived.warnings} label={`Warnings for ${labelFor(offer)}`} />
        </section>
      </div>
    </details>
  );
}

export function SavedComparisonView({ snapshot }: { snapshot: Readonly<ComparisonSnapshot> }) {
  // materializeComparison only reconnects the decoder's stored rows to their
  // stored inputs. It does not call the finance engine or create new figures.
  const comparison = materializeComparison(snapshot);
  const notices = comparison.notices;

  return (
    <article className="min-w-0 space-y-5" aria-labelledby="saved-comparison-title">
      <header className="min-w-0">
        <p className="text-[12px] font-medium text-accent">Saved comparison</p>
        <h1 id="saved-comparison-title" className="mt-1 text-[25px] font-semibold leading-tight tracking-tight text-ink">
          Your recorded loan result
        </h1>
        <p className="mt-2 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-2">
          Calculated <time dateTime={snapshot.createdAt}>{createdAtLabel(snapshot.createdAt)}</time>. These are the figures saved when you made this comparison.
        </p>
        <p className="mt-2 text-[12px] text-ink-3">
          Calculation version: <span className="break-words font-medium text-ink-2">{snapshot.calculationVersion}</span>
        </p>
      </header>

      <section aria-labelledby="saved-results-title" className="min-w-0">
        <h2 id="saved-results-title" className="mb-2 text-[15px] font-semibold text-ink">Recorded comparison</h2>
        <ResultsTable comparison={comparison} />
      </section>

      {notices.length > 0 ? (
        <section aria-labelledby="saved-notices-title" className="min-w-0 rounded-xl border border-line bg-surface-2 px-4 py-3.5">
          <h2 id="saved-notices-title" className="mb-2 text-[13.5px] font-semibold text-ink">Comparison notes saved with this result</h2>
          <WarningList warnings={notices} label="Saved comparison notes" />
        </section>
      ) : null}

      <section aria-labelledby="offer-details-title" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface">
        <h2 id="offer-details-title" className="px-4 pb-1 pt-4 text-[15px] font-semibold text-ink">Offer details</h2>
        <p className="px-4 pb-2 text-[12.5px] leading-relaxed text-ink-3">Expand an offer to see the inputs and figures stored with this result.</p>
        {comparison.rows.map((row) => (
          <StoredOfferDetails key={row.offer.id} offer={row.offer} derived={row.derived} />
        ))}
      </section>

      <p className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[12px] leading-relaxed text-ink-3">
        Estimate based on the saved inputs. It assumes EMIs are paid on schedule, with no prepayment or floating-rate reset. Check the lender&apos;s sanction letter and Key Facts Statement before signing.
      </p>
    </article>
  );
}
