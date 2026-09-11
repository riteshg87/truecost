import type { AmortRow } from "./types";

/** Equated monthly instalment on a reducing balance. */
export function emiFor(
  principal: number,
  monthlyRate: number,
  months: number,
): number {
  if (months <= 0 || principal <= 0) return 0;
  if (monthlyRate <= 0) return principal / months;
  const growth = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * growth) / (growth - 1);
}

/**
 * Invert emiFor: given an EMI, find the reducing monthly rate that produces it.
 *
 * emiFor is strictly increasing in the rate, so plain bisection is both
 * bulletproof and fast enough — 200 halvings of [0, 1] lands far below any
 * precision we can display. No closed form exists, which is exactly why
 * "10% flat" and "10% reducing" get quoted as if they were comparable.
 */
export function monthlyRateFromEmi(
  principal: number,
  emi: number,
  months: number,
): number {
  if (months <= 0 || principal <= 0) return 0;
  // An EMI that never repays more than the principal implies a zero rate.
  if (emi * months <= principal) return 0;

  let lo = 0;
  let hi = 1; // 100% per month — no retail product comes close.
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (emiFor(principal, mid, months) < emi) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Convert a quoted flat rate into the reducing rate that costs the same.
 *
 * Flat interest is charged on the full principal for the whole tenure, even
 * though the borrower is repaying it monthly. The equivalent reducing rate is
 * very roughly 1.8x the flat rate at typical retail tenures.
 */
export function flatToReducing(
  principal: number,
  flatAnnualPct: number,
  months: number,
): { monthlyRate: number; annualPct: number; emi: number } {
  const years = months / 12;
  const totalInterest = principal * (flatAnnualPct / 100) * years;
  const emi = (principal + totalInterest) / months;
  const monthlyRate = monthlyRateFromEmi(principal, emi, months);
  return { monthlyRate, annualPct: monthlyRate * 12 * 100, emi };
}

/** Full amortisation schedule. The final row absorbs accumulated rounding. */
export function amortisationSchedule(
  principal: number,
  monthlyRate: number,
  months: number,
  emi: number,
): AmortRow[] {
  const rows: AmortRow[] = [];
  let balance = principal;

  for (let month = 1; month <= months; month++) {
    const interest = balance * monthlyRate;
    const isLast = month === months;
    let principalPaid = emi - interest;
    let payment = emi;

    if (isLast) {
      principalPaid = balance;
      payment = balance + interest;
    }

    const closing = isLast ? 0 : balance - principalPaid;
    rows.push({
      month,
      opening: balance,
      emi: payment,
      interest,
      principal: principalPaid,
      closing,
    });
    balance = closing;
  }

  return rows;
}

export function monthsFromTenure(value: number, unit: "months" | "years") {
  return unit === "years" ? Math.round(value * 12) : Math.round(value);
}
