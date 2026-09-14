import { emiFor } from "../finance/core";
import { isoToday, monthsBetween, repoOn } from "./repo";
import type {
  LoanRecord,
  RateVerdict,
  ResetCycle,
  TransferQuote,
  TransferResult,
} from "./types";

/**
 * Reading a loan record against the published benchmark.
 *
 * The claim this makes is narrow on purpose. We cannot see the rate a lender
 * actually applied — only what the borrower typed in and what the benchmark
 * did. So the output is a prompt to check a statement, never an accusation of
 * overcharging, and the wording throughout has to hold that line.
 */

const CYCLE_MONTHS: Record<ResetCycle, number> = {
  monthly: 1,
  quarterly: 3,
  half: 6,
};

/** A gap smaller than this is rounding, not a missed reset. */
export const RATE_EPSILON = 0.01;

export function rateVerdict(loan: LoanRecord, today: string = isoToday()): RateVerdict {
  const monthlyRate = loan.ratePct / 12 / 100;
  const emi = emiFor(loan.outstanding, monthlyRate, loan.monthsLeft);

  const base = {
    emi,
    repoThen: null,
    repoNow: null,
    shouldBePct: null,
    gapPct: null,
    monthlyExcess: null,
    resetOverdue: false,
  };

  // A fixed loan does not track anything, so there is nothing to be late.
  if (loan.basis === "fixed") {
    return { ...base, kind: "fixed", tone: "neutral" };
  }

  // MCLR re-prices on the bank's own schedule rather than the benchmark's, so
  // the arithmetic below would be measuring against the wrong thing.
  if (loan.basis === "mclr") {
    return { ...base, kind: "mclr", tone: "warn" };
  }

  // T-bill linked loans follow a benchmark we do not carry a history for.
  if (loan.basis === "tbill") {
    return { ...base, kind: "unknown", tone: "neutral" };
  }

  const repoThen = repoOn(loan.lastReset);
  const repoNow = repoOn(today);
  const shouldBePct = repoNow + loan.spreadPct;
  const gapPct = loan.ratePct - shouldBePct;

  const sinceReset = monthsBetween(loan.lastReset, today);
  const resetOverdue = sinceReset > CYCLE_MONTHS[loan.cycle];

  if (gapPct <= RATE_EPSILON) {
    return {
      ...base,
      kind: "ontrack",
      tone: "good",
      repoThen,
      repoNow,
      shouldBePct,
      gapPct,
      monthlyExcess: 0,
      resetOverdue: false,
    };
  }

  // Interest for one month on the balance, at the gap. Not a precise
  // amortisation figure — the balance falls — but the right order of size for
  // "what this is costing while nobody has looked at it".
  const monthlyExcess = (gapPct / 100 / 12) * loan.outstanding;

  return {
    ...base,
    kind: "stale",
    tone: "warn",
    repoThen,
    repoNow,
    shouldBePct,
    gapPct,
    monthlyExcess,
    resetOverdue,
  };
}

/**
 * Whether moving the loan elsewhere pays.
 *
 * Two rules keep this honest. The comparison runs over the tenure already held,
 * so an offer that merely stretches the term cannot look cheaper by pushing
 * payments beyond the horizon. And a break-even is only a saving if you are
 * still holding the loan when it arrives.
 */
export const BREAK_EVEN_LIMIT_MONTHS = 24;

export function transferResult(
  loan: LoanRecord,
  quote: TransferQuote,
): TransferResult {
  const months = quote.keepTenure ? loan.monthsLeft : quote.newTenureMonths;
  const rNow = loan.ratePct / 12 / 100;
  const rNew = quote.newRatePct / 12 / 100;

  const emiNow = emiFor(loan.outstanding, rNow, loan.monthsLeft);
  const emiNew = emiFor(loan.outstanding, rNew, months);

  const processingFee = Math.max(0, (loan.outstanding * quote.feePct) / 100);
  const gst = processingFee * 0.18;
  const costToSwitch = processingFee + gst + Math.max(0, quote.legalCharges);

  const interestNow = emiNow * loan.monthsLeft - loan.outstanding;
  const interestNew = emiNew * months - loan.outstanding;
  const netSaving = interestNow - interestNew - costToSwitch;

  const monthlySaving = emiNow - emiNew;
  const breakEvenMonth =
    monthlySaving > 0 ? Math.ceil(costToSwitch / monthlySaving) : null;

  // Nobody knows they will hold a loan for another fifteen years. Past two
  // years a break-even is a bet on that, not a saving.
  const worthIt =
    netSaving > 0 &&
    breakEvenMonth !== null &&
    breakEvenMonth <= BREAK_EVEN_LIMIT_MONTHS;

  return {
    emiNow,
    emiNew,
    monthlySaving,
    processingFee,
    gst,
    costToSwitch,
    breakEvenMonth,
    netSaving,
    interestNow,
    interestNew,
    worthIt,
    lengthened: !quote.keepTenure && quote.newTenureMonths > loan.monthsLeft,
  };
}

/** Interest still to run, and what a lump sum against the balance would save. */
export function prepaySnapshot(loan: LoanRecord, surplus: number) {
  const r = loan.ratePct / 12 / 100;
  const emi = emiFor(loan.outstanding, r, loan.monthsLeft);
  const baseInterest = emi * loan.monthsLeft - loan.outstanding;

  const applied = Math.min(Math.max(0, surplus), loan.outstanding);
  let balance = loan.outstanding - applied;
  let months = 0;
  let interest = 0;

  if (balance > 0 && emi > balance * r) {
    while (balance > 0.5 && months < 1200) {
      const charge = balance * r;
      const payment = Math.min(emi, balance + charge);
      balance = balance + charge - payment;
      interest += charge;
      months += 1;
    }
  }

  return {
    emi,
    baseInterest,
    interestAfter: interest,
    interestSaved: baseInterest - interest,
    monthsAfter: months,
    monthsSaved: Math.max(0, loan.monthsLeft - months),
  };
}
