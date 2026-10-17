import { indianFinancialYear, validateDate } from "./dates";
import { MAX_SCHEDULE_MONTHS, MAX_SCHEDULE_RUPEES } from "./cashflows";
import { assessAnnualRouteFromContext, type AnnualContextAdapterInput } from "./annual-context-adapter";
import type { AnnualRouteDeltaAssessment } from "./annual-ordinary-tax";

export interface AccrualInvestmentInterval {
  readonly startDate: string;
  readonly endDate: string;
  /** Gross rate for this explicit credit interval, as a decimal. */
  readonly grossInterestRate: number;
  /** Scenario factor for fixed-factor mode; annual mode uses normalized contexts instead. */
  readonly effectiveTaxFactor?: number;
  readonly interestDisposition: "reinvest" | "retain-cash";
}

export interface AccrualInvestmentContribution {
  readonly id: string;
  readonly date: string;
  readonly amount: number;
}

export interface AccrualInvestmentRow {
  readonly startDate: string;
  readonly endDate: string;
  /** Invested balance before the contribution at startDate. */
  readonly openingBalance: number;
  /** Contributions at startDate are applied before this interval's interest. */
  readonly contribution: number;
  readonly grossInterest: number;
  readonly tax: number;
  /** Gross interest after the explicit tax settlement. */
  readonly netInterest: number;
  /** Invested balance after this interval, before any end/horizon contribution. */
  readonly closingBalance: number;
  /** Annual-assessment provenance when annual tax mode is selected. */
  readonly annualTaxAudit?: AccrualAnnualTaxCreditAudit;
}

export interface AccrualAnnualTaxCreditAudit {
  readonly financialYear: string;
  readonly cumulativeGrossInterest: number;
  readonly previousAnnualInvestmentTaxCost: number;
  readonly annualInvestmentTaxCost: number;
  readonly incrementalTax: number;
  readonly sourceVersion: string;
  readonly assessment: AnnualRouteDeltaAssessment;
}

export type AccrualAnnualTaxContext = Omit<AnnualContextAdapterInput, "routeOrdinaryInvestmentIncome">;

export interface AccrualInvestmentLedger {
  readonly rows: readonly AccrualInvestmentRow[];
  readonly horizonDate: string;
  readonly horizonContribution: number;
  readonly totalContributions: number;
  readonly totalGrossInterest: number;
  readonly totalTax: number;
  readonly terminalInvestedBalance: number;
  readonly retainedCash: number;
  readonly totalAssets: number;
  readonly financiallySupported: false;
  readonly financialReviewRequired: true;
  readonly methodologyReviewed: false;
}

export type AccrualInvestmentUnsupportedReason =
  | "missing-tax-settlement"
  | "off-grid-contribution"
  | "annual-tax-context-missing"
  | "annual-tax-context-unsupported"
  | "insufficient-interest-for-tax";

export type AccrualInvestmentResult =
  | { readonly kind: "ok"; readonly value: AccrualInvestmentLedger }
  | { readonly kind: "unsupported"; readonly reason: AccrualInvestmentUnsupportedReason; readonly id?: string; readonly date?: string; readonly cause?: string }
  | { readonly kind: "invalid"; readonly reason: string; readonly id?: string; readonly date?: string };

function finiteMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SCHEDULE_RUPEES;
}

function invalid(reason: string, details: { id?: string; date?: string } = {}): AccrualInvestmentResult {
  return { kind: "invalid", reason, ...details };
}

function taxYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * Accumulate ordinary interest only at the caller's explicit credit dates.
 * This is arithmetic for a reviewed event schedule, not a TDS, filing, or
 * legal payment-timing decision.
 */
