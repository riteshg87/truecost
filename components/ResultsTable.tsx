"use client";

import type { Comparison, RankedOffer } from "@/lib/finance/comparison";
import { labelFor, monthsLabel } from "@/lib/finance/comparison";
import { formatCompactINR, formatINR, formatPct } from "@/lib/finance/format";

type Direction = "lower" | "higher";

interface MetricSpec {
  key: string;
  label: string;
  sub?: string;
  better: Direction;
  value: (row: RankedOffer) => number | null;
  render: (row: RankedOffer) => string;
  /** Hidden as a ranking signal when the offers are not like-for-like. */
  comparableOnlyOnEqualTerms?: boolean;
}

const METRICS: MetricSpec[] = [
  {
    key: "apr",
    label: "Effective APR",
    sub: "all fees included",
    better: "lower",
    value: (row) => row.derived.effectiveAprPct,
    render: (row) => formatPct(row.derived.effectiveAprPct),
  },
  {
    key: "perLakh",
    label: "Cost per lakh",
    sub: "borrowed",
    better: "lower",
    value: (row) => row.derived.costPerLakh,
    render: (row) => formatINR(row.derived.costPerLakh),
  },
  {
    key: "emi",
    label: "Monthly EMI",
    better: "lower",
    value: (row) => row.derived.emi,
    render: (row) => formatINR(row.derived.emi),
    comparableOnlyOnEqualTerms: true,
  },
  {
    key: "totalCost",
    label: "Total cost of borrowing",
    sub: "interest + every fee",
    better: "lower",
    value: (row) => row.derived.totalCostOfBorrowing,
    render: (row) => formatCompactINR(row.derived.totalCostOfBorrowing),
    comparableOnlyOnEqualTerms: true,
  },
  {
    key: "interest",
    label: "Total interest",
    better: "lower",
    value: (row) => row.derived.totalInterest,
    render: (row) => formatCompactINR(row.derived.totalInterest),
    comparableOnlyOnEqualTerms: true,
  },
  {
    key: "cash",
    label: "Money in hand",
    sub: "after upfront charges",
    better: "higher",
    value: (row) => row.derived.cashInHand,
    render: (row) => formatCompactINR(row.derived.cashInHand),
    comparableOnlyOnEqualTerms: true,
  },
];

function bestIndexFor(rows: RankedOffer[], metric: MetricSpec): number | null {
  let bestIndex: number | null = null;
  let bestValue: number | null = null;
  rows.forEach((row, index) => {
    const value = metric.value(row);
    if (value === null || !isFinite(value)) return;
    if (bestValue === null) {
      bestValue = value;
      bestIndex = index;
      return;
    }
    const wins = metric.better === "lower" ? value < bestValue : value > bestValue;
    if (wins) {
      bestValue = value;
      bestIndex = index;
    }
  });
  // A tie has no winner worth highlighting.
  const ties = rows.filter((row) => {
    const value = metric.value(row);
    return value !== null && bestValue !== null && Math.abs(value - bestValue) < 1e-6;
  });
  return ties.length > 1 ? null : bestIndex;
}

export function ResultsTable({ comparison }: { comparison: Comparison }) {
  const { rows, basis } = comparison;
  const columns = `minmax(7.5rem,1.1fr) repeat(${rows.length}, minmax(5.5rem, 1fr))`;

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="min-w-full" style={{ minWidth: rows.length > 2 ? "30rem" : undefined }}>
        {/* Column heads */}
        <div
          className="grid items-end gap-x-2 border-b border-line px-3 py-3"
          style={{ gridTemplateColumns: columns }}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
            Metric
          </span>
          {rows.map((row, index) => (
            <div key={row.offer.id} className="text-right">
              {row.isBest ? (
                <span className="mb-1 inline-block rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-ink">
                  Best
                </span>
              ) : null}
              <p className="truncate text-[13px] font-semibold text-ink">
                {labelFor(row.offer, index)}
              </p>
              <p className="truncate text-[11px] text-ink-3">
                {formatPct(row.derived.effectiveReducingRatePct, 2)} ·{" "}
                {monthsLabel(row.derived.tenureMonths)}
              </p>
            </div>
          ))}
        </div>

        {/* Metric rows */}
        {METRICS.map((metric) => {
          const muted = basis.strict && metric.comparableOnlyOnEqualTerms;
          const winner = muted ? null : bestIndexFor(rows, metric);

          return (
            <div
              key={metric.key}
              className="grid items-center gap-x-2 border-b border-line px-3 py-2.5 last:border-b-0"
              style={{ gridTemplateColumns: columns }}
            >
              <div>
                <p className={`text-[12.5px] font-medium ${muted ? "text-ink-3" : "text-ink-2"}`}>
                  {metric.label}
                </p>
                {muted ? (
                  <p className="text-[10.5px] leading-tight text-ink-3">not comparable</p>
                ) : metric.sub ? (
                  <p className="text-[10.5px] leading-tight text-ink-3">{metric.sub}</p>
                ) : null}
              </div>
              {rows.map((row, index) => (
                <p
                  key={row.offer.id}
                  className={`tnum text-right text-[14px] tabular-nums ${
                    muted
                      ? "font-normal text-ink-3"
                      : winner === index
                        ? "font-bold text-accent"
                        : "font-medium text-ink"
                  }`}
                >
                  {metric.render(row)}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
