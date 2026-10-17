import { indianFinancialYear, validateDate } from "./dates";
import { MAX_SCHEDULE_RUPEES } from "./cashflows";
import type { DatedLoanSchedule, DatedLoanScheduleRow } from "./cashflows";
import { assessAnnualRouteFromContext, type AnnualContextAdapterInput, type AnnualContextAdapterValue, type AnnualContextAdapterUnsupportedReason } from "./annual-context-adapter";

export type DeductionAnnualTaxContext = Pick<AnnualContextAdapterInput, "taxProfile" | "taxYear" | "eligibilityReviewed">;

export interface DeductionYearPolicy {
  /** Indian financial-year start, for example 2026 means FY 2026-27. */
  readonly financialYear: number;
  readonly interestEligible: boolean;
  readonly principalEligible: boolean;
  /** Remaining headroom is an input, so zero is meaningful and supported. */
  readonly interestHeadroom: number;
  readonly principalHeadroom: number;
  /** Explicit scenario factor, such as 0.312; omitted in annual-assessment mode. */
  readonly effectiveTaxFactor?: number;
  /** Validated annual context; mutually exclusive with effectiveTaxFactor. */
  readonly annualTaxContext?: DeductionAnnualTaxContext;
  readonly benefitReceiptDate: string;
  readonly reinvestBenefits: boolean;
  /** Immediate prepayment is separate from scheduled principal repayment. */
  readonly immediatePrincipalEligible: boolean;
}

export interface DeductionCashflow {
  readonly financialYear: number;
  readonly date: string;
  readonly amount: number;
  readonly reinvested: boolean;
}

export interface DeductionYearLedger {
  readonly financialYear: number;
  readonly interestEligible: boolean;
  readonly principalEligible: boolean;
  readonly actualInterest: number;
  readonly actualScheduledPrincipal: number;
  readonly actualImmediatePrincipal: number;
  readonly eligibleInterest: number;
  readonly eligiblePrincipal: number;
  readonly interestUsed: number;
  readonly principalUsed: number;
  readonly interestRemainingCapacity: number;
  readonly principalRemainingCapacity: number;
  /** Null identifies annual-assessment mode; the annual audit is authoritative. */
  readonly effectiveTaxFactor: number | null;
  readonly taxBenefit: number;
  readonly annualAssessment?: AnnualContextAdapterValue;
  readonly benefitReceiptDate: string;
  readonly reinvestBenefits: boolean;
  readonly immediatePrincipalEligible: boolean;
}

export interface DeductionLedger {
  readonly years: readonly DeductionYearLedger[];
  readonly benefitCashflows: readonly DeductionCashflow[];
  readonly totalTaxBenefit: number;
}

export type DeductionLedgerUnsupportedReason =
  | "missing-schedule-year"
  | "missing-payment-date"
  | "missing-policy"
  | "missing-policy-year"
  | "missing-headroom"
  | "missing-receipt-date"
  | "missing-tax-factor"
  | "missing-reinvestment-choice"
  | "missing-annual-tax-context"
  | AnnualContextAdapterUnsupportedReason;

export type DeductionLedgerResult =
  | { readonly kind: "ok"; readonly value: DeductionLedger }
  | { readonly kind: "unsupported"; readonly reason: DeductionLedgerUnsupportedReason; readonly financialYear?: number; readonly period?: number }
  | { readonly kind: "invalid"; readonly reason: string; readonly financialYear?: number; readonly period?: number };

function finiteNonnegative(value: unknown, label: string, maximum = MAX_SCHEDULE_RUPEES): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function taxYearLabel(financialYear: number): string {
  return `${financialYear}-${String((financialYear + 1) % 100).padStart(2, "0")}`;
}

