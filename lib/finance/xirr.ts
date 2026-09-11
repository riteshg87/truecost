/**
 * IRR over evenly spaced monthly cash flows.
 *
 * For a loan, flows[0] is the cash the borrower actually receives (positive)
 * and flows[1..n] are the instalments paid out (negative). Because every fee,
 * GST rupee and financed premium moves one of those numbers, the IRR is the
 * only figure that ranks offers honestly — headline rate and total interest
 * both miss money that changes hands at disbursal.
 */

const MAX_RATE = 10; // 1000% per month — a bracket, not a plausible answer.
const MIN_RATE = -0.999999;

export function npv(monthlyRate: number, flows: number[]): number {
  let acc = 0;
  for (let i = 0; i < flows.length; i++) {
    acc += flows[i] / Math.pow(1 + monthlyRate, i);
  }
  return acc;
}

function npvDerivative(monthlyRate: number, flows: number[]): number {
  let acc = 0;
  for (let i = 1; i < flows.length; i++) {
    acc -= (i * flows[i]) / Math.pow(1 + monthlyRate, i + 1);
  }
  return acc;
}

/**
 * Newton-Raphson with a bisection fallback.
 *
 * Newton converges in a handful of iterations on well-behaved loan flows, but
 * it can shoot outside the valid domain on degenerate input (zero-interest
 * offers, fee-free loans). Bisection cannot fail once the root is bracketed,
 * so we always establish a bracket first and fall back to it.
 */
export function monthlyIrr(flows: number[]): number | null {
  if (flows.length < 2) return null;
  const hasPositive = flows.some((f) => f > 0);
  const hasNegative = flows.some((f) => f < 0);
  if (!hasPositive || !hasNegative) return null;

  // --- Newton first, from a sensible retail-loan starting point.
  let rate = 0.01;
  for (let i = 0; i < 60; i++) {
    const value = npv(rate, flows);
    if (Math.abs(value) < 1e-9) return rate;
    const slope = npvDerivative(rate, flows);
    if (!isFinite(slope) || slope === 0) break;
    const next = rate - value / slope;
    if (!isFinite(next) || next <= MIN_RATE || next > MAX_RATE) break;
    if (Math.abs(next - rate) < 1e-12) return next;
    rate = next;
  }

  // --- Bracket, then bisect.
  let lo = MIN_RATE;
  let hi = MAX_RATE;
  let fLo = npv(lo, flows);
  let fHi = npv(hi, flows);

  if (fLo * fHi > 0) {
    // Scan for a sign change if the wide bracket does not straddle the root.
    let found = false;
    let prevRate = MIN_RATE;
    let prevValue = fLo;
    for (let step = 1; step <= 400; step++) {
      const probe = MIN_RATE + (step / 400) * (MAX_RATE - MIN_RATE);
      const value = npv(probe, flows);
      if (isFinite(value) && prevValue * value <= 0) {
        lo = prevRate;
        hi = probe;
        fLo = prevValue;
        fHi = value;
        found = true;
        break;
      }
      prevRate = probe;
      prevValue = value;
    }
    if (!found) return null;
  }

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const value = npv(mid, flows);
    if (Math.abs(value) < 1e-9) return mid;
    if (fLo * value <= 0) {
      hi = mid;
      fHi = value;
    } else {
      lo = mid;
      fLo = value;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Nominal annualisation: monthly IRR x 12.
 *
 * This is the headline APR. A loan quoted at 10% with no fees comes back as
 * exactly 10.00%, which is what makes the number trustworthy to a borrower
 * holding a sanction letter — and it is the convention RBI's Key Facts
 * Statement uses. Ranking is unaffected either way, since annualisation is
 * monotonic in the monthly rate.
 */
export function nominalAnnualPct(monthlyRate: number): number {
  return monthlyRate * 12 * 100;
}

/** Compounded annualisation: what a rupee actually costs over a year. */
export function effectiveAnnualPct(monthlyRate: number): number {
  return (Math.pow(1 + monthlyRate, 12) - 1) * 100;
}

export interface AprResult {
  monthlyIrr: number;
  /** Headline APR, directly comparable to the rate the lender quoted. */
  aprPct: number;
  /** Same cash flows, compounded monthly. Always the larger of the two. */
  effectiveAnnualPct: number;
}

/** Solve a monthly cash flow series into both annualisations, or null. */
export function aprFor(flows: number[]): AprResult | null {
  const monthly = monthlyIrr(flows);
  if (monthly === null || !isFinite(monthly)) return null;
  const apr = nominalAnnualPct(monthly);
  const effective = effectiveAnnualPct(monthly);
  if (!isFinite(apr) || !isFinite(effective)) return null;
  return { monthlyIrr: monthly, aprPct: apr, effectiveAnnualPct: effective };
}
