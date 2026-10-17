import type { LoanTypeId, RateStructure, RateType } from "./types";

export interface LoanTypeConfig {
  id: LoanTypeId;
  label: string;
  short: string;
  /**
   * Whether this product is actually built yet.
   *
   * Disabled products stay on screen rather than being deleted: the shape of
   * what is coming is worth showing, and a chip that greys out reads as a
   * roadmap where a missing chip reads as an oversight.
   */
  enabled: boolean;
  /** Home loans are floating by default in India; most other retail lending is fixed. */
  defaultRateStructure: RateStructure;
  /** Rate type we assume before the user says otherwise. */
  defaultRateType: RateType;
  /**
   * True when the product is reducing-balance by regulation or universal
   * practice, so we do not offer a flat option at all.
   */
  rateTypeLocked: boolean;
  /** Shown when flat is selectable — flat quoting is where mis-selling lives. */
  flatWarning?: string;
  typicalTenureYears: number;
  tenureBoundsYears: [number, number];
  typicalRatePct: number;
  typicalProcessingFeePct: number;
  prepayNote: string;
  taxNote: string;
  /** Whether an interest deduction exists at all, for the tax nudge. */
  taxDeductible: boolean;
}

export const LOAN_TYPES: Record<LoanTypeId, LoanTypeConfig> = {
  home: {
    id: "home",
    label: "Home loan",
    short: "Home",
    enabled: true,
    defaultRateStructure: "floating",
    defaultRateType: "reducing",
    rateTypeLocked: true,
    typicalTenureYears: 20,
    tenureBoundsYears: [1, 30],
    typicalRatePct: 8.5,
    typicalProcessingFeePct: 0.35,
    prepayNote:
      "Floating-rate home loans to individuals generally carry no foreclosure charge. Fixed-rate loans usually do — confirm before you sign.",
    taxNote:
      "Under the old regime: principal under 80C (up to ₹1.5L), interest under 24(b) (up to ₹2L, self-occupied). The new regime removes both for most borrowers.",
    taxDeductible: true,
  },
  auto: {
    id: "auto",
    label: "Car / vehicle loan",
    short: "Auto",
    enabled: false,
    defaultRateStructure: "fixed",
    defaultRateType: "reducing",
    rateTypeLocked: false,
    flatWarning:
      "Dealers and NBFCs often quote vehicle loans flat. A flat rate roughly doubles once converted — check which one you were shown.",
    typicalTenureYears: 5,
    tenureBoundsYears: [1, 8],
    typicalRatePct: 9.5,
    typicalProcessingFeePct: 0.5,
    prepayNote:
      "Foreclosure charges of 3–6% of the outstanding are common, and many lenders bar prepayment in the first 6–12 months.",
    taxNote:
      "No deduction for personal use. Interest and depreciation are claimable only if the vehicle is used for business.",
    taxDeductible: false,
  },
  personal: {
    id: "personal",
    label: "Personal loan",
    short: "Personal",
    enabled: false,
    defaultRateStructure: "fixed",
    defaultRateType: "reducing",
    rateTypeLocked: false,
    flatWarning:
      "Some lenders and most app-based products quote personal loans flat. Convert before you compare — a flat quote is not the rate you pay.",
    typicalTenureYears: 3,
    tenureBoundsYears: [1, 7],
    typicalRatePct: 14,
    typicalProcessingFeePct: 2,
    prepayNote:
      "Usually fixed-rate, so a foreclosure charge of 2–5% typically applies, often with a lock-in of 6–12 EMIs.",
    taxNote:
      "No deduction by default. Interest is claimable only if you can document that the money went into a house, business or investment.",
    taxDeductible: false,
  },
  gold: {
    id: "gold",
    label: "Gold loan",
    short: "Gold",
    enabled: false,
    defaultRateStructure: "fixed",
    defaultRateType: "reducing",
    rateTypeLocked: false,
    flatWarning:
      "Gold loans are frequently quoted flat, or as bullet schemes where interest accrues and everything falls due at maturity. Both understate the real rate.",
    typicalTenureYears: 1,
    tenureBoundsYears: [0.5, 3],
    typicalRatePct: 12,
    typicalProcessingFeePct: 0.5,
    prepayNote:
      "Prepayment is usually free after a short initial period. Short tenures mean fees weigh heavily on the effective rate.",
    taxNote:
      "No deduction unless the borrowing is traceable to business use or house construction.",
    taxDeductible: false,
  },
  business: {
    id: "business",
    label: "Business loan",
    short: "Business",
    enabled: false,
    defaultRateStructure: "floating",
    defaultRateType: "reducing",
    rateTypeLocked: false,
    flatWarning:
      "Unsecured business lending is often quoted flat or as a monthly percentage. Both need converting before any comparison means anything.",
    typicalTenureYears: 3,
    tenureBoundsYears: [0.5, 10],
    typicalRatePct: 15,
    typicalProcessingFeePct: 2,
    prepayNote:
      "Foreclosure charges are common on fixed-rate facilities. Floating-rate loans to micro and small enterprises have seen these restricted — check your sanction letter.",
    taxNote:
      "Interest is deductible as a business expense. Processing fees and GST on them are generally deductible too.",
    taxDeductible: true,
  },
  education: {
    id: "education",
    label: "Education loan",
    short: "Education",
    enabled: false,
    defaultRateStructure: "floating",
    defaultRateType: "reducing",
    rateTypeLocked: true,
    typicalTenureYears: 10,
    tenureBoundsYears: [1, 15],
    typicalRatePct: 10,
    typicalProcessingFeePct: 0.5,
    prepayNote:
      "Generally no foreclosure charge. Interest accrued during the moratorium is the cost most borrowers miss — this tool assumes repayment starts immediately.",
    taxNote:
      "Under the old regime, all interest is deductible under 80E for up to 8 years with no cap. No principal deduction.",
    taxDeductible: true,
  },
};

export const LOAN_TYPE_ORDER: LoanTypeId[] = [
  "home",
  "auto",
  "personal",
  "gold",
  "business",
  "education",
];

export const DEFAULT_GST_PCT = 18;

/** The products that can actually be selected today. */
export const ENABLED_LOAN_TYPES = LOAN_TYPE_ORDER.filter(
  (id) => LOAN_TYPES[id].enabled,
);

export function isLoanTypeEnabled(id: LoanTypeId): boolean {
  return LOAN_TYPES[id].enabled;
}

/**
 * What prepaying early actually costs, which is the whole reason the fixed or
 * floating answer is worth collecting.
 */
export const FORECLOSURE_NOTE: Record<RateStructure, string> = {
  floating:
    "RBI bars foreclosure and prepayment charges on floating-rate home loans to individual borrowers, so you can prepay any amount for free. The rate can reset, though — every figure here assumes it never does.",
  fixed:
    "Fixed-rate home loans are outside that protection and typically charge 2-4% of the outstanding to close early, often with a lock-in. Your EMI is certain; your exit is not free.",
};
