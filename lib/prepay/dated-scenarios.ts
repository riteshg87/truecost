import { emiFor } from "../finance/core";
import {
  buildDatedLoanSchedule,
  MAX_MONTHLY_RATE,
  MAX_SCHEDULE_MONTHS,
  MAX_SCHEDULE_RUPEES,
} from "./cashflows";
import { addCalendarMonths } from "./dates";
import { buildEqualBudgetRouteFunding, type EqualBudgetRouteFunding } from "./route-funding";
import type { DatedLoanSchedule } from "./cashflows";

export interface DatedPrepayScenarioInput {
  readonly anchorDate: string;
  readonly outstanding: number;
  /** Decimal monthly rate, matching cashflows.ts. */
  readonly monthlyRate: number;
  readonly remainingMonths: number;
  /** A supplied EMI is authoritative; null asks the helper to derive one. */
  readonly currentEmi: number | null;
  readonly surplus: number;
  /** Explicit cash fee on the anchor date. No fee policy is inferred. */
  readonly prepaymentFeeAmount: number;
}

export type DatedPrepayRouteName = "keep-loan-invest" | "reduce-tenure" | "reduce-emi";

export interface DatedPrepayRoute {
  readonly name: DatedPrepayRouteName;
  readonly schedule: DatedLoanSchedule;
  readonly funding: EqualBudgetRouteFunding;
}

export interface DatedPrepayScenarios {
  readonly anchorDate: string;
  readonly horizonDates: readonly string[];
  readonly initialBudget: number;
  readonly monthlyBudget: number;
  readonly prepaymentFeeAmount: number;
  readonly appliedPrepayment: number;
  readonly excessSurplus: number;
  readonly derivedEmi: number;
  readonly baselineEmi: number;
  readonly emiSource: "provided" | "derived";
  readonly providedEmi: number | null;
  /** Provided EMI minus the derived amortising EMI, or null when derived. */
  readonly emiMismatch: number | null;
  readonly routes: Readonly<{
    keepLoanInvest: DatedPrepayRoute;
    reduceTenure: DatedPrepayRoute;
    reduceEmi: DatedPrepayRoute;
  }>;
}

export type DatedPrepayScenariosResult =
  | { readonly kind: "ok"; readonly value: DatedPrepayScenarios }
  | { readonly kind: "invalid"; readonly reason: string; readonly route?: DatedPrepayRouteName; readonly period?: number };

function finiteMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SCHEDULE_RUPEES;
}

function invalid(reason: string, route?: DatedPrepayRouteName): DatedPrepayScenariosResult {
  return route === undefined ? { kind: "invalid", reason } : { kind: "invalid", reason, route };
}

function makeSchedule(
  input: DatedPrepayScenarioInput,
  scheduledEmi: number,
  immediatePrepayment: number,
): DatedLoanSchedule | { readonly kind: "invalid"; readonly reason: string } {
  try {
    return buildDatedLoanSchedule({
      anchorDate: input.anchorDate,
      principal: input.outstanding,
      monthlyRate: input.monthlyRate,
      scheduledEmi,
      termMonths: input.remainingMonths,
      immediatePrepayment: { amount: immediatePrepayment },
    });
  } catch (error) {
    return { kind: "invalid", reason: error instanceof Error ? `schedule-${error.message}` : "schedule-build-failed" };
  }
}

function fundRoute(
  input: DatedPrepayScenarioInput,
  horizonDates: readonly string[],
  schedule: DatedLoanSchedule,
  initialFee: number,
  route: DatedPrepayRouteName,
  initialBudget: number,
  monthlyBudget: number,
): DatedPrepayRoute | DatedPrepayScenariosResult {
  const result = buildEqualBudgetRouteFunding({
    anchorDate: input.anchorDate,
    horizonDates,
    initialBudget,
    monthlyBudget,
    schedule,
    initialFee,
  });
  if (result.kind !== "ok") return { ...result, route };
  return { name: route, schedule, funding: result.value };
}

/**
 * Compose the three dated funding routes from one explicit loan input. The
 * helper preserves a supplied EMI, reports its mismatch to the derived EMI,
 * and leaves any non-cleared balance visible in each route's funding ledger.
 */
