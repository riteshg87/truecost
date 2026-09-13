import { describe, expect, it } from "vitest";
import { compareOffers } from "../comparison";
import {
  ENABLED_LOAN_TYPES,
  FORECLOSURE_NOTE,
  LOAN_TYPES,
  LOAN_TYPE_ORDER,
  isLoanTypeEnabled,
} from "../loanTypes";
import type { Offer } from "../types";

/**
 * The product is home loans only for now. Everything else stays defined and
 * visible but unselectable, so these lock in both halves of that: what is
 * reachable, and what the fixed-or-floating answer is used for.
 */

function offer(partial: Partial<Offer> & Pick<Offer, "id" | "lender">): Offer {
  return {
    loanType: "home",
    amount: 5000000,
    ratePct: 8.5,
    rateType: "reducing",
    rateStructure: "floating",
    tenureValue: 20,
    tenureUnit: "years",
    processingFee: { mode: "flat", value: 20000 },
    gstPct: 18,
    insurancePremium: 0,
    insuranceFunding: "upfront",
    otherFees: [],
    ...partial,
  };
}

function codes(offers: Offer[]): string[] {
  return compareOffers(offers).notices.map((n) => n.code);
}

describe("loan type gating", () => {
  it("offers home and nothing else", () => {
    expect(ENABLED_LOAN_TYPES).toEqual(["home"]);
  });

  it("keeps every other product defined so it can still be shown", () => {
    expect(LOAN_TYPE_ORDER).toHaveLength(6);
    LOAN_TYPE_ORDER.forEach((id) => {
      expect(LOAN_TYPES[id].label).toBeTruthy();
      expect(LOAN_TYPES[id].prepayNote).toBeTruthy();
    });
  });

  it("reports the disabled ones as disabled", () => {
    expect(isLoanTypeEnabled("home")).toBe(true);
    ["auto", "personal", "gold", "business", "education"].forEach((id) => {
      expect(isLoanTypeEnabled(id as Offer["loanType"])).toBe(false);
    });
  });

  it("holds home to a reducing balance, with floating assumed", () => {
    expect(LOAN_TYPES.home.rateTypeLocked).toBe(true);
    expect(LOAN_TYPES.home.defaultRateType).toBe("reducing");
    expect(LOAN_TYPES.home.defaultRateStructure).toBe("floating");
  });
});

describe("fixed versus floating", () => {
  it("does not move the arithmetic", () => {
    const floating = compareOffers([
      offer({ id: "a", lender: "A" }),
      offer({ id: "b", lender: "B", ratePct: 8.7 }),
    ]);
    const fixed = compareOffers([
      offer({ id: "a", lender: "A", rateStructure: "fixed" }),
      offer({ id: "b", lender: "B", ratePct: 8.7, rateStructure: "fixed" }),
    ]);

    expect(fixed.rows[0].derived.effectiveAprPct).toBeCloseTo(
      floating.rows[0].derived.effectiveAprPct as number,
      9,
    );
    expect(fixed.rows[0].derived.emi).toBeCloseTo(floating.rows[0].derived.emi, 9);
  });

  it("says prepayment is free when both are floating", () => {
    const notices = compareOffers([
      offer({ id: "a", lender: "A" }),
      offer({ id: "b", lender: "B", ratePct: 8.7 }),
    ]).notices;

    expect(notices.map((n) => n.code)).toContain("foreclosure-floating");
    expect(notices.find((n) => n.code === "foreclosure-floating")?.message).toBe(
      FORECLOSURE_NOTE.floating,
    );
  });

  it("warns about exit charges when both are fixed", () => {
    const notice = compareOffers([
      offer({ id: "a", lender: "A", rateStructure: "fixed" }),
      offer({ id: "b", lender: "B", ratePct: 8.7, rateStructure: "fixed" }),
    ]).notices.find((n) => n.code === "foreclosure-fixed");

    expect(notice?.message).toBe(FORECLOSURE_NOTE.fixed);
    expect(notice?.level).toBe("caution");
  });

  it("treats a fixed-against-floating comparison as the mismatch it is", () => {
    const comparison = compareOffers([
      offer({ id: "a", lender: "Floating" }),
      offer({ id: "b", lender: "Fixed", ratePct: 8.7, rateStructure: "fixed" }),
    ]);

    expect(comparison.basis.rateStructuresDiffer).toBe(true);

    const notice = comparison.notices.find((n) => n.code === "rate-structures-differ");
    expect(notice?.level).toBe("caution");

    // The blanket per-structure note would be misleading here, so it stands down.
    expect(codes(comparison.rows.map((r) => r.offer))).not.toContain(
      "foreclosure-floating",
    );
  });

  it("is not flagged as differing when every offer agrees", () => {
    expect(
      compareOffers([
        offer({ id: "a", lender: "A" }),
        offer({ id: "b", lender: "B", ratePct: 8.7 }),
      ]).basis.rateStructuresDiffer,
    ).toBe(false);
  });
});
