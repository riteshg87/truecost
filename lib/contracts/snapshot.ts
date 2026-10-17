import { LOAN_TYPES } from "../finance/loanTypes";
import type {
  Comparison,
  ComparisonBasis,
  RankedOffer,
} from "../finance/comparison";
import type {
  Derived,
  FeeInput,
  Offer,
  OtherFeeItem,
  Warning,
} from "../finance/types";
import {
  canonicalTimestamp,
  contractFail,
  deepFreeze,
  exactKeys,
  finiteNumber,
  integerValue,
  randomUuid,
  recordOf,
  stringValue,
  uuidValue,
} from "./errors";

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const CALCULATION_VERSION = "finance-engine-v1" as const;

/** Technical persistence limits. They are deliberately wider than normal UI hints. */
export const SNAPSHOT_LIMITS = {
  minOffers: 2,
  maxOffers: 3,
  maxIdLength: 64,
  maxLenderLength: 120,
  maxTenureValue: 1200,
  maxOtherFees: 50,
  maxFeeLabelLength: 80,
  maxMoney: 1_000_000_000_000,
  maxRatePct: 1000,
  maxGstPct: 100,
  maxWarnings: 100,
  maxWarningCodeLength: 64,
  maxWarningMessageLength: 500,
} as const;

const OFFER_KEYS = [
  "id",
  "lender",
  "loanType",
  "amount",
  "ratePct",
  "rateType",
  "rateStructure",
  "tenureValue",
  "tenureUnit",
  "processingFee",
  "gstPct",
  "insurancePremium",
  "insuranceFunding",
  "otherFees",
] as const;
const FEE_KEYS = ["mode", "value"] as const;
const OTHER_FEE_KEYS = ["id", "label", "amount"] as const;
const DERIVED_KEYS = [
  "tenureMonths",
  "monthlyRate",
  "effectiveReducingRatePct",
  "financedPrincipal",
  "emi",
  "totalRepayment",
  "totalInterest",
  "processingFeeAmount",
  "gstAmount",
  "otherFeesTotal",
  "upfrontInsurance",
  "upfrontFees",
  "netDisbursal",
  "cashInHand",
  "totalCostOfBorrowing",
  "monthlyIrr",
  "effectiveAprPct",
  "effectiveAnnualRatePct",
  "costPerLakh",
  "warnings",
] as const;
const WARNING_KEYS = ["level", "code", "message"] as const;
const BASIS_KEYS = [
  "amountsDiffer",
  "tenuresDiffer",
  "rateTypesDiffer",
  "rateStructuresDiffer",
  "loanTypesDiffer",
  "strict",
] as const;
const RANKED_KEYS = [
  "offerId",
  "derived",
  "rank",
  "isBest",
  "aprGapVsBest",
  "costGapVsBest",
  "perLakhGapVsBest",
] as const;
const RESULT_KEYS = [
  "rows",
  "basis",
  "bestId",
  "notices",
  "aprCostDisagreement",
] as const;
const SNAPSHOT_KEYS = [
  "schemaVersion",
  "calculationVersion",
  "resultId",
  "createdAt",
  "offers",
  "result",
] as const;

export interface SnapshotRankedOffer {
  offerId: string;
  derived: Derived;
  rank: number;
  isBest: boolean;
  aprGapVsBest: number | null;
  costGapVsBest: number;
  perLakhGapVsBest: number;
}

/** The result has one input copy in `offers`; rows reference it by ID. */
export interface SnapshotComparison {
  rows: SnapshotRankedOffer[];
  basis: ComparisonBasis;
  bestId: string | null;
  notices: Warning[];
  aprCostDisagreement: boolean;
}

export interface ComparisonSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  calculationVersion: string;
  resultId: string;
  createdAt: string;
  offers: Offer[];
  result: SnapshotComparison;
}

export interface SnapshotCreateOptions {
  createdAt?: string;
  calculationVersion?: string;
}

function enumValue<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    contractFail("invalid_enum", `${label} is not supported`);
  }
  return value as T;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") contractFail("invalid_shape", `${label} must be boolean`);
  return value;
}

