import { ANNUAL_ORDINARY_TAX_SOURCE_VERSION } from "./annual-ordinary-tax";
import {
  buildAccrualInvestmentLedger,
  type AccrualAnnualTaxContext,
  type AccrualAnnualTaxCreditAudit,
  type AccrualInvestmentLedger,
  type AccrualInvestmentInterval,
} from "./accrual-investment";
import {
  buildDatedDeductionLedger,
  type DeductionCashflow,
  type DeductionLedger,
  type DeductionYearPolicy,
} from "./deduction-ledger";
import {
  buildEqualBudgetRouteFunding,
  type EqualBudgetRouteFunding,
  type EqualBudgetRouteFundingInput,
} from "./route-funding";
import { MAX_SCHEDULE_RUPEES } from "./cashflows";

export interface AccrualRouteInput {
  /** The one authoritative schedule used for both funding and deductions. */
  readonly fundingInput: EqualBudgetRouteFundingInput;
  /** Annual contexts are required; fixed tax factors are intentionally excluded. */
  readonly deductionPolicies: readonly DeductionYearPolicy[];
  readonly intervals: readonly AccrualInvestmentInterval[];
  readonly taxSettlement: "settled-from-interest-at-credit";
}

export interface AccrualRouteBenefits {
  readonly receivedByHorizon: readonly DeductionCashflow[];
  readonly reinvestedByHorizon: readonly DeductionCashflow[];
  readonly retainedByHorizon: readonly DeductionCashflow[];
  readonly futureReceipts: readonly DeductionCashflow[];
}

export interface AccrualRouteAudit {
  readonly sourceVersion: typeof ANNUAL_ORDINARY_TAX_SOURCE_VERSION;
  readonly taxYears: readonly string[];
  readonly deductionAssessments: readonly NonNullable<DeductionLedger["years"][number]["annualAssessment"]>[];
  readonly investmentAssessments: readonly AccrualAnnualTaxCreditAudit[];
  readonly taxSettlement: "settled-from-interest-at-credit";
}

export interface AccrualRouteValuation {
  readonly funding: EqualBudgetRouteFunding;
  readonly deductions: DeductionLedger;
  readonly interestLedger: AccrualInvestmentLedger;
  readonly benefits: AccrualRouteBenefits;
  readonly totalRetainedCash: number;
  readonly terminalInvestedBalance: number;
  readonly remainingDebt: number;
  readonly terminalNetPosition: number;
  readonly audit: AccrualRouteAudit;
  readonly financiallySupported: false;
  readonly financialReviewRequired: true;
  readonly methodologyReviewed: false;
}

export type AccrualRouteResult =
  | { readonly kind: "ok"; readonly value: AccrualRouteValuation }
  | { readonly kind: "unsupported"; readonly reason: string; readonly id?: string; readonly date?: string; readonly financialYear?: number; readonly cause?: string }
  | { readonly kind: "invalid"; readonly reason: string; readonly id?: string; readonly date?: string; readonly period?: number };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SCHEDULE_RUPEES;
}

function sumFinite(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!finiteMoney(total)) return null;
  }
  return total;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function invalid(reason: string, details: { id?: string; date?: string; period?: number } = {}): AccrualRouteResult {
  return { kind: "invalid", reason, ...details };
}

/**
 * Compose one route from one dated loan schedule, annual deduction contexts,
 * explicit accrual intervals, and dated funding/benefit contributions. This
 * performs arithmetic only. It does not supply rates, eligibility, or legal
 * recognition/payment rules.
 */
