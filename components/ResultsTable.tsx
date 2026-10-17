"use client";

import type { Comparison, RankedOffer } from "@/lib/finance/comparison";
import { labelFor, monthsLabel } from "@/lib/finance/comparison";
import { formatCompactINR, formatINR, formatPct } from "@/lib/finance/format";
import { useId } from "react";

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
  const tableId = useId().replace(/:/g, "");

  return (
    <div
      role="region"
      aria-label="Loan comparison results. Scroll horizontally to view all offers."
      tabIndex={0}
      className="w-full min-w-0 overflow-x-auto rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <table
        className="min-w-full table-auto border-collapse"
        style={{ minWidth: rows.length > 2 ? "30rem" : "20rem" }}
      >
        <caption className="sr-only">
          Loan comparison results. Scroll horizontally within this region to view all offers.
        </caption>
        <colgroup>
          <col style={{ width: `${(1.1 / (rows.length + 1.1)) * 100}%` }} />
          {rows.map((row) => (
            <col key={row.offer.id} style={{ width: `${(1 / (rows.length + 1.1)) * 100}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="items-end border-b border-line px-3 py-3">
            <th
              scope="col"
              id={`${tableId}-metric-column`}
              className="px-3 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-ink-3"
            >
              Metric
            </th>
            {rows.map((row, index) => {
              const offerId = `${tableId}-offer-${index}`;
              return (
                <th
                  key={row.offer.id}
                  scope="col"
                  id={offerId}
                  className="max-w-0 px-3 py-3 text-right align-bottom"
                >
                  {row.isBest ? (
                    <span className="mb-1 inline-block rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-ink">
                      Best
                    </span>
                  ) : null}
                  <p className="break-words text-[13px] font-semibold text-ink">
                    {labelFor(row.offer, index)}
                  </p>
                  <p className="whitespace-nowrap text-[11px] text-ink-3">
                    {formatPct(row.derived.effectiveReducingRatePct, 2)} ·{" "}
                    {monthsLabel(row.derived.tenureMonths)}
                  </p>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => {
            const muted = basis.strict && metric.comparableOnlyOnEqualTerms;
            const winner = muted ? null : bestIndexFor(rows, metric);
            const metricId = `${tableId}-metric-${metric.key}`;

            return (
              <tr key={metric.key} className="border-b border-line last:border-b-0">
                <th
                  scope="row"
                  id={metricId}
                  className={`px-3 py-2.5 text-left align-middle text-[12.5px] font-medium ${muted ? "text-ink-3" : "text-ink-2"}`}
                >
                  <span>{metric.label}</span>
                  {muted ? (
                    <span className="block text-[10.5px] leading-tight text-ink-3">not comparable</span>
                  ) : metric.sub ? (
                    <span className="block text-[10.5px] leading-tight text-ink-3">{metric.sub}</span>
                  ) : null}
                </th>
                {rows.map((row, index) => (
                  <td
                    key={row.offer.id}
                    headers={`${metricId} ${tableId}-offer-${index}`}
                    className={`whitespace-nowrap px-3 py-2.5 text-right align-middle tnum text-[14px] tabular-nums ${
                      muted
                        ? "font-normal text-ink-3"
                        : winner === index
                          ? "font-bold text-accent"
                          : "font-medium text-ink"
                    }`}
                  >
                    <span className="block whitespace-nowrap">{metric.render(row)}</span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
