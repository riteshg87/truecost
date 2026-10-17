import type { LoanTypeId, RateStructure, RateType } from "../finance/types";
import type { AssetClass, TaxRegime } from "./types";
import { addCalendarMonths, validateDate } from "./dates";

/**
 * Data contract for the reviewed post-tax model.
 *
 * This module validates that the facts needed by the proposed model are
 * present and well-shaped. It deliberately does not decide tax eligibility,
 * rates, or whether a methodology is financially reviewed.
 */

export const PREPAY_MODEL_CONTRACT_VERSION = "prepay-tax-structure-v2";

export type TaxActVersion = "1961" | "2025";
export type DateString = string;

export interface ModelSourceDate {
  readonly sourceId: string;
  readonly effectiveDate: DateString;
  readonly lastReviewedDate: DateString;
}

export interface PrepayModelMetadata {
  readonly modelVersion: string;
  readonly calculationTime: string;
  readonly sourceDates: readonly ModelSourceDate[];
  readonly assumptions: readonly string[];
}

export interface TaxYearFact {
  readonly taxYear: string;
  /** Required for the 1961 Act; null is explicit/not applicable for 2025 Act. */
  readonly assessmentYear: string | null;
  readonly startDate: DateString;
  readonly endDate: DateString;
  readonly taxActVersion: TaxActVersion;
}

export type TaxBenefitReceiptRule =
  | { readonly kind: "date"; readonly date: DateString; readonly reinvest: boolean }
  | { readonly kind: "rule"; readonly ruleId: string; readonly reinvest: boolean };

export interface TaxpayerScope {
  readonly residenceStatus: "resident" | "non-resident" | "unknown";
  readonly profileFlags: readonly string[];
}

export type AnnualAmountFact =
  | { readonly kind: "known"; readonly amount: number }
  | { readonly kind: "unknown"; readonly reason: string };

export type SpecialRateIncomeComponent =
  | { readonly kind: "known"; readonly category: string; readonly amount: number }
  | { readonly kind: "unknown"; readonly category: string | null; readonly reason: string };

export interface LossCarryforwardFacts {
  readonly currentYear: AnnualAmountFact;
  readonly carryForward: AnnualAmountFact;
}

export type AnnualRoundingConvention = "raw-unrounded-arithmetic" | "statutory-section-516";

/** Per-year facts passed to the reviewed annual tax assessor. */
export interface AnnualTaxContext {
  readonly taxYear: string;
  /** Ordinary taxable income after the caller's validated background deductions. */
  readonly backgroundOrdinaryTaxableIncome: number;
  /** Empty means explicitly no special-rate components; unknown is never encoded as zero. */
  readonly specialRateIncome: readonly SpecialRateIncomeComponent[];
  /** Null is allowed when the selected rules do not require age. */
  readonly ageDuringTaxYear: number | null;
  readonly agriculturalIncome: AnnualAmountFact;
  readonly losses: LossCarryforwardFacts;
  readonly roundingConvention: AnnualRoundingConvention;
  /** Source snapshot used to construct this year's context. */
  readonly sourceVersion: string;
}

export interface NormalizedTaxProfile {
  readonly calculationDate: DateString;
  readonly taxYears: readonly TaxYearFact[];
  readonly regime: TaxRegime;
  readonly annualContexts: readonly AnnualTaxContext[];
  readonly taxpayerScope: TaxpayerScope;
  readonly taxBenefitReceiptRule: TaxBenefitReceiptRule;
}

export interface DeductionCapacity {
  readonly taxYear: string;
  readonly amount: number;
}

export interface PaymentScheduleFacts {
  readonly dateRule: string;
  readonly paymentDates: readonly DateString[];
  readonly roundingRule: string;
}

export interface NormalizedLoanFacts {
  readonly loanType: LoanTypeId;
  readonly outstandingAtCalculationDate: number;
  readonly rateType: RateType;
  readonly rateStructure: RateStructure;
  readonly ratePct: number;
  readonly remainingMonths: number;
  readonly currentEmi: number | null;
  readonly paymentSchedule: PaymentScheduleFacts;
  readonly prepaymentDate: DateString;
  readonly prepayAmount: number;
  readonly prepayFeePct: number;
  readonly otherFees: number;
  /** Explicit fee result from the selected lender/eligibility rule. */
  readonly prepaymentFeeAmount: number;
  /** DEC-013: the investment route receives surplus plus applicable fees. */
  readonly feeFunding: "extra-cash-budget";
  readonly propertyUse: "self_occupied_acquisition" | "self_occupied_repair" | "let_out" | "other";
  /** Declared facts only; this contract does not infer legal eligibility. */
  readonly propertyEligibilityFacts: Readonly<Record<string, unknown>>;
  readonly remaining24bCapacityByTaxYear: readonly DeductionCapacity[];
  readonly remaining80cCapacityByTaxYear: readonly DeductionCapacity[];
  readonly ownershipShare: number;
}

export interface ReturnEvent {
  readonly date: DateString;
  readonly grossAmount?: number;
  readonly grossRatePct?: number;
}

