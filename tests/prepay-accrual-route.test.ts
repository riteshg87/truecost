import { describe, expect, it } from "vitest";
import { ANNUAL_ORDINARY_TAX_SOURCE_VERSION } from "../lib/prepay/annual-ordinary-tax";
import { buildDatedLoanSchedule } from "../lib/prepay/cashflows";
import { buildAccrualRouteValuation, type AccrualRouteInput } from "../lib/prepay/accrual-route";
import type { NormalizedTaxProfile } from "../lib/prepay/model-contract";

const zeroFact = () => ({ kind: "known" as const, amount: 0 });

function profile(): NormalizedTaxProfile {
  return {
    calculationDate: "2026-09-17",
    taxYears: [{ taxYear: "2026-27", assessmentYear: null, startDate: "2026-04-01", endDate: "2027-03-31", taxActVersion: "2025" }],
    regime: "new",
    annualContexts: [{ taxYear: "2026-27", backgroundOrdinaryTaxableIncome: 2_000_000, specialRateIncome: [], ageDuringTaxYear: null, agriculturalIncome: zeroFact(), losses: { currentYear: zeroFact(), carryForward: zeroFact() }, roundingConvention: "raw-unrounded-arithmetic", sourceVersion: ANNUAL_ORDINARY_TAX_SOURCE_VERSION }],
    taxpayerScope: { residenceStatus: "resident", profileFlags: [] },
    taxBenefitReceiptRule: { kind: "rule", ruleId: "after-filing", reinvest: false },
  };
}

function baseInput(overrides: Partial<AccrualRouteInput> = {}): AccrualRouteInput {
  const schedule = buildDatedLoanSchedule({ anchorDate: "2026-04-01", principal: 100_000, monthlyRate: 0.01, scheduledEmi: 101_000, termMonths: 1 });
  return {
    fundingInput: { anchorDate: "2026-04-01", horizonDates: ["2026-04-01", "2026-05-01", "2026-06-01"], initialBudget: 10_000, monthlyBudget: 101_000, schedule, initialFee: 0 },
    deductionPolicies: [{ financialYear: 2026, interestEligible: true, principalEligible: false, interestHeadroom: 1_000, principalHeadroom: 0, annualTaxContext: { taxProfile: profile(), taxYear: "2026-27", eligibilityReviewed: true }, benefitReceiptDate: "2026-05-01", reinvestBenefits: true, immediatePrincipalEligible: false }],
    intervals: [{ startDate: "2026-04-01", endDate: "2026-05-01", grossInterestRate: 0.01, interestDisposition: "reinvest" }, { startDate: "2026-05-01", endDate: "2026-06-01", grossInterestRate: 0.01, interestDisposition: "reinvest" }],
    taxSettlement: "settled-from-interest-at-credit",
    ...overrides,
  };
}

function route(overrides: Partial<AccrualRouteInput> = {}) {
  return buildAccrualRouteValuation(baseInput(overrides));
}

