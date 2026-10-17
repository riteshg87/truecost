import { describe, expect, it } from "vitest";
import { ANNUAL_ORDINARY_TAX_SOURCE_VERSION } from "../lib/prepay/annual-ordinary-tax";
import {
  assessAnnualRouteFromContext,
  type AnnualContextAdapterInput,
} from "../lib/prepay/annual-context-adapter";
import type {
  AnnualTaxContext,
  NormalizedTaxProfile,
  TaxYearFact,
} from "../lib/prepay/model-contract";

const supportedYear: TaxYearFact = {
  taxYear: "2026-27",
  assessmentYear: null,
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  taxActVersion: "2025",
};

const zeroFact = () => ({ kind: "known" as const, amount: 0 });

function makeProfile(options: {
  readonly context?: Partial<AnnualTaxContext>;
  readonly year?: Partial<TaxYearFact>;
  readonly profileFlags?: readonly string[];
} = {}): NormalizedTaxProfile {
  const context: AnnualTaxContext = {
    taxYear: "2026-27",
    backgroundOrdinaryTaxableIncome: 1_250_000,
    specialRateIncome: [],
    ageDuringTaxYear: null,
    agriculturalIncome: zeroFact(),
    losses: { currentYear: zeroFact(), carryForward: zeroFact() },
    roundingConvention: "raw-unrounded-arithmetic",
    sourceVersion: ANNUAL_ORDINARY_TAX_SOURCE_VERSION,
    ...options.context,
  };
  return {
    calculationDate: "2026-09-17",
    taxYears: [{ ...supportedYear, ...options.year }],
    regime: "new",
    annualContexts: [context],
    taxpayerScope: { residenceStatus: "resident", profileFlags: options.profileFlags ?? [] },
    taxBenefitReceiptRule: { kind: "rule", ruleId: "after-filing", reinvest: false },
  };
}

function assess(overrides: Partial<AnnualContextAdapterInput> = {}) {
  return assessAnnualRouteFromContext({
    taxProfile: makeProfile(),
    taxYear: "2026-27",
    eligibleRouteDeduction: 100_000,
    routeOrdinaryInvestmentIncome: 100_000,
    eligibilityReviewed: true,
    ...overrides,
  });
}

