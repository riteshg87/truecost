import { parseSavedLoanPayload, type SavedLoanPayload } from "./contracts/saved-loan";

const record = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const numberOr = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;

const integerOr = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;

const dateOrBlank = (value: unknown): string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";

/** Parse the pre-Clerk device record without reading or mutating storage. */
export function parseLegacyDeviceLoan(value: unknown): SavedLoanPayload | null {
  const root = record(value);
  const rawLoan = record(root?.loan);
  if (!rawLoan || typeof rawLoan.outstanding !== "number" || typeof rawLoan.ratePct !== "number" || typeof rawLoan.monthsLeft !== "number") return null;
  const rawQuote = record(root?.quote);
  const normalized = {
    loan: {
      lender: typeof rawLoan.lender === "string" ? rawLoan.lender : "",
      original: numberOr(rawLoan.original, numberOr(rawLoan.outstanding, 0, 0, 1_000_000_000_000), 0, 1_000_000_000_000),
      outstanding: numberOr(rawLoan.outstanding, 0, 0, 1_000_000_000_000),
      ratePct: numberOr(rawLoan.ratePct, 0, 0, 1000),
      basis: ["repo", "tbill", "mclr", "fixed"].includes(rawLoan.basis as string) ? rawLoan.basis : "repo",
      spreadPct: typeof rawLoan.spreadPct === "number" && Number.isFinite(rawLoan.spreadPct) ? rawLoan.spreadPct : null,
      spreadProvenance: "legacy",
      cycle: ["monthly", "quarterly", "half"].includes(rawLoan.cycle as string) ? rawLoan.cycle : "quarterly",
      lastReset: dateOrBlank(rawLoan.lastReset),
      lastResetProvenance: "legacy",
      monthsLeft: integerOr(rawLoan.monthsLeft, 0, 0, 1200),
    },
    quote: {
      newRatePct: numberOr(rawQuote?.newRatePct, 0, 0, 1000),
      feePct: numberOr(rawQuote?.feePct, 0.25, 0, 100),
      legalCharges: numberOr(rawQuote?.legalCharges, 5000, 0, 1_000_000_000_000),
      keepTenure: typeof rawQuote?.keepTenure === "boolean" ? rawQuote.keepTenure : true,
      newTenureMonths: integerOr(rawQuote?.newTenureMonths, 240, 1, 1200),
    },
    surplus: numberOr(root?.surplus, 0, 0, 1_000_000_000_000),
    bufferMonths: integerOr(root?.bufferMonths, 0, 0, 120),
    rateResolvedAt: typeof root?.rateResolvedAt === "string" ? root.rateResolvedAt : null,
  };
  try { return parseSavedLoanPayload(normalized) as SavedLoanPayload; }
  catch { return null; }
}

