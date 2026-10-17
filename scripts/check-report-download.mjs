import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

// Called only with a disposable, authenticated fixture from the history run.
export async function checkReportDownload({ page, snapshot, evidenceDir, check, scenario = "desktop" }) {
  const section = page.locator("#comparison-report");
  await section.getByRole("button", { name: "Generate PDF", exact: true }).waitFor();
  const started = performance.now();
  await section.getByRole("button", { name: "Generate PDF", exact: true }).click();
  const downloadLink = section.getByRole("link", { name: "Download PDF", exact: true });
  try { await downloadLink.waitFor({ timeout: 60_000 }); }
  catch (error) {
    await page.screenshot({ path: resolve(evidenceDir, `report-browser-${scenario}-failure.png`), fullPage: false });
    const status = await section.innerText().catch(() => "Report section unavailable");
    throw new Error(`${scenario} PDF did not become ready: ${status}`, { cause: error });
  }
  const generationMs = Math.round(performance.now() - started);
  const pendingDownload = page.waitForEvent("download", { timeout: 30_000 });
  await downloadLink.click();
  const download = await pendingDownload;
  assert.equal(download.suggestedFilename(), `truecost-${snapshot.resultId}.pdf`);
  const path = resolve(evidenceDir, scenario === "desktop" ? "report-browser-saved.pdf" : `report-browser-${scenario}.pdf`);
  await download.saveAs(path);
  assert.equal(await download.failure(), null);
  const bytes = await readFile(path);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: new Uint8Array(bytes) }).promise;
  let text = "";
  try {
    for (let index = 1; index <= document.numPages; index += 1) {
      const content = await (await document.getPage(index)).getTextContent();
      text += content.items.map((item) => "str" in item ? item.str : "").join(" ") + " ";
    }
    const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
    const compact = (value) => value.replace(/\s+/g, "");
    for (const offer of snapshot.offers) assert.ok(compact(text).includes(compact(offer.lender)), "PDF omitted a lender");
    for (const row of snapshot.result.rows) {
      for (const value of [row.derived.emi, row.derived.totalRepayment]) {
        assert.ok(compact(text).includes(compact(money(value))), "PDF differs from a stored figure");
      }
    }
    check(`${scenario}: saved report downloaded through a fresh click with stored lender and EMI/repayment parity`, {
      generationMs, pages: document.numPages, bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      limit: "Chrome browser sample; viewport emulation is not a physical phone or mobile performance percentile.",
    });
  } finally { await document.destroy(); }
}

export async function checkWarmOfflineReport(options) {
  const { page, check, evidenceDir } = options;
  const originalViewport = page.viewportSize();
  const detailUrl = page.url();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    // Remount the report while online, retaining the verified document and
    // already-loaded report modules/fonts for the warm offline scenario.
    await page.locator('a[href="/comparisons"]').first().click();
    await page.waitForURL(new URL("/comparisons", detailUrl).href);
    await page.locator(`a[href="${new URL(detailUrl).pathname}"]`).click();
    await page.waitForURL(detailUrl);
    const section = page.locator("#comparison-report");
    await section.getByRole("button", { name: "Generate PDF", exact: true }).waitFor();
    await page.context().setOffline(true);
    await checkReportDownload({ ...options, scenario: "390px-warm-offline" });
    const bounds = await section.getByRole("link", { name: "Download PDF", exact: true }).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, "PDF download control overflows narrow viewport");
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(evidenceDir, "report-browser-390px-warm-offline.png"), fullPage: false });
    check("390px warm offline report control stays inside the viewport", {
      limit: "Uses a verified open document and assets previously loaded online. Cold private reload must remain locked.",
    });
  } finally {
    await page.context().setOffline(false);
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
}
