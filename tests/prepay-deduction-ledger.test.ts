import { describe, expect, it } from "vitest";
import { buildDatedLoanSchedule } from "../lib/prepay/cashflows";
import { ANNUAL_ORDINARY_TAX_SOURCE_VERSION } from "../lib/prepay/annual-ordinary-tax";
import type { DatedLoanSchedule } from "../lib/prepay/cashflows";
import type { NormalizedTaxProfile } from "../lib/prepay/model-contract";
import { buildDatedDeductionLedger, type DeductionYearPolicy } from "../lib/prepay/deduction-ledger";

const policy = (financialYear: number, overrides: Partial<DeductionYearPolicy> = {}): DeductionYearPolicy => ({
  financialYear,
  interestEligible: true,
  principalEligible: false,
  interestHeadroom: 1_000_000,
  principalHeadroom: 0,
  effectiveTaxFactor: 0.312,
  benefitReceiptDate: `${financialYear + 1}-08-31`,
  reinvestBenefits: false,
  immediatePrincipalEligible: false,
  ...overrides,
});

const zeroFact = () => ({ kind: "known" as const, amount: 0 });

function annualProfile(options: {
  readonly backgroundOrdinaryTaxableIncome?: number;
  readonly regime?: "new" | "old";
  readonly ageDuringTaxYear?: number | null;
  readonly roundingConvention?: "raw-unrounded-arithmetic" | "statutory-section-516";
  readonly specialRateIncome?: NormalizedTaxProfile["annualContexts"][number]["specialRateIncome"];
} = {}): NormalizedTaxProfile {
  return {
    calculationDate: "2026-09-17",
    taxYears: [{ taxYear: "2026-27", assessmentYear: null, startDate: "2026-04-01", endDate: "2027-03-31", taxActVersion: "2025" }],
    regime: options.regime ?? "new",
    annualContexts: [{
      taxYear: "2026-27",
      backgroundOrdinaryTaxableIncome: options.backgroundOrdinaryTaxableIncome ?? 1_250_000,
      specialRateIncome: options.specialRateIncome ?? [],
      ageDuringTaxYear: options.ageDuringTaxYear ?? null,
      agriculturalIncome: zeroFact(),
      losses: { currentYear: zeroFact(), carryForward: zeroFact() },
      roundingConvention: options.roundingConvention ?? "raw-unrounded-arithmetic",
      sourceVersion: ANNUAL_ORDINARY_TAX_SOURCE_VERSION,
    }],
    taxpayerScope: { residenceStatus: "resident", profileFlags: [] },
    taxBenefitReceiptRule: { kind: "rule", ruleId: "after-filing", reinvest: false },
  };
}

function interestOnlySchedule(interest: number): DatedLoanSchedule {
  return {
    anchorDate: "2026-04-01",
    originalPrincipal: 100_000,
    immediatePrepayment: 0,
    rows: [{ period: 0, date: "2026-04-01", financialYear: 2026, openingBalance: 100_000, interest, scheduledPayment: interest, scheduledPrincipal: 0, immediatePrepayment: 0, closingBalance: 100_000 }],
    financialYearTotals: [{ financialYear: 2026, interest, scheduledPayment: interest, scheduledPrincipal: 0, immediatePrepayment: 0 }],
    totalInterest: interest,
    totalScheduledPayment: interest,
    totalScheduledPrincipal: 0,
    remainingBalance: 100_000,
    cleared: false,
  };
}

function bSchedule() {
  return buildDatedLoanSchedule({ anchorDate: "2026-01-31", principal: 1_000_000, monthlyRate: 0.12 / 12, scheduledEmi: 172548.3667108814, termMonths: 6 });
}

function dSchedule() {
  return buildDatedLoanSchedule({ anchorDate: "2026-02-15", principal: 500_000, monthlyRate: 0.12 / 12, scheduledEmi: 48227.037855632, termMonths: 11 });
}

