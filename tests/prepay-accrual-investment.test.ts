import { describe, expect, it } from "vitest";
import { buildAccrualInvestmentLedger, type AccrualInvestmentInterval } from "../lib/prepay/accrual-investment";
import { ANNUAL_ORDINARY_TAX_SOURCE_VERSION, assessAnnualRouteDelta } from "../lib/prepay/annual-ordinary-tax";
import type { AnnualTaxContext, NormalizedTaxProfile } from "../lib/prepay/model-contract";

const intervals: readonly AccrualInvestmentInterval[] = [
  { startDate: "2026-01-01", endDate: "2027-01-01", grossInterestRate: 0.07, effectiveTaxFactor: 0.312, interestDisposition: "reinvest" },
  { startDate: "2027-01-01", endDate: "2028-01-01", grossInterestRate: 0.07, effectiveTaxFactor: 0.312, interestDisposition: "reinvest" },
];

function taxProfile(contexts: readonly AnnualTaxContext[], regime: "new" | "old" = "new"): NormalizedTaxProfile {
  return {
    calculationDate: "2026-04-01",
    regime,
    taxYears: contexts.map((context) => ({ taxYear: context.taxYear, assessmentYear: null, startDate: `${context.taxYear.slice(0, 4)}-04-01`, endDate: `${Number(context.taxYear.slice(0, 4)) + 1}-03-31`, taxActVersion: "2025" as const })),
    annualContexts: contexts,
    taxpayerScope: { residenceStatus: "resident", profileFlags: [] },
    taxBenefitReceiptRule: { kind: "rule", ruleId: "after-filing", reinvest: false },
  };
}

function annualContext(backgroundOrdinaryTaxableIncome = 2_000_000, taxYear = "2026-27", roundingConvention: AnnualTaxContext["roundingConvention"] = "raw-unrounded-arithmetic"): AnnualTaxContext {
  return {
    taxYear,
    backgroundOrdinaryTaxableIncome,
    specialRateIncome: [],
    ageDuringTaxYear: null,
    agriculturalIncome: { kind: "known", amount: 0 },
    losses: { currentYear: { kind: "known", amount: 0 }, carryForward: { kind: "known", amount: 0 } },
    roundingConvention,
    sourceVersion: ANNUAL_ORDINARY_TAX_SOURCE_VERSION,
  };
}

