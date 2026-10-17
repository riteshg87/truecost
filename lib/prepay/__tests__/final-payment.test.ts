import { describe, expect, it } from "vitest";
import { emiFor } from "../../finance/core";
import { computePrepay } from "../compute";
import type { PrepayInput } from "../types";

function input(partial: Partial<PrepayInput> = {}): PrepayInput {
  return {
    loanType: "home",
    outstanding: 120000,
    ratePct: 0,
    rateType: "reducing",
    rateStructure: "floating",
    remainingMonths: 3,
    currentEmi: null,
    surplus: 30000,
    prepayFeePct: 0,
    otherFees: 0,
    expectedReturnPct: 0,
    assetClass: "fd",
    taxSlabPct: 0,
    regime: "new",
    claims24b: false,
    claims80c: false,
    prepayMode: "tenure",
    liquidityMonthsAfter: 12,
    ...partial,
  };
}

/**
 * Independent end-of-month ledger for a zero-fee/tax tenure comparison.
 * Each month pays the amount actually due, then invests the unused part of
 * the fixed EMI budget. This does not call the prepayment engine's runoff.
 */
function independentLedger(value: PrepayInput): number {
  const horizon = Math.max(1, Math.round(value.remainingMonths));
  const rate = value.ratePct / 12 / 100;
  const emi = emiFor(value.outstanding, rate, horizon);
  const applied = Math.min(Math.max(0, value.surplus), value.outstanding);
  const excess = Math.max(0, value.surplus - applied);
  // All fixtures in this file set tax to zero. Keep this ledger independent
  // of the production tax helper and make that scope explicit.
  const investmentRate = value.expectedReturnPct / 1200;
  let balance = value.outstanding - applied;
  let wealth = excess;

  for (let month = 1; month <= horizon; month += 1) {
    wealth *= 1 + investmentRate;
    let payment = 0;
    if (balance > 0.005) {
      const charge = balance * rate;
      payment = Math.min(emi, balance + charge);
      balance = balance + charge - payment;
    }
    wealth += Math.max(0, emi - payment);
  }

  return wealth;
}

describe("prepayment final-payment cash conservation", () => {
  it("keeps the partial zero-rate final payment remainder", () => {
    const value = input();
    const actual = computePrepay(value).reduceTenure.terminalWealth;
    expect(actual).toBeCloseTo(independentLedger(value), 6);
    expect(actual).toBe(30000);
  });

  it("matches an independent ledger for a positive-rate partial final payment", () => {
    const value = input({ outstanding: 100000, ratePct: 12, remainingMonths: 12, surplus: 90000, expectedReturnPct: 6 });
    const result = computePrepay(value).reduceTenure;
    expect(result.months).toBe(2);
    expect(result.terminalWealth).toBeCloseTo(independentLedger(value), 6);
  });

  it("has no freed cash when zero prepayment pays the regular schedule", () => {
    const value = input({ surplus: 0 });
    expect(computePrepay(value).reduceTenure.terminalWealth).toBeCloseTo(independentLedger(value), 6);
    expect(computePrepay(value).reduceTenure.terminalWealth).toBe(0);
  });

  it("treats an immediate full payoff as month-one onward freed EMI cash", () => {
    const value = input({ outstanding: 120000, surplus: 120000, expectedReturnPct: 6 });
    expect(computePrepay(value).reduceTenure.months).toBe(0);
    expect(computePrepay(value).reduceTenure.terminalWealth).toBeCloseTo(independentLedger(value), 6);
  });

  it("does not invent a remainder when the payoff equals the EMI at the horizon", () => {
    const value = input({ outstanding: 120000, surplus: 40000, remainingMonths: 3 });
    const result = computePrepay(value).reduceTenure;
    expect(result.months).toBe(2);
    expect(result.terminalWealth).toBeCloseTo(independentLedger(value), 6);
    expect(result.terminalWealth).toBe(40000);
  });

  it("compounds a month-one payoff remainder across the remaining horizon", () => {
    const value = input({ outstanding: 100000, ratePct: 12, remainingMonths: 12, surplus: 99000, expectedReturnPct: 6 });
    const result = computePrepay(value).reduceTenure;
    expect(result.months).toBe(1);
    expect(result.terminalWealth).toBeCloseTo(independentLedger(value), 6);
  });

  it("keeps excess surplus separate while matching the month-by-month ledger", () => {
    const value = input({ outstanding: 120000, surplus: 150000, expectedReturnPct: 6 });
    expect(computePrepay(value).reduceTenure.terminalWealth).toBeCloseTo(independentLedger(value), 6);
  });
});
