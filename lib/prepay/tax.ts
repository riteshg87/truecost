import type { AssetClass, AssetPreset, PrepayInput, TaxRegime } from "./types";

/**
 * Both sides of the decision, after tax.
 *
 * Comparing a loan rate to an expected return is the standard mistake. The loan
 * may be subsidised by a deduction; the return is certainly taxed, and taxed
 * differently depending on what it is invested in. Only after both are put
 * post-tax do the two numbers mean the same thing.
 */

/** Section 24(b): interest on a self-occupied property. */
export const CAP_24B = 200000;
/** Section 80C: principal repaid, sharing one cap with EPF, PPF, insurance. */
export const CAP_80C = 150000;

/** Health and education cess sits on top of the slab rate. */
export const CESS_PCT = 4;

export const SLAB_OPTIONS = [0, 5, 10, 15, 20, 30] as const;

/** The slab actually paid, cess included: 30% is really 31.2%. */
export function effectiveSlabPct(slabPct: number): number {
  return slabPct * (1 + CESS_PCT / 100);
}

export const ASSET_PRESETS: Record<AssetClass, AssetPreset> = {
  fd: {
    id: "fd",
    label: "Fixed deposit",
    returnPct: 7,
    guaranteed: true,
    note: "Contractual. Interest is added to income and taxed at your slab every year, which is what makes an FD a poor match for a deducted home loan.",
  },
  debt: {
    id: "debt",
    label: "Debt fund",
    returnPct: 8,
    guaranteed: false,
    note: "Expected, not promised. Since April 2023 gains are taxed at slab regardless of holding period, so the old indexation advantage is gone.",
  },
  equity: {
    id: "equity",
    label: "Equity",
    returnPct: 11,
    guaranteed: false,
    note: "A long-run average, not a return you can count on in any given year. Long-term gains are taxed at 12.5% above ₹1.25L, which is the lightest treatment here.",
  },
};

/** Long-term capital gains on listed equity. */
export const EQUITY_LTCG_PCT = 12.5;

/**
 * Expected return, after the tax that will actually be paid on it.
 *
 * Equity is taxed on realisation at a flat LTCG rate; FDs and debt funds are
 * taxed at slab. The ₹1.25L annual exemption on equity gains is ignored, which
 * understates equity slightly — a deliberate direction, since the alternative
 * is flattering the riskier asset.
 */
export function postTaxReturnPct(
  expectedReturnPct: number,
  assetClass: AssetClass,
  slabPct: number,
): number {
  if (!(expectedReturnPct > 0)) return 0;
  const drag =
    assetClass === "equity" ? EQUITY_LTCG_PCT : effectiveSlabPct(slabPct);
  return expectedReturnPct * (1 - drag / 100);
}

export interface LoanTaxBreakdown {
  /** Interest falling due over the next twelve months on the current balance. */
  annualInterest: number;
  annualPrincipal: number;
  deduction24b: number;
  deduction80c: number;
  annualTaxSaved: number;
  /** The rate the loan actually costs once the deduction is counted. */
  postTaxCostPct: number;
  /** True when no deduction applies, so the loan costs exactly what it says. */
  noShield: boolean;
}

/**
 * What the loan costs after tax.
 *
 * Worked in rupees over the coming year and converted back to a rate, rather
 * than by scaling the headline rate. The deductions are capped in rupees, so a
 * large loan gets relief on only part of its interest — a ₹80L loan at 8.5%
 * throws off ₹6.8L of interest against a ₹2L cap, and treating the whole thing
 * as deductible would overstate the subsidy threefold.
 */
export function loanTaxBreakdown(
  input: Pick<
    PrepayInput,
    "outstanding" | "ratePct" | "claims24b" | "claims80c" | "taxSlabPct" | "regime"
  >,
  emi: number,
): LoanTaxBreakdown {
  const annualInterest = Math.max(0, (input.outstanding * input.ratePct) / 100);
  const annualPrincipal = Math.max(0, emi * 12 - annualInterest);

  const eligible = input.regime === "old";
  const deduction24b =
    eligible && input.claims24b ? Math.min(annualInterest, CAP_24B) : 0;
  const deduction80c =
    eligible && input.claims80c ? Math.min(annualPrincipal, CAP_80C) : 0;

  const slab = effectiveSlabPct(input.taxSlabPct) / 100;
  const annualTaxSaved = (deduction24b + deduction80c) * slab;

  const netAnnualCost = Math.max(0, annualInterest - annualTaxSaved);
  const postTaxCostPct =
    input.outstanding > 0 ? (netAnnualCost / input.outstanding) * 100 : 0;

  return {
    annualInterest,
    annualPrincipal,
    deduction24b,
    deduction80c,
    annualTaxSaved,
    postTaxCostPct,
    noShield: annualTaxSaved <= 0,
  };
}

/** Whether a deduction is even available, before asking if it is claimed. */
export function deductionsAvailable(regime: TaxRegime): boolean {
  return regime === "old";
}
