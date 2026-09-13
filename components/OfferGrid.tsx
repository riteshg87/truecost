"use client";

import { useMemo, type ReactNode } from "react";
import { DecimalInput, MoneyInput, Segmented } from "@/components/inputs";
import { labelFor } from "@/lib/finance/comparison";
import { computeOffer } from "@/lib/finance/compute";
import { formatCompactINR, formatINR, formatPct } from "@/lib/finance/format";
import { LOAN_TYPES } from "@/lib/finance/loanTypes";
import type { Derived, Offer } from "@/lib/finance/types";
import { issueFor, validateOffer, type FieldIssue } from "@/lib/finance/validate";
import { useCompare } from "@/lib/store";

/**
 * Offer entry as a comparison grid.
 *
 * Fields run down the left and offers across the top — the same shape as
 * ResultsTable, so entering figures and reading the verdict use one mental
 * model. It exists because the previous stacked layout put the second offer's
 * rate 420px below the first: you could never see two numbers at once, which
 * is the only thing a comparison screen is for.
 *
 * Each offer is a column, and a column is rendered by the cell function on each
 * row rather than by a component of its own. That is deliberate — a grid row
 * has to align across every column, and the only way to guarantee that is for
 * one row to own all of its cells.
 *
 * A running APR sits at the foot, so the answer arrives while the figures are
 * being typed instead of one screen later.
 */

/** "12 lakh" under a typed amount — the cheapest guard against a dropped zero. */
function amountInWords(value: number): string {
  if (value <= 0) return "";
  if (value >= 1e7) return `${+(value / 1e7).toFixed(2)} crore`;
  if (value >= 1e5) return `${+(value / 1e5).toFixed(2)} lakh`;
  if (value >= 1000) return `${+(value / 1000).toFixed(1)} thousand`;
  return "";
}

interface Column {
  offer: Offer;
  index: number;
  derived: Derived;
  issues: FieldIssue[];
  ready: boolean;
  set: (patch: Partial<Offer>) => void;
}

/* -------------------------------------------------------------------------- */
/* Layout primitives                                                          */
/* -------------------------------------------------------------------------- */

