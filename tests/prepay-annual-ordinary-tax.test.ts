import { describe, expect, it } from "vitest";
import { ANNUAL_ORDINARY_TAX_SOURCE_VERSION, assessAnnualOrdinaryTax, assessAnnualRouteDelta, type AnnualOrdinaryTaxInput, type AnnualRouteDeltaInput } from "../lib/prepay/annual-ordinary-tax";

const baseInput: AnnualOrdinaryTaxInput = {
  taxYear: "2026-27",
  taxActVersion: "2025",
  residenceStatus: "resident",
  regime: "new",
  roundingMode: "raw-unrounded-arithmetic",
  ordinaryTaxableIncome: 0,
  specialRateIncome: 0,
};

function assess(overrides: Partial<AnnualOrdinaryTaxInput> = {}) {
  const result = assessAnnualOrdinaryTax({ ...baseInput, ...overrides });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error(result.reason);
  return result.value;
}

describe("annual ordinary tax assessment", () => {
  it("uses the enacted 2026-27 new-regime slabs without rounding", () => {
    const cases = [
      [4_00_000, 0],
      [8_00_000, 20_000],
      [12_00_000, 60_000],
      [16_00_000, 1_20_000],
      [20_00_000, 2_00_000],
      [24_00_000, 3_00_000],
      [30_00_000, 4_80_000],
    ] as const;
    for (const [income, expectedSlabTax] of cases) {
      expect(assess({ ordinaryTaxableIncome: income }).audit.slabTax).toBe(expectedSlabTax);
    }
  });

  it("applies the new-regime rebate at ₹12L and marginal relief immediately above", () => {
    const atLimit = assess({ ordinaryTaxableIncome: 1_200_000 });
    expect(atLimit.audit).toMatchObject({ slabTax: 60_000, rebate: 60_000, totalTax: 0 });

    const aboveLimit = assess({ ordinaryTaxableIncome: 1_200_001 });
    expect(aboveLimit.audit).toMatchObject({ slabTax: 60_000.15, rebate: 59_999.15, taxAndSurcharge: 1, cess: 0.04, totalTax: 1.04 });
    expect(aboveLimit.audit.rounding).toBe("raw-unrounded-arithmetic");

    const oneThousandAbove = assess({ ordinaryTaxableIncome: 1_201_000 });
    expect(oneThousandAbove.audit).toMatchObject({ slabTax: 60_150, rebate: 59_150, taxAndSurcharge: 1_000, cess: 40, totalTax: 1_040 });
  });

  it("uses old-regime age bands and the old rebate boundary", () => {
    const under60 = assess({ regime: "old", ageDuringTaxYear: 59, ordinaryTaxableIncome: 500_000 });
    expect(under60.audit).toMatchObject({ slabTax: 12_500, rebate: 12_500, totalTax: 0 });

    const age60 = assess({ regime: "old", ageDuringTaxYear: 60, ordinaryTaxableIncome: 300_000 });
    expect(age60.audit.slabTax).toBe(0);
    const age80 = assess({ regime: "old", ageDuringTaxYear: 80, ordinaryTaxableIncome: 500_000 });
    expect(age80.audit.slabTax).toBe(0);

    const aboveOldRebate = assess({ regime: "old", ageDuringTaxYear: 59, ordinaryTaxableIncome: 500_001 });
    expect(aboveOldRebate.audit.rebate).toBe(0);
  });

  it("reports new-regime surcharge bands and relief at 50L, 1Cr and 2Cr", () => {
    const at50L = assess({ ordinaryTaxableIncome: 5_000_000 });
    expect(at50L.audit).toMatchObject({ surchargeRate: 0, surchargeBand: "none", totalTax: 1_123_200 });

    const over50L = assess({ ordinaryTaxableIncome: 5_000_001 });
    expect(over50L.audit).toMatchObject({ surchargeRate: 0.1, totalTax: 1_123_201.04 });
    expect(over50L.audit.marginalRelief).toBeGreaterThan(0);

    const at1Cr = assess({ ordinaryTaxableIncome: 10_000_000 });
    expect(at1Cr.audit).toMatchObject({ surchargeRate: 0.1, surchargeBand: ">₹50L to ₹1Cr", totalTax: 2_951_520 });
    const over1Cr = assess({ ordinaryTaxableIncome: 10_000_001 });
    expect(over1Cr.audit).toMatchObject({ surchargeRate: 0.15, totalTax: 2_951_521.04 });
    expect(over1Cr.audit.marginalRelief).toBeGreaterThan(0);

    const at2Cr = assess({ ordinaryTaxableIncome: 20_000_000 });
    expect(at2Cr.audit).toMatchObject({ surchargeRate: 0.15, totalTax: 6_673_680 });
    const over2Cr = assess({ ordinaryTaxableIncome: 20_000_001 });
    expect(over2Cr.audit).toMatchObject({ surchargeRate: 0.25, surchargeBand: ">₹2Cr ordinary section 202 ceiling", totalTax: 6_673_681.04 });
    expect(over2Cr.audit.marginalRelief).toBeGreaterThan(0);
  });

  it("keeps the enacted new-regime ordinary surcharge ceiling at 25%, while old regime reaches 37% above 5Cr", () => {
    expect(assess({ ordinaryTaxableIncome: 50_000_000 }).audit.surchargeRate).toBe(0.25);
    expect(assess({ ordinaryTaxableIncome: 50_000_001 }).audit.surchargeRate).toBe(0.25);
    const oldAt50L = assess({ regime: "old", ageDuringTaxYear: 59, ordinaryTaxableIncome: 5_000_000 });
    expect(oldAt50L.audit).toMatchObject({ surchargeRate: 0, totalTax: 1_365_000 });
    const oldOver50L = assess({ regime: "old", ageDuringTaxYear: 59, ordinaryTaxableIncome: 5_000_001 });
    expect(oldOver50L.audit).toMatchObject({ surchargeRate: 0.1, totalTax: 1_365_001.04 });
    const oldAt1Cr = assess({ regime: "old", ageDuringTaxYear: 59, ordinaryTaxableIncome: 10_000_000 });
    expect(oldAt1Cr.audit).toMatchObject({ surchargeRate: 0.1, totalTax: 3_217_500 });
    const oldAt5Cr = assess({ regime: "old", ageDuringTaxYear: 59, ordinaryTaxableIncome: 50_000_000 });
    expect(oldAt5Cr.audit).toMatchObject({ surchargeRate: 0.25, totalTax: 19_256_250 });
    const oldOver5Cr = assess({ regime: "old", ageDuringTaxYear: 59, ordinaryTaxableIncome: 50_000_001 });
    expect(oldOver5Cr.audit).toMatchObject({ surchargeRate: 0.37, totalTax: 19_256_251.04 });
    expect(oldOver5Cr.audit.marginalRelief).toBeGreaterThan(0);
  });

  it("returns explicit support and review metadata for arithmetic reuse", () => {
    const result = assessAnnualOrdinaryTax(baseInput);
    expect(result).toMatchObject({ kind: "ok", value: { sourceVersion: "income-tax-act-2025+finance-act-2026:tax-year-2026-27", financiallySupported: false, financialReviewRequired: true, methodologyReviewed: false } });
    if (result.kind !== "ok") return;
    expect(result.value.audit.ordinaryTaxableIncome).toBe(0);
  });

  it("exposes the same annual function for deduction benefit and investment cost deltas", () => {
    const baseline = assess({ ordinaryTaxableIncome: 1_250_000 });
    // Synthetic eligible-deduction arithmetic only; this does not assert home-loan eligibility.
    const withDeduction = assess({ ordinaryTaxableIncome: 1_150_000 });
    const withInvestment = assess({ ordinaryTaxableIncome: 1_250_000 });
    const deductionBenefit = baseline.audit.totalTax - withDeduction.audit.totalTax;
    const investmentTaxCost = withInvestment.audit.totalTax - withDeduction.audit.totalTax;
    expect(deductionBenefit).toBe(52_000);
    expect(investmentTaxCost).toBe(52_000);
    expect(deductionBenefit - investmentTaxCost).toBe(0);
    expect(withInvestment.ordinaryTaxableIncome).toBe(1_250_000);
  });

  it("rejects unsupported facts and malformed numbers without partial output", () => {
    expect(assessAnnualOrdinaryTax(null)).toMatchObject({ kind: "invalid", reason: "missing-input" });
    expect(assessAnnualOrdinaryTax({ ...baseInput, taxYear: "2025-26" })).toMatchObject({ kind: "unsupported", reason: "unsupported-tax-year" });
    expect(assessAnnualOrdinaryTax({ ...baseInput, residenceStatus: "non-resident" })).toMatchObject({ kind: "unsupported", reason: "unsupported-residence" });
    expect(assessAnnualOrdinaryTax({ ...baseInput, specialRateIncome: 1 })).toMatchObject({ kind: "unsupported", reason: "unsupported-special-rate-income" });
    expect(assessAnnualOrdinaryTax({ ...baseInput, specialRateIncome: undefined } as unknown as AnnualOrdinaryTaxInput)).toMatchObject({ kind: "unsupported", reason: "missing-special-rate-income" });
    expect(assessAnnualOrdinaryTax({ ...baseInput, ordinaryTaxableIncome: Number.NaN })).toMatchObject({ kind: "invalid", reason: "invalid-ordinary-income" });
    expect(assessAnnualOrdinaryTax({ ...baseInput, ordinaryTaxableIncome: Number.POSITIVE_INFINITY })).toMatchObject({ kind: "invalid", reason: "invalid-ordinary-income" });
    expect(assessAnnualOrdinaryTax({ ...baseInput, regime: "old", ordinaryTaxableIncome: 1_000_000 })).toMatchObject({ kind: "unsupported", reason: "missing-age" });
  });

  it("does not mutate the caller input", () => {
    const input: AnnualOrdinaryTaxInput = { ...baseInput, ordinaryTaxableIncome: 1_200_001 };
    const before = { ...input };
    assessAnnualOrdinaryTax(input);
    expect(input).toEqual(before);
  });

  it("applies section 516 to income before slabs and to final tax after cess", () => {
    const almostTwelveLakh = assess({ roundingMode: "statutory-section-516", ordinaryTaxableIncome: 1_200_004.99 });
    expect(almostTwelveLakh.audit).toMatchObject({ rawOrdinaryTaxableIncome: 1_200_004.99, assessedOrdinaryTaxableIncome: 1_200_000, finalTax: 0, totalTax: 0, rounding: "statutory-section-516" });

    const fiveRupeesAbove = assess({ roundingMode: "statutory-section-516", ordinaryTaxableIncome: 1_200_005 });
    expect(fiveRupeesAbove.audit).toMatchObject({ assessedOrdinaryTaxableIncome: 1_200_010, rawTotalTax: 10.4, finalTax: 10, totalTax: 10 });

    const finalTaxUnitFour = assess({ regime: "old", ageDuringTaxYear: 59, roundingMode: "statutory-section-516", ordinaryTaxableIncome: 1_000_080 });
    expect(finalTaxUnitFour.audit.rawTotalTax).toBeCloseTo(117_024.96, 10);
    expect(Math.floor(finalTaxUnitFour.audit.rawTotalTax) % 10).toBe(4);
    expect(finalTaxUnitFour.audit.finalTax).toBe(117_020);
    const finalTaxUnitFive = assess({ regime: "old", ageDuringTaxYear: 59, roundingMode: "statutory-section-516", ordinaryTaxableIncome: 1_000_050 });
    expect(finalTaxUnitFive.audit.rawTotalTax).toBeCloseTo(117_015.6, 10);
    expect(Math.floor(finalTaxUnitFive.audit.rawTotalTax) % 10).toBe(5);
    expect(finalTaxUnitFive.audit.finalTax).toBe(117_020);
  });

  it("composes B, B-D, and B-D+I through one context with a telescoping tax effect", () => {
    const input: AnnualRouteDeltaInput = {
      taxYear: "2026-27",
      taxActVersion: "2025",
      residenceStatus: "resident",
      regime: "new",
      roundingMode: "raw-unrounded-arithmetic",
      specialRateIncome: 0,
      baselineOrdinaryTaxableIncome: 1_250_000,
      eligibleRouteDeduction: 100_000,
      routeOrdinaryInvestmentIncome: 100_000,
      eligibilityReviewed: true,
    };
    const result = assessAnnualRouteDelta(input);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error(result.reason);
    expect(result.value).toMatchObject({
      baselineOrdinaryTaxableIncome: 1_250_000,
      withDeductionOrdinaryTaxableIncome: 1_150_000,
      withInvestmentOrdinaryTaxableIncome: 1_250_000,
      deductionBenefit: 52_000,
      investmentTaxCost: 52_000,
      netTaxEffect: 0,
      telescopeInvariant: true,
      financiallySupported: false,
      financialReviewRequired: true,
      methodologyReviewed: false,
    });
    expect(result.value.baselineAudit).toEqual(result.value.withInvestmentAudit);
    expect(result.value.baselineAudit.ordinaryTaxableIncome).toBe(1_250_000);
    expect(result.value.withDeductionAudit.ordinaryTaxableIncome).toBe(1_150_000);
  });

  it("allows zero deduction without an eligibility assertion and catches rebate-boundary deltas", () => {
    const noDeduction = assessAnnualRouteDelta({
      taxYear: "2026-27", taxActVersion: "2025", residenceStatus: "resident", regime: "new", roundingMode: "raw-unrounded-arithmetic", specialRateIncome: 0,
      baselineOrdinaryTaxableIncome: 0, eligibleRouteDeduction: 0, routeOrdinaryInvestmentIncome: 0, eligibilityReviewed: false,
    });
    expect(noDeduction).toMatchObject({ kind: "ok", value: { deductionBenefit: 0, investmentTaxCost: 0, netTaxEffect: 0 } });

    const newRelief = assessAnnualRouteDelta({
      taxYear: "2026-27", taxActVersion: "2025", residenceStatus: "resident", regime: "new", roundingMode: "raw-unrounded-arithmetic", specialRateIncome: 0,
      baselineOrdinaryTaxableIncome: 1_201_000, eligibleRouteDeduction: 1_000, routeOrdinaryInvestmentIncome: 0, eligibilityReviewed: true,
    });
    expect(newRelief).toMatchObject({ kind: "ok", value: { deductionBenefit: 1_040, investmentTaxCost: 0, netTaxEffect: 1_040 } });

    const oldRebate = assessAnnualRouteDelta({
      taxYear: "2026-27", taxActVersion: "2025", residenceStatus: "resident", regime: "old", roundingMode: "raw-unrounded-arithmetic", ageDuringTaxYear: 59, specialRateIncome: 0,
      baselineOrdinaryTaxableIncome: 500_001, eligibleRouteDeduction: 1, routeOrdinaryInvestmentIncome: 0, eligibilityReviewed: true,
    });
    expect(oldRebate).toMatchObject({ kind: "ok", value: { withDeductionOrdinaryTaxableIncome: 500_000 } });
    if (oldRebate.kind === "ok") expect(oldRebate.value.deductionBenefit).toBeCloseTo(13_000.208, 10);

    const roundedDelta = assessAnnualRouteDelta({
      taxYear: "2026-27", taxActVersion: "2025", residenceStatus: "resident", regime: "old", roundingMode: "statutory-section-516", ageDuringTaxYear: 59, specialRateIncome: 0,
      baselineOrdinaryTaxableIncome: 500_005, eligibleRouteDeduction: 1, routeOrdinaryInvestmentIncome: 0, eligibilityReviewed: true,
    });
    expect(roundedDelta).toMatchObject({ kind: "ok", value: { deductionBenefit: 13_000, rawDeductionBenefit: 13_002.08, investmentTaxCost: 0, rawInvestmentTaxCost: 0 } });
    if (roundedDelta.kind === "ok") expect(roundedDelta.value.netTaxEffect).not.toBe(Math.round(roundedDelta.value.rawNetTaxEffect));
    const rawDelta = assessAnnualRouteDelta({
      taxYear: "2026-27", taxActVersion: "2025", residenceStatus: "resident", regime: "old", roundingMode: "raw-unrounded-arithmetic", ageDuringTaxYear: 59, specialRateIncome: 0,
      baselineOrdinaryTaxableIncome: 500_005, eligibleRouteDeduction: 1, routeOrdinaryInvestmentIncome: 0, eligibilityReviewed: true,
    });
    expect(rawDelta).toMatchObject({ kind: "ok", value: { investmentTaxCost: 0 } });
    if (rawDelta.kind === "ok") {
      expect(rawDelta.value.deductionBenefit).toBeCloseTo(0.208, 10);
      expect(rawDelta.value.rawDeductionBenefit).toBeCloseTo(0.208, 10);
    }
  });

  it("requires reviewed eligibility for positive deductions and validates both derived incomes", () => {
    const common = {
      taxYear: "2026-27", taxActVersion: "2025", residenceStatus: "resident" as const, regime: "new" as const, roundingMode: "raw-unrounded-arithmetic" as const, specialRateIncome: 0,
      baselineOrdinaryTaxableIncome: 100, routeOrdinaryInvestmentIncome: 0,
    };
    expect(assessAnnualRouteDelta({ ...common, eligibleRouteDeduction: 1, eligibilityReviewed: false })).toMatchObject({ kind: "unsupported", reason: "route-eligibility-unreviewed" });
    expect(assessAnnualRouteDelta({ ...common, eligibleRouteDeduction: 101, eligibilityReviewed: true })).toMatchObject({ kind: "invalid", reason: "route-deduction-exceeds-baseline" });
    expect(assessAnnualRouteDelta({ ...common, baselineOrdinaryTaxableIncome: 1_000_000_000_000, eligibleRouteDeduction: 0, routeOrdinaryInvestmentIncome: 1, eligibilityReviewed: false })).toMatchObject({ kind: "invalid", reason: "invalid-with-investment-income" });
    expect(assessAnnualRouteDelta({ ...common, taxYear: "2025-26", eligibleRouteDeduction: 0, eligibilityReviewed: false })).toMatchObject({ kind: "unsupported", reason: "unsupported-tax-year" });
    expect(assessAnnualRouteDelta({ ...common, baselineOrdinaryTaxableIncome: 1_200_000, eligibleRouteDeduction: 0, routeOrdinaryInvestmentIncome: 1_000, eligibilityReviewed: false })).toMatchObject({ kind: "ok", value: { netTaxEffect: -1_040 } });
  });


});

