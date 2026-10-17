import { MAX_SCHEDULE_RUPEES } from "./cashflows";

/** The only enacted source snapshot supported by this component. */
export const ANNUAL_ORDINARY_TAX_SOURCE_VERSION =
  "income-tax-act-2025+finance-act-2026:tax-year-2026-27" as const;

const TAX_YEAR = "2026-27" as const;
const TAX_ACT_VERSION = "2025" as const;
const CESS_RATE = 0.04;

type Regime = "new" | "old";
type ResidenceStatus = "resident" | "non-resident";
type RateBand = readonly [upperBound: number, rate: number];
export type AnnualTaxRoundingMode = "raw-unrounded-arithmetic" | "statutory-section-516";

export interface AnnualOrdinaryTaxInput {
  readonly taxYear: string;
  readonly taxActVersion: string;
  readonly residenceStatus: ResidenceStatus | "unknown";
  readonly regime: Regime;
  /** Explicitly choose raw projection arithmetic or enacted section 516 rounding. */
  readonly roundingMode: AnnualTaxRoundingMode;
  /** Annual ordinary taxable income after the caller's validated deductions. */
  readonly ordinaryTaxableIncome: number;
  /** Special-rate income is outside this component; callers must state zero explicitly. */
  readonly specialRateIncome: number;
  /** Age at any time during the target tax year, required for old-regime bands. */
  readonly ageDuringTaxYear?: number;
}

export interface AnnualOrdinaryTaxAudit {
  /** The caller-supplied value before section 516 total-income rounding. */
  readonly rawOrdinaryTaxableIncome: number;
  /** The income used for slabs and rebate after the selected rounding mode. */
  readonly assessedOrdinaryTaxableIncome: number;
  readonly ordinaryTaxableIncome: number;
  readonly slabTax: number;
  readonly rebate: number;
  readonly incomeTaxAfterRebate: number;
  readonly surchargeRate: number;
  readonly surchargeBeforeMarginalRelief: number;
  readonly surchargeAfterMarginalRelief: number;
  readonly marginalRelief: number;
  readonly taxAndSurchargeBeforeMarginalRelief: number;
  readonly taxAndSurcharge: number;
  readonly cess: number;
  /** Raw tax arithmetic before the optional section 516 final-amount rounding. */
  readonly rawTotalTax: number;
  /** Final tax amount after the selected rounding mode. */
  readonly finalTax: number;
  readonly totalTax: number;
  readonly surchargeBand: string;
  readonly rounding: AnnualTaxRoundingMode;
}

export interface AnnualOrdinaryTaxAssessment {
  readonly taxYear: typeof TAX_YEAR;
  readonly taxActVersion: typeof TAX_ACT_VERSION;
  readonly regime: Regime;
  readonly roundingMode: AnnualTaxRoundingMode;
  readonly sourceVersion: typeof ANNUAL_ORDINARY_TAX_SOURCE_VERSION;
  /** Repeated at the top level so delta composers cannot lose the assessed base. */
  readonly rawOrdinaryTaxableIncome: number;
  readonly assessedOrdinaryTaxableIncome: number;
  readonly ordinaryTaxableIncome: number;
  readonly financiallySupported: false;
  /** Arithmetic only. A financial/tax review remains required before product use. */
  readonly financialReviewRequired: true;
  readonly methodologyReviewed: false;
  readonly audit: AnnualOrdinaryTaxAudit;
}

export type AnnualOrdinaryTaxUnsupportedReason =
  | "unsupported-tax-year"
  | "unsupported-tax-act"
  | "unsupported-residence"
  | "unsupported-special-rate-income"
  | "missing-special-rate-income"
  | "missing-age";

export type AnnualOrdinaryTaxResult =
  | { readonly kind: "ok"; readonly value: AnnualOrdinaryTaxAssessment }
  | { readonly kind: "unsupported"; readonly reason: AnnualOrdinaryTaxUnsupportedReason }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * A route comparison context. The caller supplies the reviewed eligibility
 * decision; this arithmetic component never infers home-loan eligibility.
 */
export interface AnnualRouteDeltaInput extends Omit<AnnualOrdinaryTaxInput, "ordinaryTaxableIncome"> {
  readonly baselineOrdinaryTaxableIncome: number;
  readonly eligibleRouteDeduction: number;
  readonly routeOrdinaryInvestmentIncome: number;
  readonly eligibilityReviewed: boolean;
}

