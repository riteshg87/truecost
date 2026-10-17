import { describe, expect, it } from "vitest";
import { addCalendarMonths, indianFinancialYear, validateDate } from "../lib/prepay/dates";

describe("dated prepayment calendar", () => {
  it("clamps short months without drifting the original payment day", () => {
    expect([0, 1, 2, 3].map((offset) => addCalendarMonths("2026-01-31", offset)))
      .toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addCalendarMonths("2026-12-15", 2)).toBe("2027-02-15");
    expect(addCalendarMonths("2026-01-31", -1)).toBe("2025-12-31");
  });

  it("groups adjacent March and April payment dates into different financial years", () => {
    expect(indianFinancialYear("2026-03-31")).toBe(2025);
    expect(indianFinancialYear("2026-04-01")).toBe(2026);
    expect(indianFinancialYear("2027-01-01")).toBe(2026);
  });

  it.each(["2026-02-29", "2100-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "26-01-01", "2026-1-01", "2026-01-01T00:00:00Z", "1899-12-31"])
    ("rejects invalid or non-calendar input %s", (value) => expect(() => validateDate(value)).toThrow());

  it("handles century leap years and rejects invalid offsets and overflow", () => {
    expect(() => validateDate("2000-02-29")).not.toThrow();
    for (const offset of [NaN, Infinity, 0.5, 1201]) expect(() => addCalendarMonths("2026-01-01", offset)).toThrow();
    expect(() => addCalendarMonths("9999-12-31", 1)).toThrow();
    expect(() => addCalendarMonths("1900-01-01", -1)).toThrow();
  });
});
