import { describe, expect, it } from "vitest";
import { buildDatedLoanSchedule } from "../lib/prepay/cashflows";
import { addCalendarMonths } from "../lib/prepay/dates";
import { buildDatedDeductionLedger, type DeductionYearPolicy } from "../lib/prepay/deduction-ledger";
import { buildDisposalTaxLedger } from "../lib/prepay/investment-tax-ledger";
import { buildInvestmentGrowthLedger, monthlyGrowthIntervals } from "../lib/prepay/investment-growth";
import { buildEqualBudgetRouteFunding, type EqualBudgetRouteFundingInput, type EqualBudgetRouteFunding } from "../lib/prepay/route-funding";

const horizonDates = ["2026-01-01", "2026-02-01", "2026-03-01"] as const;

function routeFunding(schedule: EqualBudgetRouteFundingInput["schedule"], overrides: Partial<EqualBudgetRouteFundingInput> = {}): EqualBudgetRouteFundingInput {
  return { anchorDate: "2026-01-01", horizonDates, initialBudget: 62_000, monthlyBudget: 50_000, schedule, initialFee: 2_000, ...overrides };
}

function fixtureISchedule(immediatePrepayment: number, scheduledEmi: number) {
  return buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0, scheduledEmi, termMonths: 2, immediatePrepayment: { amount: immediatePrepayment } });
}

function routeInvestmentTax(route: { readonly value: EqualBudgetRouteFunding }): { growth: ReturnType<typeof buildInvestmentGrowthLedger>; tax: ReturnType<typeof buildDisposalTaxLedger> } {
  const growth = buildInvestmentGrowthLedger({
    intervals: monthlyGrowthIntervals("2026-01-01", 2, 1),
    contributions: route.value.entries.filter((entry) => entry.investmentContribution > 0).map((entry) => ({ lotId: `route-${entry.date}`, date: entry.date, amount: entry.investmentContribution })),
  });
  if (growth.kind !== "ok") return { growth, tax: { kind: "invalid", reason: "growth-failed" } };
  const tax = buildDisposalTaxLedger({
    lots: growth.value.lots.map((lot) => ({ lotId: lot.lotId, costBasis: lot.cost, acquisitionDate: lot.acquisitionDate, disposalDate: lot.disposalDate, grossProceeds: lot.grossProceeds, eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false })),
    exemptionHeadroom: [{ financialYear: 2025, amount: 0 }],
    lossTreatment: "no-current-tax-credit",
  });
  return { growth, tax };
}

