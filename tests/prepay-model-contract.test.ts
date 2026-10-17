import { describe, expect, it } from "vitest";
import {
  PREPAY_MODEL_CONTRACT_VERSION,
  validatePrepayModelInput,
  type PrepayModelInput,
} from "../lib/prepay/model-contract";

function validInput(overrides: Partial<PrepayModelInput> = {}): PrepayModelInput {
  const base: PrepayModelInput = {
    metadata: {
      modelVersion: PREPAY_MODEL_CONTRACT_VERSION,
      calculationTime: "2026-09-17T12:00:00.000Z",
      sourceDates: [{ sourceId: "tax-source-review", effectiveDate: "2026-04-01", lastReviewedDate: "2026-09-16" }],
      assumptions: ["Return schedule is supplied by the scenario owner."],
    },
    tax: {
      calculationDate: "2026-09-17",
      taxYears: [{ taxYear: "2026-27", assessmentYear: null, startDate: "2026-04-01", endDate: "2027-03-31", taxActVersion: "2025" }],
      regime: "old",
      annualContexts: [{
        taxYear: "2026-27",
        backgroundOrdinaryTaxableIncome: 1_000_000,
        specialRateIncome: [],
        ageDuringTaxYear: 35,
        agriculturalIncome: { kind: "known", amount: 0 },
        losses: {
          currentYear: { kind: "known", amount: 0 },
          carryForward: { kind: "known", amount: 0 },
        },
        roundingConvention: "raw-unrounded-arithmetic",
        sourceVersion: "annual-tax-source-v1",
      }],
      taxpayerScope: { residenceStatus: "resident", profileFlags: [] },
      taxBenefitReceiptRule: { kind: "rule", ruleId: "after-filing", reinvest: false },
    },
    loan: {
      loanType: "home",
      outstandingAtCalculationDate: 1_000_000,
      rateType: "reducing",
      rateStructure: "floating",
      ratePct: 8.5,
      remainingMonths: 6,
      currentEmi: null,
      paymentSchedule: {
        dateRule: "calendar-months-from-anchor",
        paymentDates: ["2026-10-17", "2026-11-17", "2026-12-17", "2027-01-17", "2027-02-17", "2027-03-17"],
        roundingRule: "final-payment-due",
      },
      prepaymentDate: "2026-09-17",
      prepayAmount: 100_000,
      prepayFeePct: 0,
      otherFees: 0,
      prepaymentFeeAmount: 0,
      feeFunding: "extra-cash-budget",
      propertyUse: "self_occupied_acquisition",
      propertyEligibilityFacts: { completionEvidence: "declared" },
      remaining24bCapacityByTaxYear: [{ taxYear: "2026-27", amount: 0 }],
      remaining80cCapacityByTaxYear: [{ taxYear: "2026-27", amount: 0 }],
      ownershipShare: 1,
    },
    investment: {
      assetClass: "equity",
      instrumentSubtype: "listed-equity-112A",
      principalInvested: 100_000,
      investmentDate: "2026-09-17",
      expectedGrossReturnPct: 11,
      returnSchedule: {
        convention: "monthly",
        horizonMonths: 6,
        events: [
          { date: "2026-10-17", grossRatePct: 11 },
          { date: "2026-11-17", grossRatePct: 11 },
          { date: "2026-12-17", grossRatePct: 11 },
          { date: "2027-01-17", grossRatePct: 11 },
          { date: "2027-02-17", grossRatePct: 11 },
          { date: "2027-03-17", grossRatePct: 11 },
        ],
      },
      contributionLots: [{ lotId: "initial", amount: 100_000, acquisitionDate: "2026-09-17" }],
      taxEventSchedule: [{ eventId: "disposal", date: "2027-03-17", kind: "disposal", reinvest: false }],
      acquisitionCost: 100_000,
      acquisitionDate: "2026-09-17",
      disposalDate: "2027-03-17",
      proceedsRule: "documented-proceeds",
      expenseRule: "documented-transfer-expenses",
      sttEligibility: "declared",
      exemptionHeadroom: 0,
    },
    budget: {
      surplus: 100_000,
      applicablePrepaymentFees: 0,
      investmentInitialCash: 100_000,
      feeTreatment: "extra-cash-budget",
    },
  };
  return { ...base, ...overrides };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutField<T extends object>(value: T, key: string): Omit<T, keyof T> {
  const copy = { ...value } as Record<string, unknown>;
  delete copy[key];
  return copy as Omit<T, keyof T>;
}

describe("prepayment model contract", () => {
  it("marks complete structure as still financially unsupported", () => {
    const result = validatePrepayModelInput(validInput());
    expect(result.status).toBe("structurally-complete");
    expect(result.support).toEqual({
      status: "unsupported",
      reason: "financial-methodology-review-required",
      missingFields: [],
    });
  });

  it("requires annual contexts instead of accepting the legacy fixed-factor tax record", () => {
    const base = validInput();
    const legacyTax = {
      ...withoutField(base.tax, "annualContexts"),
      ordinaryMarginalRatePct: 30,
      surchargePolicy: { kind: "declared-zero" },
      cessPct: 4,
    };
    const result = validatePrepayModelInput({ ...base, tax: legacyTax });
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tax.annualContexts", issue: "missing" }),
    ]));
  });

  it("requires exactly one annual context for every tax year", () => {
    const base = validInput();
    const nextYear = { taxYear: "2027-28", assessmentYear: null, startDate: "2027-04-01", endDate: "2028-03-31", taxActVersion: "2025" as const };
    const missing = validatePrepayModelInput({
      ...base,
      tax: { ...base.tax, taxYears: [...base.tax.taxYears, nextYear] },
    });
    expect(missing.status).toBe("structurally-incomplete");
    expect(missing.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tax.annualContexts.taxYear", issue: "missing" }),
    ]));

    const context = base.tax.annualContexts[0];
    const duplicate = validatePrepayModelInput({
      ...base,
      tax: { ...base.tax, annualContexts: [context, { ...context }] },
    });
    expect(duplicate.status).toBe("structurally-incomplete");
    expect(duplicate.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tax.annualContexts.taxYear", issue: "invalid" }),
    ]));

    const duplicateTaxYear = validatePrepayModelInput({
      ...base,
      tax: { ...base.tax, taxYears: [base.tax.taxYears[0], { ...base.tax.taxYears[0], startDate: "2027-04-01", endDate: "2028-03-31" }] },
    });
    expect(duplicateTaxYear.status).toBe("structurally-incomplete");
    expect(duplicateTaxYear.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tax.taxYears.date", issue: "invalid" }),
    ]));
  });

  it("accepts explicit zero annual amounts and an age that is not needed", () => {
    const base = validInput();
    const context = base.tax.annualContexts[0];
    const result = validatePrepayModelInput({
      ...base,
      tax: {
        ...base.tax,
        regime: "new",
        annualContexts: [{
          ...context,
          backgroundOrdinaryTaxableIncome: 0,
          ageDuringTaxYear: null,
          agriculturalIncome: { kind: "known", amount: 0 },
          losses: { currentYear: { kind: "known", amount: 0 }, carryForward: { kind: "known", amount: 0 } },
        }],
      },
    });
    expect(result.status).toBe("structurally-complete");
  });

  it("requires age for the old regime while allowing null for the new regime", () => {
    const base = validInput();
    const context = base.tax.annualContexts[0];
    const result = validatePrepayModelInput({
      ...base,
      tax: { ...base.tax, annualContexts: [{ ...context, ageDuringTaxYear: null }] },
    });
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tax.annualContexts.age", issue: "missing" }),
    ]));
  });

  it("keeps unknown annual facts explicit and incomplete instead of treating them as zero", () => {
    const base = validInput();
    const context = base.tax.annualContexts[0];
    const result = validatePrepayModelInput({
      ...base,
      tax: {
        ...base.tax,
        annualContexts: [{
          ...context,
          backgroundOrdinaryTaxableIncome: undefined as never,
          specialRateIncome: [{ kind: "unknown", category: null, reason: "not supplied" }],
          agriculturalIncome: { kind: "unknown", reason: "not supplied" },
          losses: { currentYear: { kind: "unknown", reason: "not supplied" }, carryForward: { kind: "known", amount: 0 } },
        }],
      },
    });
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tax.annualContexts.backgroundIncome", issue: "missing" }),
      expect.objectContaining({ code: "tax.annualContexts.specialRateIncome", issue: "missing" }),
      expect.objectContaining({ code: "tax.annualContexts.agriculturalIncome", issue: "missing" }),
      expect.objectContaining({ code: "tax.annualContexts.losses", issue: "missing" }),
    ]));
  });

  it("rejects malformed annual context values and rounding conventions", () => {
    const base = validInput();
    const context = base.tax.annualContexts[0];
    const result = validatePrepayModelInput({
      ...base,
      tax: {
        ...base.tax,
        annualContexts: [{ ...context, backgroundOrdinaryTaxableIncome: Number.NaN, roundingConvention: "bankers" as never }],
      },
    });
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tax.annualContexts.backgroundIncome", issue: "invalid" }),
      expect.objectContaining({ code: "tax.annualContexts.rounding", issue: "invalid" }),
    ]));
  });

  it("reports malformed dates and does not mutate the supplied record", () => {
    const input = validInput();
    const malformed = {
      ...input,
      metadata: { ...input.metadata, calculationTime: "17 September 2026" },
      tax: { ...input.tax, taxYears: input.tax.taxYears.map((year) => ({ ...year, startDate: "2026-02-30" })) },
    };
    const before = JSON.stringify(malformed);

    const result = validatePrepayModelInput(malformed);

    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "metadata.calculationTime", issue: "invalid" }),
      expect.objectContaining({ code: "tax.taxYears.date", issue: "invalid" }),
    ]));
    expect(JSON.stringify(malformed)).toBe(before);
  });

  it("rejects a tax year whose end precedes its start", () => {
    const base = validInput();
    const malformed = {
      ...base,
      tax: {
        ...base.tax,
        taxYears: [{ ...base.tax.taxYears[0], startDate: "2027-03-31", endDate: "2026-04-01" }],
      },
    };
    const result = validatePrepayModelInput(malformed);
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tax.taxYears.date", issue: "invalid" }),
    ]));
  });

  it.each(["fd", "debt"] as const)("keeps a complete %s investment shape expressible", (assetClass) => {
    const base = validInput();
    const investment = assetClass === "fd"
      ? {
          assetClass: "fd" as const,
          instrumentSubtype: "fd-interest",
          principalInvested: 100_000,
          investmentDate: "2026-09-17",
          expectedGrossReturnPct: 7,
          returnSchedule: { convention: "dated" as const, horizonMonths: 6, events: [{ date: "2026-10-17", grossRatePct: 7 }] },
          contributionLots: [{ lotId: "initial", amount: 100_000, acquisitionDate: "2026-09-17" }],
          taxEventSchedule: [{ eventId: "credit", date: "2027-03-17", kind: "credit", reinvest: false }],
          contractualRatePct: 7,
          payoutRule: "maturity",
          creditSchedule: [{ eventId: "credit", date: "2027-03-17", kind: "credit", reinvest: false }],
        }
      : {
          ...base.investment,
          assetClass: "debt" as const,
          instrumentSubtype: "specified-mutual-fund-50AA",
          fundClassification: { ruleId: "classification-review", effectiveDate: "2026-04-01" },
        };
    const result = validatePrepayModelInput({ ...base, investment });
    expect(result.status).toBe("structurally-complete");
  });

  it("distinguishes zero deduction headroom from omitted headroom", () => {
    const zero = validatePrepayModelInput(validInput());
    expect(zero.status).toBe("structurally-complete");

    const base = validInput();
    const omitted = { ...base, loan: withoutField(base.loan, "remaining80cCapacityByTaxYear") };
    const result = validatePrepayModelInput(omitted);
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "loan.remaining80cCapacityByTaxYear", issue: "missing" }),
    ]));
  });

  it("requires an assessment year for a 1961 Act record but accepts explicit 2025 Act not-applicable", () => {
    const accepted = validatePrepayModelInput(validInput());
    expect(accepted.status).toBe("structurally-complete");

    const omitted = validInput();
    const omittedYear = withoutField(omitted.tax.taxYears[0], "assessmentYear");
    expect(validatePrepayModelInput({ ...omitted, tax: { ...omitted.tax, taxYears: [omittedYear] } }).status)
      .toBe("structurally-incomplete");

    const base = validInput();
    const missingAssessmentYear = {
      ...base,
      tax: {
        ...base.tax,
        taxYears: [{ ...base.tax.taxYears[0], taxActVersion: "1961" as const, assessmentYear: null }],
      },
    };
    const result = validatePrepayModelInput(missingAssessmentYear);
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "tax.taxYears.date", issue: "invalid" }),
    ]));
  });

  it("rejects capacity rows that refer to an unrepresented tax year", () => {
    const base = validInput();
    const input = {
      ...base,
      loan: {
        ...base.loan,
        remaining80cCapacityByTaxYear: [{ taxYear: "2027-28", amount: 0 }],
      },
    };
    const result = validatePrepayModelInput(input);
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "loan.remaining80cCapacityByTaxYear", issue: "invalid" }),
    ]));
  });

  it("requires every payment tax year to have an explicit capacity row", () => {
    const base = validInput();
    const input = {
      ...base,
      tax: {
        ...base.tax,
        taxYears: [
          { ...base.tax.taxYears[0], endDate: "2026-12-31" },
          { taxYear: "2027-28", assessmentYear: null, startDate: "2027-01-01", endDate: "2027-03-31", taxActVersion: "2025" as const },
        ],
      },
      loan: {
        ...base.loan,
        remaining24bCapacityByTaxYear: [{ taxYear: "2026-27", amount: 0 }],
        remaining80cCapacityByTaxYear: [{ taxYear: "2026-27", amount: 0 }],
      },
    };
    const result = validatePrepayModelInput(input);
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "loan.remaining80cCapacityByTaxYear", issue: "missing" }),
      expect.objectContaining({ code: "loan.remaining24bCapacityByTaxYear", issue: "missing" }),
    ]));
  });

  it("rejects inconsistent payment dates and disposal lots", () => {
    const base = validInput();
    const input = {
      ...base,
      loan: {
        ...base.loan,
        paymentSchedule: { ...base.loan.paymentSchedule, paymentDates: ["2026-10-17", "2026-10-17", "2026-11-17"] },
      },
      investment: {
        ...base.investment,
        contributionLots: [{ ...base.investment.contributionLots[0], acquisitionDate: "2027-04-01" }],
      },
    };
    const result = validatePrepayModelInput(input);
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "loan.paymentSchedule.term", issue: "invalid" }),
      expect.objectContaining({ code: "investment.disposalFacts", issue: "invalid" }),
    ]));
  });

  it.each([
    ["fd", { creditSchedule: [] }, "investment.fdCreditSchedule"],
    ["equity", { disposalDate: undefined }, "investment.disposalFacts"],
    ["debt", { fundClassification: undefined }, "investment.debtClassification"],
  ] as const)("requires %s-specific tax facts", (assetClass, _patch, code) => {
    const base = validInput();
    let input: PrepayModelInput | Record<string, unknown> = base;
    if (assetClass === "fd") {
      input = {
        ...base,
        investment: {
        assetClass: "fd",
        instrumentSubtype: "fd-interest",
        principalInvested: 100_000,
        investmentDate: "2026-09-17",
        expectedGrossReturnPct: 7,
        returnSchedule: { convention: "dated", horizonMonths: 6, events: [{ date: "2026-10-17", grossRatePct: 7 }] },
        contributionLots: [{ lotId: "initial", amount: 100_000, acquisitionDate: "2026-09-17" }],
        taxEventSchedule: [{ eventId: "credit", date: "2027-09-17", kind: "credit", reinvest: false }],
        contractualRatePct: 7,
        payoutRule: "maturity",
        creditSchedule: [],
        },
      };
    } else if (assetClass === "equity") {
      input = { ...base, investment: withoutField(base.investment, "disposalDate") };
    } else {
      input = { ...base, investment: { ...withoutField(base.investment, "fundClassification"), assetClass: "debt" } };
    }
    const result = validatePrepayModelInput(input);
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code, issue: expect.any(String) }),
    ]));
    void _patch;
  });

  it("enforces the accepted equal extra-cash budget", () => {
    const input = validInput({ budget: { surplus: 100_000, applicablePrepaymentFees: 15_000, investmentInitialCash: 100_000, feeTreatment: "extra-cash-budget" } });
    const result = validatePrepayModelInput(input);
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "budget.sameExtraCashBudget", issue: "invalid" }),
    ]));
  });

  it("cross-checks the budget against the declared loan and investment amounts", () => {
    const base = validInput();
    const input = {
      ...base,
      budget: { surplus: 90_000, applicablePrepaymentFees: 0, investmentInitialCash: 90_000, feeTreatment: "extra-cash-budget" as const },
    };
    const result = validatePrepayModelInput(input);
    expect(result.status).toBe("structurally-incomplete");
    expect(result.support.missingFields.filter(({ code }) => code === "budget.sameExtraCashBudget")).toHaveLength(2);
  });
});
