import { addCalendarMonths, validateDate } from "./dates";
import { MAX_SCHEDULE_MONTHS } from "./cashflows";

/** A supplied multiplicative growth factor for one dated interval. */
export interface GrowthInterval {
  readonly startDate: string;
  readonly endDate: string;
  /** 1 + return for the interval; zero is valid and represents total loss. */
  readonly growthFactor: number;
}

export interface GrowthContribution {
  readonly lotId: string;
  readonly date: string;
  readonly amount: number;
}

export interface InvestmentGrowthInput {
  readonly intervals: readonly GrowthInterval[];
  readonly contributions: readonly GrowthContribution[];
}

export interface InvestmentGrowthLot {
  readonly lotId: string;
  readonly cost: number;
  readonly acquisitionDate: string;
  readonly disposalDate: string;
  readonly grossProceeds: number;
  readonly grossGain: number;
}

export interface InvestmentGrowthLedger {
  readonly horizonDate: string;
  readonly lots: readonly InvestmentGrowthLot[];
  readonly totalCost: number;
  readonly totalGrossGain: number;
  readonly totalGrossProceeds: number;
}

export type InvestmentGrowthResult =
  | { readonly kind: "ok"; readonly value: InvestmentGrowthLedger }
  | { readonly kind: "unsupported"; readonly reason: "off-grid-contribution-date"; readonly lotId?: string }
  | { readonly kind: "invalid"; readonly reason: string; readonly lotId?: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    validateDate(value);
    return true;
  } catch {
    return false;
  }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sumFinite(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function validateInterval(value: unknown): InvestmentGrowthResult | null {
  if (!record(value)) return { kind: "invalid", reason: "invalid-growth-interval" };
  const interval = value as Partial<GrowthInterval>;
  if (!validDate(interval.startDate) || !validDate(interval.endDate)) return { kind: "invalid", reason: "invalid-growth-interval-date" };
  if (interval.endDate <= interval.startDate) return { kind: "invalid", reason: "reversed-growth-interval" };
  if (!finiteNonnegative(interval.growthFactor)) return { kind: "invalid", reason: "invalid-growth-factor" };
  return null;
}

function validateContribution(value: unknown): InvestmentGrowthResult | null {
  if (!record(value)) return { kind: "invalid", reason: "invalid-contribution" };
  const contribution = value as Partial<GrowthContribution>;
  if (!validId(contribution.lotId)) return { kind: "invalid", reason: "invalid-contribution-id" };
  if (!validDate(contribution.date)) return { kind: "invalid", reason: "invalid-contribution-date", lotId: contribution.lotId };
  if (!finiteNonnegative(contribution.amount)) return { kind: "invalid", reason: "invalid-contribution-amount", lotId: contribution.lotId };
  return null;
}

export type GrowthGridValidation =
  | { readonly kind: "ok" }
  | { readonly kind: "invalid"; readonly reason: string };

/** Validates a grid independently so zero-portfolio routes cannot bypass it. */
export function validateGrowthGrid(value: unknown): GrowthGridValidation {
  if (!Array.isArray(value) || value.length === 0) return { kind: "invalid", reason: "missing-growth-intervals" };
  for (const interval of value) {
    const error = validateInterval(interval);
    if (error?.kind === "invalid") return { kind: "invalid", reason: error.reason };
  }
  for (let index = 1; index < value.length; index += 1) {
    if (value[index - 1].endDate !== value[index].startDate) return { kind: "invalid", reason: "non-contiguous-growth-grid" };
  }
  return { kind: "ok" };
}

/**
 * Applies an explicit dated valuation grid to dated contribution lots. The
 * grid is the complete growth convention: no daily proration or monthly rate
 * is inferred. A contribution on the horizon receives no further growth.
 */
export function buildInvestmentGrowthLedger(input: InvestmentGrowthInput): InvestmentGrowthResult {
  if (!record(input) || !Array.isArray(input.intervals) || !Array.isArray(input.contributions)) {
    return { kind: "invalid", reason: "invalid-growth-ledger-input" };
  }
  const gridValidation = validateGrowthGrid(input.intervals);
  if (gridValidation.kind === "invalid") return gridValidation;
  if (input.contributions.length === 0) return { kind: "invalid", reason: "missing-contributions" };

  const ids = new Set<string>();
  for (const contribution of input.contributions) {
    const error = validateContribution(contribution);
    if (error) return error;
    if (ids.has(contribution.lotId)) return { kind: "invalid", reason: "duplicate-contribution-id", lotId: contribution.lotId };
    ids.add(contribution.lotId);
  }

  const boundaries = new Set<string>([input.intervals[0].startDate]);
  for (const interval of input.intervals) boundaries.add(interval.endDate);
  const sortedContributions = [...input.contributions].sort((left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : left.lotId < right.lotId ? -1 : left.lotId > right.lotId ? 1 : 0);
  for (const contribution of sortedContributions) {
    if (!boundaries.has(contribution.date)) return { kind: "unsupported", reason: "off-grid-contribution-date", lotId: contribution.lotId };
  }

  const horizonDate = input.intervals[input.intervals.length - 1].endDate;
  const lots: InvestmentGrowthLot[] = [];
  for (const contribution of sortedContributions) {
    let growth = 1;
    for (const interval of input.intervals) {
      if (interval.startDate < contribution.date) continue;
      growth *= interval.growthFactor;
      if (!Number.isFinite(growth)) return { kind: "invalid", reason: "arithmetic-overflow", lotId: contribution.lotId };
    }
    const grossProceeds = contribution.amount * growth;
    const grossGain = grossProceeds - contribution.amount;
    if (![grossProceeds, grossGain].every(Number.isFinite)) return { kind: "invalid", reason: "arithmetic-overflow", lotId: contribution.lotId };
    lots.push({
      lotId: contribution.lotId,
      cost: contribution.amount,
      acquisitionDate: contribution.date,
      disposalDate: horizonDate,
      grossProceeds,
      grossGain,
    });
  }

  const totalCost = sumFinite(lots.map((lot) => lot.cost));
  const totalGrossProceeds = sumFinite(lots.map((lot) => lot.grossProceeds));
  const totalGrossGain = sumFinite(lots.map((lot) => lot.grossGain));
  if (totalCost === null || totalGrossProceeds === null || totalGrossGain === null) return { kind: "invalid", reason: "arithmetic-overflow" };
  return { kind: "ok", value: { horizonDate, lots, totalCost, totalGrossGain, totalGrossProceeds } };
}

/** Convenience helper for constructing a regular monthly grid from supplied factors. */
export function monthlyGrowthIntervals(startDate: string, horizonMonths: number, growthFactor: number): readonly GrowthInterval[] {
  if (!validDate(startDate) || !Number.isSafeInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > MAX_SCHEDULE_MONTHS || !finiteNonnegative(growthFactor)) {
    throw new Error("Invalid monthly growth grid");
  }
  return Array.from({ length: horizonMonths }, (_, index) => ({
    startDate: addCalendarMonths(startDate, index),
    endDate: addCalendarMonths(startDate, index + 1),
    growthFactor,
  }));
}
