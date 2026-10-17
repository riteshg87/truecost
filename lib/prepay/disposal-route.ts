import { validateDate } from "./dates";
import type { DeductionCashflow, DeductionLedger } from "./deduction-ledger";
import { buildDisposalTaxLedger, type DisposalTaxLedger, type ExemptionHeadroomInput, type LossTreatment } from "./investment-tax-ledger";
import { buildInvestmentGrowthLedger, validateGrowthGrid, type GrowthInterval, type InvestmentGrowthLedger } from "./investment-growth";
import type { EqualBudgetRouteFunding } from "./route-funding";
import { ANNUAL_ORDINARY_TAX_SOURCE_VERSION } from "./annual-ordinary-tax";

export interface DisposalLotPolicy {
  readonly lotId: string;
  readonly eligibleExpenseAmount: number;
  readonly effectiveTaxFactor: number;
  readonly exemptionEligible: boolean;
}

export interface DisposalRouteInput {
  readonly funding: EqualBudgetRouteFunding;
  readonly deductionLedger: DeductionLedger;
  readonly growthIntervals: readonly GrowthInterval[];
  readonly disposalPolicies: readonly DisposalLotPolicy[];
  readonly exemptionHeadroom: readonly ExemptionHeadroomInput[];
  readonly lossTreatment: LossTreatment;
}

export interface DisposalRouteBenefits {
  readonly receivedByHorizon: readonly DeductionCashflow[];
  readonly reinvestedByHorizon: readonly DeductionCashflow[];
  readonly retainedByHorizon: readonly DeductionCashflow[];
  readonly futureReceipts: readonly DeductionCashflow[];
}

export interface DisposalRouteSupport {
  readonly kind: "arithmetic-only";
  readonly financiallySupported: false;
  readonly methodologyReviewed: false;
  readonly note: string;
}

export interface DisposalRouteValuation {
  readonly funding: EqualBudgetRouteFunding;
  readonly growth: InvestmentGrowthLedger | null;
  readonly tax: DisposalTaxLedger | null;
  readonly benefits: DisposalRouteBenefits;
  readonly terminalPortfolioNet: number;
  readonly retainedCash: number;
  readonly remainingDebt: number;
  readonly terminalNetPosition: number;
  readonly futureReceipts: readonly DeductionCashflow[];
  readonly support: DisposalRouteSupport;
}

export type DisposalRouteResult =
  | { readonly kind: "ok"; readonly value: DisposalRouteValuation }
  | { readonly kind: "unsupported"; readonly reason: "off-grid-contribution-date"; readonly lotId?: string }
  | { readonly kind: "invalid"; readonly reason: string; readonly lotId?: string; readonly financialYear?: number };

const arithmeticOnlySupport: DisposalRouteSupport = Object.freeze({
  kind: "arithmetic-only",
  financiallySupported: false,
  methodologyReviewed: false,
  note: "Rates, eligibility, recognition timing, and loss policy are supplied inputs; this composer does not establish financial support.",
});

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { validateDate(value); return true; } catch { return false; }
}