function Row({
  label,
  sub,
  columns,
  field,
  hint,
  children,
}: {
  label: string;
  sub?: string;
  columns: Column[];
  /** Validation key, when this row has one worth surfacing. */
  field?: FieldIssue["field"];
  /** Quiet per-cell confirmation, yielded to whenever an issue outranks it. */
  hint?: (column: Column) => string;
  children: (column: Column) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-[var(--cols)] items-start gap-x-2 gap-y-1 border-b border-line py-2.5 last:border-b-0">
      <div className="pt-2">
        <p className="text-[12px] font-medium leading-tight text-ink-2">{label}</p>
        {sub ? <p className="text-[10px] leading-tight text-ink-3">{sub}</p> : null}
      </div>
      {columns.map((column) => {
        const issue = field ? issueFor(column.issues, field) : null;
        return (
          <div key={column.offer.id} className="min-w-0">
            {children(column)}
            {issue ? (
              <p
                className={`mt-1 text-[10.5px] leading-tight ${
                  issue.level === "error" ? "text-danger" : "text-warn"
                }`}
              >
                {issue.message}
              </p>
            ) : hint?.(column) ? (
              <p className="mt-1 text-[10.5px] leading-tight text-ink-3">
                {hint(column)}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ResultRow({
  label,
  columns,
  render,
  winner,
  muted,
}: {
  label: string;
  columns: Column[];
  render: (column: Column) => string;
  winner: string | null;
  muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[var(--cols)] items-baseline gap-x-2 pt-1.5">
      <p
        className={`text-[11px] font-semibold ${muted ? "text-ink-3" : "text-accent"}`}
      >
        {label}
        {muted ? <span className="block text-[9.5px] font-normal">not comparable</span> : null}
      </p>
      {columns.map((column) => {
        const isWinner = !muted && winner === column.offer.id;
        return (
          <p
            key={column.offer.id}
            className={`tnum text-right text-[15px] tabular-nums ${
              muted
                ? "font-normal text-ink-3"
                : isWinner
                  ? "font-bold text-accent"
                  : "font-semibold text-ink"
            }`}
          >
            {column.ready ? render(column) : "—"}
          </p>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Grid                                                                       */
/* -------------------------------------------------------------------------- */

export function OfferGrid() {
  const { offers, updateOffer, removeOffer } = useCompare();

  const columns = useMemo<Column[]>(
    () =>
      offers.map((offer, index) => {
        const issues = validateOffer(offer);
        return {
          offer,
          index,
          derived: computeOffer(offer),
          issues,
          ready: issues.every((issue) => issue.level !== "error"),
          set: (patch: Partial<Offer>) => updateOffer(offer.id, patch),
        };
      }),
    [offers, updateOffer],
  );

  /* --- Ranking. Only offers with no blocking error can win anything, and raw
     totals stop meaning much once amounts or tenures diverge. */
  const ranked = columns.filter((column) => column.ready);
  const strict =
    new Set(ranked.map((c) => c.offer.amount)).size > 1 ||
    new Set(ranked.map((c) => c.derived.tenureMonths)).size > 1;

  const bestBy = (
    value: (column: Column) => number | null,
    lower = true,
  ): string | null => {
    let bestId: string | null = null;
    let bestValue: number | null = null;
    ranked.forEach((column) => {
      const v = value(column);
      if (v === null || !Number.isFinite(v)) return;
      if (bestValue === null || (lower ? v < bestValue : v > bestValue)) {
        bestValue = v;
        bestId = column.offer.id;
      }
    });
    if (bestValue === null) return null;
    const ties = ranked.filter((column) => {
      const v = value(column);
      return v !== null && Math.abs(v - (bestValue as number)) < 1e-6;
    });
    return ties.length > 1 ? null : bestId;
  };

  const bestApr = bestBy((c) => c.derived.effectiveAprPct);
  const bestEmi = strict ? null : bestBy((c) => c.derived.emi);
  const bestPerLakh = bestBy((c) => c.derived.costPerLakh);
  const bestTotal = strict ? null : bestBy((c) => c.derived.totalCostOfBorrowing);
  const bestRate = bestBy((c) => c.derived.effectiveReducingRatePct);
  const bestFee = bestBy((c) => c.derived.upfrontFees);

  const anyRateTypeOpen = offers.some(
    (offer) => !LOAN_TYPES[offer.loanType].rateTypeLocked,
  );
  const canRemove = offers.length > 2;

  // A label column plus one track per offer. Three offers overflow a phone, so
  // the whole grid pans sideways — the same escape ResultsTable already uses.
  const cols = `4.75rem repeat(${offers.length}, minmax(6.25rem, 1fr))`;

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
      <div
        className="px-3 py-3"
        style={
          {
            "--cols": cols,
            minWidth: offers.length > 2 ? "30rem" : undefined,
          } as React.CSSProperties
        }
      >
        {/* Column heads ------------------------------------------------- */}
        <div className="grid grid-cols-[var(--cols)] items-end gap-x-2 border-b border-line pb-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">
            Field
          </span>
          {columns.map((column) => (
            <div key={column.offer.id} className="min-w-0 text-center">
              {bestApr === column.offer.id ? (
                <span className="mb-1 inline-block rounded-full bg-accent px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-accent-ink">
                  Best
                </span>
              ) : null}
              <input
                aria-label={`Lender name for offer ${column.index + 1}`}
                className="w-full min-w-0 rounded-lg bg-transparent px-1 py-0.5 text-center text-[13.5px] font-semibold text-ink outline-none transition placeholder:font-normal placeholder:text-ink-3 hover:bg-surface-2 focus:bg-surface-2"
                placeholder={`Offer ${column.index + 1}`}
                value={column.offer.lender}
                onChange={(event) => column.set({ lender: event.target.value })}
              />
              {canRemove ? (
                <button
                  type="button"
                  onClick={() => removeOffer(column.offer.id)}
                  aria-label={`Remove ${labelFor(column.offer, column.index)}`}
                  className="mt-0.5 rounded px-1 text-[10.5px] font-medium text-ink-3 transition hover:text-danger"
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {/* Core fields -------------------------------------------------- */}
        <Row
          label="Loan amount"
          columns={columns}
          field="amount"
          hint={(c) => amountInWords(c.offer.amount)}
        >
          {(c) => (
            <MoneyInput
              density="sm"
              ariaLabel={`Loan amount for offer ${c.index + 1}`}
              value={c.offer.amount}
              onChange={(amount) => c.set({ amount })}
              invalid={issueFor(c.issues, "amount")?.level === "error"}
              placeholder="0"
            />
          )}
        </Row>

        <Row label="Interest rate" sub="a year" columns={columns} field="ratePct">
          {(c) => (
            <DecimalInput
              density="sm"
              suffix="%"
              ariaLabel={`Interest rate for offer ${c.index + 1}`}
              value={c.offer.ratePct}
              onChange={(ratePct) => c.set({ ratePct })}
              invalid={issueFor(c.issues, "ratePct")?.level === "error"}
              placeholder="0"
            />
          )}
        </Row>

        {/* Fixed or floating decides what leaving early costs, which no APR
            computed over a full schedule can express. Collected here so the
            prepay-versus-invest flow has it. */}
        <Row label="Rate basis" columns={columns} hint={(c) =>
          c.offer.rateStructure === "floating" ? "prepay free" : "exit charges"
        }>
          {(c) => (
            <Segmented
              size="sm"
              ariaLabel={`Fixed or floating for offer ${c.index + 1}`}
              value={c.offer.rateStructure}
              onChange={(rateStructure) => c.set({ rateStructure })}
              options={[
                { value: "floating", label: "Float" },
                { value: "fixed", label: "Fixed" },
              ]}
            />
          )}
        </Row>

        {anyRateTypeOpen ? (
          <Row label="Rate type" columns={columns}>
            {(c) =>
              LOAN_TYPES[c.offer.loanType].rateTypeLocked ? (
                <p className="py-2 text-center text-[12px] text-ink-3">Reducing</p>
              ) : (
                <Segmented
                  size="sm"
                  ariaLabel={`Rate type for offer ${c.index + 1}`}
                  value={c.offer.rateType}
                  onChange={(rateType) => c.set({ rateType })}
                  options={[
                    { value: "reducing", label: "Red." },
                    { value: "flat", label: "Flat" },
                  ]}
                />
              )
            }
          </Row>
        ) : null}

        <Row label="Tenure" columns={columns} field="tenure">
          {(c) => (
            <DecimalInput
              density="sm"
              maxDecimals={0}
              ariaLabel={`Tenure for offer ${c.index + 1}`}
              value={c.offer.tenureValue}
              onChange={(tenureValue) => c.set({ tenureValue })}
              invalid={issueFor(c.issues, "tenure")?.level === "error"}
              placeholder="0"
            />
          )}
        </Row>

        <Row label="Counted in" columns={columns}>
          {(c) => (
            <Segmented
              size="sm"
              ariaLabel={`Tenure unit for offer ${c.index + 1}`}
              value={c.offer.tenureUnit}
              onChange={(tenureUnit) => c.set({ tenureUnit })}
              options={[
                { value: "years", label: "Yrs" },
                { value: "months", label: "Mos" },
              ]}
            />
          )}
        </Row>

        <Row label="Processing fee" columns={columns} field="processingFee">
          {(c) =>
            c.offer.processingFee.mode === "percent" ? (
              <DecimalInput
                density="sm"
                suffix="%"
                ariaLabel={`Processing fee percent for offer ${c.index + 1}`}
                value={c.offer.processingFee.value}
                onChange={(value) =>
                  c.set({ processingFee: { mode: "percent", value } })
                }
                placeholder="0"
              />
            ) : (
              <MoneyInput
                density="sm"
                ariaLabel={`Processing fee for offer ${c.index + 1}`}
                value={c.offer.processingFee.value}
                onChange={(value) => c.set({ processingFee: { mode: "flat", value } })}
                placeholder="0"
              />
            )
          }
        </Row>

        <Row label="Charged as" columns={columns}>
          {(c) => (
            <Segmented
              size="sm"
              ariaLabel={`Processing fee basis for offer ${c.index + 1}`}
              value={c.offer.processingFee.mode}
              onChange={(mode) =>
                c.set({ processingFee: { ...c.offer.processingFee, mode } })
              }
              options={[
                { value: "flat", label: "₹" },
                { value: "percent", label: "%" },
              ]}
            />
          )}
        </Row>

        {/* Everything most people never touch --------------------------- */}
        <details className="border-t border-line">
          <summary className="cursor-pointer list-none py-2.5 text-[12px] font-medium text-ink-2 marker:content-none">
            <span className="text-accent">＋</span> GST, insurance and other charges
          </summary>

          <Row label="GST on fee" sub="18% standard" columns={columns} field="gstPct">
            {(c) => (
              <DecimalInput
                density="sm"
                suffix="%"
                ariaLabel={`GST percent for offer ${c.index + 1}`}
                value={c.offer.gstPct}
                onChange={(gstPct) => c.set({ gstPct })}
                placeholder="18"
              />
            )}
          </Row>

          <Row label="Insurance" sub="premium" columns={columns}>
            {(c) => (
              <MoneyInput
                density="sm"
                ariaLabel={`Insurance premium for offer ${c.index + 1}`}
                value={c.offer.insurancePremium}
                onChange={(insurancePremium) => c.set({ insurancePremium })}
                placeholder="0"
              />
            )}
          </Row>

          <Row label="Premium paid" columns={columns}>
            {(c) => (
              <Segmented
                size="sm"
                ariaLabel={`Premium funding for offer ${c.index + 1}`}
                value={c.offer.insuranceFunding}
                onChange={(insuranceFunding) => c.set({ insuranceFunding })}
                options={[
                  { value: "upfront", label: "Upfront" },
                  { value: "financed", label: "Added" },
                ]}
              />
            )}
          </Row>

          <Row label="Other charges" sub="legal, stamp" columns={columns}>
            {(c) => <OtherCharges column={c} />}
          </Row>
        </details>

        {/* Running verdict ---------------------------------------------- */}
        <div className="mt-3 rounded-xl border border-accent-line bg-accent-soft px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-accent">
              As you type
            </p>
            {strict ? (
              <p className="text-[9.5px] font-medium text-accent">per lakh basis</p>
            ) : null}
          </div>

          <ResultRow
            label="Effective APR"
            columns={columns}
            winner={bestApr}
            render={(c) => formatPct(c.derived.effectiveAprPct)}
          />
          <ResultRow
            label="Monthly EMI"
            columns={columns}
            winner={bestEmi}
            muted={strict}
            render={(c) => formatINR(c.derived.emi)}
          />
          <ResultRow
            label="Cost per lakh"
            columns={columns}
            winner={bestPerLakh}
            render={(c) => formatINR(c.derived.costPerLakh)}
          />
          <ResultRow
            label="Total cost"
            columns={columns}
            winner={bestTotal}
            muted={strict}
            render={(c) => formatCompactINR(c.derived.totalCostOfBorrowing)}
          />

          {/* The one line that justifies the whole screen. */}
          {bestApr && bestRate && bestApr !== bestRate ? (
            <p className="mt-2 border-t border-accent-line/60 pt-2 text-[11px] leading-relaxed text-accent">
              The lowest rate here is not the cheapest loan — charges close the gap
              and then some.
            </p>
          ) : bestApr && bestFee && bestApr !== bestFee && bestRate === bestApr ? (
            <p className="mt-2 border-t border-accent-line/60 pt-2 text-[11px] leading-relaxed text-accent">
              The winner charges more upfront and still costs less over the tenure.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Other charges — a variable-length list inside one cell                      */
/* -------------------------------------------------------------------------- */

function newFeeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `f_${Math.random().toString(36).slice(2, 8)}`;
}

function OtherCharges({ column }: { column: Column }) {
  const { offer, set, index } = column;

  const update = (otherFees: Offer["otherFees"]) => set({ otherFees });

  return (
    <div className="flex flex-col gap-1.5">
      {offer.otherFees.map((fee, feeIndex) => (
        <div key={fee.id} className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <input
              aria-label={`Charge name ${feeIndex + 1} for offer ${index + 1}`}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
              placeholder="Legal"
              value={fee.label}
              onChange={(event) =>
                update(
                  offer.otherFees.map((f) =>
                    f.id === fee.id ? { ...f, label: event.target.value } : f,
                  ),
                )
              }
            />
            <button
              type="button"
              aria-label={`Remove charge ${feeIndex + 1} for offer ${index + 1}`}
              onClick={() => update(offer.otherFees.filter((f) => f.id !== fee.id))}
              className="shrink-0 rounded px-1 text-[14px] leading-none text-ink-3 transition hover:text-danger"
            >
              ×
            </button>
          </div>
          <MoneyInput
            density="sm"
            ariaLabel={`Charge amount ${feeIndex + 1} for offer ${index + 1}`}
            value={fee.amount}
            onChange={(amount) =>
              update(offer.otherFees.map((f) => (f.id === fee.id ? { ...f, amount } : f)))
            }
            placeholder="0"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => update([...offer.otherFees, { id: newFeeId(), label: "", amount: 0 }])}
        className="self-start rounded px-1 py-0.5 text-[11.5px] font-medium text-accent transition hover:underline"
      >
        + Add
      </button>
    </div>
  );
}
