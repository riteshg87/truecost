import { describe, expect, it } from "vitest";
import {
  BREAK_EVEN_LIMIT_MONTHS,
  prepaySnapshot,
  rateVerdict,
  transferResult,
} from "../analyse";
import { addCalendarMonths, isResetOverdue, monthsBetween, repoOn } from "../repo";
import type { LoanRecord, TransferQuote } from "../types";

const TODAY = "2025-12-05";

function loan(partial: Partial<LoanRecord> = {}): LoanRecord {
  return {
    lender: "HDFC Bank",
    original: 5000000,
    outstanding: 4250000,
    ratePct: 8.5,
    basis: "repo",
    spreadPct: 2.75,
    spreadProvenance: "confirmed",
    cycle: "quarterly",
    lastReset: "2025-06-06",
    lastResetProvenance: "confirmed",
    monthsLeft: 214,
    ...partial,
  };
}

function quote(partial: Partial<TransferQuote> = {}): TransferQuote {
  return {
    newRatePct: 7.9,
    feePct: 0.25,
    legalCharges: 5000,
    keepTenure: true,
    newTenureMonths: 240,
    ...partial,
  };
}

describe("benchmark feed", () => {
  it("returns only exact observed dates until continuous coverage is sourced", () => {
    expect(repoOn("2023-02-08")).toBe(6.5);
    expect(repoOn("2025-06-06")).toBe(5.5);
    expect(repoOn("2025-12-05")).toBe(5.25);
    expect(repoOn("2025-09-01")).toBeNull();
    expect(repoOn("2026-09-14")).toBeNull();
  });

  it("does not infer a rate between isolated observations", () => {
    expect(repoOn("2025-06-05")).toBeNull();
    expect(repoOn("2025-06-06")).toBe(5.5);
    expect(repoOn("2025-06-07")).toBeNull();
    expect(repoOn("2025-12-04")).toBeNull();
    expect(repoOn("2025-12-05")).toBe(5.25);
  });

  it("does not promote inherited history rows to verified observations", () => {
    expect(repoOn("2025-02-07")).toBeNull();
    expect(repoOn("2025-04-09")).toBeNull();
  });

  it("rejects malformed benchmark dates rather than silently selecting a rate", () => {
    expect(() => repoOn("2025-02-30")).toThrow(RangeError);
    expect(() => repoOn("not-a-date")).toThrow(RangeError);
  });

  it("counts whole months between dates", () => {
    expect(monthsBetween("2025-09-01", "2026-09-14")).toBe(12);
    expect(monthsBetween("2026-09-01", "2026-09-14")).toBe(0);
    expect(monthsBetween("2026-09-20", "2026-09-14")).toBe(0);
  });
});

describe("rate verdict", () => {
  it("flags a rate the benchmark has left behind", () => {
    const v = rateVerdict(loan(), TODAY);
    expect(v.kind).toBe("stale");
    expect(v.repoThen).toBe(5.5);
    expect(v.repoNow).toBe(5.25);
    expect(v.shouldBePct).toBeCloseTo(8.0, 6);
    expect(v.gapPct).toBeCloseTo(0.5, 6);
    // Half a point on 42.5 lakh is about eighteen hundred a month.
    expect(v.monthlyExcess).toBeGreaterThan(1700);
    expect(v.monthlyExcess).toBeLessThan(1850);
    expect(v.resetOverdue).toBe(true);
  });

  it("clears the flag once the rate matches the benchmark plus spread", () => {
    const v = rateVerdict(loan({ ratePct: 8.0 }), TODAY);
    expect(v.kind).toBe("ontrack");
    expect(v.tone).toBe("good");
    expect(v.monthlyExcess).toBe(0);
  });

  it("treats a rounding-sized gap as no gap", () => {
    expect(rateVerdict(loan({ ratePct: 8.005 }), TODAY).kind).toBe("ontrack");
  });

  it("does not measure an MCLR loan against the repo", () => {
    const v = rateVerdict(loan({ basis: "mclr" }), TODAY);
    expect(v.kind).toBe("mclr");
    expect(v.shouldBePct).toBeNull();
    expect(v.gapPct).toBeNull();
  });

  it("stays quiet on a fixed loan, which tracks nothing", () => {
    const v = rateVerdict(loan({ basis: "fixed" }), TODAY);
    expect(v.kind).toBe("fixed");
    expect(v.tone).toBe("neutral");
  });

  it("says so rather than guessing when the benchmark is one we do not carry", () => {
    expect(rateVerdict(loan({ basis: "tbill" }), TODAY).kind).toBe("unknown");
  });

  it("knows a reset is overdue from the loan's own cycle", () => {
    expect(rateVerdict(loan({ lastReset: "2025-12-05" }), TODAY).resetOverdue).toBe(false);
    expect(rateVerdict(loan({ lastReset: "2025-06-06" }), TODAY).resetOverdue).toBe(true);
  });

  it("does not turn an unconfirmed spread into a contractual gap", () => {
    const v = rateVerdict(loan({ spreadProvenance: "unknown", lastResetProvenance: "confirmed" }), TODAY);
    expect(v.kind).toBe("unknown");
    expect(v.gapPct).toBeNull();
    expect(v.shouldBePct).toBeNull();
    expect(v.emi).toBeGreaterThan(38000);
  });

  it("keeps an explicitly confirmed zero spread distinct from an unknown spread", () => {
    const v = rateVerdict(loan({ spreadPct: 0, spreadProvenance: "confirmed" }), TODAY);
    expect(v.kind).toBe("stale");
    expect(v.shouldBePct).toBe(5.25);
    expect(v.gapPct).toBeCloseTo(3.25, 6);
  });

  it("does not treat a legacy reset date as evidence of a contractual reset", () => {
    const v = rateVerdict(loan({ spreadProvenance: "confirmed", lastResetProvenance: "legacy" }), TODAY);
    expect(v.kind).toBe("unknown");
    expect(v.gapPct).toBeNull();
    expect(v.unknownReason).toMatch(/reset date/i);
  });

  it("keeps exact anniversaries due but not overdue until the following day", () => {
    expect(isResetOverdue("2026-06-15", "2026-09-14", 3)).toBe(false);
    expect(isResetOverdue("2026-06-15", "2026-09-15", 3)).toBe(false);
    expect(isResetOverdue("2026-06-15", "2026-09-16", 3)).toBe(true);
  });

  it("preserves an unknown verdict for malformed, uncovered or future reset dates", () => {
    const uncovered = rateVerdict(loan(), "2026-09-14");
    expect(uncovered.kind).toBe("unknown");
    expect(uncovered.unknownReason).toMatch(/observations do not cover/i);
    expect(uncovered.emi).toBeGreaterThan(38000);
    expect(rateVerdict(loan({ lastReset: "2026-02-30" }), "2026-09-14").kind).toBe("unknown");
    expect(rateVerdict(loan({ lastReset: "2026-10-01" }), "2026-09-14").kind).toBe("unknown");
    expect(rateVerdict(loan(), "not-a-date").kind).toBe("unknown");
  });

  it("derives an EMI the record itself implies", () => {
    const v = rateVerdict(loan(), TODAY);
    expect(v.emi).toBeGreaterThan(38000);
    expect(v.emi).toBeLessThan(39500);
  });
});