export interface ReturnSchedule {
  readonly convention: "monthly" | "dated";
  readonly horizonMonths: number;
  readonly events: readonly ReturnEvent[];
}

export interface ContributionLot {
  readonly lotId: string;
  readonly amount: number;
  readonly acquisitionDate: DateString;
}

export interface TaxEvent {
  readonly eventId: string;
  readonly date: DateString;
  readonly kind: string;
  readonly reinvest: boolean;
}

interface InvestmentBase {
  readonly assetClass: AssetClass;
  readonly instrumentSubtype: string;
  readonly principalInvested: number;
  readonly investmentDate: DateString;
  readonly expectedGrossReturnPct: number;
  readonly returnSchedule: ReturnSchedule;
  readonly contributionLots: readonly ContributionLot[];
  readonly taxEventSchedule: readonly TaxEvent[];
}

export interface FixedDepositInvestment extends InvestmentBase {
  readonly assetClass: "fd";
  readonly contractualRatePct: number;
  readonly payoutRule: string;
  readonly creditSchedule: readonly TaxEvent[];
}

interface DisposalInvestment extends InvestmentBase {
  readonly acquisitionCost: number;
  readonly acquisitionDate: DateString;
  readonly disposalDate: DateString;
  readonly proceedsRule: string;
  readonly expenseRule: string;
}

export interface EquityInvestment extends DisposalInvestment {
  readonly assetClass: "equity";
  readonly sttEligibility: string;
  readonly exemptionHeadroom: number;
}

export interface DebtFundInvestment extends DisposalInvestment {
  readonly assetClass: "debt";
  readonly fundClassification: {
    readonly ruleId: string;
    readonly effectiveDate: DateString;
  };
}

export type NormalizedInvestmentFacts =
  | FixedDepositInvestment
  | EquityInvestment
  | DebtFundInvestment;

export interface SameBudgetFacts {
  readonly surplus: number;
  readonly applicablePrepaymentFees: number;
  readonly investmentInitialCash: number;
  readonly feeTreatment: "extra-cash-budget";
}

export interface PrepayModelInput {
  readonly metadata: PrepayModelMetadata;
  readonly tax: NormalizedTaxProfile;
  readonly loan: NormalizedLoanFacts;
  readonly investment: NormalizedInvestmentFacts;
  readonly budget: SameBudgetFacts;
}

export type StructuralMissingFieldCode =
  | "metadata.modelVersion"
  | "metadata.calculationTime"
  | "metadata.sourceDates"
  | "metadata.assumptions"
  | "tax.calculationDate"
  | "tax.taxYears"
  | "tax.taxYears.date"
  | "tax.annualContexts"
  | "tax.annualContexts.taxYear"
  | "tax.annualContexts.backgroundIncome"
  | "tax.annualContexts.specialRateIncome"
  | "tax.annualContexts.age"
  | "tax.annualContexts.agriculturalIncome"
  | "tax.annualContexts.losses"
  | "tax.annualContexts.rounding"
  | "tax.annualContexts.sourceVersion"
  | "tax.taxpayerScope"
  | "tax.taxBenefitReceiptRule"
  | "loan.paymentSchedule"
  | "loan.paymentSchedule.date"
  | "loan.paymentSchedule.term"
  | "loan.remaining24bCapacityByTaxYear"
  | "loan.remaining80cCapacityByTaxYear"
  | "loan.propertyEligibilityFacts"
  | "loan.sameBudget"
  | "investment.base"
  | "investment.returnSchedule"
  | "investment.contributionLots"
  | "investment.taxEventSchedule"
  | "investment.disposalFacts"
  | "investment.fdCreditSchedule"
  | "investment.equityTaxFacts"
  | "investment.debtClassification"
  | "investment.horizon"
  | "budget.sameExtraCashBudget";

export interface StructuralMissingField {
  readonly code: StructuralMissingFieldCode;
  readonly path: string;
  readonly issue: "missing" | "invalid";
}

export type UnsupportedReason =
  | "missing-required-facts"
  | "financial-methodology-review-required";

export interface UnsupportedTaxComparison {
  readonly status: "unsupported";
  readonly reason: UnsupportedReason;
  readonly missingFields: readonly StructuralMissingField[];
}

export type PrepayModelValidation =
  | {
      readonly status: "structurally-incomplete";
      readonly support: UnsupportedTaxComparison;
      readonly input: unknown;
    }
  | {
      /** Structural completeness does not mean financially supported. */
      readonly status: "structurally-complete";
      readonly support: UnsupportedTaxComparison;
      readonly input: PrepayModelInput;
    };

export type NormalizedTaxProfileValidation =
  | { readonly kind: "ok"; readonly value: NormalizedTaxProfile }
  | { readonly kind: "invalid"; readonly missingFields: readonly StructuralMissingField[] };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined && value[key] !== null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { validateDate(value); return true; } catch { return false; }
}

function validDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.exec(value);
  return match !== null && validDate(match[1]) && Number.isFinite(Date.parse(value));
}

