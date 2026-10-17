import type { LoanInputProvenance, LoanRecord, RateBasis, ResetCycle, TransferQuote } from "../health/types";
import {
  canonicalTimestamp,
  contractFail,
  deepFreeze,
  exactKeys,
  finiteNumber,
  integerValue,
  recordOf,
  stringValue,
  uuidValue,
} from "./errors";

export const SAVED_LOAN_LIMITS = {
  maxLenderLength: 120,
  maxMoney: 1_000_000_000_000,
  maxRatePct: 1000,
  minSpreadPct: -100,
  maxSpreadPct: 100,
  maxMonths: 1200,
  maxBufferMonths: 120,
  maxRequestAgeMs: 7 * 24 * 60 * 60 * 1000,
} as const;

const LOAN_KEYS = [
  "lender",
  "original",
  "outstanding",
  "ratePct",
  "basis",
  "spreadPct",
  "spreadProvenance",
  "cycle",
  "lastReset",
  "lastResetProvenance",
  "monthsLeft",
] as const;

const QUOTE_KEYS = [
  "newRatePct",
  "feePct",
  "legalCharges",
  "keepTenure",
  "newTenureMonths",
] as const;

const PAYLOAD_KEYS = [
  "loan",
  "quote",
  "surplus",
  "bufferMonths",
  "rateResolvedAt",
] as const;

export interface SavedLoanPayload {
  loan: LoanRecord;
  quote: TransferQuote;
  surplus: number;
  bufferMonths: number;
  rateResolvedAt: string | null;
}

function enumValue<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    contractFail("invalid_enum", `${label} is not supported`);
  }
  return value as T;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") contractFail("invalid_shape", `${label} must be boolean`);
  return value;
}

function canonicalDate(value: unknown, label: string): string {
  const date = stringValue(value, label, 10, false);
  if (date.length === 0) return date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    contractFail("invalid_timestamp", `${label} must be a calendar date`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    contractFail("invalid_timestamp", `${label} must be a valid calendar date`);
  }
  return date;
}

function provenanceValue(value: unknown, label: string, fallback: LoanInputProvenance): LoanInputProvenance {
  if (value === undefined) return fallback;
  return enumValue(value, label, ["confirmed", "unknown", "legacy"] as const);
}

function parseLoan(value: unknown): LoanRecord {
  const record = recordOf(value, "payload.loan");
  exactKeys(record, LOAN_KEYS, "payload.loan");
  const lender = stringValue(record.lender, "payload.loan.lender", SAVED_LOAN_LIMITS.maxLenderLength, false).trim();
  const spreadPct = record.spreadPct === null
    ? null
    : finiteNumber(record.spreadPct, "payload.loan.spreadPct", SAVED_LOAN_LIMITS.minSpreadPct, SAVED_LOAN_LIMITS.maxSpreadPct);
  const lastReset = canonicalDate(record.lastReset, "payload.loan.lastReset");
  const spreadProvenance = provenanceValue(record.spreadProvenance, "payload.loan.spreadProvenance", spreadPct === null ? "unknown" : "legacy");
  // Missing provenance means this field came from the pre-provenance wire
  // format, including an old blank reset date. New blank values are explicit
  // `unknown` values supplied by setup.
  const lastResetProvenance = provenanceValue(record.lastResetProvenance, "payload.loan.lastResetProvenance", "legacy");
  if (spreadPct === null && spreadProvenance === "confirmed") {
    contractFail("invalid_shape", "payload.loan.spreadProvenance cannot be confirmed without a spread");
  }
  if (lastReset === "" && lastResetProvenance === "confirmed") {
    contractFail("invalid_shape", "payload.loan.lastResetProvenance cannot be confirmed without a reset date");
  }
  return {
    lender,
    original: finiteNumber(record.original, "payload.loan.original", 0, SAVED_LOAN_LIMITS.maxMoney),
    outstanding: finiteNumber(record.outstanding, "payload.loan.outstanding", 0, SAVED_LOAN_LIMITS.maxMoney),
    ratePct: finiteNumber(record.ratePct, "payload.loan.ratePct", 0, SAVED_LOAN_LIMITS.maxRatePct),
    basis: enumValue(record.basis, "payload.loan.basis", ["repo", "tbill", "mclr", "fixed"] as const) as RateBasis,
    spreadPct,
    spreadProvenance,
    cycle: enumValue(record.cycle, "payload.loan.cycle", ["monthly", "quarterly", "half"] as const) as ResetCycle,
    lastReset,
    lastResetProvenance,
    monthsLeft: integerValue(record.monthsLeft, "payload.loan.monthsLeft", 0, SAVED_LOAN_LIMITS.maxMonths),
  };
}