describe("reset calendar anniversaries", () => {
  it("clamps monthly January anniversaries to February month end", () => {
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(isResetOverdue("2026-01-31", "2026-02-28", 1)).toBe(false);
    expect(isResetOverdue("2026-01-31", "2026-03-01", 1)).toBe(true);
  });

  it("keeps a leap-year February 29 anniversary exact", () => {
    expect(addCalendarMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(isResetOverdue("2028-01-31", "2028-02-29", 1)).toBe(false);
    expect(isResetOverdue("2028-01-31", "2028-03-01", 1)).toBe(true);
  });

  it("clamps quarterly and half-year month ends deliberately", () => {
    expect(addCalendarMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(isResetOverdue("2026-11-30", "2027-02-28", 3)).toBe(false);
    expect(isResetOverdue("2026-11-30", "2027-03-01", 3)).toBe(true);
    expect(addCalendarMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(isResetOverdue("2026-08-31", "2027-02-28", 6)).toBe(false);
  });
});

describe("transfer", () => {
  it("calls a clear rate cut worth taking", () => {
    const t = transferResult(loan(), quote());
    expect(t.monthlySaving).toBeGreaterThan(1400);
    expect(t.breakEvenMonth).toBeLessThanOrEqual(BREAK_EVEN_LIMIT_MONTHS);
    expect(t.netSaving).toBeGreaterThan(250000);
    expect(t.worthIt).toBe(true);
  });

  it("refuses a gap too narrow to repay its own fees in time", () => {
    const t = transferResult(loan(), quote({ newRatePct: 8.35 }));
    // It does save money eventually — that is exactly why the horizon matters.
    expect(t.netSaving).toBeGreaterThan(0);
    expect(t.breakEvenMonth).toBeGreaterThan(BREAK_EVEN_LIMIT_MONTHS);
    expect(t.worthIt).toBe(false);
  });

  it("finds nothing to recover when the rate is no better", () => {
    const t = transferResult(loan(), quote({ newRatePct: 8.5 }));
    expect(t.monthlySaving).toBeCloseTo(0, 6);
    expect(t.breakEvenMonth).toBeNull();
    expect(t.netSaving).toBeLessThan(0);
    expect(t.worthIt).toBe(false);
  });

  it("does not let a longer term pass as a cheaper loan", () => {
    const kept = transferResult(loan(), quote());
    const reset = transferResult(
      loan(),
      quote({ keepTenure: false, newTenureMonths: 240 }),
    );

    // The EMI falls further on the longer term, which is exactly the trap.
    expect(reset.emiNew).toBeLessThan(kept.emiNew);
    // And it costs more in interest, so the verdict must not reward it.
    expect(reset.interestNew).toBeGreaterThan(kept.interestNew);
    expect(reset.netSaving).toBeLessThan(kept.netSaving);
    expect(reset.lengthened).toBe(true);
  });

  it("counts GST on the processing fee, not just the fee", () => {
    const t = transferResult(loan(), quote({ legalCharges: 0 }));
    expect(t.processingFee).toBeCloseTo(10625, 6);
    expect(t.gst).toBeCloseTo(10625 * 0.18, 6);
    expect(t.costToSwitch).toBeCloseTo(10625 * 1.18, 6);
  });
});

describe("prepay snapshot", () => {
  it("shortens the term and saves interest", () => {
    const s = prepaySnapshot(loan(), 500000);
    expect(s.monthsSaved).toBeGreaterThan(0);
    expect(s.interestSaved).toBeGreaterThan(0);
    expect(s.monthsAfter).toBeLessThan(214);
  });

  it("clears the loan when the surplus covers the balance", () => {
    const s = prepaySnapshot(loan(), 5000000);
    expect(s.monthsAfter).toBe(0);
    expect(s.monthsSaved).toBe(214);
    expect(s.interestSaved).toBeCloseTo(s.baseInterest, 6);
  });

  it("saves nothing when there is no surplus", () => {
    const s = prepaySnapshot(loan(), 0);
    expect(s.interestSaved).toBeCloseTo(0, 4);
    expect(s.monthsSaved).toBe(0);
  });
});