function finite(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function addIssue(
  issues: StructuralMissingField[],
  code: StructuralMissingFieldCode,
  path: string,
  issue: StructuralMissingField["issue"],
): void {
  issues.push({ code, path, issue });
}

function requireDate(
  value: Record<string, unknown>,
  key: string,
  code: StructuralMissingFieldCode,
  path: string,
  issues: StructuralMissingField[],
): void {
  if (!has(value, key) || !validDate(value[key])) addIssue(issues, code, path, has(value, key) ? "invalid" : "missing");
}

function requireFinite(
  value: Record<string, unknown>,
  key: string,
  code: StructuralMissingFieldCode,
  path: string,
  issues: StructuralMissingField[],
  minimum = 0,
): void {
  if (!has(value, key) || !finite(value[key], minimum)) addIssue(issues, code, path, has(value, key) ? "invalid" : "missing");
}

function validateMetadata(value: unknown, issues: StructuralMissingField[]): void {
  if (!record(value)) {
    addIssue(issues, "metadata.modelVersion", "metadata", "missing");
    return;
  }
  if (!has(value, "modelVersion") || !nonEmpty(value.modelVersion)) addIssue(issues, "metadata.modelVersion", "metadata.modelVersion", has(value, "modelVersion") ? "invalid" : "missing");
  if (!has(value, "calculationTime") || !validDateTime(value.calculationTime)) addIssue(issues, "metadata.calculationTime", "metadata.calculationTime", has(value, "calculationTime") ? "invalid" : "missing");
  if (!Array.isArray(value.sourceDates) || value.sourceDates.length === 0) {
    addIssue(issues, "metadata.sourceDates", "metadata.sourceDates", has(value, "sourceDates") ? "invalid" : "missing");
  } else {
    value.sourceDates.forEach((source, index) => {
      if (!record(source) || !nonEmpty(source.sourceId) || !validDate(source.effectiveDate) || !validDate(source.lastReviewedDate)) {
        addIssue(issues, "metadata.sourceDates", `metadata.sourceDates[${index}]`, "invalid");
      }
    });
  }
  if (!Array.isArray(value.assumptions) || value.assumptions.length === 0 || value.assumptions.some((item) => !nonEmpty(item))) {
    addIssue(issues, "metadata.assumptions", "metadata.assumptions", has(value, "assumptions") ? "invalid" : "missing");
  }
}

function validateAnnualAmountFact(value: unknown, code: StructuralMissingFieldCode, path: string, issues: StructuralMissingField[]): void {
  if (!record(value) || (value.kind !== "known" && value.kind !== "unknown")) {
    addIssue(issues, code, path, "invalid");
    return;
  }
  if (value.kind === "known") {
    if (!finite(value.amount)) addIssue(issues, code, `${path}.amount`, has(value, "amount") ? "invalid" : "missing");
  } else if (!nonEmpty(value.reason) || has(value, "amount")) {
    addIssue(issues, code, `${path}.reason`, has(value, "reason") ? "invalid" : "missing");
  } else {
    addIssue(issues, code, `${path}.amount`, "missing");
  }
}

function validateSpecialRateIncome(value: unknown, pathPrefix: string, issues: StructuralMissingField[]): void {
  if (!Array.isArray(value)) {
    addIssue(issues, "tax.annualContexts.specialRateIncome", pathPrefix, "missing");
    return;
  }
  value.forEach((component, index) => {
    const path = `${pathPrefix}[${index}]`;
    if (!record(component) || (component.kind !== "known" && component.kind !== "unknown")) {
      addIssue(issues, "tax.annualContexts.specialRateIncome", path, "invalid");
    } else if (component.kind === "known") {
      if (!nonEmpty(component.category) || !finite(component.amount)) addIssue(issues, "tax.annualContexts.specialRateIncome", path, "invalid");
    } else if ((component.category !== null && !nonEmpty(component.category)) || !nonEmpty(component.reason) || has(component, "amount")) {
      addIssue(issues, "tax.annualContexts.specialRateIncome", path, "invalid");
    } else {
      addIssue(issues, "tax.annualContexts.specialRateIncome", path, "missing");
    }
  });
}

function validateAnnualContexts(value: Record<string, unknown>, issues: StructuralMissingField[]): void {
  const taxYears = Array.isArray(value.taxYears) ? value.taxYears : [];
  const taxYearLabels = new Set(
    taxYears.filter((year): year is Record<string, unknown> => record(year) && nonEmpty(year.taxYear)).map((year) => year.taxYear as string),
  );
  const contexts = value.annualContexts;
  if (!Array.isArray(contexts) || contexts.length === 0) {
    addIssue(issues, "tax.annualContexts", "tax.annualContexts", has(value, "annualContexts") ? "invalid" : "missing");
    return;
  }
  const seen = new Set<string>();
  contexts.forEach((context, index) => {
    const path = `tax.annualContexts[${index}]`;
    if (!record(context)) {
      addIssue(issues, "tax.annualContexts", path, "invalid");
      return;
    }
    const contextTaxYear = context.taxYear;
    if (!nonEmpty(contextTaxYear) || seen.has(contextTaxYear) || !taxYearLabels.has(contextTaxYear)) {
      addIssue(issues, "tax.annualContexts.taxYear", `${path}.taxYear`, has(context, "taxYear") ? "invalid" : "missing");
    }
    if (nonEmpty(contextTaxYear)) seen.add(contextTaxYear);
    if (!has(context, "backgroundOrdinaryTaxableIncome") || !finite(context.backgroundOrdinaryTaxableIncome)) addIssue(issues, "tax.annualContexts.backgroundIncome", `${path}.backgroundOrdinaryTaxableIncome`, has(context, "backgroundOrdinaryTaxableIncome") ? "invalid" : "missing");
    validateSpecialRateIncome(context.specialRateIncome, `${path}.specialRateIncome`, issues);
    const age = context.ageDuringTaxYear;
    if (age === null && value.regime === "old") addIssue(issues, "tax.annualContexts.age", `${path}.ageDuringTaxYear`, "missing");
    else if (age !== null && (typeof age !== "number" || !Number.isSafeInteger(age) || age < 0 || age > 150)) addIssue(issues, "tax.annualContexts.age", `${path}.ageDuringTaxYear`, has(context, "ageDuringTaxYear") ? "invalid" : "missing");
    validateAnnualAmountFact(context.agriculturalIncome, "tax.annualContexts.agriculturalIncome", `${path}.agriculturalIncome`, issues);
    if (!record(context.losses)) {
      addIssue(issues, "tax.annualContexts.losses", `${path}.losses`, has(context, "losses") ? "invalid" : "missing");
    } else {
      validateAnnualAmountFact(context.losses.currentYear, "tax.annualContexts.losses", `${path}.losses.currentYear`, issues);
      validateAnnualAmountFact(context.losses.carryForward, "tax.annualContexts.losses", `${path}.losses.carryForward`, issues);
    }
    if (context.roundingConvention !== "raw-unrounded-arithmetic" && context.roundingConvention !== "statutory-section-516") addIssue(issues, "tax.annualContexts.rounding", `${path}.roundingConvention`, has(context, "roundingConvention") ? "invalid" : "missing");
    if (!nonEmpty(context.sourceVersion)) addIssue(issues, "tax.annualContexts.sourceVersion", `${path}.sourceVersion`, has(context, "sourceVersion") ? "invalid" : "missing");
  });
  taxYearLabels.forEach((taxYear) => {
    if (!seen.has(taxYear)) addIssue(issues, "tax.annualContexts.taxYear", "tax.annualContexts", "missing");
  });
  if (contexts.length !== taxYearLabels.size) addIssue(issues, "tax.annualContexts.taxYear", "tax.annualContexts", "invalid");
}

function validateTax(value: unknown, issues: StructuralMissingField[]): void {
  if (!record(value)) {
    addIssue(issues, "tax.taxYears", "tax", "missing");
    return;
  }
  requireDate(value, "calculationDate", "tax.calculationDate", "tax.calculationDate", issues);
  if (!Array.isArray(value.taxYears) || value.taxYears.length === 0) {
    addIssue(issues, "tax.taxYears", "tax.taxYears", has(value, "taxYears") ? "invalid" : "missing");
  } else {
    value.taxYears.forEach((year, index) => {
      const path = `tax.taxYears[${index}]`;
      const assessmentYearValid = record(year) && (year.taxActVersion === "1961" ? nonEmpty(year.assessmentYear) : year.assessmentYear === null || nonEmpty(year.assessmentYear));
      if (!record(year) || !nonEmpty(year.taxYear) || !assessmentYearValid || typeof year.taxActVersion !== "string" || !["1961", "2025"].includes(year.taxActVersion) || !validDate(year.startDate) || !validDate(year.endDate) || (validDate(year.startDate) && validDate(year.endDate) && year.startDate >= year.endDate)) {
        addIssue(issues, "tax.taxYears.date", path, "invalid");
      }
    });
  }
  if (!has(value, "regime") || typeof value.regime !== "string" || !["old", "new"].includes(value.regime)) addIssue(issues, "tax.taxYears", "tax.regime", has(value, "regime") ? "invalid" : "missing");
  validateAnnualContexts(value, issues);
  if (!record(value.taxpayerScope) || typeof value.taxpayerScope.residenceStatus !== "string" || !["resident", "non-resident", "unknown"].includes(value.taxpayerScope.residenceStatus) || !Array.isArray(value.taxpayerScope.profileFlags) || value.taxpayerScope.profileFlags.some((flag) => !nonEmpty(flag))) addIssue(issues, "tax.taxpayerScope", "tax.taxpayerScope", has(value, "taxpayerScope") ? "invalid" : "missing");
  if (!record(value.taxBenefitReceiptRule) || typeof value.taxBenefitReceiptRule.kind !== "string" || !["date", "rule"].includes(value.taxBenefitReceiptRule.kind) || (value.taxBenefitReceiptRule.kind === "date" && !validDate(value.taxBenefitReceiptRule.date)) || (value.taxBenefitReceiptRule.kind === "rule" && !nonEmpty(value.taxBenefitReceiptRule.ruleId)) || typeof value.taxBenefitReceiptRule.reinvest !== "boolean") addIssue(issues, "tax.taxBenefitReceiptRule", "tax.taxBenefitReceiptRule", has(value, "taxBenefitReceiptRule") ? "invalid" : "missing");
}

/** Validates just the reusable v2 tax profile before an annual adapter call. */
export function validateNormalizedTaxProfile(value: unknown): NormalizedTaxProfileValidation {
  const issues: StructuralMissingField[] = [];
  if (!record(value)) {
    addIssue(issues, "tax.taxYears", "tax", "missing");
  } else {
    validateTax(value, issues);
    validateTaxYearCoverage({ tax: value }, issues);
  }
  if (issues.length > 0) return { kind: "invalid", missingFields: issues };
  return { kind: "ok", value: value as NormalizedTaxProfile };
}

function validateCapacityList(value: Record<string, unknown>, key: string, code: StructuralMissingFieldCode, issues: StructuralMissingField[]): void {
  const capacities = value[key];
  if (!Array.isArray(capacities) || capacities.length === 0) {
    addIssue(issues, code, `loan.${key}`, has(value, key) ? "invalid" : "missing");
    return;
  }
  capacities.forEach((capacity, index) => {
    if (!record(capacity) || !nonEmpty(capacity.taxYear) || !finite(capacity.amount)) addIssue(issues, code, `loan.${key}[${index}]`, "invalid");
  });
}

function validateLoan(value: unknown, issues: StructuralMissingField[]): void {
  if (!record(value)) {
    addIssue(issues, "loan.paymentSchedule", "loan", "missing");
    return;
  }
  const schedule = value.paymentSchedule;
  const paymentDates = record(schedule) && Array.isArray(schedule.paymentDates) ? schedule.paymentDates : null;
  if (!record(schedule) || !nonEmpty(schedule.dateRule) || !nonEmpty(schedule.roundingRule) || paymentDates === null || paymentDates.length === 0) {
    addIssue(issues, "loan.paymentSchedule", "loan.paymentSchedule", has(value, "paymentSchedule") ? "invalid" : "missing");
  } else if (paymentDates.some((date) => !validDate(date))) {
    addIssue(issues, "loan.paymentSchedule.date", "loan.paymentSchedule.paymentDates", "invalid");
  } else if (finite(value.remainingMonths, 1) && Number.isSafeInteger(value.remainingMonths) && paymentDates.length !== value.remainingMonths) {
    addIssue(issues, "loan.paymentSchedule.term", "loan.paymentSchedule.paymentDates", "invalid");
  } else if (paymentDates.some((date, index) => index > 0 && date <= paymentDates[index - 1])) {
    addIssue(issues, "loan.paymentSchedule.date", "loan.paymentSchedule.paymentDates", "invalid");
  }
  if (typeof value.loanType !== "string" || !["home", "auto", "personal", "gold", "business", "education"].includes(value.loanType)) addIssue(issues, "loan.paymentSchedule", "loan.loanType", has(value, "loanType") ? "invalid" : "missing");
  if (typeof value.rateType !== "string" || !["reducing", "flat"].includes(value.rateType)) addIssue(issues, "loan.paymentSchedule", "loan.rateType", has(value, "rateType") ? "invalid" : "missing");
  if (typeof value.rateStructure !== "string" || !["floating", "fixed"].includes(value.rateStructure)) addIssue(issues, "loan.paymentSchedule", "loan.rateStructure", has(value, "rateStructure") ? "invalid" : "missing");
  requireFinite(value, "outstandingAtCalculationDate", "loan.paymentSchedule", "loan.outstandingAtCalculationDate", issues, Number.MIN_VALUE);
  requireFinite(value, "ratePct", "loan.paymentSchedule", "loan.ratePct", issues);
  requireFinite(value, "remainingMonths", "loan.paymentSchedule", "loan.remainingMonths", issues, 1);
  if (finite(value.remainingMonths, 1) && !Number.isSafeInteger(value.remainingMonths)) addIssue(issues, "loan.paymentSchedule", "loan.remainingMonths", "invalid");
  if (!Object.prototype.hasOwnProperty.call(value, "currentEmi") || (value.currentEmi !== null && !finite(value.currentEmi))) addIssue(issues, "loan.paymentSchedule", "loan.currentEmi", Object.prototype.hasOwnProperty.call(value, "currentEmi") ? "invalid" : "missing");
  requireDate(value, "prepaymentDate", "loan.paymentSchedule", "loan.prepaymentDate", issues);
  if (validDate(value.prepaymentDate) && paymentDates && paymentDates.length > 0 && validDate(paymentDates[0]) && value.prepaymentDate > paymentDates[0]) addIssue(issues, "loan.paymentSchedule.date", "loan.prepaymentDate", "invalid");
  requireFinite(value, "prepayAmount", "loan.paymentSchedule", "loan.prepayAmount", issues);
  requireFinite(value, "prepayFeePct", "loan.paymentSchedule", "loan.prepayFeePct", issues);
  requireFinite(value, "otherFees", "loan.paymentSchedule", "loan.otherFees", issues);
  requireFinite(value, "prepaymentFeeAmount", "loan.paymentSchedule", "loan.prepaymentFeeAmount", issues);
  if (value.feeFunding !== "extra-cash-budget") addIssue(issues, "loan.sameBudget", "loan.feeFunding", has(value, "feeFunding") ? "invalid" : "missing");
  if (!nonEmpty(value.propertyUse) || !["self_occupied_acquisition", "self_occupied_repair", "let_out", "other"].includes(value.propertyUse)) addIssue(issues, "loan.propertyEligibilityFacts", "loan.propertyUse", has(value, "propertyUse") ? "invalid" : "missing");
  if (!record(value.propertyEligibilityFacts) || Object.keys(value.propertyEligibilityFacts).length === 0) addIssue(issues, "loan.propertyEligibilityFacts", "loan.propertyEligibilityFacts", has(value, "propertyEligibilityFacts") ? "invalid" : "missing");
  validateCapacityList(value, "remaining24bCapacityByTaxYear", "loan.remaining24bCapacityByTaxYear", issues);
  validateCapacityList(value, "remaining80cCapacityByTaxYear", "loan.remaining80cCapacityByTaxYear", issues);
  requireFinite(value, "ownershipShare", "loan.paymentSchedule", "loan.ownershipShare", issues, Number.MIN_VALUE);
  if (finite(value.ownershipShare) && value.ownershipShare > 1) addIssue(issues, "loan.paymentSchedule", "loan.ownershipShare", "invalid");
}

function validateTaxYearCoverage(input: Record<string, unknown>, issues: StructuralMissingField[]): void {
  const tax = input.tax;
  if (!record(tax) || !Array.isArray(tax.taxYears)) return;
  const years = tax.taxYears.filter((year): year is Record<string, unknown> => record(year) && validDate(year.startDate) && validDate(year.endDate) && nonEmpty(year.taxYear));
  const labels = new Set(years.map((year) => year.taxYear));
  const ordered = [...years].sort((left, right) => String(left.startDate).localeCompare(String(right.startDate)));
  const duplicate = new Set<string>();
  years.forEach((year) => {
    const label = String(year.taxYear);
    if (duplicate.has(label)) addIssue(issues, "tax.taxYears.date", "tax.taxYears", "invalid");
    duplicate.add(label);
  });
  ordered.forEach((year, index) => {
    const next = ordered[index + 1];
    if (next && String(year.endDate) >= String(next.startDate)) addIssue(issues, "tax.taxYears.date", "tax.taxYears", "invalid");
  });

  const loan = record(input.loan) ? input.loan : null;
  const capacities = loan ? [loan.remaining24bCapacityByTaxYear, loan.remaining80cCapacityByTaxYear] : [];
  capacities.forEach((list, listIndex) => {
    if (!Array.isArray(list)) return;
    const seen = new Set<string>();
    list.forEach((capacity) => {
      if (record(capacity) && nonEmpty(capacity.taxYear)) {
        const code = listIndex === 0 ? "loan.remaining24bCapacityByTaxYear" : "loan.remaining80cCapacityByTaxYear";
        if (!labels.has(capacity.taxYear) || seen.has(capacity.taxYear)) addIssue(issues, code, "loan.capacity.taxYear", "invalid");
        seen.add(capacity.taxYear);
      }
    });
    const paymentSchedule = loan && record(loan.paymentSchedule) ? loan.paymentSchedule : null;
    const scheduledDates = paymentSchedule && Array.isArray(paymentSchedule.paymentDates) ? paymentSchedule.paymentDates : null;
    if (scheduledDates) {
      const paymentYears = new Set(years.filter((year) => scheduledDates.some((date: unknown) => validDate(date) && String(year.startDate) <= date && date <= String(year.endDate))).map((year) => String(year.taxYear)));
      paymentYears.forEach((taxYear) => {
        if (!seen.has(taxYear)) addIssue(issues, listIndex === 0 ? "loan.remaining24bCapacityByTaxYear" : "loan.remaining80cCapacityByTaxYear", "loan.capacity.taxYear", "missing");
      });
    }
  });

  const dates: Array<[string, unknown]> = [];
  const addDate = (path: string, value: unknown) => { if (validDate(value)) dates.push([path, value]); };
  addDate("tax.calculationDate", tax.calculationDate);
  if (loan) {
    addDate("loan.prepaymentDate", loan.prepaymentDate);
    const schedule = record(loan.paymentSchedule) ? loan.paymentSchedule : null;
    if (schedule && Array.isArray(schedule.paymentDates)) schedule.paymentDates.forEach((date, index) => addDate(`loan.paymentSchedule.paymentDates[${index}]`, date));
  }
  const investment = record(input.investment) ? input.investment : null;
  if (investment) {
    addDate("investment.investmentDate", investment.investmentDate);
    if (Array.isArray(investment.contributionLots)) investment.contributionLots.forEach((lot, index) => addDate(`investment.contributionLots[${index}]`, record(lot) ? lot.acquisitionDate : undefined));
    const returnSchedule = record(investment.returnSchedule) ? investment.returnSchedule : null;
    if (returnSchedule && Array.isArray(returnSchedule.events)) returnSchedule.events.forEach((event, index) => addDate(`investment.returnSchedule.events[${index}]`, record(event) ? event.date : undefined));
    if (Array.isArray(investment.taxEventSchedule)) investment.taxEventSchedule.forEach((event, index) => addDate(`investment.taxEventSchedule[${index}]`, record(event) ? event.date : undefined));
    if (Array.isArray(investment.creditSchedule)) investment.creditSchedule.forEach((event, index) => addDate(`investment.creditSchedule[${index}]`, record(event) ? event.date : undefined));
    addDate("investment.acquisitionDate", investment.acquisitionDate);
    addDate("investment.disposalDate", investment.disposalDate);
  }
  if (record(tax.taxBenefitReceiptRule) && tax.taxBenefitReceiptRule.kind === "date") addDate("tax.taxBenefitReceiptRule.date", tax.taxBenefitReceiptRule.date);
  dates.forEach(([path, date]) => {
    if (!years.some((year) => String(year.startDate) <= String(date) && String(date) <= String(year.endDate))) addIssue(issues, "tax.taxYears.date", path, "invalid");
  });
}

function validateEvents(value: unknown, path: string, code: StructuralMissingFieldCode, issues: StructuralMissingField[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, code, path, "missing");
    return;
  }
  value.forEach((event, index) => {
    if (!record(event) || !nonEmpty(event.eventId) || !validDate(event.date) || !nonEmpty(event.kind) || typeof event.reinvest !== "boolean") addIssue(issues, code, `${path}[${index}]`, "invalid");
  });
}