export interface AnnualRouteDeltaAssessment {
  readonly sourceVersion: typeof ANNUAL_ORDINARY_TAX_SOURCE_VERSION;
  readonly baselineOrdinaryTaxableIncome: number;
  readonly withDeductionOrdinaryTaxableIncome: number;
  readonly withInvestmentOrdinaryTaxableIncome: number;
  readonly baselineAudit: AnnualOrdinaryTaxAudit;
  readonly withDeductionAudit: AnnualOrdinaryTaxAudit;
  readonly withInvestmentAudit: AnnualOrdinaryTaxAudit;
  readonly roundingMode: AnnualTaxRoundingMode;
  readonly deductionBenefit: number;
  readonly investmentTaxCost: number;
  readonly netTaxEffect: number;
  readonly rawDeductionBenefit: number;
  readonly rawInvestmentTaxCost: number;
  readonly rawNetTaxEffect: number;
  /** True because netTaxEffect is defined by the two component deltas above. */
  readonly telescopeInvariant: true;
  readonly financiallySupported: false;
  readonly financialReviewRequired: true;
  readonly methodologyReviewed: false;
}

export type AnnualRouteDeltaUnsupportedReason =
  | AnnualOrdinaryTaxUnsupportedReason
  | "route-eligibility-unreviewed";

export type AnnualRouteDeltaResult =
  | { readonly kind: "ok"; readonly value: AnnualRouteDeltaAssessment }
  | { readonly kind: "unsupported"; readonly reason: AnnualRouteDeltaUnsupportedReason }
  | { readonly kind: "invalid"; readonly reason: string };

const NEW_BANDS: readonly RateBand[] = [
  [400_000, 0],
  [800_000, 0.05],
  [1_200_000, 0.10],
  [1_600_000, 0.15],
  [2_000_000, 0.20],
  [2_400_000, 0.25],
  [Number.POSITIVE_INFINITY, 0.30],
];

const OLD_UNDER_60_BANDS: readonly RateBand[] = [
  [250_000, 0],
  [500_000, 0.05],
  [1_000_000, 0.20],
  [Number.POSITIVE_INFINITY, 0.30],
];

const OLD_60_TO_79_BANDS: readonly RateBand[] = [
  [300_000, 0],
  [500_000, 0.05],
  [1_000_000, 0.20],
  [Number.POSITIVE_INFINITY, 0.30],
];

const OLD_80_PLUS_BANDS: readonly RateBand[] = [
  [500_000, 0],
  [1_000_000, 0.20],
  [Number.POSITIVE_INFINITY, 0.30],
];

function validMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SCHEDULE_RUPEES;
}

function validAge(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 150;
}

function taxFromBands(income: number, bands: readonly RateBand[]): number {
  let lower = 0;
  let tax = 0;
  for (const [upper, rate] of bands) {
    const taxable = Math.max(0, Math.min(income, upper) - lower);
    tax += taxable * rate;
    lower = upper;
    if (income <= upper) break;
  }
  return tax;
}

/** Section 516: discard paise, then round rupees to the nearest ₹10 (5 up). */
function roundSection516(value: number): number {
  const wholeRupees = Math.floor(value);
  const units = wholeRupees % 10;
  return units >= 5 ? wholeRupees + (10 - units) : wholeRupees - units;
}

function oldBands(age: number): readonly RateBand[] {
  if (age >= 80) return OLD_80_PLUS_BANDS;
  if (age >= 60) return OLD_60_TO_79_BANDS;
  return OLD_UNDER_60_BANDS;
}

function surchargeRate(income: number, regime: Regime): { readonly rate: number; readonly band: string; readonly threshold: number } {
  if (income <= 5_000_000) return { rate: 0, band: "none", threshold: 0 };
  if (income <= 10_000_000) return { rate: 0.10, band: ">₹50L to ₹1Cr", threshold: 5_000_000 };
  if (income <= 20_000_000) return { rate: 0.15, band: ">₹1Cr to ₹2Cr", threshold: 10_000_000 };
  if (regime === "new") return { rate: 0.25, band: ">₹2Cr ordinary section 202 ceiling", threshold: 20_000_000 };
  if (income <= 50_000_000) return { rate: 0.25, band: ">₹2Cr to ₹5Cr", threshold: 20_000_000 };
  return { rate: 0.37, band: ">₹5Cr", threshold: 50_000_000 };
}

