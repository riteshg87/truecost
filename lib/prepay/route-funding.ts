import { addCalendarMonths, validateDate } from "./dates";
import { MAX_SCHEDULE_MONTHS, MAX_SCHEDULE_RUPEES } from "./cashflows";
import type { DatedLoanSchedule, DatedLoanScheduleRow } from "./cashflows";

/** Inputs for one route under a common dated external budget. */
export interface EqualBudgetRouteFundingInput {
  /** Original date used to calculate each monthly anniversary. */
  readonly anchorDate: string;
  /** Includes anchorDate and at least one later monthly anniversary. */
  readonly horizonDates: readonly string[];
  readonly initialBudget: number;
  readonly monthlyBudget: number;
  readonly schedule: DatedLoanSchedule;
  /** A separate cash outlay on anchorDate, such as a prepayment fee. */
  readonly initialFee: number;
}

export interface RouteFundingEntry {
  readonly date: string;
  readonly externalBudget: number;
  readonly interest: number;
  readonly scheduledPrincipal: number;
  readonly scheduledPayment: number;
  readonly immediatePrincipal: number;
  readonly fee: number;
  readonly loanCashUse: number;
  readonly investmentContribution: number;
  readonly remainingDebt: number;
}

export interface RouteFundingTotals {
  readonly externalBudget: number;
  readonly investmentContribution: number;
  readonly loanCashUse: number;
  readonly interest: number;
  readonly scheduledPrincipal: number;
  readonly immediatePrincipal: number;
  readonly fees: number;
}

export interface EqualBudgetRouteFunding {
  readonly entries: readonly RouteFundingEntry[];
  readonly totals: RouteFundingTotals;
  /** This is reported for valuation; this helper makes no terminal-wealth claim. */
  readonly remainingDebtAtHorizon: number;
}

export type RouteFundingResult =
  | { readonly kind: "ok"; readonly value: EqualBudgetRouteFunding }
  | { readonly kind: "invalid"; readonly reason: string; readonly date?: string; readonly period?: number };

function finiteMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SCHEDULE_RUPEES;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 64;
}

function invalid(reason: string, details: { date?: string; period?: number } = {}): RouteFundingResult {
  return { kind: "invalid", reason, ...details };
}

function validateRow(
  row: unknown,
  previous: DatedLoanScheduleRow | undefined,
  expectedDate: string,
  expectedPeriod: number,
): RouteFundingResult | null {
  if (!row || typeof row !== "object") return invalid("invalid-schedule-row", { period: expectedPeriod });
  const value = row as Partial<DatedLoanScheduleRow>;
  if (!Number.isSafeInteger(value.period) || (value.period as number) < 0) return invalid("invalid-period", { period: expectedPeriod });
  if (value.period !== expectedPeriod) return invalid("schedule-period-not-on-grid", { period: value.period });
  if (typeof value.date !== "string") return invalid("invalid-payment-date", { period: value.period });
  try { validateDate(value.date); } catch { return invalid("invalid-payment-date", { period: value.period }); }
  if (value.date !== expectedDate) return invalid("schedule-date-not-on-grid", { date: value.date, period: value.period });
  if (!finiteMoney(value.openingBalance) || !finiteMoney(value.interest) || !finiteMoney(value.scheduledPayment) ||
      !finiteMoney(value.scheduledPrincipal) || !finiteMoney(value.immediatePrepayment) || !finiteMoney(value.closingBalance)) {
    return invalid("invalid-schedule-amount", { date: value.date, period: value.period });
  }
  if (previous && !closeEnough(value.openingBalance, previous.closingBalance)) {
    return invalid("broken-balance-continuity", { date: value.date, period: value.period });
  }
  if (!closeEnough(value.scheduledPayment, value.interest + value.scheduledPrincipal)) {
    return invalid("mismatched-payment-accounting", { date: value.date, period: value.period });
  }
  if (!closeEnough(value.closingBalance, value.openingBalance - value.scheduledPrincipal - value.immediatePrepayment)) {
    return invalid("mismatched-balance-accounting", { date: value.date, period: value.period });
  }
  return null;
}