describe("prepayment dated ledger integration", () => {
  it("composes loan schedule, equal-budget funding, growth, and disposal tax for Fixture I", () => {
    const keepLoan = buildEqualBudgetRouteFunding(routeFunding(fixtureISchedule(0, 50_000), { initialFee: 0 }));
    const excessKeepLoan = buildEqualBudgetRouteFunding(routeFunding(fixtureISchedule(0, 50_000), { initialBudget: 122_000, initialFee: 0 }));
    const reduceTenure = buildEqualBudgetRouteFunding(routeFunding(fixtureISchedule(60_000, 50_000)));
    const reduceEmi = buildEqualBudgetRouteFunding(routeFunding(fixtureISchedule(60_000, 20_000)));
    const foreclosure = buildEqualBudgetRouteFunding(routeFunding(fixtureISchedule(100_000, 0), { initialBudget: 122_000 }));
    expect([keepLoan, excessKeepLoan, reduceTenure, reduceEmi, foreclosure].every((result) => result.kind === "ok")).toBe(true);
    if (keepLoan.kind !== "ok" || excessKeepLoan.kind !== "ok" || reduceTenure.kind !== "ok" || reduceEmi.kind !== "ok" || foreclosure.kind !== "ok") return;

    const routes = [
      [keepLoan, 62_000, 162_000],
      [excessKeepLoan, 122_000, 222_000],
      [reduceTenure, 60_000, 162_000],
      [reduceEmi, 60_000, 162_000],
      [foreclosure, 120_000, 222_000],
    ] as const;
    for (const [route, expectedInvestment, expectedExternalBudget] of routes) {
      expect(route.value.totals.externalBudget).toBe(expectedExternalBudget);
      expect(route.value.totals.investmentContribution).toBe(expectedInvestment);
      expect(route.value.entries.reduce((sum, entry) => sum + entry.externalBudget, 0)).toBe(expectedExternalBudget);
      for (const entry of route.value.entries) expect(entry.externalBudget).toBeCloseTo(entry.loanCashUse + entry.investmentContribution, 10);
      expect(route.value.remainingDebtAtHorizon).toBe(0);

      const composed = routeInvestmentTax(route);
      expect(composed.growth.kind).toBe("ok");
      expect(composed.tax.kind).toBe("ok");
      if (composed.growth.kind !== "ok" || composed.tax.kind !== "ok") continue;
      expect(composed.growth.value.totalCost).toBe(expectedInvestment);
      expect(composed.growth.value.totalGrossProceeds).toBe(expectedInvestment);
      expect(composed.tax.value.totalNetProceeds).toBe(expectedInvestment);
    }
    expect(reduceTenure.value.entries[1]).toMatchObject({ scheduledPayment: 40_000, investmentContribution: 10_000 });
    expect(reduceTenure.value.entries[2]).toMatchObject({ loanCashUse: 0, investmentContribution: 50_000 });
    expect(excessKeepLoan.value.entries.map((entry) => entry.investmentContribution)).toEqual([122_000, 0, 0]);
  });

  it("preserves Fixture G fee symmetry through dated growth and tax composition", () => {
    const twelveMonthHorizon = Array.from({ length: 13 }, (_, index) => addCalendarMonths("2026-01-01", index));
    const loan = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 120_000, monthlyRate: 0, scheduledEmi: 10_000, termMonths: 12 });
    const withFeeRoute = buildEqualBudgetRouteFunding(routeFunding(loan, { horizonDates: twelveMonthHorizon, initialBudget: 102_000, monthlyBudget: 10_000, initialFee: 0 }));
    const withoutFeeRoute = buildEqualBudgetRouteFunding(routeFunding(loan, { horizonDates: twelveMonthHorizon, initialBudget: 100_000, monthlyBudget: 10_000, initialFee: 0 }));
    expect(withFeeRoute.kind).toBe("ok");
    expect(withoutFeeRoute.kind).toBe("ok");
    if (withFeeRoute.kind !== "ok" || withoutFeeRoute.kind !== "ok") return;
    expect(withFeeRoute.value.totals.externalBudget).toBe(222_000);
    expect(withoutFeeRoute.value.totals.externalBudget).toBe(220_000);
    expect(withFeeRoute.value.remainingDebtAtHorizon).toBe(0);
    expect(withoutFeeRoute.value.remainingDebtAtHorizon).toBe(0);
    const withFee = buildInvestmentGrowthLedger({ intervals: monthlyGrowthIntervals("2026-01-01", 12, 1 + 0.11 / 12), contributions: withFeeRoute.value.entries.filter((entry) => entry.investmentContribution > 0).map((entry) => ({ lotId: `with-fee-${entry.date}`, date: entry.date, amount: entry.investmentContribution })) });
    const withoutFee = buildInvestmentGrowthLedger({ intervals: monthlyGrowthIntervals("2026-01-01", 12, 1 + 0.11 / 12), contributions: withoutFeeRoute.value.entries.filter((entry) => entry.investmentContribution > 0).map((entry) => ({ lotId: `without-fee-${entry.date}`, date: entry.date, amount: entry.investmentContribution })) });
    expect(withFee.kind).toBe("ok");
    expect(withoutFee.kind).toBe("ok");
    if (withFee.kind !== "ok" || withoutFee.kind !== "ok") return;
    expect(withFee.value.totalGrossProceeds).toBeCloseTo(113_803.32, 2);
    expect(withoutFee.value.totalGrossProceeds).toBeCloseTo(111_571.88, 2);
    expect(withFee.value.totalGrossProceeds - withoutFee.value.totalGrossProceeds).toBeCloseTo(2_231.44, 2);

    const taxed = buildDisposalTaxLedger({
      lots: withFee.value.lots.map((lot) => ({ lotId: lot.lotId, costBasis: lot.cost, acquisitionDate: lot.acquisitionDate, disposalDate: lot.disposalDate, grossProceeds: lot.grossProceeds, eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false })),
      exemptionHeadroom: [{ financialYear: 2026, amount: 0 }],
      lossTreatment: "no-current-tax-credit",
    });
    expect(taxed).toMatchObject({ kind: "ok", value: { totalNetProceeds: withFee.value.totalGrossProceeds } });
  });

  it("keeps dated deduction benefits separate and counts a reinvested receipt once", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-04-01", principal: 100_000, monthlyRate: 0.12 / 12, scheduledEmi: 101_000, termMonths: 1 });
    const basePolicy: DeductionYearPolicy = { financialYear: 2026, interestEligible: true, principalEligible: false, interestHeadroom: 5_000, principalHeadroom: 0, effectiveTaxFactor: 0.312, benefitReceiptDate: "2026-06-01", reinvestBenefits: true, immediatePrincipalEligible: false };
    const positive = buildDatedDeductionLedger({ schedule, policies: [basePolicy] });
    const zero = buildDatedDeductionLedger({ schedule, policies: [{ ...basePolicy, interestHeadroom: 0 }] });
    const retained = buildDatedDeductionLedger({ schedule, policies: [{ ...basePolicy, reinvestBenefits: false }] });
    expect(positive.kind).toBe("ok");
    expect(zero.kind).toBe("ok");
    expect(retained.kind).toBe("ok");
    if (positive.kind !== "ok" || zero.kind !== "ok" || retained.kind !== "ok") return;
    expect(positive.value.totalTaxBenefit).toBe(312);
    expect(zero.value.totalTaxBenefit).toBe(0);
    expect(retained.value.totalTaxBenefit).toBe(312);
    expect(positive.value.benefitCashflows).toEqual([{ financialYear: 2026, date: "2026-06-01", amount: 312, reinvested: true }]);
    expect(retained.value.benefitCashflows).toEqual([{ financialYear: 2026, date: "2026-06-01", amount: 312, reinvested: false }]);

    const reinvested = buildInvestmentGrowthLedger({ intervals: monthlyGrowthIntervals("2026-06-01", 1, 1.1), contributions: positive.value.benefitCashflows.filter((flow) => flow.reinvested).map((flow) => ({ lotId: `benefit-${flow.date}`, date: flow.date, amount: flow.amount })) });
    expect(reinvested.kind).toBe("ok");
    if (reinvested.kind !== "ok") return;
    expect(reinvested.value.totalCost).toBe(312);
    expect(reinvested.value.totalGrossProceeds).toBeCloseTo(343.2, 10);
    expect(retained.value.benefitCashflows.filter((flow) => flow.reinvested)).toHaveLength(0);
    expect(zero.value.benefitCashflows[0].amount).toBe(0);
  });
});