function computeRebate(income: number, slabTax: number, regime: Regime): number {
  if (regime === "new") {
    if (income <= 1_200_000) return Math.min(slabTax, 60_000);
    const excess = income - 1_200_000;
    return slabTax > excess ? slabTax - excess : 0;
  }
  return income <= 500_000 ? Math.min(slabTax, 12_500) : 0;
}

function invalidIfNonfinite(label: string, value: number): AnnualOrdinaryTaxResult | null {
  return Number.isFinite(value) && value >= 0 && value <= MAX_SCHEDULE_RUPEES
    ? null
    : { kind: "invalid", reason: `nonfinite-${label}` };
}

function invalidIfSignedNonfinite(label: string, value: number): AnnualRouteDeltaResult | null {
  return Number.isFinite(value) && Math.abs(value) <= MAX_SCHEDULE_RUPEES
    ? null
    : { kind: "invalid", reason: `nonfinite-${label}` };
}

function closeEnough(left: number, right: number, scale = Math.max(1, Math.abs(left), Math.abs(right))): boolean {
  const tolerance = Number.EPSILON * scale * 16;
  return Math.abs(left - right) <= tolerance;
}

function routeAssessmentFailure(result: AnnualOrdinaryTaxResult): AnnualRouteDeltaResult {
  if (result.kind === "unsupported") return result;
  if (result.kind === "invalid") return result;
  return { kind: "invalid", reason: "unexpected-route-assessment" };
}

/**
 * Assess ordinary taxable income for the enacted 2026-27 Act 2025 snapshot.
 * This intentionally returns raw arithmetic and does not invent statutory
 * rounding, special-rate tax, eligibility, or taxpayer facts.
 */
