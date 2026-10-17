import {
  ANNUAL_ORDINARY_TAX_SOURCE_VERSION,
  assessAnnualRouteDelta,
  type AnnualRouteDeltaAssessment,
  type AnnualRouteDeltaUnsupportedReason,
} from "./annual-ordinary-tax";
import {
  validateNormalizedTaxProfile,
  type AnnualAmountFact,
  type AnnualTaxContext,
  type NormalizedTaxProfile,
  type StructuralMissingField,
} from "./model-contract";

export interface AnnualContextAdapterInput {
  readonly taxProfile: NormalizedTaxProfile;
  readonly taxYear: string;
  readonly eligibleRouteDeduction: number;
  readonly routeOrdinaryInvestmentIncome: number;
  /** Eligibility is a supplied reviewed fact; this adapter never infers it. */
  readonly eligibilityReviewed: boolean;
}

export interface AnnualContextAdapterValue {
  readonly taxYear: string;
  readonly taxActVersion: "1961" | "2025";
  readonly sourceVersion: typeof ANNUAL_ORDINARY_TAX_SOURCE_VERSION;
  readonly residenceStatus: "resident" | "non-resident" | "unknown";
  readonly regime: "old" | "new";
  readonly ageDuringTaxYear: number | null;
  readonly roundingConvention: "raw-unrounded-arithmetic" | "statutory-section-516";
  readonly assessment: AnnualRouteDeltaAssessment;
  readonly financiallySupported: false;
  readonly financialReviewRequired: true;
  readonly methodologyReviewed: false;
}

export type AnnualContextAdapterUnsupportedReason =
  | "incomplete-tax-profile"
  | "tax-year-context-mismatch"
  | "unsupported-source-version"
  | "unsupported-residence"
  | "unsupported-special-rate-income"
  | "unsupported-agricultural-income"
  | "unsupported-losses"
  | "unsupported-tax-year"
  | "unsupported-tax-act"
  | "unsupported-profile"
  | "missing-age"
  | "route-eligibility-unreviewed";

