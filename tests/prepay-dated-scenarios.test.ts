import { describe, expect, it } from "vitest";
import { emiFor } from "../lib/finance/core";
import { buildDatedPrepayScenarios } from "../lib/prepay/dated-scenarios";

const fixtureI = {
  anchorDate: "2026-01-01",
  outstanding: 100_000,
  monthlyRate: 0,
  remainingMonths: 2,
  currentEmi: 50_000,
  surplus: 60_000,
  prepaymentFeeAmount: 2_000,
} as const;

describe("dated prepayment scenarios", () => {
  it("composes Fixture I routes from actual dated schedules and equal budgets", () => {
    const result = buildDatedPrepayScenarios(fixtureI);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.horizonDates).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(result.value.initialBudget).toBe(62_000);
    expect(result.value.monthlyBudget).toBe(50_000);
    expect(result.value.emiSource).toBe("provided");
    expect(result.value.emiMismatch).toBeCloseTo(0, 12);
    expect(result.value.routes.keepLoanInvest.funding.entries.map((entry) => entry.investmentContribution)).toEqual([62_000, 0, 0]);
    expect(result.value.routes.reduceTenure.funding.entries.map((entry) => entry.investmentContribution)).toEqual([0, 10_000, 50_000]);
    expect(result.value.routes.reduceEmi.funding.entries.map((entry) => entry.investmentContribution)).toEqual([0, 30_000, 30_000]);
    for (const route of Object.values(result.value.routes)) {
      expect(route.funding.remainingDebtAtHorizon).toBe(0);
      expect(route.funding.totals.externalBudget).toBe(162_000);
    }
  });

  it("derives an amortising EMI when current EMI is omitted and retains month-end anniversaries", () => {
    const result = buildDatedPrepayScenarios({
      anchorDate: "2026-01-31",
      outstanding: 1_000_000,
      monthlyRate: 0.01,
      remainingMonths: 3,
      currentEmi: null,
      surplus: 100_000,
      prepaymentFeeAmount: 1_000,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.emiSource).toBe("derived");
    expect(result.value.emiMismatch).toBeNull();
    expect(result.value.derivedEmi).toBeCloseTo(340022.1114814815, 7);
    expect(result.value.horizonDates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(result.value.routes.reduceTenure.funding.remainingDebtAtHorizon).toBe(0);
    expect(result.value.routes.reduceEmi.funding.remainingDebtAtHorizon).toBe(0);
  });

  it("preserves a provided EMI and surfaces a non-cleared schedule without extending it", () => {
    const result = buildDatedPrepayScenarios({ ...fixtureI, currentEmi: 45_000, surplus: 10_000, prepaymentFeeAmount: 0 });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.derivedEmi).toBe(50_000);
    expect(result.value.baselineEmi).toBe(45_000);
    expect(result.value.emiMismatch).toBe(-5_000);
    expect(result.value.routes.keepLoanInvest.funding.remainingDebtAtHorizon).toBe(10_000);
    expect(result.value.routes.reduceTenure.schedule.rows).toHaveLength(3);
    expect(result.value.routes.reduceTenure.funding.remainingDebtAtHorizon).toBe(0);
  });

  it("rejects a reduced-EMI route that would exceed the actual monthly budget", () => {
    const result = buildDatedPrepayScenarios({ ...fixtureI, currentEmi: 15_000, surplus: 10_000, prepaymentFeeAmount: 0 });
    expect(result).toMatchObject({ kind: "invalid", route: "reduce-emi", reason: "insufficient-budget", period: 1 });
  });

  it("keeps the explicit fee and excess surplus in route funding", () => {
    const result = buildDatedPrepayScenarios({ ...fixtureI, currentEmi: 50_000, surplus: 120_000 });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const foreclosure = result.value.routes.reduceTenure;
    expect(result.value.appliedPrepayment).toBe(100_000);
    expect(result.value.excessSurplus).toBe(20_000);
    expect(foreclosure.funding.entries.map((entry) => entry.investmentContribution)).toEqual([20_000, 50_000, 50_000]);
    expect(foreclosure.funding.totals.externalBudget).toBe(222_000);
    expect(foreclosure.funding.totals.fees).toBe(2_000);
  });

  it("rejects invalid finite/bounded inputs without partial routes", () => {
    expect(buildDatedPrepayScenarios({ ...fixtureI, outstanding: Number.POSITIVE_INFINITY })).toMatchObject({ kind: "invalid", reason: "invalid-money" });
    expect(buildDatedPrepayScenarios({ ...fixtureI, monthlyRate: Number.NaN })).toMatchObject({ kind: "invalid", reason: "invalid-monthly-rate" });
    expect(buildDatedPrepayScenarios({ ...fixtureI, currentEmi: null, remainingMonths: 0 })).toMatchObject({ kind: "invalid", reason: "invalid-remaining-months" });
    expect(emiFor(fixtureI.outstanding, fixtureI.monthlyRate, fixtureI.remainingMonths)).toBe(50_000);
  });
});