export function assessAnnualOrdinaryTax(input: AnnualOrdinaryTaxInput | null | undefined): AnnualOrdinaryTaxResult {
  if (input === null || input === undefined) return { kind: "invalid", reason: "missing-input" };
  if (input.taxYear !== TAX_YEAR) return { kind: "unsupported", reason: "unsupported-tax-year" };
  if (input.taxActVersion !== TAX_ACT_VERSION) return { kind: "unsupported", reason: "unsupported-tax-act" };
  if (input.residenceStatus !== "resident") return { kind: "unsupported", reason: "unsupported-residence" };
  if (input.regime !== "new" && input.regime !== "old") return { kind: "invalid", reason: "invalid-regime" };
  if (input.roundingMode !== "raw-unrounded-arithmetic" && input.roundingMode !== "statutory-section-516") return { kind: "invalid", reason: "invalid-rounding-mode" };
  if (!validMoney(input.ordinaryTaxableIncome)) return { kind: "invalid", reason: "invalid-ordinary-income" };
  if (input.specialRateIncome === undefined) return { kind: "unsupported", reason: "missing-special-rate-income" };
  if (!validMoney(input.specialRateIncome)) {
    return { kind: "invalid", reason: "invalid-special-rate-income" };
  }
  if ((input.specialRateIncome ?? 0) !== 0) return { kind: "unsupported", reason: "unsupported-special-rate-income" };

  let bands: readonly RateBand[] = NEW_BANDS;
  if (input.regime === "old") {
    if (!validAge(input.ageDuringTaxYear)) return { kind: "unsupported", reason: "missing-age" };
    bands = oldBands(input.ageDuringTaxYear);
  } else if (input.ageDuringTaxYear !== undefined && !validAge(input.ageDuringTaxYear)) {
    return { kind: "invalid", reason: "invalid-age" };
  }

  const rawIncome = input.ordinaryTaxableIncome;
  const income = input.roundingMode === "statutory-section-516" ? roundSection516(rawIncome) : rawIncome;
  if (!validMoney(income)) return { kind: "invalid", reason: "invalid-assessed-income" };
  const slabTax = taxFromBands(income, bands);
  const rebate = computeRebate(income, slabTax, input.regime);
  const incomeTaxAfterRebate = slabTax - rebate;
  const surcharge = surchargeRate(income, input.regime);
  const surchargeBeforeMarginalRelief = incomeTaxAfterRebate * surcharge.rate;
  const taxAndSurchargeBeforeMarginalRelief = incomeTaxAfterRebate + surchargeBeforeMarginalRelief;

  let marginalRelief = 0;
  if (surcharge.threshold > 0) {
    const thresholdTax = taxFromBands(surcharge.threshold, bands);
    const thresholdSurchargeRate = surchargeRate(surcharge.threshold, input.regime).rate;
    const thresholdLiability = thresholdTax + thresholdTax * thresholdSurchargeRate;
    const cappedLiability = thresholdLiability + (income - surcharge.threshold);
    marginalRelief = Math.max(0, taxAndSurchargeBeforeMarginalRelief - cappedLiability);
  }

  const taxAndSurcharge = taxAndSurchargeBeforeMarginalRelief - marginalRelief;
  const surchargeAfterMarginalReliefRaw = surchargeBeforeMarginalRelief - marginalRelief;
  if (surchargeAfterMarginalReliefRaw < -Number.EPSILON) return { kind: "invalid", reason: "invalid-marginal-relief" };
  const surchargeAfterMarginalRelief = Math.max(0, surchargeAfterMarginalReliefRaw);
  const cess = taxAndSurcharge * CESS_RATE;
  const rawTotalTax = taxAndSurcharge + cess;
  const finalTax = input.roundingMode === "statutory-section-516" ? roundSection516(rawTotalTax) : rawTotalTax;
  for (const [label, value] of [
    ["slab-tax", slabTax],
    ["rebate", rebate],
    ["income-tax-after-rebate", incomeTaxAfterRebate],
    ["surcharge", surchargeBeforeMarginalRelief],
    ["surcharge-after-marginal-relief", surchargeAfterMarginalRelief],
    ["marginal-relief", marginalRelief],
    ["tax-and-surcharge", taxAndSurcharge],
    ["cess", cess],
    ["raw-total-tax", rawTotalTax],
    ["final-tax", finalTax],
  ] as const) {
    const error = invalidIfNonfinite(label, value);
    if (error) return error;
  }

  return {
    kind: "ok",
    value: {
      taxYear: TAX_YEAR,
      taxActVersion: TAX_ACT_VERSION,
      regime: input.regime,
      sourceVersion: ANNUAL_ORDINARY_TAX_SOURCE_VERSION,
      roundingMode: input.roundingMode,
      rawOrdinaryTaxableIncome: rawIncome,
      assessedOrdinaryTaxableIncome: income,
      ordinaryTaxableIncome: income,
      financiallySupported: false,
      financialReviewRequired: true,
      methodologyReviewed: false,
      audit: {
        ordinaryTaxableIncome: income,
        rawOrdinaryTaxableIncome: rawIncome,
        assessedOrdinaryTaxableIncome: income,
        slabTax,
        rebate,
        incomeTaxAfterRebate,
        surchargeRate: surcharge.rate,
        surchargeBeforeMarginalRelief,
        surchargeAfterMarginalRelief,
        marginalRelief,
        taxAndSurchargeBeforeMarginalRelief,
        taxAndSurcharge,
        cess,
        rawTotalTax,
        finalTax,
        totalTax: finalTax,
        surchargeBand: surcharge.band,
        rounding: input.roundingMode,
      },
    },
  };
}

/**
 * Assess the annual tax delta for a route using one shared tax context:
 * baseline B, after the reviewed deduction B-D, and after route investment
 * income B-D+I. All three assessments use the context's selected rounding
 * mode and remain review-required arithmetic.
 */
