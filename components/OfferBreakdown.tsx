"use client";

import { useMemo, useState } from "react";
import { labelFor, monthsLabel, type RankedOffer } from "@/lib/finance/comparison";
import { interestByYear, scheduleFor } from "@/lib/finance/compute";
import { formatCompactINR, formatINR, formatPct } from "@/lib/finance/format";
import { LOAN_TYPES } from "@/lib/finance/loanTypes";

function Row({
  label,
  value,
  tone = "normal",
  indent,
}: {
  label: string;
  value: string;
  tone?: "normal" | "muted" | "strong" | "accent";
  indent?: boolean;
}) {
  const toneClass =
    tone === "strong"
      ? "font-semibold text-ink"
      : tone === "accent"
        ? "font-semibold text-accent"
        : tone === "muted"
          ? "text-ink-3"
          : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span
        className={`text-[13px] ${indent ? "pl-3 text-ink-3" : "text-ink-2"}`}
      >
        {label}
      </span>
      <span className={`tnum shrink-0 text-[13.5px] ${toneClass}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="my-1.5 h-px bg-line" />;
}

export function OfferBreakdown({ row, index }: { row: RankedOffer; index: number }) {
  const [open, setOpen] = useState(false);
  const { offer, derived } = row;
  const config = LOAN_TYPES[offer.loanType];

  const yearly = useMemo(
    () => (open ? interestByYear(scheduleFor(derived)) : []),
    [open, derived],
  );

  const converted = offer.rateType === "flat";

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface-2"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
            row.isBest
              ? "bg-accent text-accent-ink"
              : "bg-surface-inset text-ink-3"
          }`}
        >
          {row.rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">
            {labelFor(offer, index)}
          </span>
          <span className="block truncate text-[12px] text-ink-3">
            {config.short} · {formatCompactINR(offer.amount)} ·{" "}
            {monthsLabel(derived.tenureMonths)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tnum block text-[15px] font-bold text-ink">
            {formatPct(derived.effectiveAprPct)}
          </span>
          <span className="block text-[11px] text-ink-3">APR</span>
        </span>
        <span aria-hidden className="shrink-0 text-[12px] text-ink-3">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-4 py-3">
          {derived.warnings.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-1.5">
              {derived.warnings.map((warning) => (
                <li
                  key={warning.code}
                  className={`rounded-lg px-2.5 py-2 text-[12px] leading-relaxed ${
                    warning.level === "caution"
                      ? "bg-warn-soft text-warn"
                      : "bg-surface-2 text-ink-2"
                  }`}
                >
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            What you receive
          </p>
          <Row label="Sanctioned amount" value={formatINR(offer.amount)} />
          {derived.processingFeeAmount > 0 ? (
            <Row
              label={`Processing fee${
                offer.processingFee.mode === "percent"
                  ? ` (${offer.processingFee.value}%)`
                  : ""
              }`}
              value={`− ${formatINR(derived.processingFeeAmount)}`}
              indent
            />
          ) : null}
          {derived.gstAmount > 0 ? (
            <Row
              label={`GST on fee (${offer.gstPct}%)`}
              value={`− ${formatINR(derived.gstAmount)}`}
              indent
            />
          ) : null}
          {offer.otherFees
            .filter((fee) => fee.amount > 0)
            .map((fee) => (
              <Row
                key={fee.id}
                label={fee.label || "Other charge"}
                value={`− ${formatINR(fee.amount)}`}
                indent
              />
            ))}
          <Divider />
          <Row label="Net disbursal" value={formatINR(derived.netDisbursal)} tone="strong" />
          {derived.upfrontInsurance > 0 ? (
            <>
              <Row
                label="Insurance paid upfront"
                value={`− ${formatINR(derived.upfrontInsurance)}`}
                indent
              />
              <Row label="Money in hand" value={formatINR(derived.cashInHand)} tone="strong" />
            </>
          ) : null}

          <div className="mt-4" />
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            What you repay
          </p>
          {offer.insuranceFunding === "financed" && offer.insurancePremium > 0 ? (
            <Row
              label="Principal incl. financed premium"
              value={formatINR(derived.financedPrincipal)}
            />
          ) : null}
          <Row
            label={`EMI × ${derived.tenureMonths} months`}
            value={formatINR(derived.emi)}
            tone="strong"
          />
          <Row label="Total repaid" value={formatINR(derived.totalRepayment)} />
          <Row label="Of which interest" value={formatINR(derived.totalInterest)} indent />
          <Divider />
          <Row
            label="Total cost of borrowing"
            value={formatINR(derived.totalCostOfBorrowing)}
            tone="strong"
          />
          <Row
            label="Cost per lakh borrowed"
            value={formatINR(derived.costPerLakh)}
            tone="accent"
          />

          <div className="mt-4" />
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Rate
          </p>
          <Row
            label={converted ? "Quoted (flat)" : "Quoted (reducing)"}
            value={formatPct(offer.ratePct)}
          />
          {converted ? (
            <Row
              label="Reducing-balance equivalent"
              value={formatPct(derived.effectiveReducingRatePct)}
              indent
            />
          ) : null}
          <Row
            label="Effective APR with fees"
            value={formatPct(derived.effectiveAprPct)}
            tone="accent"
          />
          <Row
            label="Compounded annually"
            value={formatPct(derived.effectiveAnnualRatePct)}
            tone="muted"
          />

          {yearly.length > 0 ? (
            <>
              <div className="mt-4" />
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Interest paid by year
              </p>
              <div className="flex flex-col gap-1">
                {yearly.slice(0, 6).map((amount, yearIndex) => {
                  const max = Math.max(...yearly);
                  return (
                    <div key={yearIndex} className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-[11px] text-ink-3">
                        Year {yearIndex + 1}
                      </span>
                      <span
                        aria-hidden
                        className="h-2 rounded-full bg-accent/25"
                        style={{ width: `${Math.max(4, (amount / max) * 60)}%` }}
                      />
                      <span className="tnum text-[11.5px] text-ink-2">
                        {formatCompactINR(amount)}
                      </span>
                    </div>
                  );
                })}
                {yearly.length > 6 ? (
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    …and {yearly.length - 6} more{" "}
                    {yearly.length - 6 === 1 ? "year" : "years"}. Interest is heaviest
                    early — prepaying later moves far less.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          <p className="mt-4 rounded-lg bg-surface-2 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-3">
            <span className="font-medium text-ink-2">Prepayment: </span>
            {config.prepayNote}
          </p>
          <p className="mt-1.5 rounded-lg bg-surface-2 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-3">
            <span className="font-medium text-ink-2">Tax: </span>
            {config.taxNote}
          </p>
        </div>
      ) : null}
    </section>
  );
}