function parseWarning(value: unknown, label: string): Warning {
  const record = recordOf(value, label);
  exactKeys(record, WARNING_KEYS, label);
  return {
    level: enumValue(record.level, `${label}.level`, ["info", "caution"]),
    code: stringValue(record.code, `${label}.code`, SNAPSHOT_LIMITS.maxWarningCodeLength),
    message: stringValue(
      record.message,
      `${label}.message`,
      SNAPSHOT_LIMITS.maxWarningMessageLength,
    ),
  };
}

function parseFee(value: unknown, label: string): FeeInput {
  const record = recordOf(value, label);
  exactKeys(record, FEE_KEYS, label);
  const mode = enumValue(record.mode, `${label}.mode`, ["percent", "flat"]);
  const max = mode === "percent" ? SNAPSHOT_LIMITS.maxGstPct : SNAPSHOT_LIMITS.maxMoney;
  return { mode, value: finiteNumber(record.value, `${label}.value`, 0, max) };
}

function parseOtherFee(value: unknown, label: string): OtherFeeItem {
  const record = recordOf(value, label);
  exactKeys(record, OTHER_FEE_KEYS, label);
  return {
    id: stringValue(record.id, `${label}.id`, SNAPSHOT_LIMITS.maxIdLength),
    label: stringValue(record.label, `${label}.label`, SNAPSHOT_LIMITS.maxFeeLabelLength, false).trim(),
    amount: finiteNumber(record.amount, `${label}.amount`, 0, SNAPSHOT_LIMITS.maxMoney),
  };
}

export function parseSnapshotOffer(value: unknown, label = "offer"): Offer {
  const record = recordOf(value, label);
  exactKeys(record, OFFER_KEYS, label);
  const otherFeesValue = record.otherFees;
  if (!Array.isArray(otherFeesValue) || otherFeesValue.length > SNAPSHOT_LIMITS.maxOtherFees) {
    contractFail("wrong_count", `${label}.otherFees has an invalid count`);
  }
  const otherFees = otherFeesValue.map((fee, index) => parseOtherFee(fee, `${label}.otherFees[${index}]`));
  if (new Set(otherFees.map((fee) => fee.id)).size !== otherFees.length) {
    contractFail("duplicate_id", `${label}.otherFees contains duplicate IDs`);
  }
  const loanType = enumValue(record.loanType, `${label}.loanType`, Object.keys(LOAN_TYPES) as Array<keyof typeof LOAN_TYPES>);
  return {
    id: stringValue(record.id, `${label}.id`, SNAPSHOT_LIMITS.maxIdLength),
    lender: stringValue(record.lender, `${label}.lender`, SNAPSHOT_LIMITS.maxLenderLength, false).trim(),
    loanType,
    amount: finiteNumber(record.amount, `${label}.amount`, 0, SNAPSHOT_LIMITS.maxMoney),
    ratePct: finiteNumber(record.ratePct, `${label}.ratePct`, 0, SNAPSHOT_LIMITS.maxRatePct),
    rateType: enumValue(record.rateType, `${label}.rateType`, ["reducing", "flat"]),
    rateStructure: enumValue(record.rateStructure, `${label}.rateStructure`, ["floating", "fixed"]),
    tenureValue: finiteNumber(record.tenureValue, `${label}.tenureValue`, 0, SNAPSHOT_LIMITS.maxTenureValue),
    tenureUnit: enumValue(record.tenureUnit, `${label}.tenureUnit`, ["months", "years"]),
    processingFee: parseFee(record.processingFee, `${label}.processingFee`),
    gstPct: finiteNumber(record.gstPct, `${label}.gstPct`, 0, SNAPSHOT_LIMITS.maxGstPct),
    insurancePremium: finiteNumber(record.insurancePremium, `${label}.insurancePremium`, 0, SNAPSHOT_LIMITS.maxMoney),
    insuranceFunding: enumValue(record.insuranceFunding, `${label}.insuranceFunding`, ["financed", "upfront"]),
    otherFees,
  };
}

