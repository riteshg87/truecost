import {
  amortisationSchedule,
  emiFor,
  flatToReducing,
  monthsFromTenure,
} from "./core";
import { LOAN_TYPES } from "./loanTypes";
import type {
  AmortRow,
  Derived,
  FeeInput,
  Offer,
  Warning,
} from "./types";
import { aprFor } from "./xirr";

export function feeAmount(fee: FeeInput, base: number): number {
  if (fee.mode === "percent") return (base * fee.value) / 100;
  return fee.value;
}

/** Cash flow series from the borrower's side: money in at t=0, EMIs out after. */
export function borrowerCashFlows(
  cashInHand: number,
  emi: number,
  months: number,
): number[] {
  const flows = new Array<number>(months + 1);
  flows[0] = cashInHand;
  for (let i = 1; i <= months; i++) flows[i] = -emi;
  return flows;
}

export function computeOffer(offer: Offer): Derived {
  const config = LOAN_TYPES[offer.loanType];
  const warnings: Warning[] = [];

  const tenureMonths = Math.max(1, monthsFromTenure(offer.tenureValue, offer.tenureUnit));
  const amount = Math.max(0, offer.amount);

  const insurance = Math.max(0, offer.insurancePremium || 0);
  const financedInsurance = offer.insuranceFunding === "financed" ? insurance : 0;
  const upfrontInsurance = offer.insuranceFunding === "upfront" ? insurance : 0;
  const financedPrincipal = amount + financedInsurance;

  // --- Rate. A flat quote is converted to its reducing equivalent up front so
  // every downstream number is on one basis.
  let monthlyRate: number;
  let effectiveReducingRatePct: number;

  if (offer.rateType === "flat") {
    const converted = flatToReducing(financedPrincipal, offer.ratePct, tenureMonths);
    monthlyRate = converted.monthlyRate;
    effectiveReducingRatePct = converted.annualPct;
    warnings.push({
      level: "caution",
      code: "flat-rate",
      message: `Quoted at ${offer.ratePct}% flat, which behaves like ${converted.annualPct.toFixed(2)}% reducing.`,
    });
  } else {
    monthlyRate = offer.ratePct / 12 / 100;
    effectiveReducingRatePct = offer.ratePct;
  }

  const emi = emiFor(financedPrincipal, monthlyRate, tenureMonths);
  const totalRepayment = emi * tenureMonths;
  const totalInterest = totalRepayment - financedPrincipal;

  // --- Fees. Processing fee is charged on the sanctioned amount, not on the
  // financed principal, which is how lenders actually compute it.
  const processingFeeAmount = feeAmount(offer.processingFee, amount);
  const gstAmount = (processingFeeAmount * (offer.gstPct ?? 0)) / 100;
  const otherFeesTotal = (offer.otherFees ?? []).reduce(
    (sum, item) => sum + (item.amount || 0),
    0,
  );

  const upfrontFees = processingFeeAmount + gstAmount + otherFeesTotal;
  const netDisbursal = amount - upfrontFees;
  const cashInHand = netDisbursal - upfrontInsurance;

  const totalCostOfBorrowing = totalInterest + upfrontFees + insurance;

  const aprResult = aprFor(borrowerCashFlows(cashInHand, emi, tenureMonths));
  const apr = aprResult?.aprPct ?? null;
  const costPerLakh = amount > 0 ? totalCostOfBorrowing / (amount / 100000) : 0;

  // --- Flags worth surfacing on the offer itself.
  if (offer.gstPct !== 18 && processingFeeAmount > 0) {
    warnings.push({
      level: "info",
      code: "gst-edited",
      message: `GST on the processing fee is set to ${offer.gstPct}% instead of the standard 18%.`,
    });
  }
  if (amount > 0 && upfrontFees / amount > 0.03) {
    warnings.push({
      level: "caution",
      code: "high-fees",
      message: `Upfront charges are ${((upfrontFees / amount) * 100).toFixed(1)}% of the loan — high enough to move the effective rate noticeably.`,
    });
  }
  if (financedInsurance > 0) {
    warnings.push({
      level: "caution",
      code: "financed-insurance",
      message: `The ₹${Math.round(financedInsurance).toLocaleString("en-IN")} premium is financed, so you pay interest on it for the full tenure.`,
    });
  }
  if (apr !== null && apr - effectiveReducingRatePct > 1) {
    warnings.push({
      level: "info",
      code: "apr-gap",
      message: `Fees push the real cost ${(apr - effectiveReducingRatePct).toFixed(2)} points above the quoted ${effectiveReducingRatePct.toFixed(2)}%.`,
    });
  }
  if (config.rateTypeLocked && offer.rateType === "flat") {
    warnings.push({
      level: "caution",
      code: "unexpected-flat",
      message: `${config.label}s are not normally quoted flat. Double-check the sanction letter.`,
    });
  }

  return {
    tenureMonths,
    monthlyRate,
    effectiveReducingRatePct,
    financedPrincipal,
    emi,
    totalRepayment,
    totalInterest,
    processingFeeAmount,
    gstAmount,
    otherFeesTotal,
    upfrontInsurance,
    upfrontFees,
    netDisbursal,
    cashInHand,
    totalCostOfBorrowing,
    monthlyIrr: aprResult?.monthlyIrr ?? null,
    effectiveAprPct: apr,
    effectiveAnnualRatePct: aprResult?.effectiveAnnualPct ?? null,
    costPerLakh,
    warnings,
  };
}

export function scheduleFor(derived: Derived): AmortRow[] {
  return amortisationSchedule(
    derived.financedPrincipal,
    derived.monthlyRate,
    derived.tenureMonths,
    derived.emi,
  );
}

/** Interest paid in each of the first N years — the "front-loading" view. */
export function interestByYear(rows: AmortRow[]): number[] {
  const years: number[] = [];
  rows.forEach((row) => {
    const year = Math.floor((row.month - 1) / 12);
    years[year] = (years[year] ?? 0) + row.interest;
  });
  return years;
}
