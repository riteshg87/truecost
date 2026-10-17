import { computeOffer } from "./compute";
import type { Comparison, RankedOffer } from "./comparison";
import type { Offer } from "./types";

/**
 * What to actually tell someone once the ranking is settled.
 *
 * "This one is cheaper" is a result, not advice. The useful part is *why* it is
 * cheaper and *what would have to change* for the answer to flip — because the
 * rate on a sanction letter is close to fixed, while a processing fee is the
 * most negotiable number in Indian retail lending. A borrower who knows the
 * runner-up is losing on charges rather than on rate knows exactly what to ask
 * for, and exactly how much of it to ask for.
 *
 * Every figure here comes from re-running the real engine on a modified offer
 * rather than from an approximation, so the levers are honest: waive that fee
 * and the APRs really do meet.
 */

/** Below this the two are the same loan priced two ways. */
export const TOO_CLOSE_APR_GAP = 0.05;

export type GapDriver = "rate" | "charges" | "both" | "unclear";

export interface Recommendation {
  best: RankedOffer;
  runnerUp: RankedOffer;
  /** Percentage points of effective APR between them. Always >= 0. */
  aprGap: number;
  tooClose: boolean;

  /**
   * Points of the gap traceable to the quoted rate.
   *
   * Signed, and negative in the case worth catching: the runner-up holds the
   * better rate, loses on charges anyway, and its rate hands a little back.
   * rateEffect + chargesEffect always equals aprGap.
   */
  rateEffect: number;
  /** Points of the gap traceable to upfront charges. */
  chargesEffect: number;
  driver: GapDriver;

  /**
   * Rupees of upfront charges the runner-up must lose to draw level on APR.
   * Null when charges alone cannot close it — their rate is the problem.
   */
  feeWaiverToMatch: number | null;
  /** Percentage points the runner-up must cut from its rate to draw level. */
  rateCutToMatch: number | null;

  /**
   * True when the winner is not the offer with the lowest advertised rate —
   * the case the whole product exists to catch.
   */
  headlineMisleads: boolean;
}

function aprOf(offer: Offer): number | null {
  return computeOffer(offer).effectiveAprPct;
}

/** The same offer with its total upfront charges forced to an exact rupee figure. */
function withUpfrontCharges(offer: Offer, rupees: number): Offer {
  return {
    ...offer,
    processingFee: { mode: "flat", value: Math.max(0, rupees) },
    gstPct: 0,
    otherFees: [],
  };
}

/**
 * Smallest upfront-charge figure at which `offer` reaches `targetApr`.
 *
 * APR rises monotonically with upfront charges — every rupee deducted at
 * disbursal reduces what the borrower receives without reducing what they
 * repay — so bisection is safe. Returns null when even a full waiver leaves
 * them above the target.
 */
function chargesToReach(offer: Offer, targetApr: number, currentCharges: number): number | null {
  const floor = aprOf(withUpfrontCharges(offer, 0));
  if (floor === null || floor > targetApr + 1e-9) return null;

  let lo = 0;
  let hi = Math.max(currentCharges, 1);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const apr = aprOf(withUpfrontCharges(offer, mid));
    if (apr === null) break;
    if (apr > targetApr) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Percentage points of quoted rate `offer` must give up to reach `targetApr`. */
function rateCutToReach(offer: Offer, targetApr: number): number | null {
  if (!(offer.ratePct > 0)) return null;
  const floor = aprOf({ ...offer, ratePct: 0 });
  if (floor === null || floor > targetApr + 1e-9) return null;

  let lo = 0;
  let hi = offer.ratePct;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const apr = aprOf({ ...offer, ratePct: mid });
    if (apr === null) break;
    if (apr > targetApr) hi = mid;
    else lo = mid;
  }
  const matched = (lo + hi) / 2;
  return Math.max(0, offer.ratePct - matched);
}

export function recommend(comparison: Comparison): Recommendation | null {
  const best = comparison.rows[0];
  const runnerUp = comparison.rows[1];
  if (!best || !runnerUp) return null;

  const bestApr = best.derived.effectiveAprPct;
  const runnerApr = runnerUp.derived.effectiveAprPct;
  if (bestApr === null || runnerApr === null) return null;

  const aprGap = Math.max(0, runnerApr - bestApr);
  const tooClose = aprGap < TOO_CLOSE_APR_GAP;

  // --- Split the gap. Re-price the runner-up carrying the winner's charge load
  // (as a share of its own loan, so differing amounts stay fair). Whatever the
  // gap closes by was the charges; the rest is the rate.
  const bestChargeLoad =
    best.offer.amount > 0 ? best.derived.upfrontFees / best.offer.amount : 0;
  const matchedCharges = runnerUp.offer.amount * bestChargeLoad;
  const aprIfChargesMatched = aprOf(withUpfrontCharges(runnerUp.offer, matchedCharges));

  let chargesEffect = 0;
  if (aprIfChargesMatched !== null) {
    chargesEffect = Math.max(0, runnerApr - aprIfChargesMatched);
  }
  // Defined as the residual rather than clamped, so the two always reconcile to
  // the gap even when the rate is pulling the other way.
  const rateEffect = aprGap - chargesEffect;

  let driver: GapDriver = "unclear";
  if (aprGap > 0) {
    const chargeShare = chargesEffect / aprGap;
    if (chargeShare >= 0.7) driver = "charges";
    else if (chargeShare <= 0.3) driver = "rate";
    else driver = "both";
  }

  const feeWaiverToMatch = tooClose
    ? null
    : (() => {
        const target = chargesToReach(
          runnerUp.offer,
          bestApr,
          runnerUp.derived.upfrontFees,
        );
        if (target === null) return null;
        const waiver = runnerUp.derived.upfrontFees - target;
        return waiver > 1 ? waiver : null;
      })();

  const rateCutToMatch = tooClose ? null : rateCutToReach(runnerUp.offer, bestApr);

  // --- Does the lowest advertised rate win? Compare on the quoted figure,
  // reducing-equivalent so a flat quote is not flattered.
  const lowestQuoted = comparison.rows.reduce((a, b) =>
    a.derived.effectiveReducingRatePct <= b.derived.effectiveReducingRatePct ? a : b,
  );
  const headlineMisleads =
    !tooClose &&
    lowestQuoted.offer.id !== best.offer.id &&
    Math.abs(lowestQuoted.derived.effectiveReducingRatePct -
      best.derived.effectiveReducingRatePct) > 1e-9;

  return {
    best,
    runnerUp,
    aprGap,
    tooClose,
    rateEffect,
    chargesEffect,
    driver,
    feeWaiverToMatch,
    rateCutToMatch,
    headlineMisleads,
  };
}
