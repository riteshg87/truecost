import { describe, expect, it } from "vitest";
import { emiFor } from "../../finance/core";
import { computePrepay, prepayFee, prepayPathFor } from "../compute";
import { MIN_BUFFER_MONTHS, recommendPrepay } from "../recommend";
import { CAP_24B, effectiveSlabPct, loanTaxBreakdown, postTaxReturnPct } from "../tax";
import type { PrepayInput } from "../types";

function input(partial: Partial<PrepayInput> = {}): PrepayInput {
  return {
    loanType: "home",
    outstanding: 4000000,
    ratePct: 8.5,
    rateType: "reducing",
    rateStructure: "floating",
    remainingMonths: 180,
    currentEmi: null,
    surplus: 500000,
    prepayFeePct: 0,
    otherFees: 0,
    expectedReturnPct: 11,
    assetClass: "equity",
    taxSlabPct: 30,
    regime: "new",
    claims24b: false,
    claims80c: false,
    prepayMode: "tenure",
    liquidityMonthsAfter: 12,
    ...partial,
  };
}

/* ========================================================================== */
/* Routing                                                                    */
/* ========================================================================== */

describe("path routing", () => {
  it("part-pays while the surplus is smaller than the balance", () => {
    expect(prepayPathFor(4000000, 500000)).toBe("part-payment");
  });

  it("forecloses once the surplus covers the balance", () => {
    expect(prepayPathFor(4000000, 4000000)).toBe("foreclosure");
    expect(prepayPathFor(4000000, 5000000)).toBe("foreclosure");
  });
});

/* ========================================================================== */
/* Fees                                                                       */
/* ========================================================================== */

describe("prepayment fee", () => {
  it("is nil on a floating home loan whatever is typed in", () => {
    expect(prepayFee(input({ prepayFeePct: 4, otherFees: 5000 }))).toBe(0);
  });

  it("is charged on the amount tendered when part-paying a fixed loan", () => {
    const fee = prepayFee(
      input({ rateStructure: "fixed", prepayFeePct: 2, surplus: 500000 }),
    );
    expect(fee).toBeCloseTo(10000, 6);
  });

  it("is charged on the whole balance when closing a fixed loan", () => {
    const fee = prepayFee(
      input({ rateStructure: "fixed", prepayFeePct: 2, surplus: 4000000 }),
    );
    expect(fee).toBeCloseTo(80000, 6);
  });
});

/* ========================================================================== */
/* Scenarios                                                                  */
/* ========================================================================== */

describe("scenarios", () => {
  it("derives the EMI and reports a mismatch against a stated one", () => {
    const s = computePrepay(input({ currentEmi: 40000 }));
    const expected = emiFor(4000000, 8.5 / 12 / 100, 180);
    expect(s.noPrepay.emi).toBeCloseTo(expected, 6);
    expect(s.emiMismatch).toBeCloseTo(40000 - expected, 6);
  });

  it("leaves the mismatch null when no EMI is offered", () => {
    expect(computePrepay(input()).emiMismatch).toBeNull();
  });

  it("shortens the term while holding the instalment", () => {
    const s = computePrepay(input({ prepayMode: "tenure" }));
    expect(s.reduceTenure.emi).toBeCloseTo(s.noPrepay.emi, 6);
    expect(s.reduceTenure.months).toBeLessThan(s.noPrepay.months);
    expect(s.reduceTenure.monthsSaved).toBeGreaterThan(0);
    expect(s.reduceTenure.interestSaved).toBeGreaterThan(0);
  });

  it("lowers the instalment while holding the term", () => {
    const s = computePrepay(input({ prepayMode: "emi" }));
    expect(s.reduceEmi.months).toBe(s.noPrepay.months);
    expect(s.reduceEmi.newEmi).toBeLessThan(s.noPrepay.emi);
    expect(s.reduceEmi.monthlyFreed).toBeCloseTo(
      s.noPrepay.emi - s.reduceEmi.newEmi,
      6,
    );
  });

  it("saves more interest on the tenure route than the EMI route", () => {
    // The reason reduce-tenure is the default: the same rupee kills more
    // interest when it shortens the schedule than when it thins each payment.
    const s = computePrepay(input());
    expect(s.reduceTenure.interestSaved).toBeGreaterThan(s.reduceEmi.interestSaved);
  });

  it("clears the loan outright on the foreclosure path", () => {
    const s = computePrepay(input({ surplus: 4000000 }));
    expect(s.path).toBe("foreclosure");
    expect(s.reduceTenure.months).toBe(0);
    expect(s.reduceTenure.monthsSaved).toBe(180);
    expect(s.reduceEmi.newEmi).toBe(0);
  });

  it("puts a surplus beyond the balance to work rather than into the loan", () => {
    const s = computePrepay(input({ surplus: 5000000, expectedReturnPct: 11 }));
    // The extra 10L was never needed by the loan, so it compounds for the
    // full horizon and shows up in terminal wealth.
    expect(s.reduceTenure.terminalWealth).toBeGreaterThan(
      computePrepay(input({ surplus: 4000000 })).reduceTenure.terminalWealth,
    );
  });
});

