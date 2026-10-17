import { describe, expect, it } from "vitest";
import { addCalendarMonths } from "../lib/prepay/dates";
import { buildDisposalTaxLedger } from "../lib/prepay/investment-tax-ledger";
import { buildInvestmentGrowthLedger, monthlyGrowthIntervals, type InvestmentGrowthInput } from "../lib/prepay/investment-growth";

describe("dated investment growth ledger", () => {
  it("matches fixture A and feeds the disposal ledger without a monthly tax haircut", () => {
    const result = buildInvestmentGrowthLedger({
      intervals: monthlyGrowthIntervals("2026-01-01", 120, 1 + 0.11 / 12),
      contributions: [{ lotId: "a", date: "2026-01-01", amount: 1_000_000 }],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.lots[0].grossProceeds).toBeCloseTo(2_989_149.6030092984, 8);
    const taxed = buildDisposalTaxLedger({
      lots: result.value.lots.map((lot) => ({
        lotId: lot.lotId,
        costBasis: lot.cost,
        acquisitionDate: lot.acquisitionDate,
        disposalDate: lot.disposalDate,
        grossProceeds: lot.grossProceeds,
        eligibleExpenseAmount: 0,
        effectiveTaxFactor: 0.125,
        exemptionEligible: false,
      })),
      exemptionHeadroom: [{ financialYear: 2035, amount: 0 }],
      lossTreatment: "no-current-tax-credit",
    });
    expect(taxed.kind).toBe("ok");
    if (taxed.kind !== "ok") return;
    expect(taxed.value.totalNetProceeds).toBeCloseTo(2_740_505.902633136, 8);
  });

  it("keeps twelve dated lots separate for fixture H and gives each its own age", () => {
    const contributions = Array.from({ length: 12 }, (_, index) => ({ lotId: `lot-${index + 1}`, date: addCalendarMonths("2027-01-01", index), amount: 10_000 }));
    const result = buildInvestmentGrowthLedger({ intervals: monthlyGrowthIntervals("2027-01-01", 12, 1 + 0.1 / 12), contributions });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.lots[0].grossProceeds).toBeCloseTo(11_047.13, 2);
    expect(result.value.lots[11].grossProceeds).toBeCloseTo(10_083.33, 2);
    expect(result.value.totalGrossProceeds).toBeCloseTo(126_702.81, 2);
    expect(result.value.totalGrossGain).toBeCloseTo(6_702.81, 2);
  });

  it("supports H2 supplied ages and integrates each gross result with its supplied tax factor", () => {
    const growth = buildInvestmentGrowthLedger({
      intervals: monthlyGrowthIntervals("2026-01-01", 24, 1 + 0.1 / 12),
      contributions: [
        { lotId: "younger", date: "2027-12-01", amount: 10_000 },
        { lotId: "older", date: "2026-01-01", amount: 10_000 },
      ],
    });
    expect(growth.kind).toBe("ok");
    if (growth.kind !== "ok") return;
    const taxed = buildDisposalTaxLedger({
      lots: growth.value.lots.map((lot) => ({
        lotId: lot.lotId,
        costBasis: lot.cost,
        acquisitionDate: lot.acquisitionDate,
        disposalDate: lot.disposalDate,
        grossProceeds: lot.grossProceeds,
        eligibleExpenseAmount: 0,
        effectiveTaxFactor: lot.lotId === "older" ? 0.125 : 0.2,
        exemptionEligible: false,
      })),
      exemptionHeadroom: [{ financialYear: 2027, amount: 0 }],
      lossTreatment: "no-current-tax-credit",
    });
    expect(taxed.kind).toBe("ok");
    if (taxed.kind !== "ok") return;
    expect(taxed.value.totalTax).toBeCloseTo(292.1553683861, 8);
    expect(taxed.value.totalNetProceeds).toBeCloseTo(21_995.09, 2);
  });

  it("allows a contribution on the horizon without applying a future factor", () => {
    const result = buildInvestmentGrowthLedger({ intervals: [{ startDate: "2027-01-01", endDate: "2027-02-01", growthFactor: 2 }], contributions: [{ lotId: "horizon", date: "2027-02-01", amount: 100 }] });
    expect(result).toMatchObject({ kind: "ok", value: { lots: [{ grossProceeds: 100, grossGain: 0, disposalDate: "2027-02-01" }] } });
  });

  it("returns unsupported for off-grid timing rather than inventing day-count growth", () => {
    const result = buildInvestmentGrowthLedger({ intervals: [{ startDate: "2027-01-01", endDate: "2027-02-01", growthFactor: 1.1 }], contributions: [{ lotId: "off-grid", date: "2027-01-15", amount: 100 }] });
    expect(result).toEqual({ kind: "unsupported", reason: "off-grid-contribution-date", lotId: "off-grid" });
  });

  it("rejects gaps, reversed intervals, duplicate IDs, nonfinite values, and overflow", () => {
    const valid: InvestmentGrowthInput = { intervals: [{ startDate: "2027-01-01", endDate: "2027-02-01", growthFactor: 1.1 }], contributions: [{ lotId: "a", date: "2027-01-01", amount: 100 }] };
    expect(buildInvestmentGrowthLedger({ ...valid, intervals: [{ ...valid.intervals[0], endDate: "2027-01-15" }, { startDate: "2027-02-01", endDate: "2027-03-01", growthFactor: 1 }] })).toMatchObject({ kind: "invalid", reason: "non-contiguous-growth-grid" });
    expect(buildInvestmentGrowthLedger({ ...valid, intervals: [{ ...valid.intervals[0], endDate: "2026-12-01" }] })).toMatchObject({ kind: "invalid", reason: "reversed-growth-interval" });
    expect(buildInvestmentGrowthLedger({ ...valid, contributions: [valid.contributions[0], valid.contributions[0]] })).toMatchObject({ kind: "invalid", reason: "duplicate-contribution-id" });
    expect(buildInvestmentGrowthLedger({ ...valid, intervals: [{ ...valid.intervals[0], growthFactor: Infinity }] })).toMatchObject({ kind: "invalid", reason: "invalid-growth-factor" });
    const huge = { intervals: [{ startDate: "2027-01-01", endDate: "2027-02-01", growthFactor: 1 }], contributions: [{ lotId: "a", date: "2027-01-01", amount: Number.MAX_VALUE }, { lotId: "b", date: "2027-01-01", amount: Number.MAX_VALUE }] };
    expect(buildInvestmentGrowthLedger(huge)).toEqual({ kind: "invalid", reason: "arithmetic-overflow" });
  });

  it("keeps factor zero as an explicit total-loss result and does not mutate input", () => {
    const input: InvestmentGrowthInput = { intervals: [{ startDate: "2027-01-01", endDate: "2027-02-01", growthFactor: 0 }], contributions: [{ lotId: "loss", date: "2027-01-01", amount: 100 }] };
    const before = JSON.stringify(input);
    const result = buildInvestmentGrowthLedger(input);
    expect(result).toMatchObject({ kind: "ok", value: { lots: [{ grossProceeds: 0, grossGain: -100 }], totalGrossGain: -100 } });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("bounds the monthly helper before allocation and rejects dates beyond the supported calendar", () => {
    expect(() => monthlyGrowthIntervals("2027-01-01", 1_201, 1)).toThrow("Invalid monthly growth grid");
    expect(() => monthlyGrowthIntervals("9999-12-01", 2, 1)).toThrow("Date is outside the supported calendar");
  });
});