function validAnnualContext(value: unknown): value is DeductionAnnualTaxContext {
  return record(value) && record(value.taxProfile) && typeof value.taxYear === "string" &&
    value.taxYear.trim().length > 0 && typeof value.eligibilityReviewed === "boolean";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function validYear(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1900 && value <= 9999;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 64;
}

function validateScheduleRow(row: unknown): DeductionLedgerResult | null {
  if (!row || typeof row !== "object") return { kind: "invalid", reason: "invalid-schedule-row" };
  const value = row as Partial<DatedLoanScheduleRow>;
  if (!Number.isSafeInteger(value.period) || (value.period as number) < 0) return { kind: "invalid", reason: "invalid-period" };
  if (value.date === undefined || value.date === null || value.date === "") {
    return { kind: "unsupported", reason: "missing-payment-date", period: value.period as number };
  }
  if (typeof value.date !== "string") return { kind: "invalid", reason: "invalid-payment-date", period: value.period as number };
  try { validateDate(value.date); } catch { return { kind: "invalid", reason: "invalid-payment-date", period: value.period as number }; }
  if (!validYear(value.financialYear)) return { kind: "unsupported", reason: "missing-schedule-year", period: value.period as number };
  if (indianFinancialYear(value.date) !== value.financialYear) return { kind: "invalid", reason: "mismatched-financial-year", financialYear: value.financialYear, period: value.period as number };
  const numericFields: Array<keyof DatedLoanScheduleRow> = ["openingBalance", "interest", "scheduledPayment", "scheduledPrincipal", "immediatePrepayment", "closingBalance"];
  for (const field of numericFields) {
    if (finiteNonnegative(value[field], `schedule.${field}`) === null) return { kind: "invalid", reason: `invalid-${field}`, financialYear: value.financialYear, period: value.period as number };
  }
  return null;
}

function unsupported(reason: DeductionLedgerUnsupportedReason, financialYear?: number): DeductionLedgerResult {
  return financialYear === undefined ? { kind: "unsupported", reason } : { kind: "unsupported", reason, financialYear };
}

/**
 * Allocate actual dated schedule rows against explicit per-year deduction
 * policies. This function has no statutory knowledge and never mutates the
 * schedule or policy objects.
 */
export function buildDatedDeductionLedger(input: {
  readonly schedule: DatedLoanSchedule;
  readonly policies: readonly DeductionYearPolicy[];
}): DeductionLedgerResult {
  if (!input || typeof input !== "object" || !input.schedule || typeof input.schedule !== "object") {
    return { kind: "invalid", reason: "invalid-ledger-input" };
  }
  if (input.policies === undefined || input.policies === null) return unsupported("missing-policy");
  if (!Array.isArray(input.policies)) return { kind: "invalid", reason: "invalid-ledger-input" };
  const schedule = input.schedule;
  if (!Array.isArray(schedule.rows) || schedule.rows.length === 0) return { kind: "invalid", reason: "invalid-schedule-rows" };
  if (typeof schedule.anchorDate !== "string") return { kind: "invalid", reason: "invalid-anchor-date" };
  try { validateDate(schedule.anchorDate); } catch { return { kind: "invalid", reason: "invalid-anchor-date" }; }
  const scheduleTotals: Array<keyof DatedLoanSchedule> = ["originalPrincipal", "immediatePrepayment", "totalInterest", "totalScheduledPayment", "totalScheduledPrincipal", "remainingBalance"];
  for (const field of scheduleTotals) if (finiteNonnegative(schedule[field], `schedule.${field}`) === null) return { kind: "invalid", reason: `invalid-${field}` };
  if (schedule.immediatePrepayment > schedule.originalPrincipal) return { kind: "invalid", reason: "immediate-exceeds-principal" };
  const periods = new Set<number>();
  const dates = new Set<string>();
  const years = new Set<number>();
  let previousPeriod = -1;
  let previousDate = "";
  let sumInterest = 0;
  let sumScheduledPayment = 0;
  let sumScheduledPrincipal = 0;
  let sumImmediatePrincipal = 0;
  let previousRow: DatedLoanScheduleRow | undefined;
  for (const row of schedule.rows) {
    const error = validateScheduleRow(row);
    if (error) return error;
    const period = row.period;
    if (periods.has(period)) return { kind: "invalid", reason: "duplicate-period", period };
    if (dates.has(row.date)) return { kind: "invalid", reason: "duplicate-payment-date", period };
    if (period <= previousPeriod) return { kind: "invalid", reason: "non-chronological-period", period };
    if (previousDate !== "" && row.date <= previousDate) return { kind: "invalid", reason: "non-chronological-date", period };
    if (previousRow && !closeEnough(row.openingBalance, previousRow.closingBalance)) {
      return { kind: "invalid", reason: "broken-balance-continuity", period };
    }
    if (!closeEnough(row.scheduledPayment, row.interest + row.scheduledPrincipal)) {
      return { kind: "invalid", reason: "mismatched-payment-accounting", period };
    }
    if (!closeEnough(row.closingBalance, row.openingBalance - row.scheduledPrincipal - row.immediatePrepayment)) {
      return { kind: "invalid", reason: "mismatched-balance-accounting", period };
    }
    periods.add(period);
    dates.add(row.date);
    years.add(row.financialYear);
    previousPeriod = period;
    previousDate = row.date;
    sumInterest += row.interest;
    sumScheduledPayment += row.scheduledPayment;
    sumScheduledPrincipal += row.scheduledPrincipal;
    sumImmediatePrincipal += row.immediatePrepayment;
    if (![sumInterest, sumScheduledPayment, sumScheduledPrincipal, sumImmediatePrincipal].every(Number.isFinite)) {
      return { kind: "invalid", reason: "nonfinite-schedule-total", period };
    }
    previousRow = row;
  }
  if (schedule.rows[0].period !== 0 || schedule.rows[0].date !== schedule.anchorDate ||
      !closeEnough(schedule.rows[0].openingBalance, schedule.originalPrincipal)) return { kind: "invalid", reason: "invalid-anchor-row" };
  if (!closeEnough(schedule.rows[schedule.rows.length - 1].closingBalance, schedule.remainingBalance)) return { kind: "invalid", reason: "mismatched-remaining-balance" };
  if (!closeEnough(sumInterest, schedule.totalInterest) || !closeEnough(sumScheduledPayment, schedule.totalScheduledPayment) ||
      !closeEnough(sumScheduledPrincipal, schedule.totalScheduledPrincipal) || !closeEnough(sumImmediatePrincipal, schedule.immediatePrepayment)) {
    return { kind: "invalid", reason: "mismatched-schedule-total" };
  }

  if (input.policies.length === 0) return unsupported("missing-policy");
  const annualModeFlags = input.policies.map((policy) => record(policy) && policy.annualTaxContext !== undefined);
  const factorModeFlags = input.policies.map((policy) => record(policy) && policy.effectiveTaxFactor !== undefined);
  if (annualModeFlags.some(Boolean) && factorModeFlags.some(Boolean)) return { kind: "invalid", reason: "mixed-tax-mode" };
  const annualMode = annualModeFlags.some(Boolean);
  const policies = new Map<number, DeductionYearPolicy>();
  const annualContexts = new Map<number, DeductionAnnualTaxContext>();
  const annualTaxYears = new Set<string>();
  for (const policy of input.policies) {
    if (!policy || typeof policy !== "object") return { kind: "invalid", reason: "invalid-policy" };
    if (!validYear(policy.financialYear)) return unsupported("missing-policy-year");
    if (policies.has(policy.financialYear)) return { kind: "invalid", reason: "duplicate-financial-year", financialYear: policy.financialYear };
    if (!isBoolean(policy.interestEligible) || !isBoolean(policy.principalEligible) || !isBoolean(policy.immediatePrincipalEligible)) {
      return { kind: "invalid", reason: "invalid-eligibility-policy", financialYear: policy.financialYear };
    }
    if (!isBoolean(policy.reinvestBenefits)) return unsupported("missing-reinvestment-choice", policy.financialYear);
    if (typeof policy.benefitReceiptDate !== "string" || policy.benefitReceiptDate.length === 0) return unsupported("missing-receipt-date", policy.financialYear);
    try { validateDate(policy.benefitReceiptDate); } catch { return { kind: "invalid", reason: "invalid-receipt-date", financialYear: policy.financialYear }; }
    if (policy.interestHeadroom === undefined || policy.interestHeadroom === null || policy.principalHeadroom === undefined || policy.principalHeadroom === null) return unsupported("missing-headroom", policy.financialYear);
    if (finiteNonnegative(policy.interestHeadroom, "interestHeadroom") === null || finiteNonnegative(policy.principalHeadroom, "principalHeadroom") === null) {
      return { kind: "invalid", reason: "invalid-headroom", financialYear: policy.financialYear };
    }
    if (annualMode) {
      if (policy.effectiveTaxFactor !== undefined) return { kind: "invalid", reason: "mixed-tax-mode", financialYear: policy.financialYear };
      if (policy.annualTaxContext === undefined) return unsupported("missing-annual-tax-context", policy.financialYear);
      if (!validAnnualContext(policy.annualTaxContext)) return { kind: "invalid", reason: "invalid-annual-tax-context", financialYear: policy.financialYear };
      if (policy.annualTaxContext.taxYear !== taxYearLabel(policy.financialYear)) return unsupported("tax-year-context-mismatch", policy.financialYear);
      if (annualTaxYears.has(policy.annualTaxContext.taxYear)) return { kind: "invalid", reason: "duplicate-annual-tax-context", financialYear: policy.financialYear };
      annualTaxYears.add(policy.annualTaxContext.taxYear);
      annualContexts.set(policy.financialYear, policy.annualTaxContext);
    } else {
      if (policy.annualTaxContext !== undefined) return { kind: "invalid", reason: "mixed-tax-mode", financialYear: policy.financialYear };
      if (policy.effectiveTaxFactor === undefined) return unsupported("missing-tax-factor", policy.financialYear);
      if (!Number.isFinite(policy.effectiveTaxFactor) || policy.effectiveTaxFactor < 0 || policy.effectiveTaxFactor > 1) return { kind: "invalid", reason: "invalid-tax-factor", financialYear: policy.financialYear };
    }
    policies.set(policy.financialYear, policy);
  }
  for (const year of years) if (!policies.has(year)) return unsupported("missing-policy", year);
  for (const year of policies.keys()) if (!years.has(year)) return { kind: "invalid", reason: "unmatched-policy-year", financialYear: year };

  const rowsByYear = new Map<number, DatedLoanScheduleRow[]>();
  for (const row of schedule.rows) rowsByYear.set(row.financialYear, [...(rowsByYear.get(row.financialYear) ?? []), row]);
  const ledgers: DeductionYearLedger[] = [];
  const benefitCashflows: DeductionCashflow[] = [];
  for (const year of [...years].sort((left, right) => left - right)) {
    const policy = policies.get(year)!;
    const rows = rowsByYear.get(year)!;
    const actualInterest = rows.reduce((sum, row) => sum + row.interest, 0);
    const actualScheduledPrincipal = rows.reduce((sum, row) => sum + row.scheduledPrincipal, 0);
    const actualImmediatePrincipal = rows.reduce((sum, row) => sum + row.immediatePrepayment, 0);
    const eligibleInterest = policy.interestEligible ? actualInterest : 0;
    const eligiblePrincipal = policy.principalEligible
      ? actualScheduledPrincipal + (policy.immediatePrincipalEligible ? actualImmediatePrincipal : 0)
      : 0;
    const interestUsed = Math.min(eligibleInterest, policy.interestHeadroom);
    const principalUsed = Math.min(eligiblePrincipal, policy.principalHeadroom);
    const taxableDeduction = interestUsed + principalUsed;
    if (!Number.isFinite(actualInterest) || !Number.isFinite(actualScheduledPrincipal) || !Number.isFinite(actualImmediatePrincipal) || !Number.isFinite(taxableDeduction)) {
      return { kind: "invalid", reason: "nonfinite-year-total", financialYear: year };
    }
    let taxBenefit: number;
    let effectiveTaxFactor: number | null = null;
    let annualAssessment: AnnualContextAdapterValue | undefined;
    if (annualMode) {
      const annualTaxContext = annualContexts.get(year);
      if (!annualTaxContext) return unsupported("missing-annual-tax-context", year);
      const assessment = assessAnnualRouteFromContext({
        ...annualTaxContext,
        eligibleRouteDeduction: taxableDeduction,
        routeOrdinaryInvestmentIncome: 0,
      });
      if (assessment.kind === "unsupported") return { kind: "unsupported", reason: assessment.reason, financialYear: year };
      if (assessment.kind === "invalid") return { kind: "invalid", reason: `annual-tax-${assessment.reason}`, financialYear: year };
      annualAssessment = assessment.value;
      taxBenefit = assessment.value.assessment.deductionBenefit;
    } else {
      const factor = policy.effectiveTaxFactor;
      if (factor === undefined) return unsupported("missing-tax-factor", year);
      effectiveTaxFactor = factor;
      taxBenefit = taxableDeduction * factor;
    }
    if (!Number.isFinite(taxBenefit)) return { kind: "invalid", reason: "nonfinite-tax-benefit", financialYear: year };
    const lastProducingDate = rows.reduce((latest, row) => {
      const produces = (policy.interestEligible && row.interest > 0) ||
        (policy.principalEligible && (row.scheduledPrincipal > 0 || (policy.immediatePrincipalEligible && row.immediatePrepayment > 0)));
      return produces && row.date > latest ? row.date : latest;
    }, "");
    if (lastProducingDate !== "" && policy.benefitReceiptDate < lastProducingDate) return { kind: "invalid", reason: "receipt-before-deduction", financialYear: year };
    ledgers.push({
      financialYear: year,
      interestEligible: policy.interestEligible,
      principalEligible: policy.principalEligible,
      actualInterest,
      actualScheduledPrincipal,
      actualImmediatePrincipal,
      eligibleInterest,
      eligiblePrincipal,
      interestUsed,
      principalUsed,
      interestRemainingCapacity: policy.interestHeadroom - interestUsed,
      principalRemainingCapacity: policy.principalHeadroom - principalUsed,
      effectiveTaxFactor,
      taxBenefit,
      ...(annualAssessment ? { annualAssessment } : {}),
      benefitReceiptDate: policy.benefitReceiptDate,
      reinvestBenefits: policy.reinvestBenefits,
      immediatePrincipalEligible: policy.immediatePrincipalEligible,
    });
    // The contract intentionally aggregates each year's deduction into one
    // dated receipt. A future event model may emit multiple receipts, but
    // this primitive must not invent a receipt split from undated inputs.
    benefitCashflows.push({ financialYear: year, date: policy.benefitReceiptDate, amount: taxBenefit, reinvested: policy.reinvestBenefits });
  }
  const totalTaxBenefit = ledgers.reduce((sum, year) => sum + year.taxBenefit, 0);
  if (!Number.isFinite(totalTaxBenefit)) return { kind: "invalid", reason: "nonfinite-total-tax-benefit" };
  return { kind: "ok", value: { years: ledgers, benefitCashflows, totalTaxBenefit } };
}
