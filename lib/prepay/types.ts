import type { LoanTypeId, RateStructure, RateType } from "../finance/types";

/**
 * Surplus funds: prepay the home loan, or invest the money instead.
 *
 * The question only has an honest answer post-tax on both sides. A home loan at
 * 8.5% does not cost 8.5% if the interest is deducted under 24(b); an FD at 7%
 * does not return 7% once the slab takes its share. Comparing the two headline
 * numbers — which is what every EMI calculator does — gets the answer wrong in
 * both directions depending on the borrower's slab and regime.
 */

/** Which path the money takes, decided purely by size. */
export type PrepayPath = "foreclosure" | "part-payment";

/** Reduce the tenure and keep paying the same EMI, or keep the tenure and pay less. */
export type PrepayMode = "tenure" | "emi";

export type AssetClass = "fd" | "debt" | "equity";

export type TaxRegime = "old" | "new";

export interface AssetPreset {
  id: AssetClass;
  label: string;
  /** Indicative long-run return before tax. Editable — these are a starting point. */
  returnPct: number;
  /** Whether the return is contractual or merely expected. Drives the risk framing. */
  guaranteed: boolean;
  note: string;
}

export interface PrepayInput {
  loanType: LoanTypeId;
  outstanding: number;
  ratePct: number;
  rateType: RateType;
  rateStructure: RateStructure;
  remainingMonths: number;
  /** Optional. Derivable from the rest; when given it is used to check the record. */
  currentEmi: number | null;

  /** The money being deployed. Without it there is no question to answer. */
  surplus: number;

  /** Percent charged to prepay. Nil on a floating home loan by regulation. */
  prepayFeePct: number;
  otherFees: number;

  expectedReturnPct: number;
  assetClass: AssetClass;

  taxSlabPct: number;
  regime: TaxRegime;
  /** Interest deduction under 24(b). Only exists in the old regime for self-occupied. */
  claims24b: boolean;
  /** Principal under 80C — usually already exhausted by EPF and insurance. */
  claims80c: boolean;

  prepayMode: PrepayMode;

  /**
   * Months of living expenses still covered after the surplus is deployed.
   * Null when not answered; the liquidity gate then stays advisory.
   */
  liquidityMonthsAfter: number | null;
}

export interface NoPrepay {
  months: number;
  emi: number;
  totalPayable: number;
  totalInterest: number;
}

export interface ReduceTenure {
  months: number;
  monthsSaved: number;
  emi: number;
  interestPaid: number;
  interestSaved: number;
  /** Surplus + fee + every remaining instalment. */
  totalOutflow: number;
  /** What the freed EMIs, invested from payoff to the original end date, come to. */
  terminalWealth: number;
}

export interface ReduceEmi {
  months: number;
  newEmi: number;
  monthlyFreed: number;
  interestPaid: number;
  interestSaved: number;
  totalOutflow: number;
  /** What the monthly saving, invested across the full remaining term, comes to. */
  terminalWealth: number;
}

export interface InvestInstead {
  /** The surplus compounded at the post-tax expected return to the horizon. */
  corpus: number;
  postTaxReturnPct: number;
  terminalWealth: number;
}

export interface PrepayScenarios {
  path: PrepayPath;
  /** Rupees charged to prepay, fees included. Zero where regulation forbids it. */
  fee: number;
  horizonMonths: number;
  emiMismatch: number | null;

  noPrepay: NoPrepay;
  reduceTenure: ReduceTenure;
  reduceEmi: ReduceEmi;
  investInstead: InvestInstead;
}