/* ========================================================================== */
/* Tax                                                                        */
/* ========================================================================== */

describe("tax", () => {
  it("gives no shield in the new regime", () => {
    const t = loanTaxBreakdown(input({ regime: "new", claims24b: true }), 40000);
    expect(t.annualTaxSaved).toBe(0);
    expect(t.noShield).toBe(true);
    expect(t.postTaxCostPct).toBeCloseTo(8.5, 6);
  });

  it("caps the 24(b) relief in rupees, not as a share of interest", () => {
    // 40L at 8.5% throws off 3.4L of interest against a 2L cap, so only part
    // of the loan is subsidised.
    const t = loanTaxBreakdown(
      input({ regime: "old", claims24b: true, taxSlabPct: 30 }),
      40000,
    );
    expect(t.annualInterest).toBeCloseTo(340000, 6);
    expect(t.deduction24b).toBe(CAP_24B);
    expect(t.annualTaxSaved).toBeCloseTo(CAP_24B * (effectiveSlabPct(30) / 100), 6);
    expect(t.postTaxCostPct).toBeLessThan(8.5);
    expect(t.postTaxCostPct).toBeGreaterThan(6.5);
  });

  it("taxes an FD at slab and equity at LTCG", () => {
    expect(postTaxReturnPct(7, "fd", 30)).toBeCloseTo(7 * (1 - 0.312), 6);
    expect(postTaxReturnPct(11, "equity", 30)).toBeCloseTo(11 * (1 - 0.125), 6);
  });

  it("leaves a zero-slab return untouched", () => {
    expect(postTaxReturnPct(7, "fd", 0)).toBeCloseTo(7, 6);
  });
});

/* ========================================================================== */
/* Recommendation                                                             */
/* ========================================================================== */