describe("annual context adapter", () => {
  it("uses the exact annual assessor source and rejects a source mismatch", () => {
    const result = assess({ taxProfile: makeProfile({ context: { sourceVersion: "legacy-fixed-factor" } }) });
    expect(result).toEqual({ kind: "unsupported", reason: "unsupported-source-version" });
  });

  it("requires one matching context and never falls back from duplicate or wrong years", () => {
    const duplicate = makeProfile();
    const duplicateContext = { ...duplicate.annualContexts[0] };
    const duplicateResult = assess({
      taxProfile: { ...duplicate, annualContexts: [duplicate.annualContexts[0], duplicateContext] } as unknown as NormalizedTaxProfile,
    });
    expect(duplicateResult).toMatchObject({ kind: "unsupported", reason: "tax-year-context-mismatch" });

    const wrongYearResult = assess({ taxYear: "2025-26" });
    expect(wrongYearResult).toMatchObject({ kind: "unsupported", reason: "tax-year-context-mismatch" });
  });

  it("rejects a mismatched label, boundaries, or assessment-year metadata before the assessor", () => {
    expect(assess({ taxProfile: makeProfile({ year: { taxYear: "FY2026-27" } }) })).toMatchObject({ kind: "unsupported", reason: "tax-year-context-mismatch" });
    expect(assess({ taxProfile: makeProfile({ year: { startDate: "2026-04-02" } }) })).toMatchObject({ kind: "unsupported", reason: "unsupported-tax-year" });
    expect(assess({ taxProfile: makeProfile({ year: { assessmentYear: "AY2027-28" } }) })).toMatchObject({ kind: "unsupported", reason: "unsupported-tax-year" });
  });

  it("does not flatten unknown or nonzero tax facts into ordinary zero", () => {
    expect(assess({ taxProfile: makeProfile({ context: { specialRateIncome: [{ kind: "unknown", category: "equity", reason: "not supplied" }] } }) })).toMatchObject({ kind: "unsupported", reason: "unsupported-special-rate-income" });
    expect(assess({ taxProfile: makeProfile({ context: { agriculturalIncome: { kind: "unknown", reason: "not supplied" } } }) })).toMatchObject({ kind: "unsupported", reason: "unsupported-agricultural-income" });
    expect(assess({ taxProfile: makeProfile({ context: { losses: { currentYear: { kind: "known", amount: 1 }, carryForward: zeroFact() } } }) })).toMatchObject({ kind: "unsupported", reason: "unsupported-losses" });
  });

  it("accepts explicit zero facts and returns provenance plus all review gates", () => {
    const result = assess({ eligibleRouteDeduction: 0, routeOrdinaryInvestmentIncome: 0, eligibilityReviewed: false });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value).toMatchObject({
      taxYear: "2026-27",
      taxActVersion: "2025",
      sourceVersion: ANNUAL_ORDINARY_TAX_SOURCE_VERSION,
      residenceStatus: "resident",
      financiallySupported: false,
      financialReviewRequired: true,
      methodologyReviewed: false,
    });
    expect(result.value.assessment).toMatchObject({
      baselineAudit: expect.any(Object),
      withDeductionAudit: expect.any(Object),
      withInvestmentAudit: expect.any(Object),
      financiallySupported: false,
      financialReviewRequired: true,
      methodologyReviewed: false,
    });
  });

  it("preserves a negative investment effect when investment income raises tax", () => {
    const result = assess({ eligibleRouteDeduction: 0, routeOrdinaryInvestmentIncome: 100_000, eligibilityReviewed: false });
    expect(result).toMatchObject({ kind: "ok", value: { assessment: { deductionBenefit: 0 } } });
    if (result.kind === "ok") {
      expect(result.value.assessment.investmentTaxCost).toBeGreaterThan(0);
      expect(result.value.assessment.netTaxEffect).toBeLessThan(0);
    }
  });

  it("requires the new annual context instead of accepting the legacy fixed-factor profile", () => {
    const legacy = makeProfile();
    const result = assess({ taxProfile: { ...legacy, annualContexts: undefined } as unknown as NormalizedTaxProfile });
    expect(result).toMatchObject({ kind: "unsupported", reason: "incomplete-tax-profile" });
  });

  it("composes the old-regime statutory section-516 fixture J13000", () => {
    const base = makeProfile({
      context: {
        backgroundOrdinaryTaxableIncome: 500_005,
        ageDuringTaxYear: 59,
        roundingConvention: "statutory-section-516",
      },
    });
    const profile: NormalizedTaxProfile = { ...base, regime: "old" };
    const result = assess({ taxProfile: profile, eligibleRouteDeduction: 1, routeOrdinaryInvestmentIncome: 0, eligibilityReviewed: true });
    expect(result).toMatchObject({ kind: "ok", value: { assessment: { deductionBenefit: 13_000, rawDeductionBenefit: 13_002.08 } } });
  });

  it("rejects nonresident, profile flags, and unreviewed positive deductions", () => {
    expect(assess({ taxProfile: { ...makeProfile(), taxpayerScope: { residenceStatus: "unknown", profileFlags: [] } } })).toMatchObject({ kind: "unsupported", reason: "unsupported-residence" });
    expect(assess({ taxProfile: makeProfile({ profileFlags: ["amt-applies"] }) })).toMatchObject({ kind: "unsupported", reason: "unsupported-profile" });
    expect(assess({ eligibilityReviewed: false })).toMatchObject({ kind: "unsupported", reason: "route-eligibility-unreviewed" });
  });
});
