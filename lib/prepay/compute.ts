import { emiFor, flatToReducing } from "../finance/core";
import { postTaxReturnPct } from "./tax";
import type { PrepayInput, PrepayPath, PrepayScenarios } from "./types";

/**
 * The four scenarios, all measured to the same date.
 *
 * Every route commits the same money: the same surplus at the start and the
 * same EMI every month after. What differs is where it goes. Prepaying buys a
 * guaranteed return equal to the loan rate and frees cash later; investing
 * keeps the loan running and buys an uncertain return now. Measuring both as
 * wealth at the original payoff date is the only way to compare them without
 * quietly flattering one — and it puts the prepayment fee where it belongs, as
 * a real drag on the prepay side rather than a footnote.
 */

/** Bigger than any retail loan can run; a guard, not an expectation. */
const MAX_MONTHS = 1200;

export function prepayPathFor(outstanding: number, surplus: number): PrepayPath {
  return surplus >= outstanding && outstanding > 0 ? "foreclosure" : "part-payment";
}

/**
 * Fee to prepay, in rupees.
 *
 * RBI bars foreclosure and prepayment charges on floating-rate home loans to
 * individual borrowers, so the honest figure there is nil no matter what is
 * typed in. On a fixed-rate loan the charge is levied on the outstanding when
 * closing and on the amount tendered when part-paying.
 */
export function prepayFee(input: PrepayInput): number {
  const protectedByRule =
    input.loanType === "home" && input.rateStructure === "floating";
  if (protectedByRule) return 0;

  const path = prepayPathFor(input.outstanding, input.surplus);
  const base =
    path === "foreclosure"
      ? input.outstanding
      : Math.min(input.surplus, input.outstanding);

  return Math.max(0, (base * input.prepayFeePct) / 100) + Math.max(0, input.otherFees);
}

/** The monthly reducing rate the schedule actually runs on. */
export function monthlyRateFor(input: PrepayInput): number {
  if (input.rateType === "flat") {
    return flatToReducing(input.outstanding, input.ratePct, input.remainingMonths)
      .monthlyRate;
  }
  return input.ratePct / 12 / 100;
}

/** Amortise a balance at a fixed instalment until it clears. */
function runOff(principal: number, monthlyRate: number, emi: number) {
  let balance = principal;
  let months = 0;
  let interest = 0;
  let paid = 0;

  if (principal <= 0) return { months: 0, interest: 0, paid: 0, clears: true };
  // An instalment that never covers the interest leaves the balance growing.
  if (emi <= principal * monthlyRate) {
    return { months: MAX_MONTHS, interest: NaN, paid: NaN, clears: false };
  }

  while (balance > 0.005 && months < MAX_MONTHS) {
    const charge = balance * monthlyRate;
    const payment = Math.min(emi, balance + charge);
    balance = balance + charge - payment;
    interest += charge;
    paid += payment;
    months += 1;
  }

  return { months, interest, paid, clears: balance <= 0.005 };
}

/** Future value of a monthly contribution compounded at a monthly rate. */
export function futureValueOfSeries(
  monthly: number,
  monthlyRate: number,
  months: number,
): number {
  if (months <= 0 || monthly <= 0) return 0;
  if (monthlyRate <= 0) return monthly * months;
  return monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

export function computePrepay(input: PrepayInput): PrepayScenarios {
  const horizonMonths = Math.max(1, Math.round(input.remainingMonths));
  const outstanding = Math.max(0, input.outstanding);
  const monthlyRate = monthlyRateFor(input);

  const emi = emiFor(outstanding, monthlyRate, horizonMonths);
  const emiMismatch =
    input.currentEmi && input.currentEmi > 0 ? input.currentEmi - emi : null;

  const path = prepayPathFor(outstanding, input.surplus);
  const fee = prepayFee(input);

  const applied = Math.min(Math.max(0, input.surplus), outstanding);
  const excess = Math.max(0, input.surplus - applied);

  // The rate the invested money actually grows at, after its own tax.
  const netReturnPct = postTaxReturnPct(
    input.expectedReturnPct,
    input.assetClass,
    input.taxSlabPct,
  );
  const investMonthly = netReturnPct / 12 / 100;

  /* --- 1. Leave it alone -------------------------------------------------- */
  const noPrepayInterest = emi * horizonMonths - outstanding;
  const noPrepay = {
    months: horizonMonths,
    emi,
    totalPayable: emi * horizonMonths,
    totalInterest: noPrepayInterest,
  };

  /* --- 2. Prepay, keep the EMI, finish sooner ----------------------------- */
  const balanceAfter = Math.max(0, outstanding - applied);
  const shortened = runOff(balanceAfter, monthlyRate, emi);
  const tenureMonths = shortened.clears ? shortened.months : horizonMonths;
  const monthsSaved = Math.max(0, horizonMonths - tenureMonths);

  // Once the loan clears, the instalment is free to invest until the original
  // end date. Any surplus beyond the balance was never needed and compounds
  // from day one.
  const reduceTenure = {
    months: tenureMonths,
    monthsSaved,
    emi,
    interestPaid: shortened.clears ? shortened.interest : noPrepayInterest,
    interestSaved: noPrepayInterest - (shortened.clears ? shortened.interest : noPrepayInterest),
    totalOutflow: applied + fee + (shortened.clears ? shortened.paid : emi * horizonMonths),
    terminalWealth:
      futureValueOfSeries(emi, investMonthly, monthsSaved) +
      excess * Math.pow(1 + investMonthly, horizonMonths),
  };

  /* --- 3. Prepay, keep the term, pay less each month ---------------------- */
  const newEmi = balanceAfter > 0 ? emiFor(balanceAfter, monthlyRate, horizonMonths) : 0;
  const monthlyFreed = Math.max(0, emi - newEmi);
  const reducedInterest = newEmi * horizonMonths - balanceAfter;

  const reduceEmi = {
    months: horizonMonths,
    newEmi,
    monthlyFreed,
    interestPaid: reducedInterest,
    interestSaved: noPrepayInterest - reducedInterest,
    totalOutflow: applied + fee + newEmi * horizonMonths,
    terminalWealth:
      futureValueOfSeries(monthlyFreed, investMonthly, horizonMonths) +
      excess * Math.pow(1 + investMonthly, horizonMonths),
  };

  /* --- 4. Keep the loan, invest the surplus -------------------------------- */
  const corpus = Math.max(0, input.surplus) * Math.pow(1 + investMonthly, horizonMonths);
  const investInstead = {
    corpus,
    postTaxReturnPct: netReturnPct,
    terminalWealth: corpus,
  };

  return {
    path,
    fee,
    horizonMonths,
    emiMismatch,
    noPrepay,
    reduceTenure,
    reduceEmi,
    investInstead,
  };
}