export function assessAnnualRouteDelta(input: AnnualRouteDeltaInput | null | undefined): AnnualRouteDeltaResult {
  if (input === null || input === undefined) return { kind: "invalid", reason: "missing-input" };
  if (!validMoney(input.baselineOrdinaryTaxableIncome)) return { kind: "invalid", reason: "invalid-baseline-ordinary-income" };
  if (!validMoney(input.eligibleRouteDeduction)) return { kind: "invalid", reason: "invalid-route-deduction" };
  if (!validMoney(input.routeOrdinaryInvestmentIncome)) return { kind: "invalid", reason: "invalid-route-investment-income" };
  if (input.eligibleRouteDeduction > input.baselineOrdinaryTaxableIncome) {
    return { kind: "invalid", reason: "route-deduction-exceeds-baseline" };
  }
  if (input.eligibleRouteDeduction > 0 && input.eligibilityReviewed !== true) {
    return { kind: "unsupported", reason: "route-eligibility-unreviewed" };
  }

  const withDeductionOrdinaryTaxableIncome = input.baselineOrdinaryTaxableIncome - input.eligibleRouteDeduction;
  const withInvestmentOrdinaryTaxableIncome = withDeductionOrdinaryTaxableIncome + input.routeOrdinaryInvestmentIncome;
  if (!validMoney(withDeductionOrdinaryTaxableIncome)) return { kind: "invalid", reason: "invalid-with-deduction-income" };
  if (!validMoney(withInvestmentOrdinaryTaxableIncome)) return { kind: "invalid", reason: "invalid-with-investment-income" };

  const context = {
    taxYear: input.taxYear,
    taxActVersion: input.taxActVersion,
    residenceStatus: input.residenceStatus,
    regime: input.regime,
    roundingMode: input.roundingMode,
    specialRateIncome: input.specialRateIncome,
    ageDuringTaxYear: input.ageDuringTaxYear,
  } satisfies Omit<AnnualOrdinaryTaxInput, "ordinaryTaxableIncome">;
  const baseline = assessAnnualOrdinaryTax({ ...context, ordinaryTaxableIncome: input.baselineOrdinaryTaxableIncome });
  if (baseline.kind !== "ok") return routeAssessmentFailure(baseline);
  const withDeduction = assessAnnualOrdinaryTax({ ...context, ordinaryTaxableIncome: withDeductionOrdinaryTaxableIncome });
  if (withDeduction.kind !== "ok") return routeAssessmentFailure(withDeduction);
  const withInvestment = assessAnnualOrdinaryTax({ ...context, ordinaryTaxableIncome: withInvestmentOrdinaryTaxableIncome });
  if (withInvestment.kind !== "ok") return routeAssessmentFailure(withInvestment);

  const deductionBenefit = baseline.value.audit.totalTax - withDeduction.value.audit.totalTax;
  const investmentTaxCost = withInvestment.value.audit.totalTax - withDeduction.value.audit.totalTax;
  const netTaxEffect = deductionBenefit - investmentTaxCost;
  const rawDeductionBenefit = baseline.value.audit.rawTotalTax - withDeduction.value.audit.rawTotalTax;
  const rawInvestmentTaxCost = withInvestment.value.audit.rawTotalTax - withDeduction.value.audit.rawTotalTax;
  const rawNetTaxEffect = rawDeductionBenefit - rawInvestmentTaxCost;
  for (const [label, value] of [
    ["deduction-benefit", deductionBenefit],
    ["investment-tax-cost", investmentTaxCost],
    ["net-tax-effect", netTaxEffect],
    ["raw-deduction-benefit", rawDeductionBenefit],
    ["raw-investment-tax-cost", rawInvestmentTaxCost],
    ["raw-net-tax-effect", rawNetTaxEffect],
  ] as const) {
    const error = invalidIfSignedNonfinite(label, value);
    if (error) return error;
  }
  const expectedNetTaxEffect = baseline.value.audit.totalTax - withInvestment.value.audit.totalTax;
  const taxMagnitude = Math.max(
    1,
    Math.abs(baseline.value.audit.totalTax),
    Math.abs(withDeduction.value.audit.totalTax),
    Math.abs(withInvestment.value.audit.totalTax),
  );
  if (!closeEnough(netTaxEffect, expectedNetTaxEffect, taxMagnitude)) return { kind: "invalid", reason: "telescope-invariant-failed" };

  return {
    kind: "ok",
    value: {
      sourceVersion: baseline.value.sourceVersion,
      baselineOrdinaryTaxableIncome: input.baselineOrdinaryTaxableIncome,
      withDeductionOrdinaryTaxableIncome,
      withInvestmentOrdinaryTaxableIncome,
      baselineAudit: baseline.value.audit,
      withDeductionAudit: withDeduction.value.audit,
      withInvestmentAudit: withInvestment.value.audit,
      roundingMode: input.roundingMode,
      deductionBenefit,
      investmentTaxCost,
      netTaxEffect,
      rawDeductionBenefit,
      rawInvestmentTaxCost,
      rawNetTaxEffect,
      telescopeInvariant: true,
      financiallySupported: false,
      financialReviewRequired: true,
      methodologyReviewed: false,
    },
  };
}