function parseDerived(value: unknown, label: string): Derived {
  const record = recordOf(value, label);
  exactKeys(record, DERIVED_KEYS, label);
  const money = (field: string) => finiteNumber(record[field], `${label}.${field}`, -SNAPSHOT_LIMITS.maxMoney, SNAPSHOT_LIMITS.maxMoney);
  const rate = (field: string) => finiteNumber(record[field], `${label}.${field}`, -SNAPSHOT_LIMITS.maxRatePct, SNAPSHOT_LIMITS.maxRatePct);
  const nullable = (field: string) => {
    if (record[field] === null) return null;
    return finiteNumber(record[field], `${label}.${field}`, -SNAPSHOT_LIMITS.maxMoney, SNAPSHOT_LIMITS.maxMoney);
  };
  const warnings = record.warnings;
  if (!Array.isArray(warnings) || warnings.length > SNAPSHOT_LIMITS.maxWarnings) {
    contractFail("wrong_count", `${label}.warnings has an invalid count`);
  }
  return {
    tenureMonths: integerValue(record.tenureMonths, `${label}.tenureMonths`, 1, SNAPSHOT_LIMITS.maxTenureValue * 12),
    monthlyRate: finiteNumber(record.monthlyRate, `${label}.monthlyRate`, -SNAPSHOT_LIMITS.maxRatePct, SNAPSHOT_LIMITS.maxRatePct),
    effectiveReducingRatePct: rate("effectiveReducingRatePct"),
    financedPrincipal: money("financedPrincipal"),
    emi: money("emi"),
    totalRepayment: money("totalRepayment"),
    totalInterest: money("totalInterest"),
    processingFeeAmount: money("processingFeeAmount"),
    gstAmount: money("gstAmount"),
    otherFeesTotal: money("otherFeesTotal"),
    upfrontInsurance: money("upfrontInsurance"),
    upfrontFees: money("upfrontFees"),
    netDisbursal: money("netDisbursal"),
    cashInHand: money("cashInHand"),
    totalCostOfBorrowing: money("totalCostOfBorrowing"),
    monthlyIrr: nullable("monthlyIrr"),
    effectiveAprPct: nullable("effectiveAprPct"),
    effectiveAnnualRatePct: nullable("effectiveAnnualRatePct"),
    costPerLakh: money("costPerLakh"),
    warnings: warnings.map((warning, index) => parseWarning(warning, `${label}.warnings[${index}]`)),
  };
}

function parseBasis(value: unknown, label: string): ComparisonBasis {
  const record = recordOf(value, label);
  exactKeys(record, BASIS_KEYS, label);
  return {
    amountsDiffer: booleanValue(record.amountsDiffer, `${label}.amountsDiffer`),
    tenuresDiffer: booleanValue(record.tenuresDiffer, `${label}.tenuresDiffer`),
    rateTypesDiffer: booleanValue(record.rateTypesDiffer, `${label}.rateTypesDiffer`),
    rateStructuresDiffer: booleanValue(record.rateStructuresDiffer, `${label}.rateStructuresDiffer`),
    loanTypesDiffer: booleanValue(record.loanTypesDiffer, `${label}.loanTypesDiffer`),
    strict: booleanValue(record.strict, `${label}.strict`),
  };
}

function parseSnapshotRankedOffer(value: unknown, label: string): SnapshotRankedOffer {
  const record = recordOf(value, label);
  exactKeys(record, RANKED_KEYS, label);
  const aprGap = record.aprGapVsBest === null
    ? null
    : finiteNumber(record.aprGapVsBest, `${label}.aprGapVsBest`, -SNAPSHOT_LIMITS.maxRatePct, SNAPSHOT_LIMITS.maxRatePct);
  return {
    offerId: stringValue(record.offerId, `${label}.offerId`, SNAPSHOT_LIMITS.maxIdLength),
    derived: parseDerived(record.derived, `${label}.derived`),
    rank: integerValue(record.rank, `${label}.rank`, 1, SNAPSHOT_LIMITS.maxOffers),
    isBest: booleanValue(record.isBest, `${label}.isBest`),
    aprGapVsBest: aprGap,
    costGapVsBest: finiteNumber(record.costGapVsBest, `${label}.costGapVsBest`, -SNAPSHOT_LIMITS.maxMoney, SNAPSHOT_LIMITS.maxMoney),
    perLakhGapVsBest: finiteNumber(record.perLakhGapVsBest, `${label}.perLakhGapVsBest`, -SNAPSHOT_LIMITS.maxMoney, SNAPSHOT_LIMITS.maxMoney),
  };
}

