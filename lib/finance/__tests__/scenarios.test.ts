import { describe, expect, it } from "vitest";
import { compareOffers, labelFor, monthsLabel } from "../comparison";
import { formatINR, formatPct } from "../format";
import type { Offer } from "../types";

/**
 * End-to-end scenarios. These double as the product's claims: each one is a
 * case where the headline rate points the wrong way and the effective APR
 * does not.
 */

function offer(partial: Partial<Offer> & Pick<Offer, "id" | "lender">): Offer {
  return {
    loanType: "home",
    amount: 5000000,
    ratePct: 8.5,
    rateType: "reducing",
    tenureValue: 20,
    tenureUnit: "years",
    processingFee: { mode: "percent", value: 0 },
    gstPct: 18,
    insurancePremium: 0,
    insuranceFunding: "financed",
    otherFees: [],
    ...partial,
  };
}

function report(title: string, offers: Offer[]) {
  const comparison = compareOffers(offers);
  const lines = [`\n${title}`, "─".repeat(title.length)];
  comparison.rows.forEach((row, index) => {
    lines.push(
      [
        `${row.rank}. ${labelFor(row.offer, index).padEnd(14)}`,
        `quoted ${formatPct(row.offer.ratePct).padStart(7)} ${row.offer.rateType.padEnd(8)}`,
        `APR ${formatPct(row.derived.effectiveAprPct).padStart(7)}`,
        `EMI ${formatINR(row.derived.emi).padStart(11)}`,
        `per lakh ${formatINR(row.derived.costPerLakh).padStart(10)}`,
        `over ${monthsLabel(row.derived.tenureMonths)}`,
      ].join("  "),
    );
  });
  comparison.notices.forEach((notice) => lines.push(`   ⚑ ${notice.message}`));
  console.log(lines.join("\n"));
  return comparison;
}

describe("scenario: the lower headline rate is the worse deal", () => {
  it("ranks on APR once fees are counted", () => {
    const result = report("₹50L home loan, 20 years — fees flip the ranking", [
      offer({
        id: "a",
        lender: "Bank A",
        ratePct: 8.5,
        processingFee: { mode: "percent", value: 0.25 },
        otherFees: [{ id: "f1", label: "Legal & valuation", amount: 12000 }],
      }),
      offer({
        id: "b",
        lender: "Bank B",
        ratePct: 8.35,
        processingFee: { mode: "percent", value: 1 },
        otherFees: [{ id: "f2", label: "Legal, stamp, MODT", amount: 45000 }],
        insurancePremium: 180000,
        insuranceFunding: "financed",
      }),
    ]);

    // B advertises the cheaper rate but loses once its fees and financed
    // premium are priced in.
    expect(result.best?.offer.lender).toBe("Bank A");
    expect(result.rows[1].derived.effectiveAprPct).toBeGreaterThan(
      result.rows[0].derived.effectiveAprPct as number,
    );
  });
});

describe("scenario: a flat quote that looks cheaper than it is", () => {
  it("converts the flat rate before ranking", () => {
    const result = report("₹5L personal loan, 4 years — flat vs reducing", [
      offer({
        id: "bank",
        lender: "Bank",
        loanType: "personal",
        amount: 500000,
        ratePct: 13.5,
        rateType: "reducing",
        tenureValue: 4,
        processingFee: { mode: "percent", value: 2 },
      }),
      offer({
        id: "nbfc",
        lender: "NBFC",
        loanType: "personal",
        amount: 500000,
        ratePct: 8,
        rateType: "flat",
        tenureValue: 4,
        processingFee: { mode: "percent", value: 1 },
      }),
    ]);

    // 8% flat over 4 years is materially worse than 13.5% reducing.
    expect(result.best?.offer.lender).toBe("Bank");
    const nbfc = result.rows.find((r) => r.offer.lender === "NBFC");
    expect(nbfc?.derived.effectiveReducingRatePct).toBeGreaterThan(14);
  });
});

describe("scenario: different tenures must not be ranked on total interest", () => {
  it("prefers the cheaper money even though it shows far more interest", () => {
    const result = report("₹30L, 10 years vs 20 years — total interest misleads", [
      offer({ id: "short", lender: "10-year", amount: 3000000, ratePct: 9.4, tenureValue: 10 }),
      offer({ id: "long", lender: "20-year", amount: 3000000, ratePct: 8.4, tenureValue: 20 }),
    ]);

    expect(result.basis.strict).toBe(true);
    expect(result.best?.offer.lender).toBe("20-year");
    // The winner genuinely pays more rupees of interest — which is why the
    // flow refuses to rank on that number.
    expect(result.rows[0].derived.totalInterest).toBeGreaterThan(
      result.rows[1].derived.totalInterest,
    );
    expect(result.notices.some((n) => n.code === "tenures-differ")).toBe(true);
  });
});

describe("scenario: financing the insurance premium", () => {
  it("costs more than paying the same premium upfront", () => {
    const result = report("₹40L home loan — premium financed vs paid upfront", [
      offer({
        id: "fin",
        lender: "Financed",
        amount: 4000000,
        processingFee: { mode: "percent", value: 0.5 },
        insurancePremium: 250000,
        insuranceFunding: "financed",
      }),
      offer({
        id: "up",
        lender: "Upfront",
        amount: 4000000,
        processingFee: { mode: "percent", value: 0.5 },
        insurancePremium: 250000,
        insuranceFunding: "upfront",
      }),
    ]);

    const financed = result.rows.find((r) => r.offer.lender === "Financed")!;
    const upfront = result.rows.find((r) => r.offer.lender === "Upfront")!;
    expect(financed.derived.totalCostOfBorrowing).toBeGreaterThan(
      upfront.derived.totalCostOfBorrowing,
    );
    expect(financed.derived.warnings.some((w) => w.code === "financed-insurance")).toBe(true);
  });
});