export function buildAccrualRouteValuation(input: AccrualRouteInput | null | undefined): AccrualRouteResult {
  if (!record(input) || !record(input.fundingInput) || !Array.isArray(input.deductionPolicies) || !Array.isArray(input.intervals)) {
    return invalid("invalid-accrual-route-input");
  }
  if (input.taxSettlement !== "settled-from-interest-at-credit") return { kind: "unsupported", reason: "missing-tax-settlement" };
  if (input.deductionPolicies.length === 0) return { kind: "unsupported", reason: "annual-tax-context-missing" };
  if (input.intervals.length === 0) return invalid("invalid-intervals");

  for (const policy of input.deductionPolicies) {
    if (!record(policy)) return invalid("invalid-deduction-policy");
    if (policy.effectiveTaxFactor !== undefined) return invalid("fixed-tax-factor-not-supported", { period: typeof policy.financialYear === "number" ? policy.financialYear : undefined });
    if (!record(policy.annualTaxContext)) return { kind: "unsupported", reason: "annual-tax-context-missing" };
  }

  const fundingResult = buildEqualBudgetRouteFunding(input.fundingInput);
  if (fundingResult.kind === "invalid") return { kind: "invalid", reason: fundingResult.reason, date: fundingResult.date, period: fundingResult.period };
  const funding = fundingResult.value;
  const deductionResult = buildDatedDeductionLedger({ schedule: input.fundingInput.schedule, policies: input.deductionPolicies });
  if (deductionResult.kind === "unsupported") return { kind: "unsupported", reason: deductionResult.reason, financialYear: deductionResult.financialYear };
  if (deductionResult.kind === "invalid") return { kind: "invalid", reason: deductionResult.reason, period: deductionResult.period };
  const deductions = deductionResult.value;

  const firstInterval = input.intervals[0];
  const lastInterval = input.intervals[input.intervals.length - 1];
  if (!record(firstInterval) || !record(lastInterval) || !validDate(firstInterval.startDate) || !validDate(lastInterval.endDate)) {
    return invalid("invalid-interval-range");
  }
  const anchorDate = funding.entries[0].date;
  const horizonDate = funding.entries[funding.entries.length - 1].date;
  if (firstInterval.startDate !== anchorDate) return invalid("interval-anchor-mismatch", { date: firstInterval.startDate });
  if (lastInterval.endDate !== horizonDate) return invalid("interval-horizon-mismatch", { date: lastInterval.endDate });

  const annualContexts: AccrualAnnualTaxContext[] = [];
  const contextYears = new Set<string>();
  for (const policy of input.deductionPolicies) {
    const context = policy.annualTaxContext!;
    if (contextYears.has(context.taxYear)) return invalid("duplicate-annual-tax-context", { date: context.taxYear });
    const deductionYear = deductions.years.find((year) => year.financialYear === policy.financialYear);
    if (!deductionYear) return { kind: "unsupported", reason: "annual-tax-context-missing" };
    contextYears.add(context.taxYear);
    annualContexts.push({ ...context, eligibleRouteDeduction: deductionYear.interestUsed + deductionYear.principalUsed });
  }
  const deductionAssessments = deductions.years.map((year) => year.annualAssessment).filter((assessment): assessment is NonNullable<typeof assessment> => assessment !== undefined);
  if (deductionAssessments.length !== deductions.years.length) return { kind: "unsupported", reason: "annual-tax-context-missing" };

  const receivedByHorizon: DeductionCashflow[] = [];
  const reinvestedByHorizon: DeductionCashflow[] = [];
  const retainedByHorizon: DeductionCashflow[] = [];
  const futureReceipts: DeductionCashflow[] = [];
  const benefitContributions: Array<{ readonly id: string; readonly date: string; readonly amount: number }> = [];
  for (const benefit of deductions.benefitCashflows) {
    if (benefit.amount <= 0) continue;
    if (benefit.date < anchorDate) return invalid("benefit-before-funding-anchor", { date: benefit.date });
    if (benefit.date > horizonDate) {
      futureReceipts.push(benefit);
      continue;
    }
    receivedByHorizon.push(benefit);
    if (benefit.reinvested) {
      reinvestedByHorizon.push(benefit);
      benefitContributions.push({ id: `benefit:${benefit.financialYear}`, date: benefit.date, amount: benefit.amount });
    } else {
      retainedByHorizon.push(benefit);
    }
  }
  const fundingContributions = funding.entries
    .filter((entry) => entry.investmentContribution > 0)
    .map((entry) => ({ id: `funding:${entry.date}`, date: entry.date, amount: entry.investmentContribution }));
  const contributions = [...fundingContributions, ...benefitContributions];

  const interestResult = buildAccrualInvestmentLedger({
    intervals: input.intervals,
    contributions,
    taxSettlement: input.taxSettlement,
    annualTaxContexts: annualContexts,
  });
  if (interestResult.kind === "unsupported") return interestResult;
  if (interestResult.kind === "invalid") return interestResult;
  const interestLedger = interestResult.value;
  const retainedBenefitCash = sumFinite(retainedByHorizon.map((benefit) => benefit.amount));
  if (retainedBenefitCash === null) return invalid("arithmetic-overflow");
  const totalRetainedCash = interestLedger.retainedCash + retainedBenefitCash;
  const terminalInvestedBalance = interestLedger.terminalInvestedBalance;
  const remainingDebt = funding.remainingDebtAtHorizon;
  const totalAssets = terminalInvestedBalance + totalRetainedCash;
  const terminalNetPosition = terminalInvestedBalance + totalRetainedCash - remainingDebt;
  if (!finiteMoney(totalRetainedCash) || !finiteMoney(terminalInvestedBalance) || !finiteMoney(remainingDebt) || !finiteMoney(totalAssets) ||
      !Number.isFinite(terminalNetPosition) || Math.abs(terminalNetPosition) > MAX_SCHEDULE_RUPEES) return invalid("arithmetic-overflow");

  const investmentAssessments = interestLedger.rows
    .map((row) => row.annualTaxAudit)
    .filter((assessment): assessment is AccrualAnnualTaxCreditAudit => assessment !== undefined);
  return {
    kind: "ok",
    value: {
      funding,
      deductions,
      interestLedger,
      benefits: { receivedByHorizon, reinvestedByHorizon, retainedByHorizon, futureReceipts },
      totalRetainedCash,
      terminalInvestedBalance,
      remainingDebt,
      terminalNetPosition,
      audit: {
        sourceVersion: ANNUAL_ORDINARY_TAX_SOURCE_VERSION,
        taxYears: annualContexts.map((context) => context.taxYear),
        deductionAssessments,
        investmentAssessments,
        taxSettlement: input.taxSettlement,
      },
      financiallySupported: false,
      financialReviewRequired: true,
      methodologyReviewed: false,
    },
  };
}
