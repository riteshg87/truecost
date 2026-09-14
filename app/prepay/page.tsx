"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DecimalInput, Field, MoneyInput, Notice, Segmented } from "@/components/inputs";
import { monthsLabel } from "@/lib/finance/comparison";
import { formatCompactINR, formatINR, formatPct } from "@/lib/finance/format";
import { LOAN_TYPES } from "@/lib/finance/loanTypes";
import { ASSET_PRESETS, SLAB_OPTIONS, deductionsAvailable } from "@/lib/prepay/tax";
import { MIN_BUFFER_MONTHS, recommendPrepay } from "@/lib/prepay/recommend";
import type { AssetClass, PrepayInput } from "@/lib/prepay/types";
import { useLoan } from "@/lib/loanStore";
import { ThemeToggle } from "@/components/ThemeToggle";

const STORAGE_KEY = "truecost.prepay.v1";

function blank(): PrepayInput {
  return {
    loanType: "home",
    outstanding: 0,
    ratePct: 0,
    rateType: "reducing",
    rateStructure: "floating",
    remainingMonths: 0,
    currentEmi: null,
    surplus: 0,
    prepayFeePct: 0,
    otherFees: 0,
    expectedReturnPct: ASSET_PRESETS.equity.returnPct,
    assetClass: "equity",
    taxSlabPct: 30,
    regime: "new",
    claims24b: false,
    claims80c: false,
    prepayMode: "tenure",
    liquidityMonthsAfter: null,
  };
}

function ready(input: PrepayInput): boolean {
  return (
    input.outstanding > 0 &&
    input.ratePct > 0 &&
    input.remainingMonths > 0 &&
    input.surplus > 0
  );
}

