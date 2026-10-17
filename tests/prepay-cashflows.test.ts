import { describe, expect, it } from "vitest";
import { buildDatedLoanSchedule } from "../lib/prepay/cashflows";

function independentEmi(principal: number, monthlyRate: number, months: number): number {
  const growth = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * growth) / (growth - 1);
}

describe("dated prepayment cashflows", () => {
  it("matches the independent six-payment reducing-loan fixture", () => {
    const emi = independentEmi(1_000_000, 0.01, 6);
    const schedule = buildDatedLoanSchedule({
      anchorDate: "2026-01-15",
      principal: 1_000_000,
      monthlyRate: 0.01,
      scheduledEmi: emi,
      termMonths: 6,
    });

    expect(schedule.totalInterest).toBeCloseTo(35_290.2002653, 6);
    expect(schedule.totalScheduledPrincipal).toBeCloseTo(1_000_000, 6);
    expect(schedule.remainingBalance).toBe(0);
    expect(schedule.cleared).toBe(true);
    expect(schedule.rows.map((row) => row.date)).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
    ]);
  });

  it("anchors every payment to the original date and clamps leap month ends", () => {
    const schedule = buildDatedLoanSchedule({
      anchorDate: "2024-01-31",
      principal: 400,
      monthlyRate: 0,
      scheduledEmi: 100,
      termMonths: 4,
    });

    expect(schedule.rows.map((row) => row.date)).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
      "2024-05-31",
    ]);
  });

  it("uses a smaller final payment and reports an uncleared term honestly", () => {
    const schedule = buildDatedLoanSchedule({
      anchorDate: "2026-01-10",
      principal: 250,
      monthlyRate: 0,
      scheduledEmi: 100,
      termMonths: 3,
    });

    expect(schedule.rows.slice(1).map((row) => row.scheduledPayment)).toEqual([100, 100, 50]);
    expect(schedule.totalScheduledPrincipal).toBe(250);
    expect(schedule.remainingBalance).toBe(0);
    expect(schedule.cleared).toBe(true);

    const uncleared = buildDatedLoanSchedule({
      anchorDate: "2026-01-10",
      principal: 250,
      monthlyRate: 0,
      scheduledEmi: 100,
      termMonths: 2,
    });
    expect(uncleared.remainingBalance).toBe(50);
    expect(uncleared.cleared).toBe(false);
  });

  it("supports zero outstanding and zero rate", () => {
    const schedule = buildDatedLoanSchedule({
      anchorDate: "2026-01-31",
      principal: 0,
      monthlyRate: 0,
      scheduledEmi: 0,
      termMonths: 3,
    });

    expect(schedule.rows).toHaveLength(4);
    expect(schedule.totalInterest).toBe(0);
    expect(schedule.remainingBalance).toBe(0);
    expect(schedule.cleared).toBe(true);
  });

  it("keeps immediate prepayment separate and conserves principal", () => {
    const schedule = buildDatedLoanSchedule({
      anchorDate: "2026-01-10",
      principal: 1_000,
      monthlyRate: 0,
      scheduledEmi: 300,
      termMonths: 3,
      immediatePrepayment: { amount: 250 },
    });

    expect(schedule.rows[0].immediatePrepayment).toBe(250);
    expect(schedule.rows.slice(1).every((row) => row.immediatePrepayment === 0)).toBe(true);
    expect(schedule.totalScheduledPrincipal + schedule.remainingBalance).toBeCloseTo(
      schedule.originalPrincipal - schedule.immediatePrepayment,
      8,
    );
    expect(schedule.totalScheduledPrincipal).toBeCloseTo(750, 8);
  });

  it("partitions rows at the Indian financial-year boundary", () => {
    const schedule = buildDatedLoanSchedule({
      anchorDate: "2026-02-28",
      principal: 1_000,
      monthlyRate: 0,
      scheduledEmi: 250,
      termMonths: 4,
    });

    expect(schedule.financialYearTotals).toEqual([
      {
        financialYear: 2025,
        interest: 0,
        scheduledPayment: 250,
        scheduledPrincipal: 250,
        immediatePrepayment: 0,
      },
      {
        financialYear: 2026,
        interest: 0,
        scheduledPayment: 750,
        scheduledPrincipal: 750,
        immediatePrepayment: 0,
      },
    ]);
    expect(schedule.rows.slice(1).map((row) => [row.date, row.financialYear])).toEqual([
      ["2026-03-28", 2025],
      ["2026-04-28", 2026],
      ["2026-05-28", 2026],
      ["2026-06-28", 2026],
    ]);
  });

  it("conserves a largest-supported balance without a phantom residual", () => {
    const schedule = buildDatedLoanSchedule({
      anchorDate: "2026-01-01",
      principal: 1_000_000_000_000,
      monthlyRate: 0,
      scheduledEmi: 400_000_000_000,
      termMonths: 3,
    });

    expect(schedule.totalScheduledPrincipal + schedule.remainingBalance).toBe(
      schedule.originalPrincipal - schedule.immediatePrepayment,
    );
    expect(schedule.rows.slice(1).map((row) => row.scheduledPayment)).toEqual([
      400_000_000_000,
      400_000_000_000,
      200_000_000_000,
    ]);
    expect(schedule.remainingBalance).toBe(0);
    expect(schedule.cleared).toBe(true);
  });

  it("keeps interest-bearing large schedules within paise-level reference error", () => {
    const principal = 100_000_000_000;
    const monthlyRate = 0.005;
    const termMonths = 120;
    const emi = independentEmi(principal, monthlyRate, termMonths);
    const schedule = buildDatedLoanSchedule({
      anchorDate: "2026-01-01",
      principal,
      monthlyRate,
      scheduledEmi: emi,
      termMonths,
    });

    expect(schedule.totalInterest).toBeCloseTo(emi * termMonths - principal, 2);
    expect(schedule.totalScheduledPrincipal + schedule.remainingBalance).toBeCloseTo(principal, 2);
    expect(schedule.remainingBalance).toBe(0);
    expect(schedule.cleared).toBe(true);
  });

  it.each([1e-7, 1e-16])("retains a genuine %s rupee residual instead of rounding it away", (residual) => {
    const schedule = buildDatedLoanSchedule({
      anchorDate: "2026-01-01",
      principal: 2 * residual,
      monthlyRate: 0,
      scheduledEmi: residual,
      termMonths: 1,
    });

    expect(schedule.totalScheduledPrincipal).toBe(residual);
    expect(schedule.remainingBalance).toBe(residual);
    expect(schedule.cleared).toBe(false);
  });

  it("rejects invalid, out-of-range, and non-amortising inputs", () => {
    const valid = {
      anchorDate: "2026-01-01",
      principal: 1_000,
      monthlyRate: 0.01,
      scheduledEmi: 200,
      termMonths: 3,
    };
    expect(() => buildDatedLoanSchedule({ ...valid, principal: -1 })).toThrow();
    expect(() => buildDatedLoanSchedule({ ...valid, monthlyRate: Infinity })).toThrow();
    expect(() => buildDatedLoanSchedule({ ...valid, termMonths: 1.5 })).toThrow();
    expect(() => buildDatedLoanSchedule({ ...valid, termMonths: 1201 })).toThrow();
    expect(() => buildDatedLoanSchedule({ ...valid, principal: 1_000_000_000_001 })).toThrow();
    expect(() => buildDatedLoanSchedule({ ...valid, immediatePrepayment: { amount: 1_001 } })).toThrow();
    expect(() => buildDatedLoanSchedule({ ...valid, scheduledEmi: 10 })).toThrow();
  });
});