export function buildAccrualInvestmentLedger(input: {
  readonly intervals: readonly AccrualInvestmentInterval[];
  readonly contributions: readonly AccrualInvestmentContribution[];
  readonly taxSettlement: "settled-from-interest-at-credit";
  readonly annualTaxContexts?: readonly AccrualAnnualTaxContext[];
}): AccrualInvestmentResult {
  if (!input || typeof input !== "object" || !Array.isArray(input.intervals) || !Array.isArray(input.contributions)) {
    return invalid("invalid-accrual-input");
  }
  if (input.taxSettlement !== "settled-from-interest-at-credit") return { kind: "unsupported", reason: "missing-tax-settlement" };
  if (input.intervals.length === 0 || input.intervals.length > MAX_SCHEDULE_MONTHS) return invalid("invalid-intervals");
  const annualMode = input.annualTaxContexts !== undefined;
  const contextByTaxYear = new Map<string, AccrualAnnualTaxContext>();
  if (annualMode) {
    if (!Array.isArray(input.annualTaxContexts) || input.annualTaxContexts.length === 0) return invalid("invalid-annual-tax-contexts");
    for (const context of input.annualTaxContexts) {
      if (!context || typeof context !== "object" || typeof context.taxYear !== "string" || context.taxYear.length === 0) return invalid("invalid-annual-tax-context");
      if (contextByTaxYear.has(context.taxYear)) return invalid("duplicate-annual-tax-context", { date: context.taxYear });
      contextByTaxYear.set(context.taxYear, context);
    }
  }

  const boundaryDates = new Set<string>();
  let previousEnd = "";
  for (let index = 0; index < input.intervals.length; index += 1) {
    const interval = input.intervals[index];
    if (!interval || typeof interval !== "object") return invalid("invalid-interval", {});
    if (typeof interval.startDate !== "string" || typeof interval.endDate !== "string") return invalid("invalid-interval-date");
    try { validateDate(interval.startDate); validateDate(interval.endDate); } catch { return invalid("invalid-interval-date", { date: interval.startDate }); }
    if (interval.startDate >= interval.endDate) return invalid("non-positive-interval", { date: interval.startDate });
    if (index > 0 && interval.startDate !== previousEnd) return invalid("non-contiguous-interval", { date: interval.startDate });
    if (!Number.isFinite(interval.grossInterestRate) || interval.grossInterestRate < 0) return invalid("invalid-interest-rate", { date: interval.startDate });
    if ((annualMode && interval.effectiveTaxFactor !== undefined) || (!annualMode && interval.effectiveTaxFactor === undefined) || (interval.effectiveTaxFactor !== undefined && (!Number.isFinite(interval.effectiveTaxFactor) || interval.effectiveTaxFactor < 0 || interval.effectiveTaxFactor > 1))) return invalid(annualMode ? "mixed-tax-mode" : "invalid-tax-factor", { date: interval.startDate });
    if (interval.interestDisposition !== "reinvest" && interval.interestDisposition !== "retain-cash") return invalid("invalid-interest-disposition", { date: interval.startDate });
    boundaryDates.add(interval.startDate);
    boundaryDates.add(interval.endDate);
    previousEnd = interval.endDate;
  }

  const contributionsByDate = new Map<string, number>();
  const ids = new Set<string>();
  let totalContributions = 0;
  for (const contribution of input.contributions) {
    if (!contribution || typeof contribution !== "object" || typeof contribution.id !== "string" || contribution.id.length === 0) return invalid("invalid-contribution");
    if (ids.has(contribution.id)) return invalid("duplicate-contribution-id", { id: contribution.id });
    ids.add(contribution.id);
    if (typeof contribution.date !== "string") return invalid("invalid-contribution-date", { id: contribution.id });
    try { validateDate(contribution.date); } catch { return invalid("invalid-contribution-date", { id: contribution.id, date: contribution.date }); }
    if (!boundaryDates.has(contribution.date)) return { kind: "unsupported", reason: "off-grid-contribution", id: contribution.id, date: contribution.date };
    if (!finiteMoney(contribution.amount)) return invalid("invalid-contribution-amount", { id: contribution.id, date: contribution.date });
    const dateTotal = (contributionsByDate.get(contribution.date) ?? 0) + contribution.amount;
    if (!finiteMoney(dateTotal)) return invalid("nonfinite-contribution-total", { date: contribution.date });
    contributionsByDate.set(contribution.date, dateTotal);
    totalContributions += contribution.amount;
    if (!finiteMoney(totalContributions)) return invalid("nonfinite-contribution-total", { date: contribution.date });
  }

  const rows: AccrualInvestmentRow[] = [];
  let balance = 0;
  let retainedCash = 0;
  let totalGrossInterest = 0;
  let totalTax = 0;
  const cumulativeGrossInterestByTaxYear = new Map<string, number>();
  const annualTaxCostByTaxYear = new Map<string, number>();
  for (const interval of input.intervals) {
    const contribution = contributionsByDate.get(interval.startDate) ?? 0;
    const interestBase = balance + contribution;
    if (!finiteMoney(balance) || !finiteMoney(interestBase)) return invalid("invalid-balance", { date: interval.startDate });
    const grossInterest = interestBase * interval.grossInterestRate;
    if (!finiteMoney(grossInterest)) return invalid("invalid-gross-interest", { date: interval.endDate });
    let tax = 0;
    let annualTaxAudit: AccrualAnnualTaxCreditAudit | undefined;
    if (annualMode) {
      const financialYear = taxYearLabel(indianFinancialYear(interval.endDate));
      const context = contextByTaxYear.get(financialYear);
      if (!context) return { kind: "unsupported", reason: "annual-tax-context-missing", date: interval.endDate };
      const cumulativeGrossInterest = (cumulativeGrossInterestByTaxYear.get(financialYear) ?? 0) + grossInterest;
      if (!finiteMoney(cumulativeGrossInterest)) return invalid("nonfinite-annual-interest", { date: interval.endDate });
      const assessed = assessAnnualRouteFromContext({ ...context, routeOrdinaryInvestmentIncome: cumulativeGrossInterest });
      if (assessed.kind === "unsupported") return { kind: "unsupported", reason: "annual-tax-context-unsupported", cause: assessed.reason, date: interval.endDate };
      if (assessed.kind === "invalid") return invalid(`annual-tax-${assessed.reason}`, { date: interval.endDate });
      const previousAnnualInvestmentTaxCost = annualTaxCostByTaxYear.get(financialYear) ?? 0;
      const annualInvestmentTaxCost = assessed.value.assessment.investmentTaxCost;
      const incrementalTax = annualInvestmentTaxCost - previousAnnualInvestmentTaxCost;
      if (!Number.isFinite(incrementalTax) || incrementalTax < -Number.EPSILON || incrementalTax > MAX_SCHEDULE_RUPEES) return invalid("invalid-annual-tax-increment", { date: interval.endDate });
      tax = Math.max(0, incrementalTax);
      cumulativeGrossInterestByTaxYear.set(financialYear, cumulativeGrossInterest);
      annualTaxCostByTaxYear.set(financialYear, annualInvestmentTaxCost);
      annualTaxAudit = {
        financialYear,
        cumulativeGrossInterest,
        previousAnnualInvestmentTaxCost,
        annualInvestmentTaxCost,
        incrementalTax: tax,
        sourceVersion: assessed.value.assessment.sourceVersion,
        assessment: assessed.value.assessment,
      };
    } else {
      tax = grossInterest * (interval.effectiveTaxFactor ?? 0);
    }
    const netInterestBeforeFloor = grossInterest - tax;
    if (annualMode && netInterestBeforeFloor < -Number.EPSILON) return { kind: "unsupported", reason: "insufficient-interest-for-tax", date: interval.endDate };
    // Fixed-factor mode retains its existing invalid settlement behavior for
    // an over-large factor; annual mode reports the explicit unsupported case
    // above because tax is settled from that credit's interest only.
    const netInterest = annualMode ? Math.max(0, netInterestBeforeFloor) : netInterestBeforeFloor;
    if (!finiteMoney(tax) || !finiteMoney(netInterest)) return invalid("invalid-interest-settlement", { date: interval.endDate });
    const closingBalance = interval.interestDisposition === "reinvest" ? interestBase + netInterest : interestBase;
    if (!finiteMoney(closingBalance)) return invalid("invalid-closing-balance", { date: interval.endDate });
    if (interval.interestDisposition === "retain-cash") retainedCash += netInterest;
    totalGrossInterest += grossInterest;
    totalTax += tax;
    if (![retainedCash, totalGrossInterest, totalTax].every(finiteMoney)) return invalid("nonfinite-ledger-total", { date: interval.endDate });
    rows.push({ startDate: interval.startDate, endDate: interval.endDate, openingBalance: balance, contribution, grossInterest, tax, netInterest, closingBalance, ...(annualTaxAudit ? { annualTaxAudit } : {}) });
    balance = closingBalance;
  }
  const horizonDate = input.intervals[input.intervals.length - 1].endDate;
  const horizonContribution = contributionsByDate.get(horizonDate) ?? 0;
  const terminalInvestedBalance = balance + horizonContribution;
  const totalAssets = terminalInvestedBalance + retainedCash;
  if (![terminalInvestedBalance, totalAssets].every(Number.isFinite) || !finiteMoney(terminalInvestedBalance) || !finiteMoney(totalAssets)) return invalid("invalid-terminal-balance", { date: horizonDate });
  return {
    kind: "ok",
    value: {
      rows,
      horizonDate,
      horizonContribution,
      totalContributions,
      totalGrossInterest,
      totalTax,
      terminalInvestedBalance,
      retainedCash,
      totalAssets,
      financiallySupported: false,
      financialReviewRequired: true,
      methodologyReviewed: false,
    },
  };
}
