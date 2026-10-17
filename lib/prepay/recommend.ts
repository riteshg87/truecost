import {
  ASSET_PRESETS,
  EQUITY_LTCG_PCT,
  effectiveSlabPct,
  loanTaxBreakdown,
  type LoanTaxBreakdown,
} from "./tax";
import { computePrepay } from "./compute";
import type { AssetClass, PrepayInput, PrepayScenarios } from "./types";

/**
 * The verdict.
 *
 * Three things have to happen in order, and the order is the point.
 *
 * First the liquidity gate. Prepaying converts cash into a lower balance, and a
 * balance cannot be spent in an emergency. Someone who empties their buffer to
 * save interest has bought a good rate with a bad risk, and no arithmetic about
 * post-tax spreads should be allowed to argue them into it.
 *
 * Then the comparison, post-tax on both sides. Prepaying returns the loan's own
 * cost, guaranteed and immediately. Investing returns whatever the market gives.
 *
 * Then the risk premium. A guaranteed 8% and an expected 8% are not the same
 * offer, so equity has to clear the loan by a real margin before it is the
 * better call rather than merely the higher number.
 */

/** Below this many months of expenses, nothing else in this file matters. */
export const MIN_BUFFER_MONTHS = 6;

/**
 * How far an expected return must beat a guaranteed one before it wins.
 *
 * An FD is contractual, so almost nothing is owed to risk. Equity is a long-run
 * average that can be negative for years at a stretch, and a borrower who
 * prepaid is never exposed to that.
 */
export const RISK_PREMIUM_PCT: Record<AssetClass, number> = {
  fd: 0.25,
  debt: 0.75,
  equity: 2,
};

export type Verdict = "build-buffer" | "prepay" | "invest" | "line-ball";

export interface PrepayRecommendation {
  verdict: Verdict;
  scenarios: PrepayScenarios;
  tax: LoanTaxBreakdown;

  /** What the loan really costs, after any deduction. The guaranteed return. */
  postTaxLoanCostPct: number;
  /** What the investment really returns, after its own tax. */
  postTaxReturnPct: number;
  /** Return less cost. Positive means investing is ahead before risk is priced. */
  advantagePct: number;
  requiredPremiumPct: number;

  /** Pre-tax return the investment must make before investing is the better call. */
  crossoverPct: number;
  /** Whether the expected return is contractual or merely hoped for. */
  guaranteed: boolean;

  /** Which of the three deployments ends richest at the horizon. */
  bestByWealth: "tenure" | "emi" | "invest";
  /** Rupees between the best route and investing, at the horizon. */
  wealthGapVsInvest: number;

  /** Set when the fee is large enough to decide the answer on its own. */
  feeDecisive: boolean;

  /**
   * True when cutting the EMI ends richer than cutting the tenure.
   *
   * Counter-intuitive and real: the tenure route always kills more interest,
   * but it frees a large sum only in the last few months, where it barely
   * compounds. The EMI route frees a small sum from the very first month and
   * compounds it for the whole remaining term. Above a certain return the
   * second beats the first.
   *
   * It holds only if the freed instalment is genuinely invested every month.
   * Money that quietly becomes spending is why reduce-tenure remains the
   * default: it is forced saving, and it cannot be skipped.
   */
  emiRouteEndsRicher: boolean;
  liquidityMonthsAfter: number | null;
}

/** Tax drag on the investment side, which differs by what it is invested in. */
function returnDragPct(assetClass: AssetClass, slabPct: number): number {
  return assetClass === "equity" ? EQUITY_LTCG_PCT : effectiveSlabPct(slabPct);
}

export function recommendPrepay(input: PrepayInput): PrepayRecommendation {
  const scenarios = computePrepay(input);
  const emi = scenarios.noPrepay.emi;
  const tax = loanTaxBreakdown(input, emi);

  const postTaxLoanCostPct = tax.postTaxCostPct;
  const postTaxReturnPct = scenarios.investInstead.postTaxReturnPct;
  const advantagePct = postTaxReturnPct - postTaxLoanCostPct;
  const requiredPremiumPct = RISK_PREMIUM_PCT[input.assetClass];

  // The pre-tax return at which investing starts to deserve the risk.
  const drag = returnDragPct(input.assetClass, input.taxSlabPct) / 100;
  const crossoverPct =
    drag >= 1 ? Infinity : (postTaxLoanCostPct + requiredPremiumPct) / (1 - drag);

  /* --- Which route actually ends richest ---------------------------------- */
  const wealth = {
    tenure: scenarios.reduceTenure.terminalWealth,
    emi: scenarios.reduceEmi.terminalWealth,
    invest: scenarios.investInstead.terminalWealth,
  };
  const bestPrepay: "tenure" | "emi" =
    wealth.tenure >= wealth.emi ? "tenure" : "emi";
  const emiRouteEndsRicher = wealth.emi > wealth.tenure;
  const bestByWealth: "tenure" | "emi" | "invest" =
    wealth[bestPrepay] >= wealth.invest ? bestPrepay : "invest";
  const wealthGapVsInvest = wealth[bestPrepay] - wealth.invest;

  /* --- Did the fee decide it? --------------------------------------------- */
  // Re-run with the fee removed; if the winner changes, the charge is the
  // whole story and deserves saying out loud.
  const feeDecisive =
    scenarios.fee > 0 &&
    (() => {
      const free = computePrepay({ ...input, prepayFeePct: 0, otherFees: 0 });
      const freeBest = Math.max(
        free.reduceTenure.terminalWealth,
        free.reduceEmi.terminalWealth,
      );
      const withFeeWins = wealth[bestPrepay] >= wealth.invest;
      const withoutFeeWins = freeBest >= free.investInstead.terminalWealth;
      return withoutFeeWins && !withFeeWins;
    })();

  /* --- Verdict, gates first ----------------------------------------------- */
  const liquidityMonthsAfter = input.liquidityMonthsAfter;
  const liquidityBlocked =
    liquidityMonthsAfter !== null && liquidityMonthsAfter < MIN_BUFFER_MONTHS;

  let verdict: Verdict;
  if (liquidityBlocked) {
    verdict = "build-buffer";
  } else if (advantagePct >= requiredPremiumPct) {
    verdict = "invest";
  } else if (advantagePct <= 0) {
    verdict = "prepay";
  } else {
    verdict = "line-ball";
  }

  return {
    verdict,
    scenarios,
    tax,
    postTaxLoanCostPct,
    postTaxReturnPct,
    advantagePct,
    requiredPremiumPct,
    crossoverPct,
    guaranteed: ASSET_PRESETS[input.assetClass].guaranteed,
    bestByWealth,
    wealthGapVsInvest,
    feeDecisive,
    emiRouteEndsRicher,
    liquidityMonthsAfter,
  };
}
