import { describe, expect, it } from "vitest";
import {
  buildDisposalTaxLedger,
  buildOrdinaryInterestTaxLedger,
  type DisposalTaxLedgerInput,
} from "../lib/prepay/investment-tax-ledger";

function fixtureA(): DisposalTaxLedgerInput {
  return {
    lots: [{
      lotId: "a-2026-01-01",
      costBasis: 1_000_000,
      acquisitionDate: "2026-01-01",
      disposalDate: "2036-01-01",
      grossProceeds: 2_989_149.6030092984,
      eligibleExpenseAmount: 0,
      effectiveTaxFactor: 0.125,
      exemptionEligible: false,
    }],
    exemptionHeadroom: [{ financialYear: 2035, amount: 0 }],
    lossTreatment: "no-current-tax-credit",
  };
}

describe("investment disposal tax ledger", () => {
  it("matches the independent disposal ledger fixture A", () => {
    const result = buildDisposalTaxLedger(fixtureA());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const lot = result.value.lots[0];
    expect(lot.grossGain).toBeCloseTo(1_989_149.6030092984, 8);
    expect(lot.taxableGain).toBeCloseTo(1_989_149.6030092984, 8);
    expect(lot.tax).toBeCloseTo(248_643.7003761623, 8);
    expect(lot.netProceeds).toBeCloseTo(2_740_505.902633136, 8);
    expect(result.value.taxOutflows).toEqual([{
      id: "a-2026-01-01",
      date: "2036-01-01",
      financialYear: 2035,
      amount: -248_643.7003761623,
    }]);
  });

  it("processes each lot with its supplied factor and deterministic annual shared headroom", () => {
    const input: DisposalTaxLedgerInput = {
      lots: [
        { lotId: "late", costBasis: 1_000, acquisitionDate: "2027-12-01", disposalDate: "2028-01-01", grossProceeds: 1_200, eligibleExpenseAmount: 0, effectiveTaxFactor: 0.2, exemptionEligible: true },
        { lotId: "early", costBasis: 1_000, acquisitionDate: "2027-01-01", disposalDate: "2028-01-01", grossProceeds: 1_200, eligibleExpenseAmount: 0, effectiveTaxFactor: 0.125, exemptionEligible: true },
      ],
      exemptionHeadroom: [{ financialYear: 2027, amount: 250 }],
      lossTreatment: "no-current-tax-credit",
    };
    const result = buildDisposalTaxLedger(input);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.lots.map((lot) => [lot.lotId, lot.exemptionHeadroomUsed, lot.tax])).toEqual([
      ["early", 200, 0],
      ["late", 50, 30],
    ]);
    expect(result.value.exemptionHeadroom).toEqual([{ financialYear: 2027, initialAmount: 250, amountUsed: 250, remainingAmount: 0 }]);
    expect(result.value.totalTax).toBe(30);
  });

  it("keeps different supplied factors per lot, as in H2", () => {
    const result = buildDisposalTaxLedger({
      lots: [
        { lotId: "older", costBasis: 10_000, acquisitionDate: "2026-01-01", disposalDate: "2028-01-01", grossProceeds: 12_203.9096137556, eligibleExpenseAmount: 0, effectiveTaxFactor: 0.125, exemptionEligible: false },
        { lotId: "younger", costBasis: 10_000, acquisitionDate: "2027-12-01", disposalDate: "2028-01-01", grossProceeds: 10_083.3333333333, eligibleExpenseAmount: 0, effectiveTaxFactor: 0.2, exemptionEligible: false },
      ],
      exemptionHeadroom: [{ financialYear: 2027, amount: 0 }],
      lossTreatment: "no-current-tax-credit",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.lots[0].tax).toBeCloseTo(275.48870171945, 10);
    expect(result.value.lots[1].tax).toBeCloseTo(16.66666666666, 10);
    expect(result.value.totalNetProceeds).toBeCloseTo(21_995.09, 2);
  });

  it("records losses under the explicit no-current-tax-credit assumption", () => {
    const result = buildDisposalTaxLedger({
      lots: [{ lotId: "loss", costBasis: 1_000, acquisitionDate: "2027-01-01", disposalDate: "2027-06-01", grossProceeds: 900, eligibleExpenseAmount: 0, effectiveTaxFactor: 0.2, exemptionEligible: true }],
      exemptionHeadroom: [{ financialYear: 2027, amount: 500 }],
      lossTreatment: "no-current-tax-credit",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.lots[0]).toMatchObject({ grossGain: -100, taxableGain: 0, lossAmount: 100, exemptionHeadroomUsed: 0, tax: 0, netProceeds: 900 });
    expect(result.value.totalLossAmount).toBe(100);
  });

  it("rejects missing loss policy, duplicate IDs, reversed dates, nonfinite values, and missing years", () => {
    expect(buildDisposalTaxLedger({ ...fixtureA(), lossTreatment: undefined as never })).toEqual({ kind: "unsupported", reason: "missing-loss-treatment" });
    expect(buildDisposalTaxLedger({ ...fixtureA(), lots: [fixtureA().lots[0], fixtureA().lots[0]] })).toMatchObject({ kind: "invalid", reason: "duplicate-lot-id" });
    expect(buildDisposalTaxLedger({ ...fixtureA(), lots: [{ ...fixtureA().lots[0], acquisitionDate: "2037-01-01" }] })).toMatchObject({ kind: "invalid", reason: "reversed-lot-dates" });
    expect(buildDisposalTaxLedger({ ...fixtureA(), lots: [{ ...fixtureA().lots[0], grossProceeds: Number.NaN }] })).toMatchObject({ kind: "invalid", reason: "invalid-gross-proceeds" });
    expect(buildDisposalTaxLedger({ ...fixtureA(), exemptionHeadroom: [{ financialYear: 2034, amount: 0 }] })).toMatchObject({ kind: "invalid", reason: "missing-headroom-year", financialYear: 2035 });
    expect(buildDisposalTaxLedger({ ...fixtureA(), exemptionHeadroom: [{ financialYear: 2035, amount: 0 }, { financialYear: 2034, amount: 0 }] })).toMatchObject({ kind: "invalid", reason: "unmatched-headroom-year", financialYear: 2034 });
    expect(buildDisposalTaxLedger({ ...fixtureA(), lots: [{ ...fixtureA().lots[0], effectiveTaxFactor: 1.01 }] })).toMatchObject({ kind: "invalid", reason: "invalid-effective-tax-factor" });
  });

  it("rejects arithmetic overflow in aggregate disposal values", () => {
    const lot = { lotId: "a", costBasis: 0, acquisitionDate: "2027-01-01", disposalDate: "2027-06-01", grossProceeds: Number.MAX_VALUE, eligibleExpenseAmount: 0, effectiveTaxFactor: 0, exemptionEligible: false };
    const result = buildDisposalTaxLedger({ lots: [lot, { ...lot, lotId: "b" }], exemptionHeadroom: [{ financialYear: 2027, amount: 0 }], lossTreatment: "no-current-tax-credit" });
    expect(result).toEqual({ kind: "invalid", reason: "arithmetic-overflow" });
  });

  it("does not mutate lots or headroom while sorting and consuming", () => {
    const input = {
      lots: [
        { lotId: "b", costBasis: 1, acquisitionDate: "2027-01-01", disposalDate: "2027-05-01", grossProceeds: 2, eligibleExpenseAmount: 0, effectiveTaxFactor: 0.1, exemptionEligible: true },
        { lotId: "a", costBasis: 1, acquisitionDate: "2027-01-01", disposalDate: "2027-05-01", grossProceeds: 2, eligibleExpenseAmount: 0, effectiveTaxFactor: 0.1, exemptionEligible: true },
      ],
      exemptionHeadroom: [{ financialYear: 2027, amount: 1 }],
      lossTreatment: "no-current-tax-credit" as const,
    };
    const before = JSON.stringify(input);
    expect(buildDisposalTaxLedger(input).kind).toBe("ok");
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("ordinary interest tax ledger", () => {
  it("posts tax at each explicit FD credit date and preserves timing", () => {
    const result = buildOrdinaryInterestTaxLedger({ events: [
      { eventId: "maturity", creditDate: "2027-01-31", grossInterest: 70_000, effectiveTaxFactor: 0.312 },
      { eventId: "annual-credit", creditDate: "2026-12-31", grossInterest: 70_000, effectiveTaxFactor: 0.312 },
    ] });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.events.map((event) => [event.eventId, event.creditDate, event.tax, event.netInterest])).toEqual([
      ["annual-credit", "2026-12-31", 21_840, 48_160],
      ["maturity", "2027-01-31", 21_840, 48_160],
    ]);
    expect(result.value.taxOutflows.map((flow) => [flow.id, flow.date, flow.amount])).toEqual([
      ["annual-credit", "2026-12-31", -21_840],
      ["maturity", "2027-01-31", -21_840],
    ]);
  });

  it("rejects duplicate IDs, malformed dates, nonfinite interest and factors", () => {
    const valid = { eventId: "credit", creditDate: "2026-12-31", grossInterest: 70_000, effectiveTaxFactor: 0.312 };
    expect(buildOrdinaryInterestTaxLedger({ events: [valid, valid] })).toMatchObject({ kind: "invalid", reason: "duplicate-interest-event-id" });
    expect(buildOrdinaryInterestTaxLedger({ events: [{ ...valid, creditDate: "2026-02-30" }] })).toMatchObject({ kind: "invalid", reason: "invalid-credit-date" });
    expect(buildOrdinaryInterestTaxLedger({ events: [{ ...valid, grossInterest: Infinity }] })).toMatchObject({ kind: "invalid", reason: "invalid-gross-interest" });
    expect(buildOrdinaryInterestTaxLedger({ events: [{ ...valid, effectiveTaxFactor: Number.NaN }] })).toMatchObject({ kind: "invalid", reason: "invalid-effective-tax-factor" });
    expect(buildOrdinaryInterestTaxLedger({ events: [
      { ...valid, eventId: "a", grossInterest: Number.MAX_VALUE, effectiveTaxFactor: 0 },
      { ...valid, eventId: "b", grossInterest: Number.MAX_VALUE, effectiveTaxFactor: 0 },
    ] })).toEqual({ kind: "invalid", reason: "arithmetic-overflow" });
  });
});
