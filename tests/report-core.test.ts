import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareOffers } from "../lib/finance/comparison";
import type { Offer } from "../lib/finance/types";
import { createComparisonSnapshot } from "../lib/contracts/snapshot";
import { buildComparisonReportModel, renderComparisonReport } from "../lib/reports";

const root = process.cwd();
const fonts = {
  basic: path.join(root, "public/fonts/report/TrueCostSans-Basic.woff"),
  extended: path.join(root, "public/fonts/report/TrueCostSans-Latin.woff"),
  devanagari: path.join(root, "public/fonts/report/TrueCostSans-Devanagari.woff"),
};

function offer(id: string, lender: string, ratePct: number, tenureValue = 20): Offer {
  return {
    id,
    lender,
    loanType: "home",
    amount: 12_500_000,
    ratePct,
    rateType: "reducing",
    rateStructure: "floating",
    tenureValue,
    tenureUnit: "years",
    processingFee: { mode: "percent", value: 0.5 },
    gstPct: 18,
    insurancePremium: 25_000,
    insuranceFunding: "upfront",
    otherFees: [
      { id: `${id}-legal`, label: "Legal and valuation review", amount: 8_500 },
    ],
  };
}

function snapshot(lenders = ["Aster Bank", "Banyan Finance"] as string[]) {
  const offers = lenders.map((lender, index) => offer(`00000000-0000-4000-8000-00000000000${index + 1}`, lender, 8.4 + index * 0.35));
  return createComparisonSnapshot(offers, compareOffers(offers), { createdAt: "2026-09-16T09:00:00.000Z" });
}

async function textFromPdf(blob: Blob): Promise<{ pages: number; text: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await blob.arrayBuffer());
  const document = await pdfjs.getDocument({
    data,
    standardFontDataUrl: `${root.replaceAll("\\", "/")}/node_modules/pdfjs-dist/standard_fonts/`,
  }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return { pages: document.numPages, text: pages.join("\n") };
}