function validFinancialYear(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1900 && value <= 9999;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sumFinite(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 64;
}

function taxYearLabel(financialYear: number): string {
  return `${financialYear}-${String((financialYear + 1) % 100).padStart(2, "0")}`;
}

/** Validate the immutable annual assessor provenance carried by annual rows. */
function validAnnualAssessment(year: Record<string, unknown>): boolean {
  if (year.effectiveTaxFactor !== null || !record(year.annualAssessment)) return false;
  const annual = year.annualAssessment;
  if (annual.taxYear !== taxYearLabel(year.financialYear as number) ||
      annual.taxActVersion !== "2025" ||
      annual.sourceVersion !== ANNUAL_ORDINARY_TAX_SOURCE_VERSION ||
      annual.financiallySupported !== false || annual.financialReviewRequired !== true || annual.methodologyReviewed !== false) return false;
  if (!record(annual.assessment) || annual.assessment.sourceVersion !== ANNUAL_ORDINARY_TAX_SOURCE_VERSION ||
      annual.assessment.financiallySupported !== false || annual.assessment.financialReviewRequired !== true ||
      annual.assessment.methodologyReviewed !== false || annual.assessment.telescopeInvariant !== true) return false;
  const assessment = annual.assessment;
  const numeric = [assessment.deductionBenefit, assessment.investmentTaxCost, assessment.netTaxEffect,
    assessment.rawDeductionBenefit, assessment.rawInvestmentTaxCost, assessment.rawNetTaxEffect];
  const baselineIncome = assessment.baselineOrdinaryTaxableIncome;
  const withDeductionIncome = assessment.withDeductionOrdinaryTaxableIncome;
  const withInvestmentIncome = assessment.withInvestmentOrdinaryTaxableIncome;
  const deductionAmount = (year.interestUsed as number) + (year.principalUsed as number);
  if (!numeric.every(finiteNonnegative) || !closeEnough(assessment.investmentTaxCost as number, 0) ||
      !closeEnough(assessment.rawInvestmentTaxCost as number, 0) ||
      !closeEnough(assessment.netTaxEffect as number, assessment.deductionBenefit as number) ||
      !closeEnough(assessment.rawNetTaxEffect as number, assessment.rawDeductionBenefit as number) ||
      !closeEnough(assessment.deductionBenefit as number, year.taxBenefit as number) ||
      !finiteNonnegative(baselineIncome) || !finiteNonnegative(withDeductionIncome) || !finiteNonnegative(withInvestmentIncome) ||
      !closeEnough(withDeductionIncome as number, (baselineIncome as number) - deductionAmount) ||
      !closeEnough(withInvestmentIncome as number, withDeductionIncome as number)) return false;
  const baselineAudit = assessment.baselineAudit;
  const withDeductionAudit = assessment.withDeductionAudit;
  const withInvestmentAudit = assessment.withInvestmentAudit;
  if (!record(baselineAudit) || !record(withDeductionAudit) || !record(withInvestmentAudit) ||
      !finiteNonnegative(baselineAudit.totalTax) || !finiteNonnegative(withDeductionAudit.totalTax) ||
      !finiteNonnegative(withInvestmentAudit.totalTax) || !finiteNonnegative(baselineAudit.rawTotalTax) ||
      !finiteNonnegative(withDeductionAudit.rawTotalTax) || !finiteNonnegative(withInvestmentAudit.rawTotalTax) ||
      !closeEnough(assessment.deductionBenefit as number, (baselineAudit.totalTax as number) - (withDeductionAudit.totalTax as number)) ||
      !closeEnough(assessment.rawDeductionBenefit as number, (baselineAudit.rawTotalTax as number) - (withDeductionAudit.rawTotalTax as number)) ||
      !closeEnough(withInvestmentAudit.totalTax as number, withDeductionAudit.totalTax as number) ||
      !closeEnough(withInvestmentAudit.rawTotalTax as number, withDeductionAudit.rawTotalTax as number)) return false;
  return assessment.roundingMode === "raw-unrounded-arithmetic" || assessment.roundingMode === "statutory-section-516";
}

function validateFunding(funding: unknown): string | null {
  if (!record(funding) || !Array.isArray(funding.entries) || funding.entries.length < 2) return "invalid-funding";
  const entries = funding.entries as EqualBudgetRouteFunding["entries"];
  let previousDate = "";
  for (const entry of entries) {
    if (!record(entry) || !validDate(entry.date)) return "invalid-funding-entry";
    if (previousDate !== "" && entry.date <= previousDate) return "non-chronological-funding";
    if (![entry.externalBudget, entry.interest, entry.scheduledPrincipal, entry.scheduledPayment, entry.immediatePrincipal, entry.fee, entry.loanCashUse, entry.investmentContribution, entry.remainingDebt].every(finiteNonnegative)) return "invalid-funding-entry";
    if (!closeEnough(entry.externalBudget, entry.loanCashUse + entry.investmentContribution)) return "funding-cash-mismatch";
    previousDate = entry.date;
  }
  if (!record(funding.totals) || !finiteNonnegative(funding.remainingDebtAtHorizon)) return "invalid-funding-total";
  const totals = funding.totals as unknown as EqualBudgetRouteFunding["totals"];
  if (![totals.externalBudget, totals.investmentContribution, totals.loanCashUse, totals.interest, totals.scheduledPrincipal, totals.immediatePrincipal, totals.fees].every(finiteNonnegative)) return "invalid-funding-total";
  const fields = ["externalBudget", "investmentContribution", "loanCashUse", "interest", "scheduledPrincipal", "immediatePrincipal", "fees"] as const;
  for (const field of fields) {
    const values = field === "fees" ? entries.map((entry) => entry.fee) : entries.map((entry) => entry[field]);
    const total = sumFinite(values);
    if (total === null || !closeEnough(total, totals[field])) return "funding-total-mismatch";
  }
  if (!closeEnough(funding.remainingDebtAtHorizon, entries[entries.length - 1].remainingDebt)) return "funding-debt-mismatch";
  return null;
}

function validateDeductionLedger(ledger: unknown): string | null {
  if (!record(ledger) || !Array.isArray(ledger.years) || !Array.isArray(ledger.benefitCashflows) || !finiteNonnegative(ledger.totalTaxBenefit)) return "invalid-deduction-ledger";
  const years = new Set<number>();
  const yearRows = new Map<number, Record<string, unknown>>();
  for (const year of ledger.years) {
    if (!record(year) || !validFinancialYear(year.financialYear) || years.has(year.financialYear)) return "invalid-deduction-year";
    if (![year.actualInterest, year.actualScheduledPrincipal, year.actualImmediatePrincipal, year.eligibleInterest, year.eligiblePrincipal, year.interestUsed, year.principalUsed, year.interestRemainingCapacity, year.principalRemainingCapacity, year.taxBenefit].every(finiteNonnegative) || !validDate(year.benefitReceiptDate) || typeof year.reinvestBenefits !== "boolean") return "invalid-deduction-year";
    const annualMode = year.effectiveTaxFactor === null;
    if (annualMode ? !validAnnualAssessment(year) : typeof year.effectiveTaxFactor !== "number" || !finiteNonnegative(year.effectiveTaxFactor) || year.annualAssessment !== undefined) return "invalid-deduction-year";
    years.add(year.financialYear);
    yearRows.set(year.financialYear, year);
  }
  const receiptYears = new Set<number>();
  let receiptTotal = 0;
  for (const row of ledger.benefitCashflows) {
    if (!record(row) || !validFinancialYear(row.financialYear)) return "invalid-benefit-year";
    if (!yearRows.has(row.financialYear)) return "unmatched-benefit-year";
    if (receiptYears.has(row.financialYear)) return "duplicate-benefit-year";
    receiptYears.add(row.financialYear);
    if (!validDate(row.date) || !finiteNonnegative(row.amount) || typeof row.reinvested !== "boolean") return "invalid-benefit-receipt";
    const year = yearRows.get(row.financialYear)!;
    if (year.benefitReceiptDate !== row.date || year.reinvestBenefits !== row.reinvested || !closeEnough(year.taxBenefit as number, row.amount)) return "deduction-receipt-mismatch";
    receiptTotal += row.amount;
    if (!Number.isFinite(receiptTotal)) return "arithmetic-overflow";
  }
  if (ledger.benefitCashflows.length !== yearRows.size || !closeEnough(receiptTotal, ledger.totalTaxBenefit)) return "deduction-total-mismatch";
  return null;
}

function validateHeadroomRows(rows: unknown): string | null {
  if (!Array.isArray(rows)) return "invalid-route-tax-input";
  const years = new Set<number>();
  for (const row of rows) {
    if (!record(row) || !validFinancialYear(row.financialYear) || years.has(row.financialYear)) return "invalid-exemption-headroom";
    if (!finiteNonnegative(row.amount)) return "invalid-exemption-headroom";
    years.add(row.financialYear);
  }
  return null;
}

function validatePolicy(policy: unknown): string | null {
  if (!record(policy) || !validId(policy.lotId)) return "invalid-disposal-policy";
  if (!finiteNonnegative(policy.eligibleExpenseAmount) || typeof policy.effectiveTaxFactor !== "number" || !Number.isFinite(policy.effectiveTaxFactor) || policy.effectiveTaxFactor < 0 || policy.effectiveTaxFactor > 1 || typeof policy.exemptionEligible !== "boolean") return "invalid-disposal-policy";
  return null;
}

/**
 * Values one route using only explicit funding, growth, deduction receipts,
 * and disposal policies. This is a composer for arithmetic primitives, not a
 * tax-policy resolver or a claim that the resulting route is financially
 * supported.
 */
export function buildDisposalRouteValuation(input: DisposalRouteInput): DisposalRouteResult {
  if (!record(input)) return { kind: "invalid", reason: "invalid-route-input" };
  const fundingError = validateFunding(input.funding);
  if (fundingError) return { kind: "invalid", reason: fundingError };
  const deductionError = validateDeductionLedger(input.deductionLedger);
  if (deductionError) return { kind: "invalid", reason: deductionError };
  if (!Array.isArray(input.growthIntervals)) return { kind: "invalid", reason: "invalid-growth-grid" };
  if (!Array.isArray(input.disposalPolicies) || !Array.isArray(input.exemptionHeadroom)) return { kind: "invalid", reason: "invalid-route-tax-input" };

  const gridCheck = validateGrowthGrid(input.growthIntervals);
  if (gridCheck.kind === "invalid") return gridCheck;

  const anchorDate = input.funding.entries[0].date;
  const horizonDate = input.funding.entries[input.funding.entries.length - 1].date;
  if (input.growthIntervals[0].startDate !== anchorDate) return { kind: "invalid", reason: "growth-anchor-mismatch" };
  if (input.growthIntervals[input.growthIntervals.length - 1].endDate !== horizonDate) return { kind: "invalid", reason: "growth-horizon-mismatch" };
  const headroomError = validateHeadroomRows(input.exemptionHeadroom);
  if (headroomError) return { kind: "invalid", reason: headroomError };
  if (input.lossTreatment !== "no-current-tax-credit") return { kind: "invalid", reason: "invalid-loss-treatment" };

  const benefits = input.deductionLedger.benefitCashflows;
  const receivedByHorizon: DeductionCashflow[] = [];
  const reinvestedByHorizon: DeductionCashflow[] = [];
  const retainedByHorizon: DeductionCashflow[] = [];
  const futureReceipts: DeductionCashflow[] = [];
  for (const benefit of benefits) {
    if (benefit.date < anchorDate) return { kind: "invalid", reason: "benefit-before-funding-anchor", financialYear: benefit.financialYear };
    if (benefit.amount <= 0) continue;
    if (benefit.date > horizonDate) {
      futureReceipts.push(benefit);
    } else {
      receivedByHorizon.push(benefit);
      if (benefit.reinvested) reinvestedByHorizon.push(benefit);
      else retainedByHorizon.push(benefit);
    }
  }

  const fundingContributions = input.funding.entries
    .filter((entry) => entry.investmentContribution > 0)
    .map((entry) => ({ lotId: `funding:${entry.date}`, date: entry.date, amount: entry.investmentContribution }));
  const benefitContributions = reinvestedByHorizon.map((benefit) => ({ lotId: `benefit:${benefit.financialYear}`, date: benefit.date, amount: benefit.amount }));
  const contributions = [...fundingContributions, ...benefitContributions];
  const policyById = new Map<string, DisposalLotPolicy>();
  for (const policy of input.disposalPolicies) {
    const error = validatePolicy(policy);
    if (error) return { kind: "invalid", reason: error, lotId: record(policy) && typeof policy.lotId === "string" ? policy.lotId : undefined };
    if (policyById.has(policy.lotId)) return { kind: "invalid", reason: "duplicate-disposal-policy", lotId: policy.lotId };
    policyById.set(policy.lotId, policy);
  }
  for (const contribution of contributions) {
    if (!policyById.has(contribution.lotId)) return { kind: "invalid", reason: "missing-disposal-policy", lotId: contribution.lotId };
  }
  for (const policyId of policyById.keys()) {
    if (!contributions.some((contribution) => contribution.lotId === policyId)) return { kind: "invalid", reason: "unmatched-disposal-policy", lotId: policyId };
  }

  let growth: InvestmentGrowthLedger | null = null;
  let tax: DisposalTaxLedger | null = null;
  if (contributions.length > 0) {
    const growthResult = buildInvestmentGrowthLedger({ intervals: input.growthIntervals, contributions });
    if (growthResult.kind === "unsupported") return growthResult;
    if (growthResult.kind === "invalid") return growthResult;
    growth = growthResult.value;
    const taxResult = buildDisposalTaxLedger({
      lots: growth.lots.map((lot) => {
        const policy = policyById.get(lot.lotId)!;
        return { lotId: lot.lotId, costBasis: lot.cost, acquisitionDate: lot.acquisitionDate, disposalDate: lot.disposalDate, grossProceeds: lot.grossProceeds, eligibleExpenseAmount: policy.eligibleExpenseAmount, effectiveTaxFactor: policy.effectiveTaxFactor, exemptionEligible: policy.exemptionEligible };
      }),
      exemptionHeadroom: input.exemptionHeadroom,
      lossTreatment: input.lossTreatment,
    });
    if (taxResult.kind === "unsupported") return { kind: "invalid", reason: taxResult.reason };
    if (taxResult.kind === "invalid") return taxResult;
    tax = taxResult.value;
  } else if (policyById.size > 0) {
    return { kind: "invalid", reason: "unmatched-disposal-policy", lotId: policyById.keys().next().value };
  }
  if (contributions.length === 0 && input.exemptionHeadroom.length > 0) return { kind: "invalid", reason: "unmatched-exemption-headroom" };

  const retainedCash = sumFinite(retainedByHorizon.map((benefit) => benefit.amount));
  if (retainedCash === null) return { kind: "invalid", reason: "arithmetic-overflow" };
  const terminalPortfolioNet = tax?.totalNetProceeds ?? 0;
  const remainingDebt = input.funding.remainingDebtAtHorizon;
  const terminalNetPosition = terminalPortfolioNet + retainedCash - remainingDebt;
  if (!Number.isFinite(terminalNetPosition)) return { kind: "invalid", reason: "arithmetic-overflow" };
  return {
    kind: "ok",
    value: {
      funding: input.funding,
      growth,
      tax,
      benefits: { receivedByHorizon, reinvestedByHorizon, retainedByHorizon, futureReceipts },
      terminalPortfolioNet,
      retainedCash,
      remainingDebt,
      terminalNetPosition,
      futureReceipts,
      support: arithmeticOnlySupport,
    },
  };
}
