import { indianFinancialYear, validateDate } from "./dates";

/**
 * A disposal lot contains the arithmetic facts supplied by a reviewed policy
 * resolver. This module does not choose a tax rate or decide eligibility.
 * `effectiveTaxFactor` is a decimal factor, so 12.5% is written as 0.125.
 */
export interface DisposalTaxLotInput {
  readonly lotId: string;
  readonly costBasis: number;
  readonly acquisitionDate: string;
  readonly disposalDate: string;
  readonly grossProceeds: number;
  readonly eligibleExpenseAmount: number;
  readonly effectiveTaxFactor: number;
  readonly exemptionEligible: boolean;
}

/** Explicit annual exemption capacity. A zero amount is meaningful. */
export interface ExemptionHeadroomInput {
  /** Indian financial-year start, for example 2027 means FY 2027-28. */
  readonly financialYear: number;
  readonly amount: number;
}

export type LossTreatment = "no-current-tax-credit";

export interface DisposalTaxLedgerInput {
  readonly lots: readonly DisposalTaxLotInput[];
  readonly exemptionHeadroom: readonly ExemptionHeadroomInput[];
  /** Required so a loss never receives an accidental offset or refund. */
  readonly lossTreatment: LossTreatment;
}

export interface DisposalLotTaxLedger {
  readonly lotId: string;
  readonly acquisitionDate: string;
  readonly disposalDate: string;
  readonly financialYear: number;
  readonly costBasis: number;
  readonly grossProceeds: number;
  readonly eligibleExpenseAmount: number;
  readonly grossGain: number;
  /** Gain after eligible expenses and the consumed exemption. Never negative. */
  readonly taxableGain: number;
  readonly lossAmount: number;
  readonly exemptionEligible: boolean;
  readonly exemptionHeadroomUsed: number;
  readonly effectiveTaxFactor: number;
  /** Tax is positive; the matching dated outflow is negative. */
  readonly tax: number;
  readonly netProceeds: number;
}

export interface InvestmentTaxOutflow {
  readonly id: string;
  readonly date: string;
  readonly financialYear: number;
  /**
   * Negative arithmetic cashflow at the supplied recognition date. This is a
   * ledger convention, not a legal payment date or a claim about TDS timing.
   */
  readonly amount: number;
}

export interface ExemptionHeadroomLedger {
  readonly financialYear: number;
  readonly initialAmount: number;
  readonly amountUsed: number;
  readonly remainingAmount: number;
}

export interface DisposalTaxLedger {
  readonly lossTreatment: LossTreatment;
  readonly lots: readonly DisposalLotTaxLedger[];
  readonly taxOutflows: readonly InvestmentTaxOutflow[];
  readonly exemptionHeadroom: readonly ExemptionHeadroomLedger[];
  readonly totalGrossProceeds: number;
  readonly totalGrossGain: number;
  readonly totalTaxableGain: number;
  readonly totalLossAmount: number;
  readonly totalExemptionHeadroomUsed: number;
  readonly totalTax: number;
  readonly totalNetProceeds: number;
}

export interface OrdinaryInterestEventInput {
  readonly eventId: string;
  readonly creditDate: string;
  readonly grossInterest: number;
  readonly effectiveTaxFactor: number;
}

export interface OrdinaryInterestEventLedger {
  readonly eventId: string;
  readonly creditDate: string;
  readonly financialYear: number;
  readonly grossInterest: number;
  readonly effectiveTaxFactor: number;
  readonly tax: number;
  readonly netInterest: number;
}

export interface OrdinaryInterestTaxLedgerInput {
  readonly events: readonly OrdinaryInterestEventInput[];
}

export interface OrdinaryInterestTaxLedger {
  readonly events: readonly OrdinaryInterestEventLedger[];
  readonly taxOutflows: readonly InvestmentTaxOutflow[];
  readonly totalGrossInterest: number;
  readonly totalTax: number;
  readonly totalNetInterest: number;
}

export type InvestmentTaxLedgerResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "unsupported"; readonly reason: "missing-loss-treatment" }
  | { readonly kind: "invalid"; readonly reason: string; readonly id?: string; readonly financialYear?: number };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteNonnegativeFactor(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function sumFinite(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validFinancialYear(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1900 && value <= 9999;
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

function compareLots(left: DisposalTaxLotInput, right: DisposalTaxLotInput): number {
  if (left.disposalDate < right.disposalDate) return -1;
  if (left.disposalDate > right.disposalDate) return 1;
  return left.lotId < right.lotId ? -1 : left.lotId > right.lotId ? 1 : 0;
}

function validateDisposalLot(value: unknown): InvestmentTaxLedgerResult<never> | null {
  if (!record(value)) return { kind: "invalid", reason: "invalid-lot" };
  const lot = value as Partial<DisposalTaxLotInput>;
  if (!validId(lot.lotId)) return { kind: "invalid", reason: "invalid-lot-id" };
  if (!finiteNonnegative(lot.costBasis)) return { kind: "invalid", reason: "invalid-cost-basis", id: lot.lotId };
  if (!validDate(lot.acquisitionDate) || !validDate(lot.disposalDate)) {
    return { kind: "invalid", reason: "invalid-lot-date", id: lot.lotId };
  }
  if (lot.disposalDate < lot.acquisitionDate) return { kind: "invalid", reason: "reversed-lot-dates", id: lot.lotId };
  if (!finiteNonnegative(lot.grossProceeds)) return { kind: "invalid", reason: "invalid-gross-proceeds", id: lot.lotId };
  if (!finiteNonnegative(lot.eligibleExpenseAmount)) return { kind: "invalid", reason: "invalid-eligible-expense", id: lot.lotId };
  if (lot.eligibleExpenseAmount > lot.grossProceeds) return { kind: "invalid", reason: "expense-exceeds-proceeds", id: lot.lotId };
  if (!finiteNonnegativeFactor(lot.effectiveTaxFactor)) return { kind: "invalid", reason: "invalid-effective-tax-factor", id: lot.lotId };
  if (typeof lot.exemptionEligible !== "boolean") return { kind: "invalid", reason: "invalid-exemption-eligibility", id: lot.lotId };
  return null;
}

function validateHeadroom(value: unknown): InvestmentTaxLedgerResult<never> | null {
  if (!record(value)) return { kind: "invalid", reason: "invalid-headroom" };
  const row = value as Partial<ExemptionHeadroomInput>;
  if (!validFinancialYear(row.financialYear)) return { kind: "invalid", reason: "invalid-headroom-year" };
  if (!finiteNonnegative(row.amount)) return { kind: "invalid", reason: "invalid-headroom-amount", financialYear: row.financialYear };
  return null;
}

/**
 * Builds a disposal-event ledger from explicit lots. Lots are processed in
 * disposal-date then lot-id order, so annual exemption capacity is shared and
 * consumption is deterministic regardless of input array order.
 */
export function buildDisposalTaxLedger(input: DisposalTaxLedgerInput): InvestmentTaxLedgerResult<DisposalTaxLedger> {
  if (!record(input) || !Array.isArray(input.lots) || !Array.isArray(input.exemptionHeadroom)) {
    return { kind: "invalid", reason: "invalid-ledger-input" };
  }
  if (input.lossTreatment === undefined || input.lossTreatment === null) return { kind: "unsupported", reason: "missing-loss-treatment" };
  if (input.lossTreatment !== "no-current-tax-credit") return { kind: "invalid", reason: "invalid-loss-treatment" };
  if (input.lots.length === 0) return { kind: "invalid", reason: "missing-lots" };
  if (input.exemptionHeadroom.length === 0) return { kind: "invalid", reason: "missing-headroom" };

  const ids = new Set<string>();
  for (const lot of input.lots) {
    const error = validateDisposalLot(lot);
    if (error) return error;
    if (ids.has(lot.lotId)) return { kind: "invalid", reason: "duplicate-lot-id", id: lot.lotId };
    ids.add(lot.lotId);
  }

  const headroom = new Map<number, number>();
  for (const row of input.exemptionHeadroom) {
    const error = validateHeadroom(row);
    if (error) return error;
    if (headroom.has(row.financialYear)) return { kind: "invalid", reason: "duplicate-headroom-year", financialYear: row.financialYear };
    headroom.set(row.financialYear, row.amount);
  }

  const sortedLots = [...input.lots].sort(compareLots);
  const lotYears = new Set<number>();
  for (const lot of sortedLots) lotYears.add(indianFinancialYear(lot.disposalDate));
  for (const year of lotYears) {
    if (!headroom.has(year)) return { kind: "invalid", reason: "missing-headroom-year", financialYear: year };
  }
  for (const year of headroom.keys()) {
    if (!lotYears.has(year)) return { kind: "invalid", reason: "unmatched-headroom-year", financialYear: year };
  }

  const initialHeadroom = new Map(headroom);
  const lots: DisposalLotTaxLedger[] = [];
  const taxOutflows: InvestmentTaxOutflow[] = [];
  for (const lot of sortedLots) {
    const financialYear = indianFinancialYear(lot.disposalDate);
    const grossGain = lot.grossProceeds - lot.costBasis;
    const gainAfterExpenses = grossGain - lot.eligibleExpenseAmount;
    const lossAmount = Math.max(0, -gainAfterExpenses);
    const positiveGain = Math.max(0, gainAfterExpenses);
    const available = headroom.get(financialYear)!;
    const exemptionHeadroomUsed = lot.exemptionEligible ? Math.min(positiveGain, available) : 0;
    headroom.set(financialYear, available - exemptionHeadroomUsed);
    const taxableGain = positiveGain - exemptionHeadroomUsed;
    const tax = taxableGain * lot.effectiveTaxFactor;
    const netProceeds = lot.grossProceeds - lot.eligibleExpenseAmount - tax;
    if (![grossGain, gainAfterExpenses, lossAmount, positiveGain, exemptionHeadroomUsed, taxableGain, tax, netProceeds].every(Number.isFinite)) {
      return { kind: "invalid", reason: "arithmetic-overflow", id: lot.lotId };
    }
    lots.push({
      lotId: lot.lotId,
      acquisitionDate: lot.acquisitionDate,
      disposalDate: lot.disposalDate,
      financialYear,
      costBasis: lot.costBasis,
      grossProceeds: lot.grossProceeds,
      eligibleExpenseAmount: lot.eligibleExpenseAmount,
      grossGain,
      taxableGain,
      lossAmount,
      exemptionEligible: lot.exemptionEligible,
      exemptionHeadroomUsed,
      effectiveTaxFactor: lot.effectiveTaxFactor,
      tax,
      netProceeds,
    });
    taxOutflows.push({ id: lot.lotId, date: lot.disposalDate, financialYear, amount: -tax });
  }

  const exemptionLedger = [...initialHeadroom.keys()].sort((left, right) => left - right).map((financialYear) => {
    const initialAmount = initialHeadroom.get(financialYear)!;
    const remainingAmount = headroom.get(financialYear)!;
    return { financialYear, initialAmount, amountUsed: initialAmount - remainingAmount, remainingAmount };
  });
  if (exemptionLedger.some((row) => ![row.initialAmount, row.amountUsed, row.remainingAmount].every(Number.isFinite))) {
    return { kind: "invalid", reason: "arithmetic-overflow" };
  }
  const totalGrossProceeds = sumFinite(lots.map((lot) => lot.grossProceeds));
  const totalGrossGain = sumFinite(lots.map((lot) => lot.grossGain));
  const totalTaxableGain = sumFinite(lots.map((lot) => lot.taxableGain));
  const totalLossAmount = sumFinite(lots.map((lot) => lot.lossAmount));
  const totalExemptionHeadroomUsed = sumFinite(lots.map((lot) => lot.exemptionHeadroomUsed));
  const totalTax = sumFinite(lots.map((lot) => lot.tax));
  const totalNetProceeds = sumFinite(lots.map((lot) => lot.netProceeds));
  if (totalGrossProceeds === null || totalGrossGain === null || totalTaxableGain === null || totalLossAmount === null || totalExemptionHeadroomUsed === null || totalTax === null || totalNetProceeds === null) {
    return { kind: "invalid", reason: "arithmetic-overflow" };
  }
  return {
    kind: "ok",
    value: {
      lossTreatment: input.lossTreatment,
      lots,
      taxOutflows,
      exemptionHeadroom: exemptionLedger,
      totalGrossProceeds,
      totalGrossGain,
      totalTaxableGain,
      totalLossAmount,
      totalExemptionHeadroomUsed,
      totalTax,
      totalNetProceeds,
    },
  };
}

function validateInterestEvent(value: unknown): InvestmentTaxLedgerResult<never> | null {
  if (!record(value)) return { kind: "invalid", reason: "invalid-interest-event" };
  const event = value as Partial<OrdinaryInterestEventInput>;
  if (!validId(event.eventId)) return { kind: "invalid", reason: "invalid-interest-event-id" };
  if (!validDate(event.creditDate)) return { kind: "invalid", reason: "invalid-credit-date", id: event.eventId };
  if (!finiteNonnegative(event.grossInterest)) return { kind: "invalid", reason: "invalid-gross-interest", id: event.eventId };
  if (!finiteNonnegativeFactor(event.effectiveTaxFactor)) return { kind: "invalid", reason: "invalid-effective-tax-factor", id: event.eventId };
  return null;
}

/**
 * Builds ordinary-interest tax outflows at the supplied credit dates. A
 * maturity date is never inferred, and event dates remain observable even if
 * two scenarios happen to have equal gross interest. The outflow date is an
 * arithmetic recognition-date convention; a reviewed policy must supply a
 * different legal payment/TDS date when applicable.
 */
export function buildOrdinaryInterestTaxLedger(input: OrdinaryInterestTaxLedgerInput): InvestmentTaxLedgerResult<OrdinaryInterestTaxLedger> {
  if (!record(input) || !Array.isArray(input.events)) return { kind: "invalid", reason: "invalid-interest-ledger-input" };
  if (input.events.length === 0) return { kind: "invalid", reason: "missing-interest-events" };
  const ids = new Set<string>();
  for (const event of input.events) {
    const error = validateInterestEvent(event);
    if (error) return error;
    if (ids.has(event.eventId)) return { kind: "invalid", reason: "duplicate-interest-event-id", id: event.eventId };
    ids.add(event.eventId);
  }
  const events = [...input.events].sort((left, right) => left.creditDate < right.creditDate ? -1 : left.creditDate > right.creditDate ? 1 : left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0).map((event) => {
    const tax = event.grossInterest * event.effectiveTaxFactor;
    const netInterest = event.grossInterest - tax;
    return {
      eventId: event.eventId,
      creditDate: event.creditDate,
      financialYear: indianFinancialYear(event.creditDate),
      grossInterest: event.grossInterest,
      effectiveTaxFactor: event.effectiveTaxFactor,
      tax,
      netInterest,
    };
  });
  if (events.some((event) => ![event.tax, event.netInterest].every(Number.isFinite))) {
    return { kind: "invalid", reason: "arithmetic-overflow" };
  }
  const totalGrossInterest = sumFinite(events.map((event) => event.grossInterest));
  const totalTax = sumFinite(events.map((event) => event.tax));
  const totalNetInterest = sumFinite(events.map((event) => event.netInterest));
  if (totalGrossInterest === null || totalTax === null || totalNetInterest === null) {
    return { kind: "invalid", reason: "arithmetic-overflow" };
  }
  return {
    kind: "ok",
    value: {
      events,
      taxOutflows: events.map((event) => ({ id: event.eventId, date: event.creditDate, financialYear: event.financialYear, amount: -event.tax })),
      totalGrossInterest,
      totalTax,
      totalNetInterest,
    },
  };
}
