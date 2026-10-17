import { createComparisonSnapshot, materializeComparison, type ComparisonSnapshot } from "../lib/contracts/snapshot";
import { compareOffers } from "../lib/finance/comparison";
import { errorsFor, validateOffer } from "../lib/finance/validate";
import type { FeeMode, InsuranceFunding, Offer } from "../lib/finance/types";

export interface OfflineOfferForm {
  lender: string;
  amount: string;
  ratePct: string;
  tenureValue: string;
  tenureUnit: "years" | "months";
  feeMode: FeeMode;
  feeValue: string;
  gstPct: string;
  insurancePremium: string;
  insuranceFunding: InsuranceFunding;
  otherFeesTotal: string;
}

export type CalculationResult =
  | { kind: "invalid"; issues: string[] }
  | { kind: "success"; snapshot: Readonly<ComparisonSnapshot> };

function numberField(value: string, label: string): number {
  if (value.trim() === "") throw new Error(`${label} is required`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} is required`);
  return number;
}

export function offerFromForm(form: OfflineOfferForm, id: string): Offer {
  return {
    id,
    lender: form.lender.trim(),
    loanType: "home",
    amount: numberField(form.amount, "Loan amount"),
    ratePct: numberField(form.ratePct, "Interest rate"),
    rateType: "reducing",
    rateStructure: "floating",
    tenureValue: numberField(form.tenureValue, "Tenure"),
    tenureUnit: form.tenureUnit,
    processingFee: { mode: form.feeMode, value: numberField(form.feeValue, "Processing fee") },
    gstPct: numberField(form.gstPct, "GST"),
    insurancePremium: numberField(form.insurancePremium, "Insurance premium"),
    insuranceFunding: form.insuranceFunding,
    otherFees: [{ id: `${id}-other`, label: "Other fees", amount: numberField(form.otherFeesTotal, "Other fees") }],
  };
}

export function calculateOffline(forms: [OfflineOfferForm, OfflineOfferForm]): CalculationResult {
  try {
    const offers = forms.map((form, index) => offerFromForm(form, `guest-offer-${index + 1}`));
    const issues = offers.flatMap((offer, index) => {
      const errors = errorsFor(offer);
      return errors.map((issue) => `Offer ${index + 1}: ${issue.message}`);
    });
    if (issues.length) return { kind: "invalid", issues };
    const comparison = compareOffers(offers);
    return { kind: "success", snapshot: createComparisonSnapshot(offers, comparison) };
  } catch (error) {
    return { kind: "invalid", issues: [error instanceof Error ? error.message : "Check the highlighted values."] };
  }
}

export function comparisonFromSnapshot(snapshot: ComparisonSnapshot) {
  return materializeComparison(snapshot);
}

export function formIssues(form: OfflineOfferForm): string[] {
  try {
    return validateOffer(offerFromForm(form, "validation")).filter((i) => i.level === "error").map((i) => i.message);
  } catch (error) {
    return [error instanceof Error ? error.message : "Check this value."];
  }
}
