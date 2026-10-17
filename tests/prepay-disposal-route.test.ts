import { describe, expect, it } from "vitest";
import { addCalendarMonths } from "../lib/prepay/dates";
import { buildDatedDeductionLedger, type DeductionLedger, type DeductionYearPolicy } from "../lib/prepay/deduction-ledger";
import { buildDatedLoanSchedule } from "../lib/prepay/cashflows";
import { ANNUAL_ORDINARY_TAX_SOURCE_VERSION } from "../lib/prepay/annual-ordinary-tax";
import type { NormalizedTaxProfile } from "../lib/prepay/model-contract";
import { buildEqualBudgetRouteFunding } from "../lib/prepay/route-funding";
import { buildDisposalRouteValuation, type DisposalRouteInput } from "../lib/prepay/disposal-route";
import { monthlyGrowthIntervals } from "../lib/prepay/investment-growth";

const emptyDeductions: DeductionLedger = { years: [], benefitCashflows: [], totalTaxBenefit: 0 };

function fundingFor(schedule: ReturnType<typeof buildDatedLoanSchedule>, initialBudget: number, monthlyBudget: number, horizonMonths: number, initialFee = 0) {
  const horizonDates = Array.from({ length: horizonMonths + 1 }, (_, index) => addCalendarMonths("2026-01-01", index));
  const result = buildEqualBudgetRouteFunding({ anchorDate: "2026-01-01", horizonDates, initialBudget, monthlyBudget, schedule, initialFee });
  if (result.kind !== "ok") throw new Error(result.reason);
  return result.value;
}

function composerInput(funding: ReturnType<typeof fundingFor>, deductions: DeductionLedger = emptyDeductions, overrides: Partial<DisposalRouteInput> = {}): DisposalRouteInput {
  return {
    funding,
    deductionLedger: deductions,
    growthIntervals: monthlyGrowthIntervals(funding.entries[0].date, funding.entries.length - 1, 1),
    disposalPolicies: [],
    exemptionHeadroom: [],
    lossTreatment: "no-current-tax-credit",
    ...overrides,
  };
}

function receiptDeductions(reinvested: boolean, receiptDate: string): DeductionLedger {
  const schedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0.12 / 12, scheduledEmi: 101_000, termMonths: 1 });
  const policy: DeductionYearPolicy = { financialYear: 2025, interestEligible: true, principalEligible: false, interestHeadroom: 5_000, principalHeadroom: 0, effectiveTaxFactor: 0.312, benefitReceiptDate: receiptDate, reinvestBenefits: reinvested, immediatePrincipalEligible: false };
  const result = buildDatedDeductionLedger({ schedule, policies: [policy] });
  if (result.kind !== "ok") throw new Error(result.reason);
  return result.value;
}

function annualTaxProfile(options: { readonly backgroundOrdinaryTaxableIncome?: number } = {}): NormalizedTaxProfile {
  const zero = () => ({ kind: "known" as const, amount: 0 });
  return {
    calculationDate: "2026-09-17",
    taxYears: [{ taxYear: "2026-27", assessmentYear: null, startDate: "2026-04-01", endDate: "2027-03-31", taxActVersion: "2025" }],
    regime: "new",
    annualContexts: [{ taxYear: "2026-27", backgroundOrdinaryTaxableIncome: options.backgroundOrdinaryTaxableIncome ?? 1_250_000, specialRateIncome: [], ageDuringTaxYear: null, agriculturalIncome: zero(), losses: { currentYear: zero(), carryForward: zero() }, roundingConvention: "raw-unrounded-arithmetic", sourceVersion: ANNUAL_ORDINARY_TAX_SOURCE_VERSION }],
    taxpayerScope: { residenceStatus: "resident", profileFlags: [] },
    taxBenefitReceiptRule: { kind: "rule", ruleId: "after-filing", reinvest: false },
  };
}

function annualDeductions(reinvestBenefits = true, benefitReceiptDate = "2026-05-01", backgroundOrdinaryTaxableIncome = 1_250_000, interest = 1000): DeductionLedger {
  const schedule = buildDatedLoanSchedule({ anchorDate: "2026-04-01", principal: 100_000, monthlyRate: interest / 100_000, scheduledEmi: 100_000, termMonths: 1 });
  const policy: DeductionYearPolicy = { financialYear: 2026, interestEligible: true, principalEligible: false, interestHeadroom: 100_000, principalHeadroom: 0, effectiveTaxFactor: undefined, annualTaxContext: { taxProfile: annualTaxProfile({ backgroundOrdinaryTaxableIncome }), taxYear: "2026-27", eligibilityReviewed: true }, benefitReceiptDate, reinvestBenefits, immediatePrincipalEligible: false };
  const result = buildDatedDeductionLedger({ schedule, policies: [policy] });
  if (result.kind !== "ok") throw new Error(result.reason);
  return result.value;
}