function parseSnapshotResult(value: unknown, label = "result"): SnapshotComparison {
  const record = recordOf(value, label);
  exactKeys(record, RESULT_KEYS, label);
  if (!Array.isArray(record.rows) || record.rows.length < SNAPSHOT_LIMITS.minOffers || record.rows.length > SNAPSHOT_LIMITS.maxOffers) {
    contractFail("wrong_count", `${label}.rows has an invalid count`);
  }
  const rows = record.rows.map((row, index) => parseSnapshotRankedOffer(row, `${label}.rows[${index}]`));
  if (new Set(rows.map((row) => row.offerId)).size !== rows.length) {
    contractFail("duplicate_id", `${label}.rows contains duplicate offer IDs`);
  }
  const notices = record.notices;
  if (!Array.isArray(notices) || notices.length > SNAPSHOT_LIMITS.maxWarnings) {
    contractFail("wrong_count", `${label}.notices has an invalid count`);
  }
  const bestId = record.bestId === null
    ? null
    : stringValue(record.bestId, `${label}.bestId`, SNAPSHOT_LIMITS.maxIdLength);
  return {
    rows,
    basis: parseBasis(record.basis, `${label}.basis`),
    bestId,
    notices: notices.map((notice, index) => parseWarning(notice, `${label}.notices[${index}]`)),
    aprCostDisagreement: booleanValue(record.aprCostDisagreement, `${label}.aprCostDisagreement`),
  };
}

function verifySnapshotRelations(snapshot: ComparisonSnapshot): void {
  const offerIds = snapshot.offers.map((offer) => offer.id);
  if (new Set(offerIds).size !== offerIds.length) contractFail("duplicate_id", "offers contain duplicate IDs");
  if (snapshot.offers.length < SNAPSHOT_LIMITS.minOffers || snapshot.offers.length > SNAPSHOT_LIMITS.maxOffers) {
    contractFail("wrong_count", "snapshot must contain two or three offers");
  }
  for (const offer of snapshot.offers) {
    if (!(offer.amount > 0) || !(offer.ratePct > 0) || !(offer.tenureValue > 0)) {
      contractFail("invalid_number", "snapshot offers must contain a complete comparison input");
    }
  }
  const rows = snapshot.result.rows;
  const rowIds = rows.map((row) => row.offerId);
  if (new Set(rowIds).size !== rowIds.length || rowIds.some((id) => !offerIds.includes(id)) || rowIds.length !== offerIds.length) {
    contractFail("id_mismatch", "snapshot offer and result IDs do not match");
  }
  const ranks = [...rows].sort((a, b) => a.rank - b.rank);
  ranks.forEach((row, index) => {
    if (row.rank !== index + 1) contractFail("id_mismatch", "snapshot ranks are not contiguous");
  });
  const bestRows = rows.filter((row) => row.isBest);
  const rankOne = rows.find((row) => row.rank === 1);
  if (
    bestRows.length !== 1 ||
    !rankOne ||
    !rankOne.isBest ||
    bestRows[0] !== rankOne ||
    snapshot.result.bestId !== rankOne.offerId
  ) {
    contractFail("id_mismatch", "snapshot best result does not match its rows");
  }
  for (const row of rows) {
    const offer = snapshot.offers.find((candidate) => candidate.id === row.offerId)!;
    if (JSON.stringify(parseSnapshotOffer(offer)) !== JSON.stringify(offer)) {
      contractFail("invalid_shape", "snapshot offers must be normalized");
    }
  }
}

