import { describe, expect, it } from "vitest";
import { compareOffers } from "../../finance/comparison";
import type { Offer } from "../../finance/types";
import {
  createComparisonSnapshot,
  decodeComparisonSnapshot,
  materializeComparison,
  serializeComparisonSnapshot,
} from "../snapshot";
import { ContractValidationError } from "../errors";

const RESULT_ID = "00000000-0000-4000-8000-000000000001";

function offer(id: string, partial: Partial<Offer> = {}): Offer {
  return {
    id,
    lender: `Lender ${id}`,
    loanType: "home",
    amount: 5_000_000,
    ratePct: 8.5,
    rateType: "reducing",
    rateStructure: "floating",
    tenureValue: 20,
    tenureUnit: "years",
    processingFee: { mode: "percent", value: 0.25 },
    gstPct: 18,
    insurancePremium: 0,
    insuranceFunding: "financed",
    otherFees: [],
    ...partial,
  };
}

function snapshot(count = 2) {
  const offers = Array.from({ length: count }, (_, index) =>
    offer(String.fromCharCode(97 + index), { amount: 5_000_000 + index * 100_000 }),
  );
  return { offers, comparison: compareOffers(offers) };
}

function expectCode(run: () => unknown, code: ContractValidationError["code"]): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ContractValidationError);
    expect((error as ContractValidationError).code).toBe(code);
  }
}

describe("comparison snapshots", () => {
  it("captures two and three offers with the complete displayed result", () => {
    for (const count of [2, 3]) {
      const { offers, comparison } = snapshot(count);
      const saved = createComparisonSnapshot(offers, comparison, {
        createdAt: "2026-09-15T20:00:00.000Z",
      });
      expect(saved.offers).toHaveLength(count);
      expect(saved.result.rows).toHaveLength(count);
      expect(saved.result.rows[0].derived).toEqual(comparison.rows[0].derived);
      expect(saved.result.basis).toEqual(comparison.basis);
      expect(saved.result.bestId).toBe(comparison.best?.offer.id);
      expect(saved.resultId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    }
  });

  it("round-trips without recalculating and materializes the same result shape", () => {
    const { offers, comparison } = snapshot();
    const saved = createComparisonSnapshot(offers, comparison, {
      createdAt: "2026-09-15T20:00:00.000Z",
    });
    const decoded = decodeComparisonSnapshot(JSON.parse(serializeComparisonSnapshot(saved)));
    expect(decoded).toEqual(saved);
    expect(materializeComparison(decoded)).toEqual(comparison);

    const altered = JSON.parse(serializeComparisonSnapshot(saved)) as Record<string, any>;
    altered.result.rows[0].derived.emi = 12345;
    const historic = decodeComparisonSnapshot(altered);
    expect(materializeComparison(historic).rows[0].derived.emi).toBe(12345);
  });

  it("normalizes copied inputs and stays detached from mutable drafts", () => {
    const offers = [offer("a", { lender: "  Bank A  " }), offer("b")];
    const comparison = compareOffers(offers);
    const saved = createComparisonSnapshot(offers, comparison, {
      createdAt: "2026-09-15T20:00:00.000Z",
    });
    offers[0].lender = "Changed after capture";
    comparison.rows[0].derived.emi = 999;
    expect(saved.offers[0].lender).toBe("Bank A");
    expect(saved.result.rows[0].derived.emi).not.toBe(999);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.result.rows[0].derived)).toBe(true);
  });

  it("rejects hostile or inconsistent persisted data", () => {
    const { offers, comparison } = snapshot();
    const base = JSON.parse(
      serializeComparisonSnapshot(
        createComparisonSnapshot(offers, comparison, { createdAt: "2026-09-15T20:00:00.000Z" }),
      ),
    ) as Record<string, any>;

    expectCode(() => decodeComparisonSnapshot({ ...base, extra: true }), "unknown_field");
    expectCode(() => decodeComparisonSnapshot({ ...base, schemaVersion: 2 }), "unsupported_schema");
    expectCode(() => decodeComparisonSnapshot({ ...base, createdAt: "yesterday" }), "invalid_timestamp");
    expectCode(() => decodeComparisonSnapshot({ ...base, resultId: RESULT_ID, offers: [base.offers[0], base.offers[0]] }), "duplicate_id");
    expectCode(() => decodeComparisonSnapshot({ ...base, offers: [...base.offers, base.offers[0], base.offers[0]] }), "wrong_count");
    expectCode(() => decodeComparisonSnapshot({ ...base, offers: [{ ...base.offers[0], amount: Number.NaN }, base.offers[1]] }), "invalid_number");
    expectCode(() => decodeComparisonSnapshot({ ...base, result: { ...base.result, rows: base.result.rows.map((row: any, i: number) => i === 0 ? { ...row, offerId: "missing" } : row) } }), "id_mismatch");
    expectCode(() => decodeComparisonSnapshot({
      ...base,
      result: {
        ...base.result,
        bestId: base.result.rows[0].offerId,
        rows: base.result.rows.map((row: any, i: number) => ({ ...row, isBest: i === 1 })),
      },
    }), "id_mismatch");
    expectCode(() => decodeComparisonSnapshot({ ...base, offers: base.offers.map((o: any) => ({ ...o, loanType: "crypto" })) }), "invalid_enum");
  });

  it("requires a complete bounded comparison at capture time", () => {
    const offers = [offer("a", { amount: 0 }), offer("b")];
    expectCode(() => createComparisonSnapshot(offers, compareOffers(offers)), "invalid_number");
  });
});
