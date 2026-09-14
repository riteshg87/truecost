import { describe, expect, it } from "vitest";
import { newer, stamp, worthSyncing, type SyncedLoan } from "../loanSync";
import type { LoanRecord, TransferQuote } from "../../health/types";

const loan: LoanRecord = {
  lender: "HDFC", original: 5000000, outstanding: 4250000, ratePct: 8.5,
  basis: "repo", spreadPct: 2.75, cycle: "quarterly",
  lastReset: "2025-09-01", monthsLeft: 214,
};
const quote: TransferQuote = {
  newRatePct: 0, feePct: 0.25, legalCharges: 5000,
  keepTenure: true, newTenureMonths: 240,
};

function payload(updatedAt: string, over = {}): SyncedLoan {
  return { loan, quote, surplus: 0, bufferMonths: 0, rateResolvedAt: null, updatedAt, ...over };
}

describe("conflict resolution", () => {
  it("takes the newer of two copies", () => {
    expect(newer(payload("2026-09-10T00:00:00Z"), payload("2026-09-01T00:00:00Z"))).toBe("local");
    expect(newer(payload("2026-09-01T00:00:00Z"), payload("2026-09-10T00:00:00Z"))).toBe("remote");
  });

  it("calls identical timestamps a draw rather than picking one", () => {
    const t = "2026-09-10T00:00:00Z";
    expect(newer(payload(t), payload(t))).toBe("same");
  });

  it("takes whichever copy exists when only one does", () => {
    expect(newer(payload("2026-09-10T00:00:00Z"), null)).toBe("local");
    expect(newer(null, payload("2026-09-10T00:00:00Z"))).toBe("remote");
  });

  it("has nothing to decide when neither exists", () => {
    expect(newer(null, null)).toBeNull();
  });

  it("orders ISO timestamps correctly as strings", () => {
    // Lexicographic order only matches chronological order for zero-padded
    // UTC ISO strings, which is why stamp() must produce exactly those.
    expect(newer(payload("2026-01-02T00:00:00.000Z"), payload("2026-01-10T00:00:00.000Z"))).toBe("remote");
    expect(stamp({ loan, quote, surplus: 0, bufferMonths: 0, rateResolvedAt: null }).updatedAt)
      .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("what is worth sending", () => {
  it("refuses an empty record", () => {
    expect(worthSyncing(null)).toBe(false);
    expect(worthSyncing(payload("2026-09-10T00:00:00Z", { loan: { ...loan, outstanding: 0 } }))).toBe(false);
  });

  it("accepts a real one", () => {
    expect(worthSyncing(payload("2026-09-10T00:00:00Z"))).toBe(true);
  });
});
