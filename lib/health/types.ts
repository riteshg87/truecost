/**
 * The loan you keep, rather than the loan you calculate once.
 *
 * Flow 1 prices offers you are choosing between. This is the one you already
 * signed: a record held on the device that gets re-read against the published
 * benchmark every time you return, so a rate that quietly failed to reset has
 * somewhere to show up.
 */

/** What the rate is pegged to, which decides whether a reset is even owed. */
export type RateBasis = "repo" | "tbill" | "mclr" | "fixed";

/** How often the lender is obliged to re-price an external-benchmark loan. */
export type ResetCycle = "monthly" | "quarterly" | "half";

export interface LoanRecord {
  lender: string;
  /** Sanctioned principal, kept so progress means something. */
  original: number;
  outstanding: number;
  ratePct: number;
  basis: RateBasis;
  /** Margin over the benchmark, fixed for the life of the loan. */
  spreadPct: number;
  cycle: ResetCycle;
  /** ISO date of the last re-pricing, from the statement. */
  lastReset: string;
  monthsLeft: number;
}

export type RateVerdictKind = "stale" | "ontrack" | "mclr" | "fixed" | "unknown";

export interface RateVerdict {
  kind: RateVerdictKind;
  tone: "good" | "warn" | "neutral";
  /** Monthly instalment implied by the record. */
  emi: number;
  /** Benchmark on the day of the last reset, and today. Null off-benchmark. */
  repoThen: number | null;
  repoNow: number | null;
  /** Benchmark today plus the spread. What the rate ought to be. */
  shouldBePct: number | null;
  /** Percentage points being paid above that. Positive means stale. */
  gapPct: number | null;
  /** Rupees a month attributable to the gap. */
  monthlyExcess: number | null;
  /** True once a reset is overdue by the loan's own cycle. */
  resetOverdue: boolean;
}

export interface TransferQuote {
  newRatePct: number;
  /** Percent of the outstanding, before GST. */
  feePct: number;
  legalCharges: number;
  /** Keep the term you have, or restart on a fresh one. */
  keepTenure: boolean;
  newTenureMonths: number;
}

export interface TransferResult {
  emiNow: number;
  emiNew: number;
  monthlySaving: number;
  processingFee: number;
  gst: number;
  costToSwitch: number;
  /** Month the saving overtakes the cost. Null when it never does. */
  breakEvenMonth: number | null;
  /** Measured over the tenure you hold now, so a longer term cannot flatter. */
  netSaving: number;
  interestNow: number;
  interestNew: number;
  worthIt: boolean;
  lengthened: boolean;
}