function validateInvestment(value: unknown, issues: StructuralMissingField[]): void {
  if (!record(value)) {
    addIssue(issues, "investment.base", "investment", "missing");
    return;
  }
  if (!nonEmpty(value.assetClass) || !["fd", "equity", "debt"].includes(value.assetClass) || !nonEmpty(value.instrumentSubtype)) addIssue(issues, "investment.base", "investment.assetClass", "invalid");
  requireFinite(value, "principalInvested", "investment.base", "investment.principalInvested", issues, Number.MIN_VALUE);
  requireDate(value, "investmentDate", "investment.base", "investment.investmentDate", issues);
  if (!has(value, "expectedGrossReturnPct") || typeof value.expectedGrossReturnPct !== "number" || !Number.isFinite(value.expectedGrossReturnPct)) addIssue(issues, "investment.base", "investment.expectedGrossReturnPct", has(value, "expectedGrossReturnPct") ? "invalid" : "missing");
  const schedule = value.returnSchedule;
  if (!record(schedule) || typeof schedule.convention !== "string" || !["monthly", "dated"].includes(schedule.convention) || !finite(schedule.horizonMonths, 1) || !Number.isSafeInteger(schedule.horizonMonths)) addIssue(issues, "investment.returnSchedule", "investment.returnSchedule", has(value, "returnSchedule") ? "invalid" : "missing");
  else if (!Array.isArray(schedule.events) || schedule.events.length === 0 || schedule.events.some((event) => !record(event) || !validDate(event.date) || (!finite(event.grossAmount) && !number(event.grossRatePct)))) addIssue(issues, "investment.returnSchedule", "investment.returnSchedule.events", "invalid");
  else if (schedule.convention === "monthly" && schedule.events.length !== schedule.horizonMonths) addIssue(issues, "investment.horizon", "investment.returnSchedule.events", "invalid");
  const investmentDate = value.investmentDate;
  const horizonMonths = record(schedule) ? schedule.horizonMonths : undefined;
  if (typeof horizonMonths === "number" && Number.isSafeInteger(horizonMonths) && validDate(investmentDate)) {
    const horizonEnd = addCalendarMonths(investmentDate, horizonMonths);
    if (record(schedule) && Array.isArray(schedule.events) && schedule.events.some((event) => record(event) && validDate(event.date) && (event.date < investmentDate || event.date > horizonEnd))) addIssue(issues, "investment.horizon", "investment.returnSchedule.events", "invalid");
    const disposalDate = value.disposalDate;
    if (validDate(disposalDate) && disposalDate > horizonEnd) addIssue(issues, "investment.horizon", "investment.disposalDate", "invalid");
  }
  if (!Array.isArray(value.contributionLots) || value.contributionLots.length === 0 || value.contributionLots.some((lot) => !record(lot) || !nonEmpty(lot.lotId) || !finite(lot.amount, Number.MIN_VALUE) || !validDate(lot.acquisitionDate))) addIssue(issues, "investment.contributionLots", "investment.contributionLots", has(value, "contributionLots") ? "invalid" : "missing");
  validateEvents(value.taxEventSchedule, "investment.taxEventSchedule", "investment.taxEventSchedule", issues);

  if (value.assetClass === "fd") {
    requireFinite(value, "contractualRatePct", "investment.fdCreditSchedule", "investment.contractualRatePct", issues);
    if (!nonEmpty(value.payoutRule)) addIssue(issues, "investment.fdCreditSchedule", "investment.payoutRule", has(value, "payoutRule") ? "invalid" : "missing");
    validateEvents(value.creditSchedule, "investment.creditSchedule", "investment.fdCreditSchedule", issues);
  } else {
    const disposalFields = ["acquisitionCost", "acquisitionDate", "disposalDate", "proceedsRule", "expenseRule"];
    if (!finite(value.acquisitionCost, Number.MIN_VALUE) || !validDate(value.acquisitionDate) || !validDate(value.disposalDate) || !nonEmpty(value.proceedsRule) || !nonEmpty(value.expenseRule)) addIssue(issues, "investment.disposalFacts", "investment.disposalFacts", "invalid");
    const acquisitionDate = value.acquisitionDate;
    const disposalDate = value.disposalDate;
    if (validDate(acquisitionDate) && validDate(disposalDate) && disposalDate < acquisitionDate) addIssue(issues, "investment.disposalFacts", "investment.disposalDate", "invalid");
    if (Array.isArray(value.contributionLots) && validDate(disposalDate) && value.contributionLots.some((lot) => record(lot) && validDate(lot.acquisitionDate) && lot.acquisitionDate > disposalDate)) addIssue(issues, "investment.disposalFacts", "investment.contributionLots", "invalid");
    if (value.assetClass === "equity") {
      if (!nonEmpty(value.sttEligibility) || !finite(value.exemptionHeadroom)) addIssue(issues, "investment.equityTaxFacts", "investment.equityTaxFacts", "invalid");
    } else if (!record(value.fundClassification) || !nonEmpty(value.fundClassification.ruleId) || !validDate(value.fundClassification.effectiveDate)) {
      addIssue(issues, "investment.debtClassification", "investment.fundClassification", has(value, "fundClassification") ? "invalid" : "missing");
    }
  }
}

