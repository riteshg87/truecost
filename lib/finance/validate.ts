import { LOAN_TYPES } from "./loanTypes";
import { monthsFromTenure } from "./core";
import type { Offer } from "./types";

export type IssueLevel = "error" | "nudge";

export interface FieldIssue {
  field: "amount" | "ratePct" | "tenure" | "processingFee" | "gstPct";
  level: IssueLevel;
  message: string;
}

/**
 * Errors block the comparison. Nudges never do — they surface an assumption
 * the user may not have noticed, which is different from getting it wrong.
 */
export function validateOffer(offer: Offer): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const config = LOAN_TYPES[offer.loanType];

  if (!(offer.amount > 0)) {
    issues.push({ field: "amount", level: "error", message: "Enter the loan amount." });
  } else if (offer.amount < 1000) {
    issues.push({
      field: "amount",
      level: "nudge",
      message: "That looks unusually small — check you have not dropped a zero.",
    });
  }

  if (!(offer.ratePct > 0)) {
    issues.push({ field: "ratePct", level: "error", message: "Enter the interest rate." });
  } else if (offer.ratePct > 60) {
    issues.push({
      field: "ratePct",
      level: "nudge",
      message: "Above 60% a year. Confirm this is an annual rate, not a monthly one.",
    });
  } else if (offer.rateType === "reducing" && offer.ratePct < config.typicalRatePct / 2) {
    issues.push({
      field: "ratePct",
      level: "nudge",
      message: `Well below the usual range for a ${config.short.toLowerCase()} loan — is this a teaser rate that resets later?`,
    });
  }

  const months = monthsFromTenure(offer.tenureValue, offer.tenureUnit);
  const [minYears, maxYears] = config.tenureBoundsYears;
  if (!(months > 0)) {
    issues.push({ field: "tenure", level: "error", message: "Enter the tenure." });
  } else if (months / 12 > maxYears) {
    issues.push({
      field: "tenure",
      level: "nudge",
      message: `Longer than ${maxYears} years is rare for this product.`,
    });
  } else if (months / 12 < minYears) {
    issues.push({
      field: "tenure",
      level: "nudge",
      message: `Shorter than ${minYears < 1 ? `${minYears * 12} months` : `${minYears} year${minYears === 1 ? "" : "s"}`} is rare for this product.`,
    });
  }

  if (offer.processingFee.value === 0) {
    issues.push({
      field: "processingFee",
      level: "nudge",
      message:
        "Set to zero. Genuine waivers exist, but check the sanction letter before assuming one.",
    });
  } else if (offer.processingFee.mode === "percent" && offer.processingFee.value > 5) {
    issues.push({
      field: "processingFee",
      level: "nudge",
      message: "Above 5% of the loan. Confirm this is a percentage and not a rupee figure.",
    });
  }

  if (offer.gstPct !== 18) {
    issues.push({
      field: "gstPct",
      level: "nudge",
      message: "GST on lending fees is 18% unless something unusual applies.",
    });
  }

  return issues;
}

export function errorsFor(offer: Offer): FieldIssue[] {
  return validateOffer(offer).filter((issue) => issue.level === "error");
}

export function issueFor(issues: FieldIssue[], field: FieldIssue["field"]) {
  return issues.find((issue) => issue.field === field) ?? null;
}

export function allOffersReady(offers: Offer[]): boolean {
  return offers.length >= 2 && offers.every((offer) => errorsFor(offer).length === 0);
}
