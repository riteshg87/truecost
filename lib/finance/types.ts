/**
 * Domain types for the True Cost Comparison flow.
 *
 * Money is always rupees (not paise) as a JS number. Loan sizes in the Indian
 * retail market top out well inside 2^53, so float error is immaterial next to
 * the rounding lenders themselves apply to EMIs.
 */

export type LoanTypeId =
  | "home"
  | "auto"
  | "personal"
  | "gold"
  | "business"
  | "education";

export type RateType = "reducing" | "flat";
export type FeeMode = "percent" | "flat";
export type TenureUnit = "months" | "years";
export type InsuranceFunding = "financed" | "upfront";

export interface FeeInput {
  mode: FeeMode;
  /** Percent of sanctioned amount when mode is "percent", else absolute rupees. */
  value: number;
}

export interface OtherFeeItem {
  id: string;
  label: string;
  amount: number;
}

/** Everything the user keys in for a single offer. */
export interface Offer {
  id: string;
  lender: string;
  loanType: LoanTypeId;
  amount: number;
  ratePct: number;
  rateType: RateType;
  tenureValue: number;
  tenureUnit: TenureUnit;
  processingFee: FeeInput;
  /** Defaulted to 18 and editable, but never a field the user has to think about. */
  gstPct: number;
  insurancePremium: number;
  insuranceFunding: InsuranceFunding;
  otherFees: OtherFeeItem[];
}

export type WarningLevel = "info" | "caution";

export interface Warning {
  level: WarningLevel;
  code: string;
  message: string;
}

export interface AmortRow {
  month: number;
  opening: number;
  emi: number;
  interest: number;
  principal: number;
  closing: number;
}

/** Everything computed from an Offer. Never stored — always derived. */
export interface Derived {
  tenureMonths: number;
  /** The reducing-balance monthly rate actually used for the schedule. */
  monthlyRate: number;
  /** Annualised reducing rate. Equals ratePct unless the input was flat. */
  effectiveReducingRatePct: number;
  /** Principal the EMI is actually computed on (includes financed insurance). */
  financedPrincipal: number;

  emi: number;
  totalRepayment: number;
  totalInterest: number;

  processingFeeAmount: number;
  gstAmount: number;
  otherFeesTotal: number;
  upfrontInsurance: number;
  /** Fees deducted at disbursal: PF + GST + other. Matches lender sanction letters. */
  upfrontFees: number;

  /** Sanctioned amount less upfront fees. */
  netDisbursal: number;
  /** What actually reaches the borrower at t=0, after an upfront insurance premium too. */
  cashInHand: number;

  totalCostOfBorrowing: number;
  /** Monthly IRR of the real cash flows. Null only if unsolvable. */
  monthlyIrr: number | null;
  /** Headline APR (monthly IRR x 12). The number offers are ranked on. */
  effectiveAprPct: number | null;
  /** The same cash flows compounded monthly. Shown as detail, not headline. */
  effectiveAnnualRatePct: number | null;
  costPerLakh: number;

  warnings: Warning[];
}
