import {
  decodeComparisonSnapshot,
  type ComparisonSnapshot,
} from "../contracts/snapshot";

export const REPORT_VERSION = "comparison-report-v1" as const;

export interface ReportWarning {
  level: "info" | "caution";
  code: string;
  message: string;
}

export interface ReportOffer {
  offerId: string;
  lender: string;
  rank: number;
  isBest: boolean;
  amount: string;
  tenure: string;
  quotedRate: string;
  rateType: string;
  rateStructure: string;
  processingFee: string;
  gst: string;
  insurance: string;
  otherFees: string;
  upfrontFees: string;
  emi: string;
  totalRepayment: string;
  totalInterest: string;
  totalCostOfBorrowing: string;
  costPerLakh: string;
  apr: string;
  aprUnavailableReason: string | null;
  warnings: ReportWarning[];
}

export interface ComparisonReportModel {
  reportVersion: typeof REPORT_VERSION;
  snapshotVersion: number;
  calculationVersion: string;
  resultId: string;
  createdAt: string;
  generatedAt: string;
  title: string;
  offers: ReportOffer[];
  assumptions: ReportWarning[];
  disclaimer: string;
  glyphCoverage: {
    supportedScripts: readonly ["Latin", "Devanagari"];
    unsupportedLenderCharacters: string[];
    unsupportedFeeLabelCharacters: string[];
    unsupportedTextCharacters: string[];
  };
}

export interface ReportModelOptions {
  generatedAt?: string;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function number(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function percent(value: number): string {
  return `${number(value)}%`;
}

function timestamp(value: string | undefined, label: string): string {
  const result = new Date(value ?? new Date().toISOString());
  if (!Number.isFinite(result.getTime())) throw new Error(`${label}_invalid`);
  return result.toISOString();
}

function tenure(value: ComparisonSnapshot["offers"][number]): string {
  return value.tenureUnit === "years"
    ? `${number(value.tenureValue, value.tenureValue % 1 === 0 ? 0 : 1)} years`
    : `${number(value.tenureValue, value.tenureValue % 1 === 0 ? 0 : 1)} months`;
}

function supportedLenderCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return (
    code >= 0x20 && code <= 0x7e ||
    (code >= 0x0900 && code <= 0x097f) ||
    code === 0x20b9
  );
}

function unsupportedLenderCharacters(lenders: string[]): string[] {
  return [...new Set(lenders.flatMap((lender) => [...lender].filter((character) => !supportedLenderCharacter(character))))];
}

function unsupportedCharacters(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => [...value].filter((character) => !supportedLenderCharacter(character))))];
}

function aprReason(row: ComparisonSnapshot["result"]["rows"][number]): string | null {
  if (row.derived.effectiveAprPct !== null) return null;
  return "The stored cash-flow series could not produce a finite APR.";
}

export function buildComparisonReportModel(
  input: ComparisonSnapshot | string | unknown,
  options: ReportModelOptions = {},
): ComparisonReportModel {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  const snapshot = decodeComparisonSnapshot(parsed);
  const offers = snapshot.result.rows
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((row) => {
      const offer = snapshot.offers.find((candidate) => candidate.id === row.offerId)!;
      return {
        offerId: offer.id,
        lender: offer.lender || `Offer ${row.rank}`,
        rank: row.rank,
        isBest: row.isBest,
        amount: money(offer.amount),
        tenure: tenure(offer),
        quotedRate: percent(offer.ratePct),
        rateType: offer.rateType === "reducing" ? "Reducing balance" : "Flat rate",
        rateStructure: offer.rateStructure === "floating" ? "Floating" : "Fixed",
        processingFee: offer.processingFee.mode === "percent" ? `${number(offer.processingFee.value)}%` : money(offer.processingFee.value),
        gst: percent(offer.gstPct),
        insurance: `${money(offer.insurancePremium)} (${offer.insuranceFunding === "financed" ? "financed" : "upfront"})`,
        otherFees: offer.otherFees.length === 0 ? "None" : offer.otherFees.map((fee) => `${fee.label}: ${money(fee.amount)}`).join("; "),
        upfrontFees: money(row.derived.upfrontFees),
        emi: money(row.derived.emi),
        totalRepayment: money(row.derived.totalRepayment),
        totalInterest: money(row.derived.totalInterest),
        totalCostOfBorrowing: money(row.derived.totalCostOfBorrowing),
        costPerLakh: money(row.derived.costPerLakh),
        apr: row.derived.effectiveAprPct === null ? "Unavailable" : percent(row.derived.effectiveAprPct),
        aprUnavailableReason: aprReason(row),
        warnings: row.derived.warnings.map((warning) => ({ ...warning })),
      } satisfies ReportOffer;
    });

  const assumptions = snapshot.result.notices.map((notice) => ({ ...notice }));
  assumptions.push({
    level: "info",
    code: "snapshot-source",
    message: "This report reproduces the stored comparison snapshot. It does not recalculate the finance result.",
  });
  return {
    reportVersion: REPORT_VERSION,
    snapshotVersion: snapshot.schemaVersion,
    calculationVersion: snapshot.calculationVersion,
    resultId: snapshot.resultId,
    createdAt: snapshot.createdAt,
    generatedAt: timestamp(options.generatedAt, "generatedAt"),
    title: "TrueCost comparison",
    offers,
    assumptions,
    disclaimer: "Illustration only. Confirm rates, fees, eligibility and repayment terms with the lender.",
    glyphCoverage: {
      supportedScripts: ["Latin", "Devanagari"],
      unsupportedLenderCharacters: unsupportedLenderCharacters(snapshot.offers.map((offer) => offer.lender)),
      unsupportedFeeLabelCharacters: unsupportedCharacters(snapshot.offers.flatMap((offer) => offer.otherFees.map((fee) => fee.label))),
      unsupportedTextCharacters: unsupportedCharacters([
        ...snapshot.offers.map((offer) => offer.lender),
        ...snapshot.offers.flatMap((offer) => offer.otherFees.map((fee) => fee.label)),
      ]),
    },
  };
}