function parseQuote(value: unknown): TransferQuote {
  const record = recordOf(value, "payload.quote");
  exactKeys(record, QUOTE_KEYS, "payload.quote");
  return {
    newRatePct: finiteNumber(record.newRatePct, "payload.quote.newRatePct", 0, SAVED_LOAN_LIMITS.maxRatePct),
    feePct: finiteNumber(record.feePct, "payload.quote.feePct", 0, 100),
    legalCharges: finiteNumber(record.legalCharges, "payload.quote.legalCharges", 0, SAVED_LOAN_LIMITS.maxMoney),
    keepTenure: booleanValue(record.keepTenure, "payload.quote.keepTenure"),
    newTenureMonths: integerValue(record.newTenureMonths, "payload.quote.newTenureMonths", 1, SAVED_LOAN_LIMITS.maxMonths),
  };
}

export function parseSavedLoanPayload(value: unknown): Readonly<SavedLoanPayload> {
  const record = recordOf(value, "payload");
  exactKeys(record, PAYLOAD_KEYS, "payload");
  const rateResolvedAt = record.rateResolvedAt === null
    ? null
    : canonicalTimestamp(record.rateResolvedAt, "payload.rateResolvedAt");
  const payload: SavedLoanPayload = {
    loan: parseLoan(record.loan),
    quote: parseQuote(record.quote),
    surplus: finiteNumber(record.surplus, "payload.surplus", 0, SAVED_LOAN_LIMITS.maxMoney),
    bufferMonths: integerValue(record.bufferMonths, "payload.bufferMonths", 0, SAVED_LOAN_LIMITS.maxBufferMonths),
    rateResolvedAt,
  };
  if (payload.loan.outstanding > payload.loan.original) {
    contractFail("invalid_number", "payload.loan.outstanding cannot exceed original principal");
  }
  return deepFreeze(payload);
}

/** Stable key order makes retries comparable without accepting a client hash. */
export function canonicalSavedLoanPayload(value: unknown): string {
  const payload = parseSavedLoanPayload(value);
  const loan = {
    lender: payload.loan.lender,
    original: payload.loan.original,
    outstanding: payload.loan.outstanding,
    ratePct: payload.loan.ratePct,
    basis: payload.loan.basis,
    spreadPct: payload.loan.spreadPct,
    cycle: payload.loan.cycle,
    lastReset: payload.loan.lastReset,
    monthsLeft: payload.loan.monthsLeft,
    // Legacy records retain their original wire shape so a lost-ack replay
    // still matches the receipt hash created before provenance was added.
    ...(payload.loan.spreadProvenance !== "legacy" || payload.loan.lastResetProvenance !== "legacy"
      ? { spreadProvenance: payload.loan.spreadProvenance, lastResetProvenance: payload.loan.lastResetProvenance }
      : {}),
  };
  return JSON.stringify({
    loan,
    quote: {
      newRatePct: payload.quote.newRatePct,
      feePct: payload.quote.feePct,
      legalCharges: payload.quote.legalCharges,
      keepTenure: payload.quote.keepTenure,
      newTenureMonths: payload.quote.newTenureMonths,
    },
    surplus: payload.surplus,
    bufferMonths: payload.bufferMonths,
    rateResolvedAt: payload.rateResolvedAt,
  });
}

export function parseRequestId(value: unknown): string {
  return uuidValue(value, "requestId");
}

export function parseExpectedRevision(value: unknown): number {
  return integerValue(value, "expectedRevision", 0, 2_147_483_647);
}

export function parseCreatedAt(value: unknown, now = Date.now()): number {
  const createdAt = canonicalTimestamp(value, "createdAt");
  const time = new Date(createdAt).getTime();
  if (time > now || now - time > SAVED_LOAN_LIMITS.maxRequestAgeMs) {
    contractFail("expired", "request is outside the supported replay window");
  }
  return time;
}
