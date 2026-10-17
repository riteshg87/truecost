import { describe, expect, it } from "vitest";
import { buildDatedLoanSchedule } from "../lib/prepay/cashflows";
import { buildEqualBudgetRouteFunding, type EqualBudgetRouteFundingInput } from "../lib/prepay/route-funding";

const horizonDates = ["2026-01-01", "2026-02-01", "2026-03-01"] as const;

function funding(schedule: EqualBudgetRouteFundingInput["schedule"], overrides: Partial<EqualBudgetRouteFundingInput> = {}): EqualBudgetRouteFundingInput {
  return {
    anchorDate: "2026-01-01",
    horizonDates,
    initialBudget: 62_000,
    monthlyBudget: 50_000,
    schedule,
    initialFee: 2_000,
    ...overrides,
  };
}

function schedule(immediatePrepayment: number, scheduledEmi: number) {
  return buildDatedLoanSchedule({
    anchorDate: "2026-01-01",
    principal: 100_000,
    monthlyRate: 0,
    scheduledEmi,
    termMonths: 2,
    immediatePrepayment: { amount: immediatePrepayment },
  });
}

describe("equal-budget route funding", () => {
  it("conserves Fixture I funding at every route date", () => {
    const keepLoan = buildEqualBudgetRouteFunding(funding(schedule(0, 50_000), { initialFee: 0 }));
    const reduceTenure = buildEqualBudgetRouteFunding(funding(schedule(60_000, 50_000)));
    const reduceEmi = buildEqualBudgetRouteFunding(funding(schedule(60_000, 20_000)));
    const foreclosure = buildEqualBudgetRouteFunding(funding(schedule(100_000, 0), { initialBudget: 122_000 }));
    expect(keepLoan.kind).toBe("ok");
    expect(reduceTenure.kind).toBe("ok");
    expect(reduceEmi.kind).toBe("ok");
    expect(foreclosure.kind).toBe("ok");
    if (keepLoan.kind !== "ok" || reduceTenure.kind !== "ok" || reduceEmi.kind !== "ok" || foreclosure.kind !== "ok") return;

    expect(keepLoan.value.entries.map((entry) => entry.investmentContribution)).toEqual([62_000, 0, 0]);
    expect(reduceTenure.value.entries.map((entry) => entry.investmentContribution)).toEqual([0, 10_000, 50_000]);
    expect(reduceEmi.value.entries.map((entry) => entry.investmentContribution)).toEqual([0, 30_000, 30_000]);
    expect(foreclosure.value.entries.map((entry) => entry.investmentContribution)).toEqual([20_000, 50_000, 50_000]);
    for (const [result, externalBudget] of [[keepLoan, 162_000], [reduceTenure, 162_000], [reduceEmi, 162_000], [foreclosure, 222_000]] as const) {
      expect(result.value.totals.externalBudget).toBe(externalBudget);
      expect(result.value.entries.reduce((sum, entry) => sum + entry.externalBudget, 0)).toBe(externalBudget);
      for (const entry of result.value.entries) {
        expect(entry.externalBudget).toBeCloseTo(entry.loanCashUse + entry.investmentContribution, 10);
      }
      expect(result.value.remainingDebtAtHorizon).toBe(0);
    }
    expect(keepLoan.value.totals.investmentContribution).toBe(62_000);
    expect(reduceTenure.value.totals.investmentContribution).toBe(60_000);
    expect(reduceEmi.value.totals.investmentContribution).toBe(60_000);
    expect(foreclosure.value.totals.investmentContribution).toBe(120_000);
  });

  it("continues monthly contributions after early payoff and reports debt if horizon ends first", () => {
    const earlyPayoff = buildEqualBudgetRouteFunding(funding(schedule(60_000, 50_000)));
    expect(earlyPayoff.kind).toBe("ok");
    if (earlyPayoff.kind !== "ok") return;
    expect(earlyPayoff.value.entries[2]).toMatchObject({ date: "2026-03-01", loanCashUse: 0, investmentContribution: 50_000, remainingDebt: 0 });

    const debtAtHorizon = buildEqualBudgetRouteFunding(funding(schedule(50_000, 20_000)));
    expect(debtAtHorizon.kind).toBe("ok");
    if (debtAtHorizon.kind !== "ok") return;
    expect(debtAtHorizon.value.remainingDebtAtHorizon).toBe(10_000);
    expect(debtAtHorizon.value.entries[2].remainingDebt).toBe(10_000);
  });

  it("rejects an initial or monthly shortfall instead of clipping investment", () => {
    expect(buildEqualBudgetRouteFunding(funding(schedule(60_000, 50_000), { initialBudget: 61_999 })))
      .toMatchObject({ kind: "invalid", reason: "insufficient-budget", period: 0 });
    expect(buildEqualBudgetRouteFunding(funding(schedule(60_000, 50_000), { monthlyBudget: 39_999 })))
      .toMatchObject({ kind: "invalid", reason: "insufficient-budget", period: 1 });
  });

  it("requires the explicit horizon to be original-anchor monthly anniversaries", () => {
    const monthEndSchedule = buildDatedLoanSchedule({ anchorDate: "2026-01-31", principal: 100_000, monthlyRate: 0, scheduledEmi: 50_000, termMonths: 2, immediatePrepayment: { amount: 60_000 } });
    expect(buildEqualBudgetRouteFunding(funding(monthEndSchedule, {
      horizonDates: ["2026-01-31", "2026-02-28", "2026-03-28"], anchorDate: "2026-01-31",
    }))).toMatchObject({ kind: "invalid", reason: "horizon-date-not-monthly-anniversary", date: "2026-03-28" });
    expect(buildEqualBudgetRouteFunding(funding(schedule(60_000, 50_000), {
      horizonDates: ["2026-01-01", "2026-02-01", "2026-02-01"],
    }))).toMatchObject({ kind: "invalid", reason: "duplicate-horizon-date", period: 2 });
  });

  it("rejects schedule rows with inconsistent accounting even when summary totals are adjusted", () => {
    const base = schedule(60_000, 50_000);
    const malformed = {
      ...base,
      totalScheduledPayment: base.totalScheduledPayment + 1,
      rows: base.rows.map((row, index) => index === 1 ? { ...row, scheduledPayment: row.scheduledPayment + 1 } : row),
    };
    expect(buildEqualBudgetRouteFunding(funding(malformed))).toMatchObject({ kind: "invalid", reason: "mismatched-payment-accounting", period: 1 });
  });

  it("rejects bounded and finite money violations without mutating the schedule", () => {
    const base = schedule(60_000, 50_000);
    const before = structuredClone(base);
    const malformed = { ...base, rows: base.rows.map((row, index) => index === 1 ? { ...row, interest: Number.NaN } : row) };
    expect(buildEqualBudgetRouteFunding(funding(malformed))).toMatchObject({ kind: "invalid", reason: "invalid-schedule-amount", period: 1 });
    expect(buildEqualBudgetRouteFunding(funding(base))).toMatchObject({ kind: "ok" });
    expect(base).toEqual(before);
  });

  it("rejects an incomplete debt schedule and non-anchor principal events", () => {
    const shortSchedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0, scheduledEmi: 20_000, termMonths: 1 });
    expect(buildEqualBudgetRouteFunding(funding(shortSchedule))).toMatchObject({ kind: "invalid", reason: "truncated-non-cleared-schedule" });

    const base = schedule(60_000, 50_000);
    const anchorUse = { ...base, rows: base.rows.map((row, index) => index === 0 ? { ...row, interest: 1, scheduledPayment: 1 } : row), totalInterest: base.totalInterest + 1, totalScheduledPayment: base.totalScheduledPayment + 1 };
    expect(buildEqualBudgetRouteFunding(funding(anchorUse))).toMatchObject({ kind: "invalid", reason: "anchor-has-scheduled-use" });

    const laterBase = schedule(50_000, 20_000);
    const laterPrepayment = { ...laterBase, rows: laterBase.rows.map((row, index) => index === 1 ? { ...row, immediatePrepayment: 1, closingBalance: row.closingBalance - 1 } : row) };
    expect(buildEqualBudgetRouteFunding(funding(laterPrepayment))).toMatchObject({ kind: "invalid", reason: "non-anchor-immediate-prepayment" });
    expect(buildEqualBudgetRouteFunding(funding({ ...base, totalInterest: Number.POSITIVE_INFINITY }))).toMatchObject({ kind: "invalid", reason: "invalid-schedule-total" });
  });
});