export default function PrepayPage() {
  const [input, setInput] = useState<PrepayInput>(blank);
  const [hydrated, setHydrated] = useState(false);
  const { loan, surplus, bufferMonths, hydrated: loanReady } = useLoan();

  useEffect(() => {
    if (!loanReady) return;
    let stored: PrepayInput | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) stored = { ...blank(), ...(JSON.parse(raw) as PrepayInput) };
    } catch {
      // A stale or unreadable blob is not worth a white screen.
    }

    // The loan record is the source of truth for the loan itself. Someone who
    // has already told us their balance and rate once should not be asked for
    // it again on the way to a decision about it.
    if (loan && loan.outstanding > 0) {
      setInput({
        ...(stored ?? blank()),
        outstanding: loan.outstanding,
        ratePct: loan.ratePct,
        rateStructure: loan.basis === "fixed" ? "fixed" : "floating",
        remainingMonths: loan.monthsLeft,
        surplus: stored?.surplus || surplus,
        liquidityMonthsAfter:
          stored?.liquidityMonthsAfter ?? (bufferMonths > 0 ? bufferMonths : null),
      });
    } else if (stored) {
      setInput(stored);
    }
    setHydrated(true);
  }, [loanReady, loan, surplus, bufferMonths]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
    } catch {
      // Private mode. The session still works entirely in memory.
    }
  }, [input, hydrated]);

  const set = (patch: Partial<PrepayInput>) =>
    setInput((prev) => ({ ...prev, ...patch }));

  const complete = ready(input);
  const rec = useMemo(
    () => (complete ? recommendPrepay(input) : null),
    [complete, input],
  );

  const feeWaived =
    input.loanType === "home" && input.rateStructure === "floating";
  const oldRegime = deductionsAvailable(input.regime);
  const path = rec?.scenarios.path ?? null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col lg:max-w-[1180px]">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={loan ? "/loan" : "/"}
            className="-ml-1 rounded-lg px-1 py-1 text-[14px] font-medium text-ink-3 transition hover:text-ink"
          >
            ← {loan ? "Loan health" : "Back"}
          </Link>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">
            Prepay or invest
          </h1>
          <div className="-mr-1 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setInput(blank())}
              className="rounded-lg px-1 py-1 text-[14px] font-medium text-ink-3 transition hover:text-ink"
            >
              Reset
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Two tracks on a wide screen: the figures you change on the left, the
          answer pinned on the right. The whole point of this screen is watching
          one move the other, which a single column an arm's length long hides. */}
      <main className="flex-1 px-5 pb-16 pt-4">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-6">
          {/* ---- Inputs ------------------------------------------------- */}
          <div className="flex flex-col gap-4">
            <Section title="The loan you have" sub={LOAN_TYPES[input.loanType].label}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Outstanding balance" required htmlFor="outstanding">
                  <MoneyInput
                    id="outstanding"
                    value={input.outstanding}
                    onChange={(outstanding) => set({ outstanding })}
                    placeholder="0"
                  />
                </Field>
                <Field label="Current EMI" htmlFor="emi" hint="Optional — checks the figures against your statement.">
                  <MoneyInput
                    id="emi"
                    value={input.currentEmi ?? 0}
                    onChange={(v) => set({ currentEmi: v > 0 ? v : null })}
                    placeholder="Derived if blank"
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Interest rate" required htmlFor="rate">
                  <DecimalInput
                    id="rate"
                    suffix="%"
                    value={input.ratePct}
                    onChange={(ratePct) => set({ ratePct })}
                    placeholder="8.5"
                  />
                </Field>
                <Field label="Months left" required htmlFor="months">
                  <DecimalInput
                    id="months"
                    maxDecimals={0}
                    value={input.remainingMonths}
                    onChange={(remainingMonths) => set({ remainingMonths })}
                    placeholder="180"
                  />
                </Field>
                <Field
                  label="Rate basis"
                  hint={feeWaived ? "Prepay free" : "Exit charges apply"}
                >
                  <Segmented
                    size="sm"
                    ariaLabel="Fixed or floating"
                    value={input.rateStructure}
                    onChange={(rateStructure) => set({ rateStructure })}
                    options={[
                      { value: "floating", label: "Floating" },
                      { value: "fixed", label: "Fixed" },
                    ]}
                  />
                </Field>
              </div>

              {rec && rec.scenarios.emiMismatch !== null &&
              Math.abs(rec.scenarios.emiMismatch) > 100 ? (
                <Notice level="caution">
                  Your stated EMI differs from the one these figures imply by{" "}
                  <strong>{formatINR(Math.abs(rec.scenarios.emiMismatch))}</strong> a
                  month. The balance, rate or remaining term is probably not quite
                  what was entered — everything below rests on it.
                </Notice>
              ) : null}
            </Section>

            <Section
              title="The money you have spare"
              sub="The one figure this whole question turns on."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Surplus amount" required htmlFor="surplus">
                  <MoneyInput
                    id="surplus"
                    value={input.surplus}
                    onChange={(surplus) => set({ surplus })}
                    placeholder="0"
                  />
                </Field>

                {path === "part-payment" ? (
                  <Field
                    label="If you prepay"
                    hint="Tenure kills more interest. EMI frees cash sooner."
                  >
                    <Segmented
                      size="sm"
                      ariaLabel="Prepayment mode"
                      value={input.prepayMode}
                      onChange={(prepayMode) => set({ prepayMode })}
                      options={[
                        { value: "tenure", label: "Cut tenure" },
                        { value: "emi", label: "Cut EMI" },
                      ]}
                    />
                  </Field>
                ) : null}
              </div>

              {path ? (
                <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                  {path === "foreclosure" ? (
                    <>
                      <strong className="text-ink">Foreclosure.</strong> This covers
                      the whole balance, so the loan closes outright and there is no
                      tenure-or-EMI choice left to make.
                    </>
                  ) : (
                    <>
                      <strong className="text-ink">Part payment.</strong> This is{" "}
                      {formatPct((input.surplus / input.outstanding) * 100, 0)} of the
                      balance, so the loan continues — shorter, or lighter.
                    </>
                  )}
                </p>
              ) : null}

              {feeWaived ? (
                <Notice level="info">
                  No prepayment charge applies. RBI bars foreclosure and part-payment
                  fees on floating-rate home loans to individual borrowers, so
                  anything a lender quotes here is worth challenging in writing.
                </Notice>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Prepayment fee" htmlFor="fee">
                    <DecimalInput
                      id="fee"
                      suffix="%"
                      value={input.prepayFeePct}
                      onChange={(prepayFeePct) => set({ prepayFeePct })}
                      placeholder="2"
                    />
                  </Field>
                  <Field label="Other charges" htmlFor="other">
                    <MoneyInput
                      id="other"
                      value={input.otherFees}
                      onChange={(otherFees) => set({ otherFees })}
                      placeholder="0"
                    />
                  </Field>
                </div>
              )}
            </Section>

            <Section
              title="Where else it could go"
              sub="Prepaying has to beat this to be worth doing."
            >
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-end">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(ASSET_PRESETS) as AssetClass[]).map((id) => {
                    const preset = ASSET_PRESETS[id];
                    const selected = id === input.assetClass;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          set({ assetClass: id, expectedReturnPct: preset.returnPct })
                        }
                        className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                          selected
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-line bg-surface text-ink-2 hover:border-line-strong"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <Field label="Expected return" htmlFor="ret">
                  <DecimalInput
                    id="ret"
                    suffix="%"
                    value={input.expectedReturnPct}
                    onChange={(expectedReturnPct) => set({ expectedReturnPct })}
                  />
                </Field>
              </div>
              <p className="text-[12px] leading-snug text-ink-3">
                {ASSET_PRESETS[input.assetClass].note}
              </p>
            </Section>

            {/* Tax and the buffer are both short — they pair up rather than
                each taking a full row to themselves. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Section title="Your tax" sub="It changes both sides of the answer.">
                <Field label="Regime">
                  <Segmented
                    size="sm"
                    ariaLabel="Tax regime"
                    value={input.regime}
                    onChange={(regime) =>
                      set({
                        regime,
                        claims24b: regime === "old" ? input.claims24b : false,
                        claims80c: regime === "old" ? input.claims80c : false,
                      })
                    }
                    options={[
                      { value: "new", label: "New" },
                      { value: "old", label: "Old" },
                    ]}
                  />
                </Field>

                <Field label="Slab" hint="Cess on top — 30% is really 31.2%.">
                  <div className="flex flex-wrap gap-1.5">
                    {SLAB_OPTIONS.map((slab) => (
                      <button
                        key={slab}
                        type="button"
                        aria-pressed={slab === input.taxSlabPct}
                        onClick={() => set({ taxSlabPct: slab })}
                        className={`tnum rounded-full border px-2.5 py-1.5 text-[12.5px] font-medium transition ${
                          slab === input.taxSlabPct
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-line bg-surface text-ink-2 hover:border-line-strong"
                        }`}
                      >
                        {slab}%
                      </button>
                    ))}
                  </div>
                </Field>

                {oldRegime ? (
                  <div className="flex flex-col gap-2">
                    <Check
                      checked={input.claims24b}
                      onChange={(claims24b) => set({ claims24b })}
                      label="I claim interest under 24(b)"
                      hint="Up to ₹2L a year, self-occupied."
                    />
                    <Check
                      checked={input.claims80c}
                      onChange={(claims80c) => set({ claims80c })}
                      label="80C has room for the principal"
                      hint="Usually full from EPF and insurance."
                    />
                  </div>
                ) : (
                  <p className="rounded-xl border border-warn-line bg-warn-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warn">
                    The new regime removes 24(b) and 80C for most borrowers. Your
                    loan costs exactly what it says, which makes prepaying more
                    attractive, not less.
                  </p>
                )}
              </Section>

              <Section
                title="What you would have left"
                sub="Checked before anything else, and it can overrule the arithmetic."
              >
                <Field
                  label="Months of expenses still covered"
                  hint={`Below ${MIN_BUFFER_MONTHS} months neither route is right yet. Blank to skip.`}
                  htmlFor="liq"
                >
                  <DecimalInput
                    id="liq"
                    maxDecimals={0}
                    value={input.liquidityMonthsAfter ?? 0}
                    onChange={(v) => set({ liquidityMonthsAfter: v > 0 ? v : null })}
                    placeholder="e.g. 8"
                  />
                </Field>
              </Section>
            </div>
          </div>

          {/* ---- Answer, pinned ------------------------------------------ */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-[68px]">
            {rec ? (
              <Results rec={rec} input={input} />
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-surface-2 px-5 py-10 text-center">
                <p className="text-[14px] font-medium text-ink-2">
                  Four scenarios appear here
                </p>
                <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-ink-3">
                  A balance, a rate, a remaining term and the surplus you are
                  thinking of deploying. Nothing leaves this device.
                </p>
              </div>
            )}

            <p className="text-[11.5px] leading-relaxed text-ink-3">
              Projections assume the return is earned steadily and the freed cash is
              actually invested every month. Real markets do neither. This is a
              calculation tool, not financial advice.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

function Results({
  rec,
  input,
}: {
  rec: NonNullable<ReturnType<typeof recommendPrepay>>;
  input: PrepayInput;
}) {
  const s = rec.scenarios;
  const partPayment = s.path === "part-payment";

  return (
    <div className="flex flex-col gap-4">
      {/* Four scenarios, all measured to the same date. */}
      <div>
        <h2 className="mb-1.5 px-1 text-[12.5px] font-medium text-ink-2">
          Four ways this plays out, all measured to{" "}
          {monthsLabel(s.horizonMonths)} from now
        </h2>
        <div className="grid grid-cols-2 items-stretch gap-2">
          <Scenario
            label="Do nothing"
            headline={formatCompactINR(s.noPrepay.totalPayable)}
            caption="total still payable"
            lines={[
              [`${formatCompactINR(s.noPrepay.totalInterest)}`, "of it interest"],
              [monthsLabel(s.noPrepay.months), "left to run"],
              // Cash that is neither deployed nor invested simply sits, which is
              // what makes this the baseline the other three are measured against.
              [formatCompactINR(input.surplus), "surplus still idle"],
            ]}
          />

          <Scenario
            label={partPayment ? "Prepay, cut tenure" : "Close the loan"}
            highlight={rec.bestByWealth === "tenure"}
            headline={formatCompactINR(s.reduceTenure.interestSaved)}
            caption="interest saved"
            lines={[
              [monthsLabel(s.reduceTenure.monthsSaved), "off the term"],
              [formatINR(s.reduceTenure.emi), "EMI unchanged"],
              [formatCompactINR(s.reduceTenure.terminalWealth), "you end up with"],
            ]}
          />

          <Scenario
            label="Prepay, cut EMI"
            highlight={rec.bestByWealth === "emi"}
            disabled={!partPayment}
            headline={partPayment ? formatINR(s.reduceEmi.newEmi) : "—"}
            caption={partPayment ? "new EMI" : "not applicable"}
            lines={
              partPayment
                ? [
                    [formatINR(s.reduceEmi.monthlyFreed), "freed each month"],
                    [formatCompactINR(s.reduceEmi.interestSaved), "interest saved"],
                    [formatCompactINR(s.reduceEmi.terminalWealth), "you end up with"],
                  ]
                : [["The balance is cleared", "nothing left to re-spread"]]
            }
          />

          <Scenario
            label="Invest instead"
            highlight={rec.bestByWealth === "invest"}
            headline={formatCompactINR(s.investInstead.corpus)}
            caption="post-tax corpus"
            lines={[
              [formatPct(rec.postTaxReturnPct), "after tax on gains"],
              [formatCompactINR(s.noPrepay.totalInterest), "interest still paid"],
              [formatCompactINR(s.investInstead.terminalWealth), "you end up with"],
            ]}
          />
        </div>
      </div>

      <Verdict rec={rec} input={input} />

      {s.fee > 0 ? (
        <Notice level="caution">
          Prepaying costs <strong>{formatINR(s.fee)}</strong> in charges before it
          saves a rupee.{" "}
          {rec.feeDecisive
            ? "That charge is what tips this to investing — without it, prepaying would end ahead."
            : "It is counted in every figure above."}
        </Notice>
      ) : null}

      <TaxPanel rec={rec} input={input} />
    </div>
  );
}

function Verdict({
  rec,
  input,
}: {
  rec: NonNullable<ReturnType<typeof recommendPrepay>>;
  input: PrepayInput;
}) {
  const asset = ASSET_PRESETS[input.assetClass].label.toLowerCase();

  if (rec.verdict === "build-buffer") {
    return (
      <section className="rounded-2xl border border-warn-line bg-warn-soft px-5 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-warn">
          Recommendation
        </p>
        <h2 className="mt-1.5 text-[21px] font-semibold leading-tight tracking-tight text-ink">
          Neither, yet. Rebuild the buffer first.
        </h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
          Deploying this would leave you{" "}
          <span className="tnum font-semibold text-ink">
            {rec.liquidityMonthsAfter} month
            {rec.liquidityMonthsAfter === 1 ? "" : "s"}
          </span>{" "}
          of expenses, under the {MIN_BUFFER_MONTHS} months worth holding. A lower
          loan balance cannot be spent in a hospital or a redundancy — and the
          alternative to having cash then is borrowing again, at a personal-loan
          rate far above the one you are trying to save.
        </p>
        <p className="mt-2.5 rounded-xl bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
          The arithmetic below still holds, and it will still be there once the
          buffer is back. It just should not decide this.
        </p>
      </section>
    );
  }

  const headline =
    rec.verdict === "invest"
      ? `Investing wins, on these numbers.`
      : rec.verdict === "prepay"
        ? `Prepaying wins, and it wins for certain.`
        : `Close enough that certainty should decide it.`;

  return (
    <section className="rounded-2xl border border-accent-line bg-accent-soft px-5 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
        Recommendation
      </p>
      <h2 className="mt-1.5 text-[21px] font-semibold leading-tight tracking-tight text-ink">
        {headline}
      </h2>

      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
        Your loan really costs{" "}
        <span className="tnum font-semibold text-ink">
          {formatPct(rec.postTaxLoanCostPct)}
        </span>{" "}
        after tax. The {asset} really returns{" "}
        <span className="tnum font-semibold text-ink">
          {formatPct(rec.postTaxReturnPct)}
        </span>{" "}
        after tax. Prepaying earns the first of those{" "}
        <strong>guaranteed</strong>
        {rec.guaranteed ? "" : ", while the second is an average, not a promise"}.
      </p>

      {rec.verdict === "line-ball" ? (
        <p className="mt-2.5 rounded-xl bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
          Investing is ahead by only{" "}
          <span className="tnum font-semibold text-ink">
            {rec.advantagePct.toFixed(2)}
          </span>{" "}
          points, inside the{" "}
          <span className="tnum font-semibold text-ink">
            {rec.requiredPremiumPct.toFixed(2)}
          </span>{" "}
          this asset should clear before its risk is worth taking. A sure{" "}
          {formatPct(rec.postTaxLoanCostPct)} is the better trade unless you hold
          strong views.
        </p>
      ) : (
        <p className="mt-2.5 rounded-xl bg-surface/70 px-3 py-2.5 text-[13px] leading-relaxed text-ink-2">
          {rec.verdict === "invest" ? (
            <>
              It clears the loan by{" "}
              <span className="tnum font-semibold text-ink">
                {rec.advantagePct.toFixed(2)}
              </span>{" "}
              points, past the{" "}
              <span className="tnum font-semibold text-ink">
                {rec.requiredPremiumPct.toFixed(2)}
              </span>{" "}
              this asset should clear to pay for its risk.
            </>
          ) : (
            <>
              The {asset} would have to return{" "}
              <span className="tnum font-semibold text-ink">
                {formatPct(rec.crossoverPct)}
              </span>{" "}
              before tax — not{" "}
              <span className="tnum">{formatPct(input.expectedReturnPct)}</span> —
              before investing would be the better call. That is the crossover,
              and it already prices in the risk premium.
            </>
          )}
        </p>
      )}

      {rec.emiRouteEndsRicher ? (
        <p className="mt-2.5 border-t border-accent-line/70 pt-3 text-[13px] leading-relaxed text-ink-2">
          <span className="font-semibold text-ink">
            If you do prepay, cutting the EMI ends richer here than cutting the
            tenure
          </span>{" "}
          — by{" "}
          <span className="tnum font-semibold text-ink">
            {formatCompactINR(
              rec.scenarios.reduceEmi.terminalWealth -
                rec.scenarios.reduceTenure.terminalWealth,
            )}
          </span>
          . Cutting the tenure saves more interest, but frees a large instalment
          only in the closing months, where it has no time to compound. Cutting
          the EMI frees a smaller sum from month one. It only holds if you
          genuinely invest that difference every month; if it would quietly become
          spending, take the tenure cut, because it is forced saving.
        </p>
      ) : null}
    </section>
  );
}

function TaxPanel({
  rec,
  input,
}: {
  rec: NonNullable<ReturnType<typeof recommendPrepay>>;
  input: PrepayInput;
}) {
  const t = rec.tax;
  return (
    <details className="rounded-2xl border border-line bg-surface-2 px-4 py-3.5">
      <summary className="cursor-pointer list-none text-[13px] font-medium text-ink-2">
        How the post-tax figures are worked out
      </summary>
      <div className="mt-3 flex flex-col gap-2.5 text-[12.5px] leading-relaxed text-ink-3">
        <Line k="Interest over the next year" v={formatINR(t.annualInterest)} />
        <Line k="Deductible under 24(b)" v={formatINR(t.deduction24b)} />
        <Line k="Deductible under 80C" v={formatINR(t.deduction80c)} />
        <Line k="Tax saved" v={formatINR(t.annualTaxSaved)} />
        <Line
          k="Loan cost after tax"
          v={formatPct(rec.postTaxLoanCostPct)}
          strong
        />
        <p className="border-t border-line pt-2.5">
          {t.noShield ? (
            <>
              No deduction applies, so the loan costs its full{" "}
              {formatPct(input.ratePct)}. Prepaying earns exactly that, tax-free,
              which is a return no deposit matches.
            </>
          ) : (
            <>
              The deductions are capped in rupees, not as a share of interest, so
              a larger loan is subsidised on only part of what it costs. Relief is
              applied to the year ahead and held flat — in reality it shrinks each
              year as the interest portion of the EMI falls, which makes prepaying
              gradually more attractive than shown.
            </>
          )}
        </p>
      </div>
    </details>
  );
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex h-full flex-col rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-[var(--shadow-card)]">
      <h2 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h2>
      {sub ? <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{sub}</p> : null}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Scenario({
  label,
  headline,
  caption,
  lines,
  highlight,
  disabled,
}: {
  label: string;
  headline: string;
  caption: string;
  lines: [string, string][];
  highlight?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-2xl border px-3 py-3 ${
        disabled
          ? "border-dashed border-line bg-surface-2 opacity-70"
          : highlight
            ? "border-accent-line bg-accent-soft"
            : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-[11.5px] font-semibold leading-tight text-ink-2">{label}</p>
        {highlight ? (
          <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-ink">
            Best
          </span>
        ) : null}
      </div>

      <p
        className={`tnum mt-1.5 text-[18px] font-semibold leading-none tracking-tight ${
          highlight ? "text-accent" : "text-ink"
        }`}
      >
        {headline}
      </p>
      <p className="mt-1 text-[10px] leading-tight text-ink-3">{caption}</p>

      <dl className="mt-2.5 flex flex-col gap-1 border-t border-line pt-2">
        {lines.map(([value, note]) => (
          <div key={note}>
            <dt className="tnum text-[12px] font-medium text-ink">{value}</dt>
            <dd className="text-[10px] leading-tight text-ink-3">{note}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{k}</span>
      <span className={`tnum ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>
        {v}
      </span>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
      />
      <span>
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="block text-[11.5px] leading-snug text-ink-3">{hint}</span>
      </span>
    </label>
  );
}
