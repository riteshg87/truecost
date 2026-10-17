"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHead, Screen } from "@/components/health";
import { FormError } from "@/components/mobile";
import { LoanSyncStatus } from "@/components/LoanSyncStatus";
import { privateWriteError } from "@/lib/private-storage/messages";
import { useViewLifetime } from "@/lib/use-view-lifetime";
import { DecimalInput, Field, MoneyInput, Segmented, TextInput } from "@/components/inputs";
import type { LoanRecord, RateBasis, ResetCycle } from "@/lib/health/types";
import { blankLoan, useLoan } from "@/lib/loanStore";

/**
 * Stage one complete loan update for the verified account's private outbox.
 *
 * Balance, rate, term and basis keep the record useful. Spread and reset
 * details sharpen the verdict when they are confirmed from loan documents.
 */
export default function LoanSetupPage() {
  const router = useRouter();
  const isCurrentView = useViewLifetime();
  const { loan, surplus, bufferMonths, hydrated, saveLoan } =
    useLoan();

  const [draft, setDraft] = useState<LoanRecord>(() => ({
    ...blankLoan(),
    spreadPct: null,
    spreadProvenance: "unknown",
    lastResetProvenance: "unknown",
  }));
  const [spare, setSpare] = useState(0);
  const [buffer, setBuffer] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || loaded) return;
    if (loan) setDraft(loan);
    setSpare(surplus);
    setBuffer(bufferMonths);
    setLoaded(true);
  }, [hydrated, loaded, loan, surplus, bufferMonths]);

  const set = (patch: Partial<LoanRecord>) => setDraft((prev) => ({ ...prev, ...patch }));

  const ready =
    draft.outstanding > 0 && draft.ratePct > 0 && draft.monthsLeft > 0;

  const save = async () => {
    if (!ready || !hydrated || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveLoan({
        ...draft,
        lender: draft.lender.trim(),
        original: Math.max(draft.original, draft.outstanding),
        spreadPct: draft.spreadPct,
        spreadProvenance: draft.spreadProvenance ?? (draft.spreadPct === null ? "unknown" : "legacy"),
        lastReset: draft.lastReset,
        lastResetProvenance: draft.lastResetProvenance ?? (draft.lastReset ? "legacy" : "unknown"),
      }, { surplus: spare, bufferMonths: buffer });
      if (!isCurrentView()) return;
      const error = privateWriteError(result);
      if (error) setSaveError(error);
      else router.push("/loan");
    } catch {
      setSaveError("Your loan could not be saved. Keep this form open and try again.");
    } finally { setSaving(false); }
  };

  return (
    <Screen back={{ href: "/loan", label: "Loan Health Monitor" }} title="Your loan">
      <PageHead
        title="Your loan"
        sub="Add your loan details. Once the save is confirmed, you can open them on another device."
      />
      <LoanSyncStatus />

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Lender" htmlFor="lender" hint="For your own reference. We never contact them.">
            <TextInput
              id="lender"
              value={draft.lender}
              onChange={(lender) => set({ lender })}
              placeholder="HDFC Bank"
            />
          </Field>
        </div>

        <Field label="Outstanding balance" required htmlFor="outstanding">
          <MoneyInput
            id="outstanding"
            value={draft.outstanding}
            onChange={(outstanding) => set({ outstanding })}
            placeholder="0"
          />
        </Field>

        <Field
          label="Original principal"
          hint="Only used to show how far you have come."
          htmlFor="original"
        >
          <MoneyInput
            id="original"
            value={draft.original}
            onChange={(original) => set({ original })}
            placeholder="0"
          />
        </Field>

        <Field label="Interest rate" required htmlFor="rate">
          <DecimalInput
            id="rate"
            suffix="%"
            value={draft.ratePct}
            onChange={(ratePct) => set({ ratePct })}
            placeholder="8.5"
          />
        </Field>

        <Field label="Months remaining" required htmlFor="months">
          <DecimalInput
            id="months"
            maxDecimals={0}
            value={draft.monthsLeft}
            onChange={(monthsLeft) => set({ monthsLeft })}
            placeholder="214"
          />
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="Rate basis"
            hint="On your sanction letter. Loans taken after October 2019 are usually repo-linked."
          >
            <Segmented
              size="sm"
              ariaLabel="Rate basis"
              value={draft.basis}
              onChange={(basis: RateBasis) => set({ basis })}
              options={[
                { value: "repo", label: "Repo" },
                { value: "tbill", label: "T-bill" },
                { value: "mclr", label: "MCLR" },
                { value: "fixed", label: "Fixed" },
              ]}
            />
          </Field>
        </div>

        {draft.basis === "repo" ? (
          <>
            <Field
              label="Your spread over the benchmark"
              hint={
                draft.spreadProvenance === "confirmed"
                  ? "Confirmed from your loan documents."
                  : draft.spreadProvenance === "legacy" && draft.spreadPct !== null
                    ? "Saved from an older record. Re-enter this value to confirm it from your sanction letter."
                    : "Optional. Leave it blank until you can confirm it from your sanction letter."
              }
              htmlFor="spread"
            >
              <div className="relative">
                <input
                  id="spread"
                  type="number"
                  min="-100"
                  max="100"
                  step="0.01"
                  value={draft.spreadPct ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    set({
                      spreadPct: value === "" ? null : Number(value),
                      spreadProvenance: value === "" ? "unknown" : "confirmed",
                    });
                  }}
                  placeholder="e.g. 2.75"
                  className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 pr-12 text-[16px] font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] font-medium text-ink-3">%</span>
              </div>
            </Field>

            <Field
              label="Last reset date"
              hint={
                draft.lastResetProvenance === "legacy"
                  ? "Saved from an older record. Re-enter this date to confirm it from a statement."
                  : "Optional. Enter the date your rate last changed, from a statement."
              }
              htmlFor="reset"
            >
              <input
                id="reset"
                type="date"
                value={draft.lastReset}
                onChange={(event) => set({ lastReset: event.target.value, lastResetProvenance: event.target.value ? "confirmed" : "unknown" })}
                className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[16px] font-medium text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
            </Field>

            <div className="sm:col-span-2">
              <Field
                label="Reset cycle"
                hint="External-benchmark loans must re-price at least once a quarter."
              >
                <Segmented
                  size="sm"
                  ariaLabel="Reset cycle"
                  value={draft.cycle}
                  onChange={(cycle: ResetCycle) => set({ cycle })}
                  options={[
                    { value: "monthly", label: "Monthly" },
                    { value: "quarterly", label: "Quarterly" },
                    { value: "half", label: "Half-yearly" },
                  ]}
                />
              </Field>
            </div>
          </>
        ) : null}

        <Field
          label="Surplus you're weighing"
          hint="Optional. Carries into the prepay screen so nothing is re-entered."
          htmlFor="surplus"
        >
          <MoneyInput
            id="surplus"
            value={spare}
            onChange={setSpare}
            placeholder="0"
          />
        </Field>

        <Field
          label="Months of expenses in reserve"
          hint="Checked before any prepay verdict. Below six months, nothing else matters."
          htmlFor="buffer"
        >
          <DecimalInput
            id="buffer"
            maxDecimals={0}
            value={buffer}
            onChange={setBuffer}
            placeholder="8"
          />
        </Field>
      </div>

      <button
        type="button"
        disabled={!ready || !hydrated || saving}
        onClick={save}
        className="mt-5 w-full rounded-xl bg-accent px-4 py-3.5 text-[15px] font-semibold text-accent-ink transition disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-3"
      >
        {saving ? "Preparing save…" : ready ? "Save loan" : "Balance, rate and term needed"}
      </button>
      <FormError>{saveError}</FormError>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        Changes are queued privately on this browser. The save status confirms
        when your account has received them.
      </p>

      {loan ? (
        <button
          type="button"
          onClick={() => router.push("/account")}
          className="mt-4 w-full rounded-xl border border-line px-4 py-3 text-[13.5px] font-medium text-ink-3 transition hover:border-danger/50 hover:text-danger"
        >
          Manage or delete this loan
        </button>
      ) : null}
    </Screen>
  );
}
