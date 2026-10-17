// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultsTable } from "../components/ResultsTable";
import { compareOffers } from "../lib/finance/comparison";
import type { Offer } from "../lib/finance/types";

function offer(index: number, lender: string): Offer {
  return {
    id: `offer-${index}`,
    lender,
    loanType: "home",
    amount: 5_000_000,
    ratePct: 8 + index / 10,
    rateType: "reducing",
    rateStructure: "floating",
    tenureValue: 20,
    tenureUnit: "years",
    processingFee: { mode: "percent", value: 0.35 },
    gstPct: 18,
    insurancePremium: 0,
    insuranceFunding: "financed",
    otherFees: [],
  };
}

describe("ResultsTable accessibility", () => {
  afterEach(cleanup);

  it.each([
    [2, ["Aster Bank", "Banyan Finance"]],
    [3, [
      "Aster Bank with an intentionally long lender name for narrow screens",
      "Banyan Finance with an intentionally long lender name for narrow screens",
      "Cedar Cooperative with an intentionally long lender name for narrow screens",
    ]],
  ])("exposes %i offers through semantic headers and a focusable scroll region", (count, lenders) => {
    const comparison = compareOffers(lenders.map((lender, index) => offer(index, lender)));
    render(<ResultsTable comparison={comparison} />);

    const region = screen.getByRole("region", { name: /loan comparison results.*scroll horizontally/i });
    expect(region.getAttribute("tabindex")).toBe("0");
    region.focus();
    expect(document.activeElement).toBe(region);

    const table = within(region).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Metric" })).toBeTruthy();
    const columnHeaders = within(table).getAllByRole("columnheader");
    expect(columnHeaders).toHaveLength(count + 1);
    expect(columnHeaders.slice(1).every((header) => !header.querySelector(".truncate"))).toBe(true);
    expect(columnHeaders.slice(1).every((header) => header.querySelector("p:last-of-type")?.classList.contains("whitespace-nowrap"))).toBe(true);
    expect(within(table).getAllByRole("rowheader")).toHaveLength(6);
    const cells = within(table).getAllByRole("cell");
    expect(cells).toHaveLength(6 * count);
    expect(cells.every((cell) => cell.classList.contains("whitespace-nowrap"))).toBe(true);
    expect(cells.some((cell) => cell.classList.contains("truncate"))).toBe(false);
    expect(within(table).getByText(lenders[0])).toBeTruthy();

    const offerHeaderIds = columnHeaders.slice(1).map((header) => header.id);
    const metricHeaderIds = within(table).getAllByRole("rowheader").map((header) => header.id);
    for (const cell of within(table).getAllByRole("cell")) {
      const headers = cell.getAttribute("headers")?.split(" ") ?? [];
      expect(headers).toHaveLength(2);
      expect(metricHeaderIds).toContain(headers[0]);
      expect(offerHeaderIds).toContain(headers[1]);
    }

    expect(table.getAttribute("style")).toContain(`min-width: ${count === 3 ? "30rem" : "20rem"}`);
  });
});