describe("comparison PDF core", () => {
  it("builds a report model from the immutable snapshot without recalculating", () => {
    const value = snapshot();
    const model = buildComparisonReportModel(value, { generatedAt: "2026-09-16T09:01:00.000Z" });
    expect(model.resultId).toBe(value.resultId);
    expect(model.createdAt).toBe(value.createdAt);
    expect(model.generatedAt).toBe("2026-09-16T09:01:00.000Z");
    expect(model.calculationVersion).toBe(value.calculationVersion);
    expect(model.offers[0].emi).toBe(new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value.result.rows.find((row) => row.offerId === model.offers[0].offerId)!.derived.emi));
    expect(model.offers).toHaveLength(2);
    expect(model.offers[0].lender).toBe("Aster Bank");
  });

  it("renders selectable text, rupee grouping, figures, warnings, and long comparisons", async () => {
    const value = snapshot(["आशा गृह ऋण", "Banyan Finance", "Cedar Cooperative"]);
    const started = performance.now();
    const blob = await renderComparisonReport(value, { generatedAt: "2026-09-16T09:01:00.000Z", fonts });
    const elapsed = performance.now() - started;
    const parsed = await textFromPdf(blob);
    console.info(`report fixture render ${elapsed.toFixed(0)}ms, ${parsed.pages} pages, ${blob.size} bytes`);
    expect(blob.type).toContain("pdf");
    expect(parsed.pages).toBeGreaterThanOrEqual(2);
    const normalized = parsed.text.replace(/\s+/g, " ");
    expect(normalized).toContain("TrueCost comparison");
    expect(normalized).toContain("आशा गृह ऋण");
    expect(normalized).toContain("₹ 1,25,00,000");
    expect(normalized).toContain("Monthly EMI");
    expect(normalized).toContain(value.result.rows[0].derived.emi.toLocaleString("en-IN", { maximumFractionDigits: 0 }));
    expect(normalized).toContain(value.result.rows[0].derived.totalRepayment.toLocaleString("en-IN", { maximumFractionDigits: 0 }));
    expect(normalized).toContain(value.result.rows[0].derived.totalInterest.toLocaleString("en-IN", { maximumFractionDigits: 0 }));
    expect(normalized).toContain(value.result.rows[0].derived.totalCostOfBorrowing.toLocaleString("en-IN", { maximumFractionDigits: 0 }));
    expect(normalized).toContain("Processing fee");
    expect(normalized).toContain("Insurance");
    expect(normalized).toContain("Upfront fees");
    expect(normalized).toContain("Assumptions and warnings");
    expect(normalized).toContain("Illustration only");
  }, 15_000); // Includes PDF font loading and text extraction under suite contention.

  it("keeps an APR failure honest instead of inventing a number", async () => {
    const original = snapshot();
    const raw = JSON.parse(JSON.stringify(original));
    const first = raw.result.rows[0].derived;
    first.monthlyIrr = null;
    first.effectiveAprPct = null;
    first.effectiveAnnualRatePct = null;
    const model = buildComparisonReportModel(raw, { generatedAt: "2026-09-16T09:01:00.000Z" });
    expect(model.offers[0].apr).toBe("Unavailable");
    expect(model.offers[0].aprUnavailableReason).toContain("finite APR");
    const parsed = await textFromPdf(await renderComparisonReport(raw, { generatedAt: "2026-09-16T09:01:00.000Z", fonts }));
    const normalized = parsed.text.replace(/\s+/g, " ");
    expect(normalized).toContain("Effective APR Unavailable");
    expect(normalized).toContain("APR reason:");
  });

  it("rejects lender glyphs outside the bundled Latin and Devanagari coverage", async () => {
    const value = snapshot(["தமிழ் வங்கி", "Banyan Finance"]);
    const model = buildComparisonReportModel(value, { generatedAt: "2026-09-16T09:01:00.000Z" });
    expect(model.glyphCoverage.unsupportedLenderCharacters).toContain("த");
    await expect(renderComparisonReport(value, { generatedAt: "2026-09-16T09:01:00.000Z", fonts })).rejects.toMatchObject({ code: "unsupported_report_glyph" });
  });

  it("does not silently drop unsupported fee-label glyphs", async () => {
    const value = snapshot();
    const raw = JSON.parse(JSON.stringify(value));
    raw.offers[0].otherFees[0].label = "தமிழ் fee";
    expect(buildComparisonReportModel(raw, { generatedAt: "2026-09-16T09:01:00.000Z" }).glyphCoverage.unsupportedFeeLabelCharacters).toContain("த");
    await expect(renderComparisonReport(raw, { generatedAt: "2026-09-16T09:01:00.000Z", fonts })).rejects.toMatchObject({ code: "unsupported_report_glyph" });
  });

  it("paginates the maximum warning payload instead of clipping report content", async () => {
    const raw = JSON.parse(JSON.stringify(snapshot(["Aster Bank", "Banyan Finance", "Cedar Cooperative"]))) as any;
    raw.result.notices = Array.from({ length: 100 }, (_, index) => ({ level: "caution", code: `notice-${index}`, message: `Notice ${index} ${"Keep this stored assumption visible. ".repeat(10)}`.slice(0, 500) }));
    const parsed = await textFromPdf(await renderComparisonReport(raw, { generatedAt: "2026-09-16T09:01:00.000Z", fonts }));
    expect(parsed.pages).toBeGreaterThan(2);
    expect(parsed.text.replace(/\s+/g, " ")).toContain("Notice 99");
  });

  it("writes an inspected representative artifact for release review", async () => {
    const blob = await renderComparisonReport(snapshot(["Aster Bank", "Banyan Finance", "Cedar Cooperative"]), { generatedAt: "2026-09-16T09:01:00.000Z", fonts });
    const destination = path.join(root, "docs/evidence/report-core-sample.pdf");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from(await blob.arrayBuffer()));
    const inspected = await textFromPdf(new Blob([await fs.readFile(destination)], { type: "application/pdf" }));
    expect(inspected.text).toContain("TrueCost");
    expect(inspected.pages).toBeGreaterThanOrEqual(2);
    expect((await fs.stat(destination)).size).toBeGreaterThan(5_000);
  });
});