export function buildDatedPrepayScenarios(input: DatedPrepayScenarioInput): DatedPrepayScenariosResult {
  if (!input || typeof input !== "object") return invalid("invalid-scenario-input");
  if (!finiteMoney(input.outstanding) || !finiteMoney(input.surplus) || !finiteMoney(input.prepaymentFeeAmount)) return invalid("invalid-money");
  if (typeof input.monthlyRate !== "number" || !Number.isFinite(input.monthlyRate) || input.monthlyRate < 0 || input.monthlyRate > MAX_MONTHLY_RATE) return invalid("invalid-monthly-rate");
  if (!Number.isSafeInteger(input.remainingMonths) || input.remainingMonths < 1 || input.remainingMonths > MAX_SCHEDULE_MONTHS) return invalid("invalid-remaining-months");
  if (input.currentEmi !== null && (!finiteMoney(input.currentEmi) || input.currentEmi === undefined)) return invalid("invalid-current-emi");

  let horizonDates: string[];
  try {
    horizonDates = Array.from({ length: input.remainingMonths + 1 }, (_, period) => addCalendarMonths(input.anchorDate, period));
  } catch {
    return invalid("invalid-anchor-date");
  }
  const derivedEmi = emiFor(input.outstanding, input.monthlyRate, input.remainingMonths);
  if (!Number.isFinite(derivedEmi) || derivedEmi < 0 || derivedEmi > MAX_SCHEDULE_RUPEES) return invalid("invalid-derived-emi");
  const baselineEmi = input.currentEmi === null ? derivedEmi : input.currentEmi;
  if (!Number.isFinite(baselineEmi)) return invalid("invalid-current-emi");
  const appliedPrepayment = Math.min(input.surplus, input.outstanding);
  const excessSurplus = input.surplus - appliedPrepayment;
  const initialBudget = input.surplus + input.prepaymentFeeAmount;
  if (!finiteMoney(initialBudget)) return invalid("invalid-initial-budget");
  const emiSource = input.currentEmi === null ? "derived" : "provided";
  const emiMismatch = input.currentEmi === null ? null : input.currentEmi - derivedEmi;
  if (emiMismatch !== null && !Number.isFinite(emiMismatch)) return invalid("invalid-emi-mismatch");

  const keepScheduleResult = makeSchedule(input, baselineEmi, 0);
  if ("kind" in keepScheduleResult) return keepScheduleResult;
  const keepRoute = fundRoute(input, horizonDates, keepScheduleResult, 0, "keep-loan-invest", initialBudget, baselineEmi);
  if (!("funding" in keepRoute)) return keepRoute;

  const tenureScheduleResult = makeSchedule(input, baselineEmi, appliedPrepayment);
  if ("kind" in tenureScheduleResult) return { ...tenureScheduleResult, route: "reduce-tenure" };
  const tenureRoute = fundRoute(input, horizonDates, tenureScheduleResult, input.prepaymentFeeAmount, "reduce-tenure", initialBudget, baselineEmi);
  if (!("funding" in tenureRoute)) return tenureRoute;

  const reducedBalance = input.outstanding - appliedPrepayment;
  const reducedEmi = emiFor(reducedBalance, input.monthlyRate, input.remainingMonths);
  if (!Number.isFinite(reducedEmi) || reducedEmi < 0 || reducedEmi > MAX_SCHEDULE_RUPEES) return invalid("invalid-reduced-emi", "reduce-emi");
  const emiScheduleResult = makeSchedule(input, reducedEmi, appliedPrepayment);
  if ("kind" in emiScheduleResult) return { ...emiScheduleResult, route: "reduce-emi" };
  const emiRoute = fundRoute(input, horizonDates, emiScheduleResult, input.prepaymentFeeAmount, "reduce-emi", initialBudget, baselineEmi);
  if (!("funding" in emiRoute)) return emiRoute;

  return {
    kind: "ok",
    value: {
      anchorDate: input.anchorDate,
      horizonDates,
      initialBudget,
      monthlyBudget: baselineEmi,
      prepaymentFeeAmount: input.prepaymentFeeAmount,
      appliedPrepayment,
      excessSurplus,
      derivedEmi,
      baselineEmi,
      emiSource,
      providedEmi: input.currentEmi,
      emiMismatch,
      routes: { keepLoanInvest: keepRoute, reduceTenure: tenureRoute, reduceEmi: emiRoute },
    },
  };
}