export function createComparisonSnapshot(
  offers: Offer[],
  comparison: Comparison,
  options: SnapshotCreateOptions = {},
): Readonly<ComparisonSnapshot> {
  if (!Array.isArray(offers) || offers.length < SNAPSHOT_LIMITS.minOffers || offers.length > SNAPSHOT_LIMITS.maxOffers) {
    contractFail("wrong_count", "snapshot must contain two or three offers");
  }
  const normalizedOffers = offers.map((offer, index) => parseSnapshotOffer(offer, `offers[${index}]`));
  const resultRows = comparison.rows;
  if (!Array.isArray(resultRows) || resultRows.length !== normalizedOffers.length) {
    contractFail("id_mismatch", "comparison rows do not match the offers");
  }
  for (const row of resultRows) {
    const normalized = normalizedOffers.find((offer) => offer.id === row.offer.id);
    if (!normalized || JSON.stringify(parseSnapshotOffer(row.offer)) !== JSON.stringify(normalized)) {
      contractFail("id_mismatch", "comparison row input does not match the snapshot offer");
    }
  }
  const createdAt = canonicalTimestamp(options.createdAt ?? new Date().toISOString(), "createdAt");
  const calculationVersion = stringValue(
    options.calculationVersion ?? CALCULATION_VERSION,
    "calculationVersion",
    64,
  );
  const snapshot: ComparisonSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    calculationVersion,
    resultId: randomUuid(),
    createdAt,
    offers: normalizedOffers,
    result: {
      rows: resultRows.map((row) => ({
        offerId: row.offer.id,
        derived: { ...row.derived, warnings: row.derived.warnings.map((warning) => ({ ...warning })) },
        rank: row.rank,
        isBest: row.isBest,
        aprGapVsBest: row.aprGapVsBest,
        costGapVsBest: row.costGapVsBest,
        perLakhGapVsBest: row.perLakhGapVsBest,
      })),
      basis: { ...comparison.basis },
      bestId: comparison.best?.offer.id ?? null,
      notices: comparison.notices.map((notice) => ({ ...notice })),
      aprCostDisagreement: comparison.aprCostDisagreement,
    },
  };
  // Reuse the persisted-data decoder so a caller cannot capture a malformed
  // derived result by bypassing the runtime parser at construction time.
  return decodeComparisonSnapshot(snapshot);
}

export function decodeComparisonSnapshot(value: unknown): Readonly<ComparisonSnapshot> {
  const record = recordOf(value, "snapshot");
  exactKeys(record, SNAPSHOT_KEYS, "snapshot");
  const schemaVersion = integerValue(record.schemaVersion, "snapshot.schemaVersion", 1, Number.MAX_SAFE_INTEGER);
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    contractFail("unsupported_schema", `snapshot schema ${schemaVersion} is unsupported`);
  }
  const offersValue = record.offers;
  if (!Array.isArray(offersValue) || offersValue.length < SNAPSHOT_LIMITS.minOffers || offersValue.length > SNAPSHOT_LIMITS.maxOffers) {
    contractFail("wrong_count", "snapshot must contain two or three offers");
  }
  const snapshot: ComparisonSnapshot = {
    schemaVersion,
    calculationVersion: stringValue(record.calculationVersion, "snapshot.calculationVersion", 64),
    resultId: uuidValue(record.resultId, "snapshot.resultId"),
    createdAt: canonicalTimestamp(record.createdAt, "snapshot.createdAt"),
    offers: offersValue.map((offer, index) => parseSnapshotOffer(offer, `snapshot.offers[${index}]`)),
    result: parseSnapshotResult(record.result),
  };
  verifySnapshotRelations(snapshot);
  return deepFreeze(snapshot);
}

export function serializeComparisonSnapshot(snapshot: ComparisonSnapshot): string {
  return JSON.stringify(decodeComparisonSnapshot(snapshot));
}

/** Rebuilds the current result shape from stored values. It never calls computeOffer or compareOffers. */
export function materializeComparison(snapshot: ComparisonSnapshot): Comparison {
  const decoded = decodeComparisonSnapshot(snapshot);
  const rows: RankedOffer[] = decoded.result.rows
    .map((row) => ({
      offer: decoded.offers.find((offer) => offer.id === row.offerId)!,
      derived: row.derived,
      rank: row.rank,
      isBest: row.isBest,
      aprGapVsBest: row.aprGapVsBest,
      costGapVsBest: row.costGapVsBest,
      perLakhGapVsBest: row.perLakhGapVsBest,
    }))
    .sort((a, b) => a.rank - b.rank);
  return {
    rows,
    basis: decoded.result.basis,
    best: rows.find((row) => row.offer.id === decoded.result.bestId) ?? null,
    notices: decoded.result.notices,
    aprCostDisagreement: decoded.result.aprCostDisagreement,
  };
}