describe("dated deduction ledger", () => {
  it("allocates fixture B actual six-payment interest and emits dated benefits", () => {
    const schedule = bSchedule();
    const result = buildDatedDeductionLedger({ schedule, policies: [
      policy(2025, { benefitReceiptDate: "2026-04-01" }),
      policy(2026, { benefitReceiptDate: "2026-08-31" }),
    ] });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.years.reduce((sum, year) => sum + year.actualInterest, 0)).toBeCloseTo(35290.2002652885, 8);
    expect(result.value.totalTaxBenefit).toBeCloseTo(11010.5424827708, 8);
    expect(result.value.benefitCashflows).toEqual([
      expect.objectContaining({ financialYear: 2025, date: "2026-04-01", reinvested: false }),
      expect.objectContaining({ financialYear: 2026, date: "2026-08-31", reinvested: false }),
    ]);
  });

  it("changes only the capacity-limited benefit for fixture C", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-04-01", principal: 2_000_000, monthlyRate: 0.12 / 12, scheduledEmi: 177697.5773566834, termMonths: 12 });
    const zero = buildDatedDeductionLedger({ schedule, policies: [
      policy(2026, { interestHeadroom: 0, benefitReceiptDate: "2027-03-31" }),
      policy(2027, { interestHeadroom: 0, benefitReceiptDate: "2027-05-01" }),
    ] });
    const partial = buildDatedDeductionLedger({ schedule, policies: [
      policy(2026, { interestHeadroom: 80_000, benefitReceiptDate: "2027-03-31" }),
      policy(2027, { interestHeadroom: 80_000, benefitReceiptDate: "2027-05-01" }),
    ] });
    expect(zero.kind).toBe("ok");
    expect(partial.kind).toBe("ok");
    if (zero.kind !== "ok" || partial.kind !== "ok") return;
    expect(zero.value.totalTaxBenefit).toBe(0);
    expect(partial.value.totalTaxBenefit).toBeCloseTo(25508.9271696563, 8);
    expect(partial.value.years[0].interestUsed).toBe(80_000);
    expect(partial.value.years[1].interestUsed).toBeCloseTo(1759.38195402657, 8);
  });

  it("splits fixture D interest and capacity at the financial-year boundary", () => {
    const schedule = dSchedule();
    const result = buildDatedDeductionLedger({ schedule, policies: [
      policy(2025, { interestHeadroom: 4_000, benefitReceiptDate: "2026-03-31" }),
      policy(2026, { interestHeadroom: 20_000, benefitReceiptDate: "2027-07-31" }),
    ] });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.years.map((year) => year.interestUsed)).toEqual([4_000, 20_000]);
    expect(result.value.totalTaxBenefit).toBeCloseTo(7488, 8);
    expect(result.value.years[0].actualInterest).toBeCloseTo(5000, 8);
    expect(result.value.years[1].actualInterest).toBeCloseTo(25497.4164119516, 8);
  });

  it("accepts explicit zero headroom and marks missing headroom unsupported", () => {
    const schedule = bSchedule();
    const zero = buildDatedDeductionLedger({ schedule, policies: [
      policy(2025, { interestHeadroom: 0, benefitReceiptDate: "2026-04-01" }),
      policy(2026, { interestHeadroom: 0, benefitReceiptDate: "2026-08-31" }),
    ] });
    const missing: Record<string, unknown> = { ...policy(2025, { benefitReceiptDate: "2026-04-01" }) };
    delete missing.interestHeadroom;
    expect(zero).toMatchObject({ kind: "ok", value: { totalTaxBenefit: 0 } });
    expect(buildDatedDeductionLedger({ schedule, policies: [missing as unknown as DeductionYearPolicy, policy(2026, { benefitReceiptDate: "2026-08-31" })] })).toMatchObject({ kind: "unsupported", reason: "missing-headroom" });
  });

  it("rejects duplicate or mismatched financial years without a partial ledger", () => {
    const schedule = bSchedule();
    expect(buildDatedDeductionLedger({ schedule, policies: [policy(2025, { benefitReceiptDate: "2026-04-01" }), policy(2025, { benefitReceiptDate: "2026-04-01" }), policy(2026, { benefitReceiptDate: "2026-08-31" })] })).toMatchObject({ kind: "invalid", reason: "duplicate-financial-year" });
    const mismatched = { ...schedule, rows: schedule.rows.map((row, index) => index === 1 ? { ...row, financialYear: row.financialYear + 1 } : row) };
    expect(buildDatedDeductionLedger({ schedule: mismatched, policies: [policy(2025), policy(2026)] })).toMatchObject({ kind: "invalid", reason: "mismatched-financial-year" });
  });

  it("requires receipt after the last deduction-producing row", () => {
    const schedule = bSchedule();
    expect(buildDatedDeductionLedger({ schedule, policies: [
      policy(2025, { benefitReceiptDate: "2026-03-30" }),
      policy(2026, { benefitReceiptDate: "2026-08-31" }),
    ] })).toMatchObject({ kind: "invalid", reason: "receipt-before-deduction", financialYear: 2025 });
  });

  it("includes immediate principal only with the explicit eligibility flag", () => {
    const schedule = buildDatedLoanSchedule({ anchorDate: "2026-01-01", principal: 100_000, monthlyRate: 0.01, scheduledEmi: 100_000, termMonths: 1, immediatePrepayment: { amount: 10_000 } });
    const excluded = buildDatedDeductionLedger({ schedule, policies: [
      policy(2025, { interestEligible: false, principalEligible: true, principalHeadroom: 100_000, benefitReceiptDate: "2026-02-01" }),
    ] });
    const included = buildDatedDeductionLedger({ schedule, policies: [
      policy(2025, { interestEligible: false, principalEligible: true, principalHeadroom: 100_000, immediatePrincipalEligible: true, benefitReceiptDate: "2026-02-01" }),
    ] });
    expect(excluded).toMatchObject({ kind: "ok", value: { years: [expect.objectContaining({ principalUsed: 90000, actualImmediatePrincipal: 10000 })] } });
    expect(included).toMatchObject({ kind: "ok", value: { years: [expect.objectContaining({ principalUsed: 100000 })] } });
  });

  it("rejects non-finite schedule values and never mutates input", () => {
    const schedule = bSchedule();
    const before = structuredClone(schedule);
    const invalid = { ...schedule, rows: schedule.rows.map((row, index) => index === 2 ? { ...row, interest: Number.NaN } : row) };
    expect(buildDatedDeductionLedger({ schedule: invalid, policies: [policy(2025), policy(2026)] })).toMatchObject({ kind: "invalid", reason: "invalid-interest" });
    expect(schedule).toEqual(before);
  });

  it("rejects totals-consistent rows with broken accounting or balance continuity", () => {
    const schedule = bSchedule();
    const paymentMismatch = {
      ...schedule,
      totalScheduledPayment: schedule.totalScheduledPayment + 1,
      rows: schedule.rows.map((row, index) => index === 1 ? { ...row, scheduledPayment: row.scheduledPayment + 1 } : row),
    };
    expect(buildDatedDeductionLedger({ schedule: paymentMismatch, policies: [policy(2025), policy(2026)] }))
      .toMatchObject({ kind: "invalid", reason: "mismatched-payment-accounting" });

    const continuityMismatch = {
      ...schedule,
      rows: schedule.rows.map((row, index) => index === 1 ? { ...row, openingBalance: row.openingBalance + 1, closingBalance: row.closingBalance + 1 } : row),
    };
    expect(buildDatedDeductionLedger({ schedule: continuityMismatch, policies: [policy(2025), policy(2026)] }))
      .toMatchObject({ kind: "invalid", reason: "broken-balance-continuity" });
  });

  it("distinguishes missing dates from out-of-range amounts", () => {
    const schedule = bSchedule();
    const missingDate = {
      ...schedule,
      rows: schedule.rows.map((row, index) => index === 0 ? { ...row, date: undefined as unknown as string } : row),
    };
    expect(buildDatedDeductionLedger({ schedule: missingDate, policies: [policy(2025), policy(2026)] }))
      .toMatchObject({ kind: "unsupported", reason: "missing-payment-date", period: 0 });

    const outOfRange = {
      ...schedule,
      rows: schedule.rows.map((row, index) => index === 1 ? { ...row, interest: 1_000_000_000_001 } : row),
    };
    expect(buildDatedDeductionLedger({ schedule: outOfRange, policies: [policy(2025), policy(2026)] }))
      .toMatchObject({ kind: "invalid", reason: "invalid-interest" });
  });

  it("uses the annual assessor for the new-regime raw B1.25m, D100k fixture", () => {
    const result = buildDatedDeductionLedger({
      schedule: interestOnlySchedule(100_000),
      policies: [{ ...policy(2026), effectiveTaxFactor: undefined, annualTaxContext: { taxProfile: annualProfile(), taxYear: "2026-27", eligibilityReviewed: true }, benefitReceiptDate: "2026-05-01" }],
    });
    expect(result).toMatchObject({ kind: "ok", value: { totalTaxBenefit: 52_000 } });
    if (result.kind !== "ok") return;
    expect(result.value.years[0]).toMatchObject({
      financialYear: 2026, interestUsed: 100_000, effectiveTaxFactor: null, taxBenefit: 52_000,
      annualAssessment: { taxYear: "2026-27", financiallySupported: false, methodologyReviewed: false, assessment: { deductionBenefit: 52_000, investmentTaxCost: 0 } },
    });
  });

  it("uses the annual assessor for the old-regime statutory J13000 fixture", () => {
    const result = buildDatedDeductionLedger({
      schedule: interestOnlySchedule(1),
      policies: [{ ...policy(2026), effectiveTaxFactor: undefined, annualTaxContext: { taxProfile: annualProfile({ backgroundOrdinaryTaxableIncome: 500_005, regime: "old", ageDuringTaxYear: 59, roundingConvention: "statutory-section-516" }), taxYear: "2026-27", eligibilityReviewed: true }, benefitReceiptDate: "2026-05-01" }],
    });
    expect(result).toMatchObject({ kind: "ok", value: { totalTaxBenefit: 13_000 } });
  });

  it("accepts explicit zero eligible deduction without an eligibility review", () => {
    const result = buildDatedDeductionLedger({
      schedule: interestOnlySchedule(100_000),
      policies: [{ ...policy(2026), interestEligible: false, effectiveTaxFactor: undefined, annualTaxContext: { taxProfile: annualProfile(), taxYear: "2026-27", eligibilityReviewed: false }, benefitReceiptDate: "2026-05-01" }],
    });
    expect(result).toMatchObject({ kind: "ok", value: { totalTaxBenefit: 0, years: [{ interestUsed: 0, taxBenefit: 0, effectiveTaxFactor: null }] } });
  });

  it("propagates unsupported annual facts and rejects mixed or missing annual modes", () => {
    const unsupported = buildDatedDeductionLedger({
      schedule: interestOnlySchedule(1),
      policies: [{ ...policy(2026), effectiveTaxFactor: undefined, annualTaxContext: { taxProfile: annualProfile({ specialRateIncome: [{ kind: "unknown", category: "equity", reason: "not supplied" }] }), taxYear: "2026-27", eligibilityReviewed: true }, benefitReceiptDate: "2026-05-01" }],
    });
    expect(unsupported).toMatchObject({ kind: "unsupported", reason: "unsupported-special-rate-income", financialYear: 2026 });
    const mixed = buildDatedDeductionLedger({ schedule: interestOnlySchedule(1), policies: [{ ...policy(2026), annualTaxContext: { taxProfile: annualProfile(), taxYear: "2026-27", eligibilityReviewed: true } }] });
    expect(mixed).toMatchObject({ kind: "invalid", reason: "mixed-tax-mode" });
    const firstYear = interestOnlySchedule(1);
    const twoYearSchedule: DatedLoanSchedule = {
      ...firstYear,
      rows: [...firstYear.rows, { period: 1, date: "2027-04-01", financialYear: 2027, openingBalance: 100_000, interest: 0, scheduledPayment: 0, scheduledPrincipal: 0, immediatePrepayment: 0, closingBalance: 100_000 }],
      financialYearTotals: [...firstYear.financialYearTotals, { financialYear: 2027, interest: 0, scheduledPayment: 0, scheduledPrincipal: 0, immediatePrepayment: 0 }],
    };
    const missing = buildDatedDeductionLedger({ schedule: twoYearSchedule, policies: [
      { ...policy(2026), effectiveTaxFactor: undefined, annualTaxContext: { taxProfile: annualProfile(), taxYear: "2026-27", eligibilityReviewed: true }, benefitReceiptDate: "2026-05-01" },
      { ...policy(2027), effectiveTaxFactor: undefined },
    ] });
    expect(missing).toMatchObject({ kind: "unsupported", reason: "missing-annual-tax-context" });
  });
});