function validateBudget(value: unknown, issues: StructuralMissingField[]): void {
  if (!record(value) || value.feeTreatment !== "extra-cash-budget" || !finite(value.surplus) || !finite(value.applicablePrepaymentFees) || !finite(value.investmentInitialCash) || Math.abs(value.investmentInitialCash - (value.surplus + value.applicablePrepaymentFees)) > Number.EPSILON * Math.max(1, Math.abs(value.investmentInitialCash))) {
    addIssue(issues, "budget.sameExtraCashBudget", "budget", record(value) ? "invalid" : "missing");
  }
}

function validateCrossFields(input: Record<string, unknown>, issues: StructuralMissingField[]): void {
  const loan = record(input.loan) ? input.loan : null;
  const investment = record(input.investment) ? input.investment : null;
  const budget = record(input.budget) ? input.budget : null;
  if (!loan || !investment || !budget) return;
  if (finite(loan.prepayAmount) && finite(budget.surplus) && loan.prepayAmount !== budget.surplus) addIssue(issues, "budget.sameExtraCashBudget", "budget.surplus", "invalid");
  if (finite(investment.principalInvested) && finite(budget.investmentInitialCash) && investment.principalInvested !== budget.investmentInitialCash) addIssue(issues, "budget.sameExtraCashBudget", "budget.investmentInitialCash", "invalid");
  if (finite(loan.prepaymentFeeAmount) && finite(budget.applicablePrepaymentFees) && loan.prepaymentFeeAmount !== budget.applicablePrepaymentFees) addIssue(issues, "budget.sameExtraCashBudget", "budget.applicablePrepaymentFees", "invalid");
  const loanMonths = loan.remainingMonths;
  const investmentSchedule = record(investment.returnSchedule) ? investment.returnSchedule : null;
  if (Number.isSafeInteger(loanMonths) && investmentSchedule && Number.isSafeInteger(investmentSchedule.horizonMonths) && loanMonths !== investmentSchedule.horizonMonths) addIssue(issues, "investment.horizon", "investment.returnSchedule.horizonMonths", "invalid");
}

export function validatePrepayModelInput(input: unknown): PrepayModelValidation {
  const issues: StructuralMissingField[] = [];
  if (!record(input)) {
    addIssue(issues, "metadata.modelVersion", "input", "missing");
  } else {
    validateMetadata(input.metadata, issues);
    validateTax(input.tax, issues);
    validateLoan(input.loan, issues);
    validateInvestment(input.investment, issues);
    validateBudget(input.budget, issues);
    validateTaxYearCoverage(input, issues);
    validateCrossFields(input, issues);
  }
  if (issues.length > 0) return { status: "structurally-incomplete", support: { status: "unsupported", reason: "missing-required-facts", missingFields: issues }, input };
  return { status: "structurally-complete", support: { status: "unsupported", reason: "financial-methodology-review-required", missingFields: [] }, input: input as PrepayModelInput };
}
