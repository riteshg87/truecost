"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHead, Screen } from "@/components/health";
import { DecimalInput, Field, MoneyInput, Segmented, TextInput } from "@/components/inputs";
import { isoToday } from "@/lib/health/repo";
import type { LoanRecord, RateBasis, ResetCycle } from "@/lib/health/types";
import { blankLoan, useLoan } from "@/lib/loanStore";

/**
 * Set once, kept on the device.
 *
 * Only five things are genuinely required — balance, rate, term, basis and the
 * last reset. The spread and the sanction figures sharpen the verdict but a
 * loan record that refuses to save without a sanction letter to hand is a
 * record nobody creates.
 */
export default function LoanSetupPage() {
  const router = useRouter();
  const { loan, surplus, bufferMonths, hydrated, saveLoan, setSurplus, setBufferMonths, clearAll } =
    useLoan();

  const [draft, setDraft] = useState<LoanRecord>(blankLoan);
  const [spare, setSpare] = useState(0);
  const [buffer, setBuffer] = useState(0);
  const [loaded, setLoaded] = useState(false);

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

  // Not knowing the spread is the common case — it is on the sanction letter,
  // which nobody has to hand. Infer it rather than block on it.
  const inferredSpread =
    draft.spreadPct > 0 ? draft.spreadPct : Math.max(0, draft.ratePct - 5.75);

  const save = () => {
    saveLoan({
      ...draft,
      lender: draft.lender.trim(),
      original: Math.max(draft.original, draft.outstanding),
      spreadPct: inferredSpread,
      lastReset: draft.lastReset || isoToday(),
    });
    setSurplus(spare);
    setBufferMonths(buffer);
    router.push("/loan");
  };

  return (
    <Screen back={{ href: "/loan", label: "Loan health" }} title="Your loan">
      <PageHead
        title="Your loan"
        sub="Set this once. It stays on this device and greets you next time with a verdict rather than a blank form."
      />

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Lender" hint="For your own reference — we never contact them.">
            <TextInput
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
                draft.spreadPct > 0
                  ? "From your sanction letter. Fixed for the life of the loan."
                  : `Leave it blank and we infer ${inferredSpread.toFixed(2)}% from your rate and the repo.`
              }
              htmlFor="spread"
            >
              <DecimalInput
                id="spread"
                suffix="%"
                value={draft.spreadPct}
                onChange={(spreadPct) => set({ spreadPct })}
                placeholder={inferredSpread.toFixed(2)}
              />
            </Field>

            <Field
              label="Last reset date"
              hint="The date your rate last changed, from a statement."
              htmlFor="reset"
            >
              <input
                id="reset"
                type="date"
                value={draft.lastReset}
                onChange={(event) => set({ lastReset: event.target.value })}
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
        disabled={!ready}
        onClick={save}
        className="mt-5 w-full rounded-xl bg-accent px-4 py-3.5 text-[15px] font-semibold text-accent-ink transition disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-3"
      >
        {ready ? "Save loan on this device" : "Balance, rate and term needed"}
      </button>

      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        Stored in this browser only. Clearing your browser data removes it, and
        there is no copy anywhere else — that is the trade for never sending your
        loan to a server.
      </p>

      {loan ? (
        <button
          type="button"
          onClick={() => {
            clearAll();
            setDraft(blankLoan());
            setSpare(0);
            setBuffer(0);
            router.push("/");
          }}
          className="mt-4 w-full rounded-xl border border-line px-4 py-3 text-[13.5px] font-medium text-ink-3 transition hover:border-danger/50 hover:text-danger"
        >
          Delete this loan from the device
        </button>
      ) : null}
    </Screen>
  );
}