describe("dated accrual investment ledger", () => {
  it("credits gross interest on the actual invested balance and reinvests net interest", () => {
    const result = buildAccrualInvestmentLedger({ intervals, contributions: [{ id: "initial", date: "2026-01-01", amount: 100_000 }], taxSettlement: "settled-from-interest-at-credit" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.rows[0]).toMatchObject({ openingBalance: 0, contribution: 100_000, closingBalance: 104_816 });
    expect(result.value.rows[0].grossInterest).toBeCloseTo(7_000, 10);
    expect(result.value.rows[0].tax).toBeCloseTo(2_184, 10);
    expect(result.value.rows[0].netInterest).toBeCloseTo(4_816, 10);
    expect(result.value.rows[1].openingBalance).toBe(104_816);
    expect(result.value.terminalInvestedBalance).toBeCloseTo(109_863.93856, 8);
    expect(result.value.totalGrossInterest).toBeCloseTo(14_337.12, 8);
    expect(result.value.totalTax).toBeCloseTo(4_473.18144, 8);
    expect(result.value.retainedCash).toBe(0);
    expect(result.value.totalAssets).toBe(result.value.terminalInvestedBalance);
  });

  it("retains net interest as cash without compounding it into the next base", () => {
    const result = buildAccrualInvestmentLedger({ intervals: intervals.map((interval) => ({ ...interval, interestDisposition: "retain-cash" })), contributions: [{ id: "initial", date: "2026-01-01", amount: 100_000 }], taxSettlement: "settled-from-interest-at-credit" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.terminalInvestedBalance).toBe(100_000);
    expect(result.value.retainedCash).toBeCloseTo(9_632, 8);
    expect(result.value.totalAssets).toBeCloseTo(109_632, 8);
  });

  it("applies a start-boundary deposit before that interval and a horizon deposit after it", () => {
    const result = buildAccrualInvestmentLedger({ intervals, contributions: [
      { id: "initial", date: "2026-01-01", amount: 100_000 },
      { id: "second-year", date: "2027-01-01", amount: 10_000 },
      { id: "horizon", date: "2028-01-01", amount: 5_000 },
    ], taxSettlement: "settled-from-interest-at-credit" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.rows[1]).toMatchObject({ openingBalance: 104_816, contribution: 10_000 });
    expect(result.value.rows[1].grossInterest).toBeCloseTo(8_037.12, 8);
    expect(result.value.horizonContribution).toBe(5_000);
    expect(result.value.terminalInvestedBalance).toBeCloseTo(125_345.53856, 8);
    expect(result.value.totalContributions).toBe(115_000);
  });

  it("accepts zero rates and zero contributions", () => {
    const result = buildAccrualInvestmentLedger({ intervals: intervals.map((interval) => ({ ...interval, grossInterestRate: 0 })), contributions: [], taxSettlement: "settled-from-interest-at-credit" });
    expect(result).toMatchObject({ kind: "ok", value: { totalContributions: 0, totalGrossInterest: 0, totalTax: 0, terminalInvestedBalance: 0, retainedCash: 0, totalAssets: 0 } });
  });

  it("requires the explicit settlement convention and rejects off-grid or duplicate contributions", () => {
    expect(buildAccrualInvestmentLedger({ intervals, contributions: [], taxSettlement: undefined as never })).toMatchObject({ kind: "unsupported", reason: "missing-tax-settlement" });
    expect(buildAccrualInvestmentLedger({ intervals, contributions: [{ id: "off", date: "2026-06-01", amount: 1 }], taxSettlement: "settled-from-interest-at-credit" })).toMatchObject({ kind: "unsupported", reason: "off-grid-contribution", id: "off" });
    expect(buildAccrualInvestmentLedger({ intervals, contributions: [{ id: "same", date: "2026-01-01", amount: 1 }, { id: "same", date: "2027-01-01", amount: 1 }], taxSettlement: "settled-from-interest-at-credit" })).toMatchObject({ kind: "invalid", reason: "duplicate-contribution-id" });
  });

  it("rejects invalid dates, gaps, negative rates, and out-of-range money", () => {
    expect(buildAccrualInvestmentLedger({ intervals: [{ ...intervals[0], endDate: "2027-02-01" }, intervals[1]], contributions: [], taxSettlement: "settled-from-interest-at-credit" })).toMatchObject({ kind: "invalid", reason: "non-contiguous-interval" });
    expect(buildAccrualInvestmentLedger({ intervals: [{ ...intervals[0], grossInterestRate: -0.01 }], contributions: [], taxSettlement: "settled-from-interest-at-credit" })).toMatchObject({ kind: "invalid", reason: "invalid-interest-rate" });
    expect(buildAccrualInvestmentLedger({ intervals, contributions: [{ id: "nan", date: "2026-01-01", amount: Number.NaN }], taxSettlement: "settled-from-interest-at-credit" })).toMatchObject({ kind: "invalid", reason: "invalid-contribution-amount" });
    expect(buildAccrualInvestmentLedger({ intervals, contributions: [{ id: "huge", date: "2026-01-01", amount: 1_000_000_000_001 }], taxSettlement: "settled-from-interest-at-credit" })).toMatchObject({ kind: "invalid", reason: "invalid-contribution-amount" });
  });

  it("matches independent Fixture K for raw and section-516 annual reinvestment", () => {
    const base = {
      intervals: [
        { startDate: "2026-04-01", endDate: "2026-05-01", grossInterestRate: 0.01, interestDisposition: "reinvest" as const },
        { startDate: "2026-05-01", endDate: "2026-06-01", grossInterestRate: 0.01, interestDisposition: "reinvest" as const },
      ],
      contributions: [{ id: "initial", date: "2026-04-01", amount: 1_000_000 }],
      taxSettlement: "settled-from-interest-at-credit" as const,
    };
    const raw = buildAccrualInvestmentLedger({ ...base, annualTaxContexts: [{ taxProfile: taxProfile([annualContext(1_590_000)]), taxYear: "2026-27", eligibleRouteDeduction: 0, eligibilityReviewed: false }] });
    expect(raw.kind).toBe("ok");
    if (raw.kind === "ok") {
      expect(raw.value.terminalInvestedBalance).toBeCloseTo(1_016_426.8448, 8);
      expect(raw.value.totalTax).toBeCloseTo(3_657.5552, 8);
      expect(raw.value.rows[0].tax).toBeCloseTo(1_560, 8);
      expect(raw.value.rows[1].tax).toBeCloseTo(2_097.5552, 8);
    }
    const retained = buildAccrualInvestmentLedger({ ...base, intervals: base.intervals.map((interval) => ({ ...interval, interestDisposition: "retain-cash" as const })), annualTaxContexts: [{ taxProfile: taxProfile([annualContext(1_590_000)]), taxYear: "2026-27", eligibleRouteDeduction: 0, eligibilityReviewed: false }] });
    expect(retained).toMatchObject({ kind: "ok", value: { terminalInvestedBalance: 1_000_000, retainedCash: 16_360, totalTax: 3_640, totalAssets: 1_016_360 } });
    if (retained.kind === "ok") {
      expect(retained.value.rows[0].tax).toBeCloseTo(1_560, 8);
      expect(retained.value.rows[1].tax).toBeCloseTo(2_080, 8);
    }
    const statutory = buildAccrualInvestmentLedger({ ...base, annualTaxContexts: [{ taxProfile: taxProfile([annualContext(1_590_000, "2026-27", "statutory-section-516")]), taxYear: "2026-27", eligibleRouteDeduction: 0, eligibilityReviewed: false }] });
    expect(statutory).toMatchObject({ kind: "ok", value: { terminalInvestedBalance: 1_016_424.4, totalTax: 3_660 } });
    if (statutory.kind === "ok") expect(statutory.value.rows[1].tax).toBeCloseTo(2_100, 8);
  });

  it("does not add a deduction benefit to invested cash, and keeps a delicate delta valid", () => {
    const result = buildAccrualInvestmentLedger({
      intervals: [{ startDate: "2026-04-01", endDate: "2026-05-01", grossInterestRate: 0.01, interestDisposition: "reinvest" }],
      contributions: [{ id: "initial", date: "2026-04-01", amount: 100_000 }],
      taxSettlement: "settled-from-interest-at-credit",
      annualTaxContexts: [{ taxProfile: taxProfile([annualContext(2_000_000)]), taxYear: "2026-27", eligibleRouteDeduction: 100_000, eligibilityReviewed: true }],
    });
    expect(result).toMatchObject({ kind: "ok", value: { totalContributions: 100_000 } });
    if (result.kind === "ok") {
      expect(result.value.rows[0].contribution).toBe(100_000);
      expect(result.value.rows[0].grossInterest).toBe(1_000);
      expect(result.value.rows[0].tax).toBe(208);
      expect(result.value.rows[0].netInterest).toBe(792);
      expect(result.value.terminalInvestedBalance).toBe(100_792);
      expect(result.value.retainedCash).toBe(0);
      expect(result.value.totalAssets).toBe(100_792);
      expect(result.value.rows[0].annualTaxAudit?.assessment.deductionBenefit).toBe(20_800);
    }

    const delicate = assessAnnualRouteDelta({
      taxYear: "2026-27", taxActVersion: "2025", residenceStatus: "resident", regime: "new", roundingMode: "raw-unrounded-arithmetic", specialRateIncome: 0,
      baselineOrdinaryTaxableIncome: 2_084_202.9713094234, eligibleRouteDeduction: 657_724.7724829179, routeOrdinaryInvestmentIncome: 645_498.2641153038, eligibilityReviewed: true,
    });
    expect(delicate.kind).toBe("ok");
  });

  it("uses cumulative annual tax cost for each credit, with raw audit provenance", () => {
    const result = buildAccrualInvestmentLedger({
      intervals: [
        { startDate: "2026-04-01", endDate: "2026-05-01", grossInterestRate: 0.1, interestDisposition: "reinvest" },
        { startDate: "2026-05-01", endDate: "2026-06-01", grossInterestRate: 0.1, interestDisposition: "reinvest" },
      ],
      contributions: [{ id: "initial", date: "2026-04-01", amount: 100_000 }],
      taxSettlement: "settled-from-interest-at-credit",
      annualTaxContexts: [{ taxProfile: taxProfile([annualContext()]), taxYear: "2026-27", eligibleRouteDeduction: 0, eligibilityReviewed: false }],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error(result.reason);
    expect(result.value.rows[0]).toMatchObject({ grossInterest: 10_000, tax: 2_600, netInterest: 7_400 });
    expect(result.value.rows[1].annualTaxAudit).toMatchObject({ financialYear: "2026-27", cumulativeGrossInterest: 20_740, previousAnnualInvestmentTaxCost: 2_600 });
    if (result.value.rows[1].annualTaxAudit) {
      expect(result.value.rows[1].annualTaxAudit.annualInvestmentTaxCost).toBeCloseTo(5_392.4, 10);
      expect(result.value.rows[1].annualTaxAudit.incrementalTax).toBeCloseTo(2_792.4, 10);
      expect(result.value.rows[1].annualTaxAudit.assessment.baselineAudit.rawOrdinaryTaxableIncome).toBe(2_000_000);
    }
    expect(result.value.totalTax).toBeCloseTo(5_392.4, 10);
    expect(result.value).toMatchObject({ financiallySupported: false, financialReviewRequired: true, methodologyReviewed: false });
  });

  it("supports zero-interest annual mode and retains cash without adding deduction benefits", () => {
    const result = buildAccrualInvestmentLedger({
      intervals: [{ startDate: "2026-04-01", endDate: "2026-05-01", grossInterestRate: 0, interestDisposition: "retain-cash" }],
      contributions: [],
      taxSettlement: "settled-from-interest-at-credit",
      annualTaxContexts: [{ taxProfile: taxProfile([annualContext()]), taxYear: "2026-27", eligibleRouteDeduction: 100_000, eligibilityReviewed: true }],
    });
    expect(result).toMatchObject({ kind: "ok", value: { totalTax: 0, totalAssets: 0, retainedCash: 0 } });
  });

  it("rejects missing or unsupported annual contexts, mixed factors, and tax shortfalls", () => {
    const annualIntervals: readonly AccrualInvestmentInterval[] = [{ startDate: "2026-04-01", endDate: "2026-05-01", grossInterestRate: 0.1, interestDisposition: "retain-cash" }];
    expect(buildAccrualInvestmentLedger({ intervals: annualIntervals, contributions: [], taxSettlement: "settled-from-interest-at-credit", annualTaxContexts: [] })).toMatchObject({ kind: "invalid", reason: "invalid-annual-tax-contexts" });
    expect(buildAccrualInvestmentLedger({ intervals: annualIntervals, contributions: [], taxSettlement: "settled-from-interest-at-credit", annualTaxContexts: [{ taxProfile: taxProfile([annualContext()]), taxYear: "2027-28", eligibleRouteDeduction: 0, eligibilityReviewed: false }] })).toMatchObject({ kind: "unsupported", reason: "annual-tax-context-missing" });
    expect(buildAccrualInvestmentLedger({ intervals: [{ ...annualIntervals[0], effectiveTaxFactor: 0.2 }], contributions: [], taxSettlement: "settled-from-interest-at-credit", annualTaxContexts: [{ taxProfile: taxProfile([annualContext()]), taxYear: "2026-27", eligibleRouteDeduction: 0, eligibilityReviewed: false }] })).toMatchObject({ kind: "invalid", reason: "mixed-tax-mode" });
    const oldContext = { ...annualContext(500_000), ageDuringTaxYear: 59 };
    expect(buildAccrualInvestmentLedger({ intervals: annualIntervals, contributions: [{ id: "tiny", date: "2026-04-01", amount: 1 }], taxSettlement: "settled-from-interest-at-credit", annualTaxContexts: [{ taxProfile: taxProfile([oldContext], "old"), taxYear: "2026-27", eligibleRouteDeduction: 0, eligibilityReviewed: false }] })).toMatchObject({ kind: "unsupported", reason: "insufficient-interest-for-tax" });
  });

  it("keeps financial-year lookup explicit and rejects an unsupported future adapter year", () => {
    const futureProfile = { ...taxProfile([annualContext(2_000_000, "2027-28")]), calculationDate: "2027-04-01" };
    const result = buildAccrualInvestmentLedger({
      intervals: [
        { startDate: "2026-03-01", endDate: "2027-03-01", grossInterestRate: 0.01, interestDisposition: "reinvest" },
        { startDate: "2027-03-01", endDate: "2027-04-01", grossInterestRate: 0.01, interestDisposition: "reinvest" },
      ],
      contributions: [{ id: "initial", date: "2026-03-01", amount: 100_000 }],
      taxSettlement: "settled-from-interest-at-credit",
      annualTaxContexts: [
        { taxProfile: taxProfile([annualContext(2_000_000)]), taxYear: "2026-27", eligibleRouteDeduction: 0, eligibilityReviewed: false },
        { taxProfile: futureProfile, taxYear: "2027-28", eligibleRouteDeduction: 0, eligibilityReviewed: false },
      ],
    });
    expect(result).toMatchObject({ kind: "unsupported", reason: "annual-tax-context-unsupported", cause: "unsupported-tax-year", date: "2027-04-01" });
  });
});
