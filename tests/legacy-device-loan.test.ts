import { describe, expect, it } from "vitest";
import { parseLegacyDeviceLoan } from "../lib/legacy-device-loan";

describe("legacy device loan adoption", () => {
  it("normalizes the older partial record without mutating it", () => {
    const value = { loan: { lender: "Old Bank", original: 2_000_000, outstanding: 1_800_000, ratePct: 8.5, monthsLeft: 120 }, quote: {} };
    const parsed = parseLegacyDeviceLoan(value);
    expect(parsed?.loan.lender).toBe("Old Bank");
    expect(parsed?.loan.spreadProvenance).toBe("legacy");
    expect(parsed?.quote.feePct).toBe(0.25);
    expect(value).toEqual({ loan: { lender: "Old Bank", original: 2_000_000, outstanding: 1_800_000, ratePct: 8.5, monthsLeft: 120 }, quote: {} });
  });

  it("rejects a record without the minimum loan fields", () => {
    expect(parseLegacyDeviceLoan({ loan: { lender: "missing balance" } })).toBeNull();
  });
});

