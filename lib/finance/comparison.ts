import { computeOffer } from "./compute";
import { LOAN_TYPES } from "./loanTypes";
import type { Derived, Offer, Warning } from "./types";

export interface ComparisonBasis {
  amountsDiffer: boolean;
  tenuresDiffer: boolean;
  rateTypesDiffer: boolean;
  loanTypesDiffer: boolean;
  /**
   * True when the offers are not like-for-like, so raw total interest must not
   * be used to pick a winner. This is the whole point of the flow: a 30-year
   * loan always shows more total interest than a 10-year one, even when it is
   * unambiguously the cheaper money.
   */
  strict: boolean;
}

export interface RankedOffer {
  offer: Offer;
  derived: Derived;
  rank: number;
  isBest: boolean;
  /** Percentage points of effective APR above the best offer. */
  aprGapVsBest: number | null;
  /** Rupees of total borrowing cost above the best offer. */
  costGapVsBest: number;
  /** Rupees of cost per lakh above the best offer. */
  perLakhGapVsBest: number;
}

export interface Comparison {
  rows: RankedOffer[];
  basis: ComparisonBasis;
  best: RankedOffer | null;
  notices: Warning[];
  /**
   * Set when ranking by effective APR disagrees with ranking by rupees spent.
   * Happens when one offer front-loads its cost into fees.
   */
  aprCostDisagreement: boolean;
}

function allSame<T>(values: T[]): boolean {
  return values.every((value) => value === values[0]);
}

export function compareOffers(offers: Offer[]): Comparison {
  const priced = offers.map((offer) => ({ offer, derived: computeOffer(offer) }));

  const basis: ComparisonBasis = {
    amountsDiffer: !allSame(priced.map((p) => p.offer.amount)),
    tenuresDiffer: !allSame(priced.map((p) => p.derived.tenureMonths)),
    rateTypesDiffer: !allSame(priced.map((p) => p.offer.rateType)),
    loanTypesDiffer: !allSame(priced.map((p) => p.offer.loanType)),
    strict: false,
  };
  basis.strict = basis.amountsDiffer || basis.tenuresDiffer;

  // --- Rank on effective APR, because it is the only metric that survives
  // differing amounts and tenures. Cost per lakh breaks ties.
  const sorted = [...priced].sort((a, b) => {
    const aApr = a.derived.effectiveAprPct;
    const bApr = b.derived.effectiveAprPct;
    if (aApr === null && bApr === null) return a.derived.costPerLakh - b.derived.costPerLakh;
    if (aApr === null) return 1;
    if (bApr === null) return -1;
    if (Math.abs(aApr - bApr) > 1e-9) return aApr - bApr;
    return a.derived.costPerLakh - b.derived.costPerLakh;
  });

  const bestDerived = sorted[0]?.derived;

  const rows: RankedOffer[] = sorted.map((entry, index) => ({
    offer: entry.offer,
    derived: entry.derived,
    rank: index + 1,
    isBest: index === 0,
    aprGapVsBest:
      entry.derived.effectiveAprPct !== null && bestDerived?.effectiveAprPct != null
        ? entry.derived.effectiveAprPct - bestDerived.effectiveAprPct
        : null,
    costGapVsBest: entry.derived.totalCostOfBorrowing - (bestDerived?.totalCostOfBorrowing ?? 0),
    perLakhGapVsBest: entry.derived.costPerLakh - (bestDerived?.costPerLakh ?? 0),
  }));

  // --- Would ranking by rupees spent have picked someone else?
  const cheapestByRupees = [...priced].sort(
    (a, b) => a.derived.totalCostOfBorrowing - b.derived.totalCostOfBorrowing,
  )[0];
  const aprCostDisagreement =
    !basis.strict &&
    priced.length > 1 &&
    cheapestByRupees !== undefined &&
    sorted[0] !== undefined &&
    cheapestByRupees.offer.id !== sorted[0].offer.id;

  const notices: Warning[] = [];

  if (basis.tenuresDiffer) {
    const tenures = priced.map((p) => p.derived.tenureMonths);
    const min = Math.min(...tenures);
    const max = Math.max(...tenures);
    notices.push({
      level: "caution",
      code: "tenures-differ",
      message: `Tenures differ (${monthsLabel(min)} vs ${monthsLabel(max)}). The longer loan will always show more total interest, so these are ranked on effective APR and cost per lakh instead.`,
    });
  }

  if (basis.amountsDiffer) {
    notices.push({
      level: "caution",
      code: "amounts-differ",
      message:
        "Loan amounts differ, so total interest is not comparable between these offers. Cost per lakh puts them on one footing.",
    });
  }

  if (basis.rateTypesDiffer) {
    notices.push({
      level: "info",
      code: "rate-types-differ",
      message:
        "One of these is quoted on a flat rate. It has been converted to its reducing-balance equivalent so the comparison is like-for-like.",
    });
  }

  if (basis.loanTypesDiffer) {
    const labels = Array.from(new Set(priced.map((p) => LOAN_TYPES[p.offer.loanType].short)));
    notices.push({
      level: "info",
      code: "loan-types-differ",
      message: `You are comparing different products (${labels.join(", ")}). Prepayment rules and tax treatment differ between them.`,
    });
  }

  if (aprCostDisagreement && cheapestByRupees) {
    notices.push({
      level: "info",
      code: "apr-cost-split",
      message: `${labelFor(cheapestByRupees.offer)} costs fewer rupees overall, but ${labelFor(sorted[0].offer)} wins on effective APR because less of its cost is paid upfront. Ranking follows APR.`,
    });
  }

  return {
    rows,
    basis,
    best: rows[0] ?? null,
    notices,
    aprCostDisagreement,
  };
}

export function labelFor(offer: Offer, index?: number): string {
  const trimmed = offer.lender.trim();
  if (trimmed) return trimmed;
  return index !== undefined ? `Offer ${index + 1}` : "This offer";
}

export function monthsLabel(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} ${years === 1 ? "year" : "years"}`;
  }
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years}y ${rest}m`;
}
