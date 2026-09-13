import { describe, expect, it } from "vitest";
import {
  amortisationSchedule,
  emiFor,
  flatToReducing,
  monthlyRateFromEmi,
} from "../core";
import { aprFor, monthlyIrr, npv } from "../xirr";
import { borrowerCashFlows, computeOffer } from "../compute";
import { compareOffers } from "../comparison";
import type { Offer } from "../types";

const baseOffer = (overrides: Partial<Offer> = {}): Offer => ({
  id: "a",
  lender: "Test Bank",
  loanType: "home",
  amount: 1000000,
  ratePct: 10,
  rateType: "reducing",
  rateStructure: "floating",
  tenureValue: 10,
  tenureUnit: "years",
  processingFee: { mode: "flat", value: 0 },
  gstPct: 18,
  insurancePremium: 0,
  insuranceFunding: "financed",
  otherFees: [],
  ...overrides,
});

describe("emiFor", () => {
  it("matches the textbook figure for 10L @ 10% over 10 years", () => {
    // Widely published answer for this exact loan is ₹13,215.
    expect(emiFor(1000000, 0.1 / 12, 120)).toBeCloseTo(13215, 0);
  });

  it("matches a 50L home loan @ 8.5% over 20 years", () => {
    expect(emiFor(5000000, 0.085 / 12, 240)).toBeCloseTo(43391, 0);
  });

  it("degrades to straight-line repayment at a zero rate", () => {
    expect(emiFor(120000, 0, 12)).toBe(10000);
  });

  it("returns zero for a non-loan", () => {
    expect(emiFor(0, 0.01, 12)).toBe(0);
    expect(emiFor(100000, 0.01, 0)).toBe(0);
  });
});

describe("monthlyRateFromEmi", () => {
  it("inverts emiFor across the retail rate range", () => {
    for (const annual of [6, 8.5, 10, 14, 18, 24, 36]) {
      for (const months of [12, 36, 60, 120, 240, 360]) {
        const rate = annual / 12 / 100;
        const emi = emiFor(1000000, rate, months);
        expect(monthlyRateFromEmi(1000000, emi, months)).toBeCloseTo(rate, 10);
      }
    }
  });

  it("reports a zero rate when the EMIs never exceed the principal", () => {
    expect(monthlyRateFromEmi(120000, 10000, 12)).toBe(0);
  });
});

describe("flatToReducing", () => {
  it("converts 10% flat over 5 years to roughly 17.3% reducing", () => {
    const result = flatToReducing(100000, 10, 60);
    expect(result.emi).toBeCloseTo(2500, 6);
    expect(result.annualPct).toBeGreaterThan(17);
    expect(result.annualPct).toBeLessThan(17.5);
  });

  it("produces an EMI that reproduces the flat total exactly", () => {
    const principal = 500000;
    const months = 36;
    const result = flatToReducing(principal, 12, months);
    const totalFlat = principal + principal * 0.12 * (months / 12);
    expect(result.emi * months).toBeCloseTo(totalFlat, 6);
    // Round-tripping the solved rate must give back the same EMI.
    expect(emiFor(principal, result.monthlyRate, months)).toBeCloseTo(result.emi, 6);
  });

  it("always costs more than the same number quoted reducing", () => {
    for (const pct of [8, 10, 14, 18]) {
      const flat = flatToReducing(300000, pct, 48);
      expect(flat.annualPct).toBeGreaterThan(pct);
    }
  });
});

describe("amortisationSchedule", () => {
  it("closes out at exactly zero and repays the whole principal", () => {
    const principal = 2500000;
    const rate = 0.09 / 12;
    const months = 180;
    const emi = emiFor(principal, rate, months);
    const rows = amortisationSchedule(principal, rate, months, emi);

    expect(rows).toHaveLength(months);
    expect(rows[rows.length - 1].closing).toBe(0);

    const principalRepaid = rows.reduce((sum, r) => sum + r.principal, 0);
    expect(principalRepaid).toBeCloseTo(principal, 4);
  });

  it("front-loads interest", () => {
    const emi = emiFor(1000000, 0.1 / 12, 120);
    const rows = amortisationSchedule(1000000, 0.1 / 12, 120, emi);
    expect(rows[0].interest).toBeGreaterThan(rows[119].interest);
    expect(rows[0].principal).toBeLessThan(rows[119].principal);
  });
});

describe("monthlyIrr", () => {
  it("recovers the exact rate on a fee-free loan", () => {
    const rate = 0.1 / 12;
    const emi = emiFor(1000000, rate, 120);
    expect(monthlyIrr(borrowerCashFlows(1000000, emi, 120))).toBeCloseTo(rate, 10);
  });

  it("drives NPV to zero at the solved rate", () => {
    const emi = emiFor(800000, 0.14 / 12, 60);
    const flows = borrowerCashFlows(760000, emi, 60);
    const solved = monthlyIrr(flows);
    expect(solved).not.toBeNull();
    expect(Math.abs(npv(solved as number, flows))).toBeLessThan(1e-6);
  });

  it("handles a zero-interest loan with fees", () => {
    const flows = borrowerCashFlows(98000, 100000 / 12, 12);
    const solved = monthlyIrr(flows);
    expect(solved).not.toBeNull();
    expect(solved as number).toBeGreaterThan(0);
  });

  it("returns null when there is no sign change to solve", () => {
    expect(monthlyIrr([100, 200, 300])).toBeNull();
    expect(monthlyIrr([-100, -200])).toBeNull();
    expect(monthlyIrr([100])).toBeNull();
  });

  it("stays stable on a 30-year schedule", () => {
    const rate = 0.085 / 12;
    const emi = emiFor(5000000, rate, 360);
    const solved = monthlyIrr(borrowerCashFlows(4950000, emi, 360));
    expect(solved).not.toBeNull();
    expect(solved as number).toBeGreaterThan(rate);
  });
});