describe("dated disposal route valuation", () => {
  it("accepts a zero-portfolio route without synthesizing a fake lot", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0, scheduledEmi: 50_000, termMonths: 2 });
    const funding = fundingFor(schedule, 0, 50_000, 2);
    const result = buildDisposalRouteValuation(composerInput(funding));
    expect(result).toMatchObject({ kind: "ok", value: { growth: null, tax: null, terminalPortfolioNet: 0, retainedCash: 0, remainingDebt: 0, terminalNetPosition: 0 } });
    if (result.kind !== "ok") return;
    expect(result.value.support).toMatchObject({ kind: "arithmetic-only", financiallySupported: false, methodologyReviewed: false });
    expect(Object.isFrozen(result.value.support)).toBe(true);
  });

  it("reinvests a benefit at its supplied grid boundary, or retains it once as cash", () => {
    const loan = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0.12 / 12, scheduledEmi: 101_000, termMonths: 1 });
    const funding = fundingFor(loan, 1_000, 101_000, 2);
    const reinvested = buildDisposalRouteValuation(composerInput(funding, receiptDeductions(true, "2026-02-01"), {
      growthIntervals: monthlyGrowthIntervals("2026-01-01", 2, 1.1),
      disposalPolicies: [
        { lotId: "funding:2026-01-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0.2, exemptionEligible: false },
        { lotId: "benefit:2025", eligibleExpenseAmount: 0, effectiveTaxFactor: 0.2, exemptionEligible: false },
        { lotId: "funding:2026-03-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0.2, exemptionEligible: false },
      ],
      exemptionHeadroom: [{ financialYear: 2025, amount: 0 }],
    }));
    const retained = buildDisposalRouteValuation(composerInput(funding, receiptDeductions(false, "2026-02-01"), {
      growthIntervals: monthlyGrowthIntervals("2026-01-01", 2, 1.1),
      disposalPolicies: [
        { lotId: "funding:2026-01-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0.2, exemptionEligible: false },
        { lotId: "funding:2026-03-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0.2, exemptionEligible: false },
      ],
      exemptionHeadroom: [{ financialYear: 2025, amount: 0 }],
    }));
    expect(reinvested).toMatchObject({ kind: "ok", value: { terminalPortfolioNet: 102_504.96, retainedCash: 0, terminalNetPosition: 102_504.96 } });
    expect(retained).toMatchObject({ kind: "ok", value: { terminalPortfolioNet: 102_168, retainedCash: 312, terminalNetPosition: 102_480 } });
    if (reinvested.kind !== "ok") return;
    expect(reinvested.value.benefits.reinvestedByHorizon).toHaveLength(1);
    expect(reinvested.value.tax?.lots).toHaveLength(3);
  });

  it("keeps receipts after the horizon separate from terminal cash", () => {
    const loan = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0.12 / 12, scheduledEmi: 101_000, termMonths: 1 });
    const funding = fundingFor(loan, 0, 101_000, 1);
    const result = buildDisposalRouteValuation(composerInput(funding, receiptDeductions(true, "2026-03-01"), { growthIntervals: monthlyGrowthIntervals("2026-01-01", 1, 1.1) }));
    expect(result).toMatchObject({ kind: "ok", value: { terminalPortfolioNet: 0, retainedCash: 0, terminalNetPosition: 0, futureReceipts: [{ financialYear: 2025, date: "2026-03-01", amount: 312, reinvested: true }] } });
  });

  it("requires policies for every generated positive funding or benefit lot", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0, scheduledEmi: 50_000, termMonths: 2 });
    const funding = fundingFor(schedule, 62_000, 50_000, 2);
    const missing = buildDisposalRouteValuation(composerInput(funding));
    expect(missing).toMatchObject({ kind: "invalid", reason: "missing-disposal-policy", lotId: "funding:2026-01-01" });
    const unmatched = buildDisposalRouteValuation(composerInput(funding, emptyDeductions, { disposalPolicies: [{ lotId: "funding:2026-01-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false }, { lotId: "unused", eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false }] }));
    expect(unmatched).toMatchObject({ kind: "invalid", reason: "unmatched-disposal-policy", lotId: "unused" });
  });

  it("computes a positive disposal tax exactly once, 100 growing to 110 at 20%", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 0, monthlyRate: 0, scheduledEmi: 0, termMonths: 1 });
    const funding = fundingFor(schedule, 100, 0, 1);
    const result = buildDisposalRouteValuation(composerInput(funding, emptyDeductions, {
      growthIntervals: monthlyGrowthIntervals("2026-01-01", 1, 1.1),
      disposalPolicies: [{ lotId: "funding:2026-01-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0.2, exemptionEligible: false }],
      exemptionHeadroom: [{ financialYear: 2025, amount: 0 }],
    }));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.terminalPortfolioNet).toBeCloseTo(108, 10);
    expect(result.value.terminalNetPosition).toBeCloseTo(108, 10);
    expect(result.value.tax?.totalTax).toBeCloseTo(2, 10);
    expect(result.value.tax?.lots[0].grossProceeds).toBeCloseTo(110, 10);
  });

  it("subtracts remaining debt and preserves Fixture I route funding", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0, scheduledEmi: 20_000, termMonths: 2 });
    const debtFunding = fundingFor(schedule, 0, 20_000, 2);
    const debt = buildDisposalRouteValuation(composerInput(debtFunding));
    expect(debt).toMatchObject({ kind: "ok", value: { terminalPortfolioNet: 0, retainedCash: 0, remainingDebt: 60_000, terminalNetPosition: -60_000 } });

    const routeSchedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0, scheduledEmi: 50_000, termMonths: 2, immediatePrepayment: { amount: 60_000 } });
    const routeFunding = fundingFor(routeSchedule, 62_000, 50_000, 2, 2_000);
    const route = buildDisposalRouteValuation(composerInput(routeFunding, emptyDeductions, {
      disposalPolicies: [
        { lotId: "funding:2026-02-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false },
        { lotId: "funding:2026-03-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false },
      ],
      exemptionHeadroom: [{ financialYear: 2025, amount: 0 }],
    }));
    expect(route).toMatchObject({ kind: "ok", value: { terminalPortfolioNet: 60_000, retainedCash: 0, remainingDebt: 0, terminalNetPosition: 60_000, funding: { totals: { externalBudget: 162_000 } } } });
  });

  it("rejects a benefit receipt before the funding anchor", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0, scheduledEmi: 50_000, termMonths: 2 });
    const funding = fundingFor(schedule, 0, 50_000, 2);
    const validDeductions = receiptDeductions(false, "2026-02-01");
    const beforeAnchorDeductions = { ...validDeductions, years: validDeductions.years.map((year) => ({ ...year, benefitReceiptDate: "2025-12-31" })), benefitCashflows: validDeductions.benefitCashflows.map((benefit) => ({ ...benefit, date: "2025-12-31" })) };
    const result = buildDisposalRouteValuation(composerInput(funding, beforeAnchorDeductions));
    expect(result).toMatchObject({ kind: "invalid", reason: "benefit-before-funding-anchor", financialYear: 2025 });
  });

  it("accepts annual-assessment provenance and places its dated receipt once", () => {
    const zeroLoan = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 0, monthlyRate: 0, scheduledEmi: 0, termMonths: 4 });
    const funding = fundingFor(zeroLoan, 100, 0, 4);
    const route = (deductions: DeductionLedger) => buildDisposalRouteValuation(composerInput(funding, deductions, {
      growthIntervals: monthlyGrowthIntervals("2026-01-01", 4, 1),
      disposalPolicies: [
        { lotId: "funding:2026-01-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false },
        ...(deductions.benefitCashflows[0].date <= "2026-05-01" && deductions.benefitCashflows[0].reinvested ? [{ lotId: "benefit:2026", eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false }] : []),
      ],
      exemptionHeadroom: [{ financialYear: 2026, amount: 0 }],
    }));
    const reinvested = route(annualDeductions(true, "2026-05-01"));
    const retained = route(annualDeductions(false, "2026-05-01"));
    const future = route(annualDeductions(true, "2026-06-01"));
    expect(reinvested).toMatchObject({ kind: "ok", value: { benefits: { receivedByHorizon: [{ financialYear: 2026, reinvested: true }], reinvestedByHorizon: [{ financialYear: 2026 }], retainedByHorizon: [], futureReceipts: [] } } });
    expect(retained).toMatchObject({ kind: "ok", value: { benefits: { receivedByHorizon: [{ financialYear: 2026, reinvested: false }], reinvestedByHorizon: [], retainedByHorizon: [{ financialYear: 2026 }], futureReceipts: [] } } });
    expect(future).toMatchObject({ kind: "ok", value: { benefits: { receivedByHorizon: [], reinvestedByHorizon: [], retainedByHorizon: [], futureReceipts: [{ financialYear: 2026, reinvested: true }] } } });
    expect(route(annualDeductions(false, "2026-05-01", 2_084_202.9713094234, 0.01))).toMatchObject({ kind: "ok" });
  });

  it("rejects annual provenance whose audit or deduction amount is altered", () => {
    const deductions = annualDeductions();
    const year = deductions.years[0];
    const altered = {
      ...deductions,
      years: [{ ...year, taxBenefit: year.taxBenefit + 1, annualAssessment: year.annualAssessment && { ...year.annualAssessment, assessment: { ...year.annualAssessment.assessment, deductionBenefit: year.annualAssessment.assessment.deductionBenefit + 1 } } }],
      benefitCashflows: deductions.benefitCashflows.map((receipt) => ({ ...receipt, amount: receipt.amount + 1 })),
      totalTaxBenefit: deductions.totalTaxBenefit + 1,
    };
    const zeroLoan = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 0, monthlyRate: 0, scheduledEmi: 0, termMonths: 4 });
    expect(buildDisposalRouteValuation(composerInput(fundingFor(zeroLoan, 100, 0, 4), altered, { growthIntervals: monthlyGrowthIntervals("2026-01-01", 4, 1), disposalPolicies: [{ lotId: "funding:2026-01-01", eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false }, { lotId: "benefit:2026", eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false }], exemptionHeadroom: [{ financialYear: 2026, amount: 0 }] }))).toMatchObject({ kind: "invalid", reason: "invalid-deduction-year" });
  });

  it("rejects empty-portfolio funding, grid, headroom, loss, and duplicate-receipt inconsistencies", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0, scheduledEmi: 50_000, termMonths: 2 });
    const funding = fundingFor(schedule, 0, 50_000, 2);
    const badFunding = { ...funding, entries: funding.entries.map((entry, index) => index === 0 ? { ...entry, externalBudget: entry.externalBudget + 1 } : entry) };
    expect(buildDisposalRouteValuation(composerInput(badFunding))).toMatchObject({ kind: "invalid", reason: "funding-cash-mismatch" });
    expect(buildDisposalRouteValuation(composerInput(funding, emptyDeductions, { growthIntervals: [{ startDate: "2026-01-01", endDate: "2026-02-01", growthFactor: Number.NaN }, { startDate: "2026-02-02", endDate: "2026-03-01", growthFactor: 1 }] }))).toMatchObject({ kind: "invalid", reason: "invalid-growth-factor" });
    expect(buildDisposalRouteValuation(composerInput(funding, emptyDeductions, { growthIntervals: [null, { startDate: "2026-02-01", endDate: "2026-03-01", growthFactor: 1 }] as never }))).toMatchObject({ kind: "invalid", reason: "invalid-growth-interval" });
    expect(buildDisposalRouteValuation(composerInput(funding, emptyDeductions, { growthIntervals: [{ startDate: "2026-01-01", endDate: "2026-02-01", growthFactor: 1 }, null] as never }))).toMatchObject({ kind: "invalid", reason: "invalid-growth-interval" });
    expect(buildDisposalRouteValuation(composerInput(funding, emptyDeductions, { exemptionHeadroom: [{ financialYear: 2025, amount: 0 }] }))).toMatchObject({ kind: "invalid", reason: "unmatched-exemption-headroom" });
    expect(buildDisposalRouteValuation(composerInput(funding, emptyDeductions, { lossTreatment: "other" as never }))).toMatchObject({ kind: "invalid", reason: "invalid-loss-treatment" });

    const valid = receiptDeductions(false, "2026-02-01");
    const duplicateReceipt = { ...valid, years: [...valid.years, { ...valid.years[0], financialYear: 2026 }], benefitCashflows: [...valid.benefitCashflows, { ...valid.benefitCashflows[0], amount: 312 }], totalTaxBenefit: 624 };
    expect(buildDisposalRouteValuation(composerInput(funding, duplicateReceipt))).toMatchObject({ kind: "invalid", reason: "duplicate-benefit-year" });
  });
});
