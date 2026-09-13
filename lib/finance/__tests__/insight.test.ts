import { describe, expect, it } from "vitest";
import { compareOffers } from "../comparison";
import { computeOffer } from "../compute";
import { recommend, TOO_CLOSE_APR_GAP } from "../insight";
import type { Offer } from "../types";

function offer(partial: Partial<Offer> & Pick<Offer, "id" | "lender">): Offer {
  return {
    loanType: "auto",
    amount: 1200000,
    ratePct: 9.5,
    rateType: "reducing",
    tenureValue: 5,
    tenureUnit: "years",
    processingFee: { mode: "flat", value: 0 },
    gstPct: 18,
    insurancePremium: 0,
    insuranceFunding: "upfront",
    otherFees: [],
    ...partial,
  };
}

function rec(offers: Offer[]) {
  const r = recommend(compareOffers(offers));
  if (!r) throw new Error("expected a recommendation");
  return r;
}

describe("recommend", () => {
  it("returns null with fewer than two offers", () => {
    expect(recommend(compareOffers([offer({ id: "a", lender: "Only" })]))).toBeNull();
  });

  it("flags the case the product exists for: lowest rate is not cheapest", () => {
    const r = rec([
      offer({ id: "a", lender: "Cheap rate", ratePct: 9.25, processingFee: { mode: "flat", value: 25000 } }),
      offer({ id: "b", lender: "Cheap fee", ratePct: 9.55, processingFee: { mode: "flat", value: 3000 } }),
    ]);

    expect(r.best.offer.lender).toBe("Cheap fee");
    expect(r.headlineMisleads).toBe(true);
    expect(r.driver).toBe("charges");
  });

  it("does not cry wolf when the lowest rate genuinely wins", () => {
    const r = rec([
      offer({ id: "a", lender: "Low", ratePct: 9.0, processingFee: { mode: "flat", value: 5000 } }),
      offer({ id: "b", lender: "High", ratePct: 11.0, processingFee: { mode: "flat", value: 5000 } }),
    ]);

    expect(r.best.offer.lender).toBe("Low");
    expect(r.headlineMisleads).toBe(false);
    expect(r.driver).toBe("rate");
  });

  it("splits the gap into rate and charges, and the two account for it", () => {
    const r = rec([
      offer({ id: "a", lender: "A", ratePct: 9.0, processingFee: { mode: "flat", value: 2000 } }),
      offer({ id: "b", lender: "B", ratePct: 9.6, processingFee: { mode: "flat", value: 30000 } }),
    ]);

    expect(r.driver).toBe("both");
    expect(r.rateEffect).toBeGreaterThan(0);
    expect(r.chargesEffect).toBeGreaterThan(0);
    expect(r.rateEffect + r.chargesEffect).toBeCloseTo(r.aprGap, 6);
  });

  it("the fee waiver it quotes actually draws the runner-up level", () => {
    const offers = [
      offer({ id: "a", lender: "A", ratePct: 9.4, processingFee: { mode: "flat", value: 2000 } }),
      offer({ id: "b", lender: "B", ratePct: 9.3, processingFee: { mode: "flat", value: 28000 } }),
    ];
    const r = rec(offers);
    expect(r.feeWaiverToMatch).not.toBeNull();

    // Re-price the runner-up with the waiver applied and confirm the APRs meet.
    const waived = r.runnerUp.derived.upfrontFees - (r.feeWaiverToMatch as number);
    const repriced = computeOffer({
      ...r.runnerUp.offer,
      processingFee: { mode: "flat", value: waived },
      gstPct: 0,
      otherFees: [],
    });

    expect(repriced.effectiveAprPct).toBeCloseTo(
      r.best.derived.effectiveAprPct as number,
      4,
    );
  });

  it("reports no waiver when the rate alone already loses", () => {
    const r = rec([
      offer({ id: "a", lender: "A", ratePct: 9.0, processingFee: { mode: "flat", value: 0 } }),
      offer({ id: "b", lender: "B", ratePct: 12.0, processingFee: { mode: "flat", value: 0 } }),
    ]);

    // B carries no charges to give up, so no waiver can close a 3-point gap.
    expect(r.feeWaiverToMatch).toBeNull();
    expect(r.rateCutToMatch).toBeGreaterThan(2.5);
  });

  it("the rate cut it quotes actually draws the runner-up level", () => {
    const r = rec([
      offer({ id: "a", lender: "A", ratePct: 9.0, processingFee: { mode: "flat", value: 5000 } }),
      offer({ id: "b", lender: "B", ratePct: 10.2, processingFee: { mode: "flat", value: 5000 } }),
    ]);
    expect(r.rateCutToMatch).not.toBeNull();

    const repriced = computeOffer({
      ...r.runnerUp.offer,
      ratePct: r.runnerUp.offer.ratePct - (r.rateCutToMatch as number),
    });
    expect(repriced.effectiveAprPct).toBeCloseTo(
      r.best.derived.effectiveAprPct as number,
      4,
    );
  });

  it("calls a dead heat too close and offers no levers", () => {
    const r = rec([
      offer({ id: "a", lender: "A", ratePct: 9.5 }),
      offer({ id: "b", lender: "B", ratePct: 9.5 }),
    ]);

    expect(r.aprGap).toBeLessThan(TOO_CLOSE_APR_GAP);
    expect(r.tooClose).toBe(true);
    expect(r.feeWaiverToMatch).toBeNull();
    expect(r.rateCutToMatch).toBeNull();
    expect(r.headlineMisleads).toBe(false);
  });

  it("holds up across differing amounts, where charge load matters not rupees", () => {
    const r = rec([
      offer({ id: "a", lender: "Small", amount: 500000, ratePct: 9.4, processingFee: { mode: "flat", value: 5000 } }),
      offer({ id: "b", lender: "Large", amount: 2500000, ratePct: 9.4, processingFee: { mode: "flat", value: 25000 } }),
    ]);

    // Same rate, same 1% charge load — neither should run away with it.
    expect(r.aprGap).toBeLessThan(0.01);
    expect(r.tooClose).toBe(true);
  });

  it("treats a flat quote on its reducing equivalent when judging the headline", () => {
    const r = rec([
      offer({ id: "a", lender: "Reducing", ratePct: 9.5 }),
      offer({ id: "b", lender: "Flat", ratePct: 5.5, rateType: "flat" }),
    ]);

    // 5.5% flat is ~10% reducing, so the lower-looking number must not be
    // credited as the lowest rate.
    expect(r.best.offer.lender).toBe("Reducing");
    expect(r.headlineMisleads).toBe(false);
  });
});