describe("aprFor", () => {
  it("reports the quoted rate back when there are no fees", () => {
    const emi = emiFor(1000000, 0.1 / 12, 120);
    const result = aprFor(borrowerCashFlows(1000000, emi, 120));
    expect(result?.aprPct).toBeCloseTo(10, 6);
    // The compounded figure is always higher than the nominal one.
    expect(result?.effectiveAnnualPct).toBeGreaterThan(10.4);
  });
});

describe("computeOffer", () => {
  it("leaves a no-fee offer's APR equal to its quoted rate", () => {
    const d = computeOffer(baseOffer());
    expect(d.effectiveAprPct).toBeCloseTo(10, 6);
    expect(d.netDisbursal).toBe(1000000);
    expect(d.totalCostOfBorrowing).toBeCloseTo(d.totalInterest, 6);
  });

  it("applies GST to the processing fee, not the loan", () => {
    const d = computeOffer(
      baseOffer({ processingFee: { mode: "percent", value: 1 } }),
    );
    expect(d.processingFeeAmount).toBe(10000);
    expect(d.gstAmount).toBe(1800);
    expect(d.netDisbursal).toBe(1000000 - 11800);
  });

  it("pushes APR above the quoted rate once fees are charged", () => {
    const plain = computeOffer(baseOffer());
    const withFees = computeOffer(
      baseOffer({ processingFee: { mode: "percent", value: 2 } }),
    );
    expect(withFees.emi).toBeCloseTo(plain.emi, 6);
    expect(withFees.effectiveAprPct as number).toBeGreaterThan(
      plain.effectiveAprPct as number,
    );
  });

  it("charges interest on a financed premium but not an upfront one", () => {
    const financed = computeOffer(
      baseOffer({ insurancePremium: 50000, insuranceFunding: "financed" }),
    );
    const upfront = computeOffer(
      baseOffer({ insurancePremium: 50000, insuranceFunding: "upfront" }),
    );
    expect(financed.emi).toBeGreaterThan(upfront.emi);
    expect(financed.totalCostOfBorrowing).toBeGreaterThan(upfront.totalCostOfBorrowing);
    // Upfront costs the borrower the premium at disbursal instead.
    expect(upfront.cashInHand).toBe(financed.cashInHand - 50000);
  });

  it("converts a flat quote and flags it", () => {
    const d = computeOffer(
      baseOffer({ loanType: "auto", rateType: "flat", ratePct: 10, tenureValue: 5 }),
    );
    expect(d.effectiveReducingRatePct).toBeGreaterThan(17);
    expect(d.warnings.some((w) => w.code === "flat-rate")).toBe(true);
  });

  it("keeps cost per lakh independent of loan size at a fixed percentage fee", () => {
    const small = computeOffer(
      baseOffer({ amount: 500000, processingFee: { mode: "percent", value: 1 } }),
    );
    const large = computeOffer(
      baseOffer({ amount: 5000000, processingFee: { mode: "percent", value: 1 } }),
    );
    expect(small.costPerLakh).toBeCloseTo(large.costPerLakh, 4);
  });
});

describe("compareOffers", () => {
  it("ranks the genuinely cheaper offer first despite a lower headline rate elsewhere", () => {
    // B quotes a lower rate but buries 3% in fees.
    const a = baseOffer({ id: "a", lender: "A", ratePct: 10.5 });
    const b = baseOffer({
      id: "b",
      lender: "B",
      ratePct: 10,
      processingFee: { mode: "percent", value: 3 },
      otherFees: [{ id: "x", label: "Legal", amount: 25000 }],
    });
    const result = compareOffers([a, b]);
    expect(result.best?.offer.lender).toBe("A");
  });

  it("flags differing tenures and refuses to rank on total interest", () => {
    const short = baseOffer({ id: "a", lender: "Short", tenureValue: 5 });
    const long = baseOffer({ id: "b", lender: "Long", tenureValue: 20, ratePct: 9 });
    const result = compareOffers([short, long]);

    expect(result.basis.tenuresDiffer).toBe(true);
    expect(result.basis.strict).toBe(true);
    expect(result.notices.some((n) => n.code === "tenures-differ")).toBe(true);
    // The 20-year loan pays far more interest but is the cheaper money.
    expect(result.best?.offer.lender).toBe("Long");
  });

  it("flags differing amounts", () => {
    const result = compareOffers([
      baseOffer({ id: "a", amount: 1000000 }),
      baseOffer({ id: "b", amount: 2000000 }),
    ]);
    expect(result.basis.amountsDiffer).toBe(true);
    expect(result.notices.some((n) => n.code === "amounts-differ")).toBe(true);
  });

  it("treats identical offers as non-strict with a zero gap", () => {
    const result = compareOffers([
      baseOffer({ id: "a", lender: "A" }),
      baseOffer({ id: "b", lender: "B" }),
    ]);
    expect(result.basis.strict).toBe(false);
    expect(result.rows[1].aprGapVsBest).toBeCloseTo(0, 8);
  });

  it("notices when APR and rupees-spent disagree", () => {
    // Same amount and tenure: one loads cost upfront, the other into interest.
    const upfrontHeavy = baseOffer({
      id: "a",
      lender: "Upfront",
      ratePct: 9,
      processingFee: { mode: "percent", value: 4 },
    });
    const interestHeavy = baseOffer({ id: "b", lender: "Interest", ratePct: 10.2 });
    const result = compareOffers([upfrontHeavy, interestHeavy]);
    expect(result.rows).toHaveLength(2);
    expect(result.basis.strict).toBe(false);
  });
});
