"use client";

import { useId, useState } from "react";
import {
  DecimalInput,
  Field,
  MoneyInput,
  Segmented,
  TextInput,
} from "@/components/inputs";
import { feeAmount } from "@/lib/finance/compute";
import { formatCompactINR, formatINR } from "@/lib/finance/format";
import { LOAN_TYPES, LOAN_TYPE_ORDER } from "@/lib/finance/loanTypes";
import type { LoanTypeId, Offer } from "@/lib/finance/types";
import { issueFor, validateOffer } from "@/lib/finance/validate";
import { useCompare } from "@/lib/store";

function amountInWords(value: number): string {
  if (value <= 0) return "";
  if (value >= 1e7) return `${+(value / 1e7).toFixed(2)} crore`;
  if (value >= 1e5) return `${+(value / 1e5).toFixed(2)} lakh`;
  if (value >= 1000) return `${+(value / 1000).toFixed(1)} thousand`;
  return "";
}

export function OfferCard({ offer, index }: { offer: Offer; index: number }) {
  const { updateOffer, removeOffer, offers } = useCompare();
  const [showExtras, setShowExtras] = useState(
    offer.insurancePremium > 0 || offer.otherFees.length > 0,
  );
  const uid = useId();
  const config = LOAN_TYPES[offer.loanType];
  const issues = validateOffer(offer);
  const canRemove = offers.length > 2;

  const pfAmount = feeAmount(offer.processingFee, offer.amount);
  const gstAmount = (pfAmount * offer.gstPct) / 100;

  const set = (patch: Partial<Offer>) => updateOffer(offer.id, patch);

  return (
    <section className="rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
      {/* Header ------------------------------------------------------------ */}
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="shrink-0 rounded-lg bg-surface-inset px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Offer {index + 1}
        </span>
        <input
          aria-label={`Lender name for offer ${index + 1}`}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
          placeholder="Lender name"
          value={offer.lender}
          onChange={(event) => set({ lender: event.target.value })}
        />
        {canRemove ? (
          <button
            type="button"
            onClick={() => removeOffer(offer.id)}
            aria-label={`Remove offer ${index + 1}`}
            className="shrink-0 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink-3 transition hover:bg-surface-inset hover:text-danger"
          >
            Remove
          </button>
        ) : null}
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        {/* Amount --------------------------------------------------------- */}
        <Field
          label="Loan amount"
          required
          htmlFor={`${uid}-amount`}
          issue={issueFor(issues, "amount")?.message}
          issueLevel={issueFor(issues, "amount")?.level}
          hint={amountInWords(offer.amount) || "The sanctioned principal"}
        >
          <MoneyInput
            id={`${uid}-amount`}
            value={offer.amount}
            onChange={(amount) => set({ amount })}
            placeholder="0"
            invalid={issueFor(issues, "amount")?.level === "error"}
          />
        </Field>

        {/* Rate ----------------------------------------------------------- */}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Interest rate"
            required
            htmlFor={`${uid}-rate`}
            issue={issueFor(issues, "ratePct")?.message}
            issueLevel={issueFor(issues, "ratePct")?.level}
            hint={`Typically ~${config.typicalRatePct}%`}
          >
            <DecimalInput
              id={`${uid}-rate`}
              value={offer.ratePct}
              onChange={(ratePct) => set({ ratePct })}
              placeholder="0.00"
              suffix="% p.a."
              invalid={issueFor(issues, "ratePct")?.level === "error"}
            />
          </Field>

          <Field
            label="Rate type"
            hint={
              config.rateTypeLocked
                ? "Always reducing balance"
                : offer.rateType === "flat"
                  ? "Converted for comparison"
                  : "Interest on the outstanding"
            }
          >
            {config.rateTypeLocked ? (
              <div className="flex h-[46px] items-center rounded-xl border border-line bg-surface-inset px-3.5 text-[15px] font-medium text-ink-2">
                Reducing
              </div>
            ) : (
              <Segmented
                ariaLabel={`Rate type for offer ${index + 1}`}
                value={offer.rateType}
                onChange={(rateType) => set({ rateType })}
                options={[
                  { value: "reducing", label: "Reducing" },
                  { value: "flat", label: "Flat" },
                ]}
              />
            )}
          </Field>
        </div>

        {config.flatWarning && offer.rateType === "flat" ? (
          <p className="-mt-1 rounded-xl border border-warn-line bg-warn-soft px-3 py-2 text-[12px] leading-relaxed text-warn">
            {config.flatWarning}
          </p>
        ) : null}

        {/* Tenure --------------------------------------------------------- */}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Tenure"
            required
            htmlFor={`${uid}-tenure`}
            issue={issueFor(issues, "tenure")?.message}
            issueLevel={issueFor(issues, "tenure")?.level}
          >
            <DecimalInput
              id={`${uid}-tenure`}
              value={offer.tenureValue}
              onChange={(tenureValue) => set({ tenureValue })}
              placeholder="0"
              maxDecimals={0}
              invalid={issueFor(issues, "tenure")?.level === "error"}
            />
          </Field>
          <Field label="Unit">
            <Segmented
              ariaLabel={`Tenure unit for offer ${index + 1}`}
              value={offer.tenureUnit}
              onChange={(tenureUnit) => set({ tenureUnit })}
              options={[
                { value: "years", label: "Years" },
                { value: "months", label: "Months" },
              ]}
            />
          </Field>
        </div>

        {/* Processing fee -------------------------------------------------- */}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Processing fee"
            required
            htmlFor={`${uid}-pf`}
            issue={issueFor(issues, "processingFee")?.message}
            issueLevel={issueFor(issues, "processingFee")?.level}
          >
            <DecimalInput
              id={`${uid}-pf`}
              value={offer.processingFee.value}
              onChange={(value) => set({ processingFee: { ...offer.processingFee, value } })}
              placeholder="0"
              suffix={offer.processingFee.mode === "percent" ? "%" : "₹"}
            />
          </Field>
          <Field
            label="Charged as"
            hint={
              pfAmount > 0
                ? `${formatINR(pfAmount)} + ${formatINR(gstAmount)} GST`
                : `GST at ${offer.gstPct}% is added`
            }
          >
            <Segmented
              ariaLabel={`Processing fee mode for offer ${index + 1}`}
              value={offer.processingFee.mode}
              onChange={(mode) => set({ processingFee: { ...offer.processingFee, mode } })}
              options={[
                { value: "percent", label: "% of loan" },
                { value: "flat", label: "Rupees" },
              ]}
            />
          </Field>
        </div>

        {/* Extras --------------------------------------------------------- */}
        <button
          type="button"
          onClick={() => setShowExtras((open) => !open)}
          aria-expanded={showExtras}
          className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] font-medium text-ink-2 transition hover:bg-surface-inset"
        >
          <span>Insurance, GST &amp; other charges</span>
          <span className="text-ink-3">{showExtras ? "Hide" : "Add"}</span>
        </button>

        {showExtras ? (
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-2 px-3.5 py-4">
            <Field
              label="Product type"
              hint="Changes prepayment rules and tax treatment"
              htmlFor={`${uid}-type`}
            >
              <select
                id={`${uid}-type`}
                value={offer.loanType}
                onChange={(event) => set({ loanType: event.target.value as LoanTypeId })}
                className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-medium text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              >
                {LOAN_TYPE_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {LOAN_TYPES[id].label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Loan protection / insurance premium"
              htmlFor={`${uid}-ins`}
              hint="Leave blank if none was bundled"
            >
              <MoneyInput
                id={`${uid}-ins`}
                value={offer.insurancePremium}
                onChange={(insurancePremium) => set({ insurancePremium })}
                placeholder="0"
              />
            </Field>

            {offer.insurancePremium > 0 ? (
              <Field
                label="How is the premium paid?"
                hint={
                  offer.insuranceFunding === "financed"
                    ? "Added to the loan, so you pay interest on it too"
                    : "Paid from your pocket at disbursal"
                }
              >
                <Segmented
                  ariaLabel={`Insurance funding for offer ${index + 1}`}
                  value={offer.insuranceFunding}
                  onChange={(insuranceFunding) => set({ insuranceFunding })}
                  options={[
                    { value: "financed", label: "Added to loan" },
                    { value: "upfront", label: "Paid upfront" },
                  ]}
                />
              </Field>
            ) : null}

            <Field
              label="GST on processing fee"
              htmlFor={`${uid}-gst`}
              issue={issueFor(issues, "gstPct")?.message}
              issueLevel={issueFor(issues, "gstPct")?.level}
              hint="Standard rate, applied automatically"
            >
              <DecimalInput
                id={`${uid}-gst`}
                value={offer.gstPct}
                onChange={(gstPct) => set({ gstPct })}
                placeholder="18"
                suffix="%"
              />
            </Field>

            <OtherFees offer={offer} index={index} />
          </div>
        ) : null}
      </div>

      {/* Footer preview ---------------------------------------------------- */}
      {offer.amount > 0 ? (
        <footer className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12px] text-ink-3">
          <span>Money in hand</span>
          <span className="tnum font-medium text-ink-2">
            {formatCompactINR(
              offer.amount -
                pfAmount -
                gstAmount -
                offer.otherFees.reduce((sum, f) => sum + f.amount, 0) -
                (offer.insuranceFunding === "upfront" ? offer.insurancePremium : 0),
            )}
          </span>
        </footer>
      ) : null}
    </section>
  );
}