export type AnnualContextAdapterResult =
  | { readonly kind: "ok"; readonly value: AnnualContextAdapterValue }
  | { readonly kind: "unsupported"; readonly reason: AnnualContextAdapterUnsupportedReason; readonly missingFields?: readonly StructuralMissingField[] }
  | { readonly kind: "invalid"; readonly reason: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isKnownZero(value: AnnualAmountFact): boolean {
  return value.kind === "known" && value.amount === 0;
}

function explicitUnsupportedFacts(profile: unknown, selectedYear: string): AnnualContextAdapterUnsupportedReason | null {
  if (!record(profile) || !Array.isArray(profile.annualContexts)) return null;
  for (const rawContext of profile.annualContexts) {
    if (!record(rawContext) || rawContext.taxYear !== selectedYear) continue;
    if (Array.isArray(rawContext.specialRateIncome) && rawContext.specialRateIncome.some((component) => record(component) && component.kind === "unknown")) return "unsupported-special-rate-income";
    const agriculturalIncome = rawContext.agriculturalIncome;
    if (record(agriculturalIncome) && agriculturalIncome.kind === "unknown") return "unsupported-agricultural-income";
    const losses = rawContext.losses;
    if (record(losses) && [losses.currentYear, losses.carryForward].some((fact) => record(fact) && fact.kind === "unknown")) return "unsupported-losses";
  }
  return null;
}

function incompleteReason(validation: Extract<ReturnType<typeof validateNormalizedTaxProfile>, { kind: "invalid" }>): AnnualContextAdapterUnsupportedReason {
  if (validation.missingFields.some(({ code }) => code === "tax.annualContexts.taxYear")) return "tax-year-context-mismatch";
  if (validation.missingFields.some(({ code }) => code === "tax.annualContexts.age")) return "missing-age";
  if (validation.missingFields.some(({ code }) => code === "tax.annualContexts.specialRateIncome")) return "unsupported-special-rate-income";
  if (validation.missingFields.some(({ code }) => code === "tax.annualContexts.agriculturalIncome")) return "unsupported-agricultural-income";
  if (validation.missingFields.some(({ code }) => code === "tax.annualContexts.losses")) return "unsupported-losses";
  return "incomplete-tax-profile";
}

function assessorUnsupportedReason(reason: AnnualRouteDeltaUnsupportedReason): AnnualContextAdapterUnsupportedReason {
  if (reason === "missing-special-rate-income") return "unsupported-special-rate-income";
  return reason;
}

/**
 * Adapts one validated v2 annual context into the shared B, B-D, and B-D+I
 * ordinary-tax delta calculation. Tax classes outside that assessor remain
 * explicit unsupported states; no unknown fact becomes zero here.
 */
export function assessAnnualRouteFromContext(input: AnnualContextAdapterInput | null | undefined): AnnualContextAdapterResult {
  if (!record(input)) return { kind: "invalid", reason: "missing-input" };
  if (typeof input.taxYear !== "string" || input.taxYear.trim() === "") return { kind: "invalid", reason: "invalid-tax-year" };
  if (!finiteNonnegative(input.eligibleRouteDeduction)) return { kind: "invalid", reason: "invalid-route-deduction" };
  if (!finiteNonnegative(input.routeOrdinaryInvestmentIncome)) return { kind: "invalid", reason: "invalid-route-investment-income" };
  if (typeof input.eligibilityReviewed !== "boolean") return { kind: "invalid", reason: "invalid-eligibility-review" };

  const explicitUnsupported = explicitUnsupportedFacts(input.taxProfile, input.taxYear);
  if (explicitUnsupported) return { kind: "unsupported", reason: explicitUnsupported };
  const profileResult = validateNormalizedTaxProfile(input.taxProfile);
  if (profileResult.kind === "invalid") return { kind: "unsupported", reason: incompleteReason(profileResult), missingFields: profileResult.missingFields };
  const profile = profileResult.value;
  if (profile.taxpayerScope.residenceStatus !== "resident") return { kind: "unsupported", reason: "unsupported-residence" };
  if (profile.taxpayerScope.profileFlags.length > 0) return { kind: "unsupported", reason: "unsupported-profile" };

  const yearFacts = profile.taxYears.filter((year) => year.taxYear === input.taxYear);
  const contexts = profile.annualContexts.filter((context) => context.taxYear === input.taxYear);
  if (yearFacts.length !== 1 || contexts.length !== 1) return { kind: "unsupported", reason: "tax-year-context-mismatch" };
  const year = yearFacts[0];
  const context: AnnualTaxContext = contexts[0];
  if (context.sourceVersion !== ANNUAL_ORDINARY_TAX_SOURCE_VERSION) return { kind: "unsupported", reason: "unsupported-source-version" };
  if (year.taxActVersion !== "2025") return { kind: "unsupported", reason: "unsupported-tax-act" };
  if (year.taxYear !== "2026-27" || year.startDate !== "2026-04-01" || year.endDate !== "2027-03-31" || year.assessmentYear !== null) {
    return { kind: "unsupported", reason: "unsupported-tax-year" };
  }
  if (context.agriculturalIncome.kind !== "known" || context.agriculturalIncome.amount !== 0) return { kind: "unsupported", reason: "unsupported-agricultural-income" };
  if (!isKnownZero(context.losses.currentYear) || !isKnownZero(context.losses.carryForward)) return { kind: "unsupported", reason: "unsupported-losses" };
  if (context.specialRateIncome.some((component) => component.kind === "unknown" || component.amount !== 0)) return { kind: "unsupported", reason: "unsupported-special-rate-income" };

  const assessed = assessAnnualRouteDelta({
    taxYear: year.taxYear,
    taxActVersion: year.taxActVersion,
    residenceStatus: profile.taxpayerScope.residenceStatus,
    regime: profile.regime,
    roundingMode: context.roundingConvention,
    specialRateIncome: 0,
    ageDuringTaxYear: context.ageDuringTaxYear ?? undefined,
    baselineOrdinaryTaxableIncome: context.backgroundOrdinaryTaxableIncome,
    eligibleRouteDeduction: input.eligibleRouteDeduction,
    routeOrdinaryInvestmentIncome: input.routeOrdinaryInvestmentIncome,
    eligibilityReviewed: input.eligibilityReviewed,
  });
  if (assessed.kind === "unsupported") return { kind: "unsupported", reason: assessorUnsupportedReason(assessed.reason) };
  if (assessed.kind === "invalid") return assessed;
  return {
    kind: "ok",
    value: {
      taxYear: year.taxYear,
      taxActVersion: year.taxActVersion,
      sourceVersion: context.sourceVersion,
      residenceStatus: profile.taxpayerScope.residenceStatus,
      regime: profile.regime,
      ageDuringTaxYear: context.ageDuringTaxYear,
      roundingConvention: context.roundingConvention,
      assessment: assessed.value,
      financiallySupported: false,
      financialReviewRequired: true,
      methodologyReviewed: false,
    },
  };
}