describe("recommendation", () => {
  it("stops at the liquidity gate before any arithmetic wins the argument", () => {
    // Equity at 11% would otherwise win outright here.
    const r = recommendPrepay(
      input({ liquidityMonthsAfter: 2, assetClass: "equity", expectedReturnPct: 14 }),
    );
    expect(r.verdict).toBe("build-buffer");
  });

  it("clears the gate at six months of cover", () => {
    const r = recommendPrepay(input({ liquidityMonthsAfter: MIN_BUFFER_MONTHS }));
    expect(r.verdict).not.toBe("build-buffer");
  });

  it("stays advisory when liquidity was never answered", () => {
    const r = recommendPrepay(input({ liquidityMonthsAfter: null }));
    expect(r.verdict).not.toBe("build-buffer");
  });

  it("prepays when the loan costs more than the investment returns", () => {
    const r = recommendPrepay(
      input({ assetClass: "fd", expectedReturnPct: 7, taxSlabPct: 30, regime: "new" }),
    );
    // 7% before tax is 4.8% after slab, against a loan costing 8.5%.
    expect(r.postTaxReturnPct).toBeLessThan(r.postTaxLoanCostPct);
    expect(r.verdict).toBe("prepay");
  });

  it("invests when the return clears the loan by more than the risk premium", () => {
    const r = recommendPrepay(
      input({ assetClass: "equity", expectedReturnPct: 14, regime: "new" }),
    );
    // 14% less 12.5% LTCG is 12.25%, comfortably past 8.5% + 2.
    expect(r.advantagePct).toBeGreaterThan(r.requiredPremiumPct);
    expect(r.verdict).toBe("invest");
  });

  it("calls it line-ball when the return is ahead but not by enough to pay for the risk", () => {
    const r = recommendPrepay(
      input({ assetClass: "equity", expectedReturnPct: 10.5, regime: "new" }),
    );
    expect(r.advantagePct).toBeGreaterThan(0);
    expect(r.advantagePct).toBeLessThan(r.requiredPremiumPct);
    expect(r.verdict).toBe("line-ball");
  });

  it("quotes a crossover the asset actually has to reach", () => {
    const r = recommendPrepay(input({ assetClass: "equity", regime: "new" }));
    // Feed the crossover back in and investing should just tip over the line.
    const at = recommendPrepay(
      input({ assetClass: "equity", regime: "new", expectedReturnPct: r.crossoverPct }),
    );
    expect(at.advantagePct).toBeCloseTo(at.requiredPremiumPct, 6);
    expect(at.verdict).toBe("invest");

    const under = recommendPrepay(
      input({
        assetClass: "equity",
        regime: "new",
        expectedReturnPct: r.crossoverPct - 0.5,
      }),
    );
    expect(under.verdict).not.toBe("invest");
  });

  it("lowers the bar once the deduction makes the loan cheaper", () => {
    const noShield = recommendPrepay(input({ regime: "new" }));
    const shielded = recommendPrepay(
      input({ regime: "old", claims24b: true, taxSlabPct: 30 }),
    );
    expect(shielded.postTaxLoanCostPct).toBeLessThan(noShield.postTaxLoanCostPct);
    expect(shielded.crossoverPct).toBeLessThan(noShield.crossoverPct);
  });

  it("names the fee when the fee is what decided it", () => {
    // A fixed loan with a punitive exit charge, against a return that would
    // otherwise lose to prepaying.
    const r = recommendPrepay(
      input({
        rateStructure: "fixed",
        prepayFeePct: 4,
        assetClass: "debt",
        expectedReturnPct: 8,
        taxSlabPct: 5,
        regime: "new",
      }),
    );
    expect(r.scenarios.fee).toBeGreaterThan(0);
    expect(typeof r.feeDecisive).toBe("boolean");
  });

  it("reports which route ends richest", () => {
    const r = recommendPrepay(input());
    expect(["tenure", "emi", "invest"]).toContain(r.bestByWealth);
  });

  it("finds the EMI route ends richer when the freed cash really is invested", () => {
    // Counter-intuitive but correct. Cutting the tenure kills more interest,
    // but frees a large instalment only in the closing months, where it has no
    // time to compound. Cutting the EMI frees a small sum from month one and
    // compounds it across the whole term.
    const r = recommendPrepay(input({ expectedReturnPct: 11, assetClass: "equity" }));
    expect(r.scenarios.reduceTenure.interestSaved).toBeGreaterThan(
      r.scenarios.reduceEmi.interestSaved,
    );
    expect(r.scenarios.reduceEmi.terminalWealth).toBeGreaterThan(
      r.scenarios.reduceTenure.terminalWealth,
    );
    expect(r.emiRouteEndsRicher).toBe(true);
  });

  it("puts the tenure route back on top when the freed cash earns little", () => {
    const r = recommendPrepay(
      input({ expectedReturnPct: 3, assetClass: "fd", taxSlabPct: 30 }),
    );
    expect(r.scenarios.reduceTenure.terminalWealth).toBeGreaterThan(
      r.scenarios.reduceEmi.terminalWealth,
    );
    expect(r.emiRouteEndsRicher).toBe(false);
  });
});