describe("dated accrual route valuation", () => {
  it("uses the shared generated loan schedule and places a ₹208 annual benefit once", () => {
    const result = route();
    expect(result).toMatchObject({ kind: "ok", value: {
      funding: { totals: { externalBudget: 212_000, investmentContribution: 111_000 } },
      deductions: { years: [{ actualInterest: 1_000, interestUsed: 1_000, taxBenefit: 208, effectiveTaxFactor: null }] },
      benefits: { receivedByHorizon: [{ amount: 208, reinvested: true }], reinvestedByHorizon: [{ amount: 208 }], retainedByHorizon: [], futureReceipts: [] },
      totalRetainedCash: 0,
      remainingDebt: 0,
      financiallySupported: false,
      financialReviewRequired: true,
      methodologyReviewed: false,
    } });
    if (result.kind === "ok") {
      expect(result.value.terminalInvestedBalance).toBeCloseTo(111_368.674624, 8);
      expect(result.value.terminalNetPosition).toBeCloseTo(111_368.674624, 8);
    }
  });

  it("retains benefits as cash and keeps future receipts outside assets", () => {
    const retained = route({ deductionPolicies: [{ ...baseInput().deductionPolicies[0], reinvestBenefits: false }] });
    const future = route({ deductionPolicies: [{ ...baseInput().deductionPolicies[0], benefitReceiptDate: "2026-07-01" }] });
    expect(retained).toMatchObject({ kind: "ok", value: { benefits: { reinvestedByHorizon: [], retainedByHorizon: [{ amount: 208 }], futureReceipts: [] }, totalRetainedCash: 208 } });
    expect(future).toMatchObject({ kind: "ok", value: { benefits: { receivedByHorizon: [], reinvestedByHorizon: [], retainedByHorizon: [], futureReceipts: [{ amount: 208 }] }, totalRetainedCash: 0 } });
    if (retained.kind === "ok") {
      expect(retained.value.terminalInvestedBalance).toBeCloseTo(111_159.027264, 8);
      expect(retained.value.terminalNetPosition).toBeCloseTo(111_367.027264, 8);
    }
    if (future.kind === "ok") {
      expect(future.value.terminalInvestedBalance).toBeCloseTo(111_159.027264, 8);
      expect(future.value.terminalNetPosition).toBeCloseTo(111_159.027264, 8);
    }
  });

  it("preserves residual debt and same-budget post-payoff contributions", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-04-01", principal: 200_000, monthlyRate: 0, scheduledEmi: 50_000, termMonths: 2 });
    const residualProfile = { ...profile(), annualContexts: [{ ...profile().annualContexts[0], backgroundOrdinaryTaxableIncome: 1_999_000 }] };
    const result = route({ fundingInput: { anchorDate: "2026-04-01", horizonDates: ["2026-04-01", "2026-05-01", "2026-06-01"], initialBudget: 10_000, monthlyBudget: 50_000, schedule, initialFee: 0 }, deductionPolicies: [{ ...baseInput().deductionPolicies[0], annualTaxContext: { ...baseInput().deductionPolicies[0].annualTaxContext!, taxProfile: residualProfile } }] });
    expect(result).toMatchObject({ kind: "ok", value: { funding: { totals: { externalBudget: 110_000 } }, remainingDebt: 100_000 } });
    if (result.kind === "ok") expect(result.value.terminalNetPosition).toBeCloseTo(-89_840.972736, 8);
  });

  it("rejects fixed factors, malformed ranges, off-grid intervals, and missing annual contexts", () => {
    expect(route({ intervals: [{ ...baseInput().intervals[0], effectiveTaxFactor: 0.2 }, baseInput().intervals[1]] })).toMatchObject({ kind: "invalid", reason: "mixed-tax-mode" });
    expect(route({ intervals: [{ ...baseInput().intervals[0], startDate: "2026-03-31" }, baseInput().intervals[1]] })).toMatchObject({ kind: "invalid", reason: "interval-anchor-mismatch" });
    expect(route({ intervals: [{ ...baseInput().intervals[0], endDate: "2026-05-02" }, baseInput().intervals[1]] })).toMatchObject({ kind: "invalid", reason: "non-contiguous-interval" });
    expect(route({ deductionPolicies: [{ ...baseInput().deductionPolicies[0], annualTaxContext: undefined }] })).toMatchObject({ kind: "unsupported", reason: "annual-tax-context-missing" });
    expect(route({ deductionPolicies: [{ ...baseInput().deductionPolicies[0], benefitReceiptDate: "2026-05-15" }] })).toMatchObject({ kind: "unsupported", reason: "off-grid-contribution" });
    const unknownProfile = { ...profile(), annualContexts: [{ ...profile().annualContexts[0], specialRateIncome: [{ kind: "unknown" as const, category: "equity", reason: "not supplied" }] }] };
    expect(route({ deductionPolicies: [{ ...baseInput().deductionPolicies[0], annualTaxContext: { taxProfile: unknownProfile, taxYear: "2026-27", eligibilityReviewed: true } }] })).toMatchObject({ kind: "unsupported", reason: "unsupported-special-rate-income" });
  });

  it("does not create a second tax or benefit when the receipt is reinvested", () => {
    const result = route();
    expect(result).toMatchObject({ kind: "ok", value: { deductions: { totalTaxBenefit: 208 }, interestLedger: { retainedCash: 0 }, benefits: { receivedByHorizon: [{ amount: 208 }], reinvestedByHorizon: [{ amount: 208 }] } } });
    if (result.kind === "ok") expect(result.value.interestLedger.totalTax).toBeCloseTo(42.197376, 8);
    if (result.kind === "ok") expect(result.value.interestLedger.totalAssets).toBeCloseTo(result.value.terminalInvestedBalance, 10);
  });

  it("counts the horizon contribution without giving it interval growth and conserves each funding entry", () => {
    const result = route();
    expect(result).toMatchObject({ kind: "ok", value: { interestLedger: { horizonContribution: 101_000 }, funding: { entries: [{ investmentContribution: 10_000 }, { investmentContribution: 0 }, { investmentContribution: 101_000 }] } } });
    if (result.kind !== "ok") return;
    for (const entry of result.value.funding.entries) expect(entry.externalBudget).toBeCloseTo(entry.loanCashUse + entry.investmentContribution, 10);
    const rows = result.value.interestLedger.rows;
    expect(result.value.terminalInvestedBalance).toBeCloseTo(rows[rows.length - 1].closingBalance + result.value.interestLedger.horizonContribution, 10);
  });

  it("rejects assets above the supported money bound before debt subtraction", () => {
    const input = baseInput();
    const result = buildAccrualRouteValuation({
      ...input,
      fundingInput: { ...input.fundingInput, initialBudget: 1_000_000_000_000 - 101_000 },
      intervals: input.intervals.map((interval) => ({ ...interval, grossInterestRate: 0 })),
      deductionPolicies: [{ ...input.deductionPolicies[0], reinvestBenefits: false }],
    });
    expect(result).toMatchObject({ kind: "invalid", reason: "arithmetic-overflow" });
  });
});
