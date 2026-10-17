// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SavedComparisonView } from "../components/SavedComparisonView";
import { compareOffers } from "../lib/finance/comparison";
import * as comparisonModule from "../lib/finance/comparison";
import * as computeModule from "../lib/finance/compute";
import {
  createComparisonSnapshot,
  decodeComparisonSnapshot,
  serializeComparisonSnapshot,
} from "../lib/contracts/snapshot";

const offers = [
  {
    id: "00000000-0000-4000-8000-000000000101",
    lender: "A lender with a deliberately long historical name that must wrap on a narrow screen",
    loanType: "home" as const,
    amount: 5_000_000,
    ratePct: 8.5,
    rateType: "reducing" as const,
    rateStructure: "floating" as const,
    tenureValue: 20,
    tenureUnit: "years" as const,
    processingFee: { mode: "percent" as const, value: 0.35 },
    gstPct: 18,
    insurancePremium: 12_000,
    insuranceFunding: "upfront" as const,
    otherFees: [{ id: "fee-101", label: "Document handling and valuation", amount: 2_500 }],
  },
  {
    id: "00000000-0000-4000-8000-000000000102",
    lender: "Second lender",
    loanType: "home" as const,
    amount: 5_000_000,
    ratePct: 8.7,
    rateType: "reducing" as const,
    rateStructure: "floating" as const,
    tenureValue: 20,
    tenureUnit: "years" as const,
    processingFee: { mode: "flat" as const, value: 8_000 },
    gstPct: 18,
    insurancePremium: 0,
    insuranceFunding: "financed" as const,
    otherFees: [],
  },
  {
    id: "00000000-0000-4000-8000-000000000103",
    lender: "Third lender",
    loanType: "home" as const,
    amount: 5_000_000,
    ratePct: 9.1,
    rateType: "reducing" as const,
    rateStructure: "floating" as const,
    tenureValue: 20,
    tenureUnit: "years" as const,
    processingFee: { mode: "percent" as const, value: 0.5 },
    gstPct: 18,
    insurancePremium: 4_000,
    insuranceFunding: "financed" as const,
    otherFees: [],
  },
];

function historicalSnapshot() {
  const base = createComparisonSnapshot(offers, compareOffers(offers), {
    createdAt: "2025-04-15T09:30:00.000Z",
    calculationVersion: "finance-engine-v0",
  });
  const persisted = JSON.parse(serializeComparisonSnapshot(base)) as Record<string, unknown> & {
    result: { rows: Array<{ derived: Record<string, unknown> }>; notices: unknown[] };
    offers: Array<Record<string, unknown>>;
  };

  // These values intentionally differ from the current engine's output. The
  // view must display them exactly as recorded.
  persisted.result.rows[0].derived.emi = 12_345.67;
  persisted.result.rows[0].derived.totalRepayment = 4_444_444;
  persisted.result.rows[0].derived.totalInterest = 1_111_111;
  persisted.result.rows[0].derived.effectiveAprPct = 7.17;
  persisted.result.rows[1].derived.effectiveAprPct = null;
  persisted.result.rows[1].derived.warnings = [{
    level: "caution",
    code: "historic-rate-note",
    message: "This warning was recorded with the original calculation.",
  }];
  persisted.result.notices = [];

  return decodeComparisonSnapshot(persisted);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SavedComparisonView", () => {
  it("renders immutable recorded figures without invoking the finance engine", () => {
    const snapshot = historicalSnapshot();
    const compute = vi.spyOn(computeModule, "computeOffer").mockImplementation(() => {
      throw new Error("historical view must not compute");
    });
    const compare = vi.spyOn(comparisonModule, "compareOffers").mockImplementation(() => {
      throw new Error("historical view must not compare");
    });
    const schedule = vi.spyOn(computeModule, "scheduleFor").mockImplementation(() => {
      throw new Error("historical view must not schedule");
    });
    const interest = vi.spyOn(computeModule, "interestByYear").mockImplementation(() => {
      throw new Error("historical view must not calculate interest");
    });

    expect(() => render(<SavedComparisonView snapshot={snapshot} />)).not.toThrow();
    expect(screen.getByText("finance-engine-v0")).toBeTruthy();
    expect(screen.getAllByText("₹12,346").length).toBeGreaterThan(0);
    expect(screen.getByText("₹44.44 L")).toBeTruthy();
    expect(screen.getByText("This warning was recorded with the original calculation.")).toBeTruthy();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A lender with a deliberately long historical name that must wrap on a narrow screen")).toHaveLength(2);
    expect(screen.getAllByText(/Stored offer details:/)).toHaveLength(3);
    const firstSummary = screen.getAllByText(/Stored offer details:/)[0];
    fireEvent.click(firstSummary);
    expect((firstSummary.closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(compute).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(interest).not.toHaveBeenCalled();
  });

  it("keeps the original creation timestamp and shows the estimate disclaimer", () => {
    const snapshot = historicalSnapshot();
    render(<SavedComparisonView snapshot={snapshot} />);

    expect(screen.getByRole("time").getAttribute("dateTime")).toBe("2025-04-15T09:30:00.000Z");
    expect(screen.getByText(/EMIs are paid on schedule/)).toBeTruthy();
    expect(screen.getByText(/Key Facts Statement/)).toBeTruthy();
  });
});