/**
 * Allocate a route's actual dated loan cash uses against a common budget.
 * Remaining budget becomes a dated investment contribution. This is funding
 * arithmetic only: it does not calculate investment growth, tax, or terminal
 * wealth, and it never clips a genuine shortfall to zero.
 */
export function buildEqualBudgetRouteFunding(input: EqualBudgetRouteFundingInput): RouteFundingResult {
  if (!input || typeof input !== "object" || !input.schedule || typeof input.schedule !== "object") {
    return invalid("invalid-funding-input");
  }
  if (typeof input.anchorDate !== "string") return invalid("invalid-anchor-date");
  try { validateDate(input.anchorDate); } catch { return invalid("invalid-anchor-date"); }
  if (!Array.isArray(input.horizonDates) || input.horizonDates.length < 2 || input.horizonDates.length > MAX_SCHEDULE_MONTHS + 1) {
    return invalid("invalid-horizon-dates");
  }
  if (!finiteMoney(input.initialBudget) || !finiteMoney(input.monthlyBudget) || !finiteMoney(input.initialFee)) {
    return invalid("invalid-budget");
  }
  if (input.horizonDates[0] !== input.anchorDate) return invalid("horizon-does-not-start-at-anchor");

  const horizonSet = new Set<string>();
  let previousHorizonDate = "";
  for (let period = 0; period < input.horizonDates.length; period += 1) {
    const date = input.horizonDates[period];
    if (typeof date !== "string") return invalid("invalid-horizon-date", { period });
    try { validateDate(date); } catch { return invalid("invalid-horizon-date", { date, period }); }
    if (horizonSet.has(date)) return invalid("duplicate-horizon-date", { date, period });
    if (previousHorizonDate !== "" && date <= previousHorizonDate) return invalid("non-chronological-horizon-date", { date, period });
    let expectedDate: string;
    try { expectedDate = addCalendarMonths(input.anchorDate, period); } catch { return invalid("invalid-horizon-date", { date, period }); }
    if (date !== expectedDate) return invalid("horizon-date-not-monthly-anniversary", { date, period });
    horizonSet.add(date);
    previousHorizonDate = date;
  }

  const schedule = input.schedule;
  if (!Array.isArray(schedule.rows) || schedule.rows.length === 0) return invalid("invalid-schedule-rows");
  if (schedule.anchorDate !== input.anchorDate) return invalid("schedule-anchor-mismatch");
  if (!finiteMoney(schedule.originalPrincipal) || !finiteMoney(schedule.immediatePrepayment) || !finiteMoney(schedule.remainingBalance) ||
      !finiteMoney(schedule.totalInterest) || !finiteMoney(schedule.totalScheduledPrincipal) || !finiteMoney(schedule.totalScheduledPayment)) {
    return invalid("invalid-schedule-total");
  }
  if (schedule.immediatePrepayment > schedule.originalPrincipal) return invalid("immediate-exceeds-principal");
  if (schedule.rows.length > input.horizonDates.length) return invalid("schedule-beyond-horizon");

  const seenPeriods = new Set<number>();
  const seenDates = new Set<string>();
  let previousRow: DatedLoanScheduleRow | undefined;
  let sumInterest = 0;
  let sumScheduledPrincipal = 0;
  let sumScheduledPayment = 0;
  let sumImmediatePrincipal = 0;
  for (let index = 0; index < schedule.rows.length; index += 1) {
    const row = schedule.rows[index];
    const expectedDate = input.horizonDates[index];
    const rowError = validateRow(row, previousRow, expectedDate, index);
    if (rowError) return rowError;
    if (seenPeriods.has(row.period)) return invalid("duplicate-period", { period: row.period });
    if (seenDates.has(row.date)) return invalid("duplicate-payment-date", { date: row.date, period: row.period });
    if (index === 0 && (!closeEnough(row.interest, 0) || !closeEnough(row.scheduledPrincipal, 0) || !closeEnough(row.scheduledPayment, 0))) {
      return invalid("anchor-has-scheduled-use", { date: row.date, period: row.period });
    }
    if (index > 0 && row.immediatePrepayment !== 0) return invalid("non-anchor-immediate-prepayment", { date: row.date, period: row.period });
    seenPeriods.add(row.period);
    seenDates.add(row.date);
    sumInterest += row.interest;
    sumScheduledPrincipal += row.scheduledPrincipal;
    sumScheduledPayment += row.scheduledPayment;
    sumImmediatePrincipal += row.immediatePrepayment;
    if (![sumInterest, sumScheduledPrincipal, sumScheduledPayment, sumImmediatePrincipal].every(Number.isFinite)) {
      return invalid("nonfinite-schedule-total", { date: row.date, period: row.period });
    }
    previousRow = row;
  }
  const firstRow = schedule.rows[0];
  const lastRow = schedule.rows[schedule.rows.length - 1];
  if (!closeEnough(firstRow.openingBalance, schedule.originalPrincipal)) return invalid("invalid-anchor-balance");
  if (!closeEnough(lastRow.closingBalance, schedule.remainingBalance)) return invalid("mismatched-remaining-balance");
  if (schedule.rows.length < input.horizonDates.length && lastRow.closingBalance > 0) return invalid("truncated-non-cleared-schedule");
  if (!closeEnough(sumInterest, schedule.totalInterest) || !closeEnough(sumScheduledPrincipal, schedule.totalScheduledPrincipal) ||
      !closeEnough(sumScheduledPayment, schedule.totalScheduledPayment) || !closeEnough(sumImmediatePrincipal, schedule.immediatePrepayment)) {
    return invalid("mismatched-schedule-total");
  }

  const expectedExternalBudget = input.initialBudget + input.monthlyBudget * (input.horizonDates.length - 1);
  if (!Number.isFinite(expectedExternalBudget)) return invalid("nonfinite-external-budget");
  const entries: RouteFundingEntry[] = [];
  let totalInvestment = 0;
  let totalLoanCashUse = 0;
  let totalInterest = 0;
  let totalScheduledPrincipal = 0;
  let totalImmediatePrincipal = 0;
  let totalFees = 0;
  let remainingDebt = lastRow.closingBalance;
  for (let period = 0; period < input.horizonDates.length; period += 1) {
    const date = input.horizonDates[period];
    const row = schedule.rows[period];
    const interest = row?.interest ?? 0;
    const scheduledPrincipal = row?.scheduledPrincipal ?? 0;
    const scheduledPayment = row?.scheduledPayment ?? 0;
    const immediatePrincipal = row?.immediatePrepayment ?? 0;
    const fee = period === 0 ? input.initialFee : 0;
    const externalBudget = period === 0 ? input.initialBudget : input.monthlyBudget;
    const loanCashUse = interest + scheduledPrincipal + immediatePrincipal + fee;
    if (![interest, scheduledPrincipal, scheduledPayment, immediatePrincipal, fee, externalBudget, loanCashUse].every(Number.isFinite)) {
      return invalid("nonfinite-funding-entry", { date, period });
    }
    const rawInvestment = externalBudget - loanCashUse;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(externalBudget), Math.abs(loanCashUse)) * 64;
    if (rawInvestment < -tolerance) return invalid("insufficient-budget", { date, period });
    const investmentContribution = rawInvestment < 0 ? 0 : rawInvestment;
    if (row) remainingDebt = row.closingBalance;
    entries.push({ date, externalBudget, interest, scheduledPrincipal, scheduledPayment, immediatePrincipal, fee, loanCashUse, investmentContribution, remainingDebt });
    totalInvestment += investmentContribution;
    totalLoanCashUse += loanCashUse;
    totalInterest += interest;
    totalScheduledPrincipal += scheduledPrincipal;
    totalImmediatePrincipal += immediatePrincipal;
    totalFees += fee;
    if (![totalInvestment, totalLoanCashUse, totalInterest, totalScheduledPrincipal, totalImmediatePrincipal, totalFees].every(Number.isFinite)) {
      return invalid("nonfinite-funding-total", { date, period });
    }
  }
  return {
    kind: "ok",
    value: {
      entries,
      totals: {
        externalBudget: expectedExternalBudget,
        investmentContribution: totalInvestment,
        loanCashUse: totalLoanCashUse,
        interest: totalInterest,
        scheduledPrincipal: totalScheduledPrincipal,
        immediatePrincipal: totalImmediatePrincipal,
        fees: totalFees,
      },
      remainingDebtAtHorizon: remainingDebt,
    },
  };
}