function OtherFees({ offer, index }: { offer: Offer; index: number }) {
  const { updateOffer } = useCompare();

  const update = (fees: Offer["otherFees"]) => updateOffer(offer.id, { otherFees: fees });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink-2">
          Other charges
        </span>
        <span className="text-[12px] text-ink-3">Legal, valuation, stamp, MODT</span>
      </div>

      {offer.otherFees.map((fee, feeIndex) => (
        <div key={fee.id} className="flex items-center gap-2">
          <input
            aria-label={`Charge name ${feeIndex + 1} for offer ${index + 1}`}
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            placeholder="Charge"
            value={fee.label}
            onChange={(event) =>
              update(
                offer.otherFees.map((f) =>
                  f.id === fee.id ? { ...f, label: event.target.value } : f,
                ),
              )
            }
          />
          <div className="w-28 shrink-0">
            <MoneyInput
              ariaLabel={`Charge amount ${feeIndex + 1} for offer ${index + 1}`}
              value={fee.amount}
              onChange={(amount) =>
                update(offer.otherFees.map((f) => (f.id === fee.id ? { ...f, amount } : f)))
              }
              placeholder="0"
            />
          </div>
          <button
            type="button"
            aria-label={`Remove charge ${feeIndex + 1}`}
            onClick={() => update(offer.otherFees.filter((f) => f.id !== fee.id))}
            className="shrink-0 rounded-lg px-2 py-2 text-[16px] leading-none text-ink-3 transition hover:text-danger"
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          update([
            ...offer.otherFees,
            {
              id:
                typeof crypto !== "undefined" && "randomUUID" in crypto
                  ? crypto.randomUUID()
                  : `f_${Math.random().toString(36).slice(2, 8)}`,
              label: "",
              amount: 0,
            },
          ])
        }
        className="self-start rounded-lg px-1 py-1 text-[13px] font-medium text-accent transition hover:underline"
      >
        + Add a charge
      </button>
    </div>
  );
}
