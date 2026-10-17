import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const baseUrl = "http://localhost:3337";
const evidenceDir = resolve(root, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });
const require = createRequire(import.meta.url);
const playwrightModulePath = process.env.TRUECOST_PLAYWRIGHT_MODULE ||
  "C:/Users/RajeshShinde/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(playwrightModulePath);
const playwrightPackage = JSON.parse(await readFile(resolve(playwrightModulePath, "package.json"), "utf8"));
const buildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim();

const evidence = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  buildId,
  browser: null,
  status: "pending",
  checks: [],
  errors: [],
  writeRequests: [],
  viewportChecks: [],
  screenshots: [],
  accessibility: { productionTwoOffer: {} },
};
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
const scrub = (value) => String(value).replace(/(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted]");

async function assertNoPageOverflow(page, label) {
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(Math.max(sizes.document, sizes.body) <= sizes.viewport, `${label} page overflows: ${JSON.stringify(sizes)}`);
  evidence.viewportChecks.push({ label, ...sizes, pageOverflow: false });
}

async function inspectProductionTable(page, label) {
  const region = page.locator('[role="region"][aria-label^="Loan comparison results"]').first();
  await region.waitFor({ timeout: 30_000 });
  const result = await region.evaluate((container) => {
    const table = container.querySelector("table");
    if (!table) return { error: "missing table" };
    const columnHeaders = [...table.querySelectorAll("thead th[scope=col]")];
    const rowHeaders = [...table.querySelectorAll("tbody th[scope=row]")];
    const cells = [...table.querySelectorAll("tbody td")];
    const refsValid = cells.every((cell) => cell.getAttribute("headers")?.split(/\s+/).every((id) => Boolean(table.querySelector(`#${CSS.escape(id)}`))));
    const numericTextComplete = cells.every((cell) => {
      const element = cell;
      const span = element.querySelector("span");
      return element.textContent?.trim() && element.scrollWidth <= element.clientWidth + 1 && (!span || span.scrollWidth <= span.clientWidth + 1);
    });
    const caption = table.querySelector("caption")?.textContent?.trim() || "";
    const regionRect = container.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    return {
      caption,
      columnHeaders: columnHeaders.length,
      rowHeaders: rowHeaders.length,
      dataCells: cells.length,
      refsValid,
      numericTextComplete,
      regionTabIndex: container.getAttribute("tabindex"),
      tableScrollWidth: container.scrollWidth,
      regionClientWidth: container.clientWidth,
      regionRect: { left: regionRect.left, right: regionRect.right, width: regionRect.width },
      tableRect: { left: tableRect.left, right: tableRect.right, width: tableRect.width },
      numericValues: cells.map((cell) => cell.textContent?.trim() || ""),
    };
  });
  assert.equal(result.error, undefined, `${label} table is missing`);
  assert.equal(result.columnHeaders, 3, `${label} expected metric plus two offer headers`);
  assert.ok(result.rowHeaders >= 6, `${label} expected metric row headers`);
  assert.ok(result.dataCells >= 12, `${label} expected full numeric data cells`);
  assert.equal(result.refsValid, true, `${label} cells have invalid header associations`);
  assert.equal(result.numericTextComplete, true, `${label} numeric text is clipped inside data cells`);
  assert.equal(result.regionTabIndex, "0", `${label} horizontal region is not keyboard focusable`);
  const viewport = await page.evaluate(() => innerWidth);
  const leftGutter = result.regionRect.left;
  const rightGutter = viewport - result.regionRect.right;
  assert.ok(leftGutter >= 19.5, `${label} results region is too close to the left edge: ${leftGutter}px`);
  assert.ok(rightGutter >= 19.5, `${label} results region is too close to the right edge: ${rightGutter}px`);
  if (viewport === 320) {
    assert.ok(Math.abs(leftGutter - 20) < 0.5, `${label} expected a 20px left gutter: ${leftGutter}px`);
    assert.ok(Math.abs(rightGutter - 20) < 0.5, `${label} expected a 20px right gutter: ${rightGutter}px`);
  }
  evidence.accessibility.productionTwoOffer[label] = result;
  check(`${label} exposes a semantic two-offer table with complete numeric cells`, result);
  return region;
}

async function checkNumericValuesAtScrollExtents(region, label) {
  const result = await region.evaluate((container) => {
    const cells = [...container.querySelectorAll("tbody td")];
    const inspect = () => ({
      values: cells.map((cell) => cell.textContent?.trim() || ""),
      complete: cells.every((cell) => {
        const span = cell.querySelector("span");
        return Boolean(cell.textContent?.trim()) && cell.scrollWidth <= cell.clientWidth + 1 && (!span || span.scrollWidth <= span.clientWidth + 1);
      }),
    });
    const startScrollLeft = container.scrollLeft;
    container.scrollLeft = 0;
    const atStart = inspect();
    container.scrollLeft = container.scrollWidth;
    const atEnd = { scrollLeft: container.scrollLeft, ...inspect() };
    container.scrollLeft = startScrollLeft;
    return { atStart, atEnd };
  });
  assert.equal(result.atStart.complete, true, `${label} numeric values are clipped at the start of the results region`);
  assert.equal(result.atEnd.complete, true, `${label} numeric values are clipped at the end of the results region`);
  assert.deepEqual(result.atStart.values, result.atEnd.values, `${label} numeric values changed while scrolling the results region`);
  check(`${label} numeric values remain complete at both horizontal scroll extents`, result);
}

async function checkKeyboardScroll(page, region, label) {
  const dimensions = await region.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollLeft: element.scrollLeft }));
  if (dimensions.scrollWidth <= dimensions.clientWidth + 1) {
    check(`${label} needs no horizontal scroll at this viewport`, dimensions);
  } else {
    await region.focus();
    for (let i = 0; i < 24; i += 1) await page.keyboard.press("ArrowRight");
    const after = await region.evaluate((element) => element.scrollLeft);
    assert.ok(after > dimensions.scrollLeft, `${label} did not scroll horizontally from the keyboard`);
    check(`${label} horizontal results region scrolls with keyboard arrows`, { ...dimensions, after });
  }
}

let browser;
let context;
let page;
try {
  const response = await fetch(baseUrl);
  assert.ok(response.status >= 200 && response.status < 500, `localhost:3337 returned HTTP ${response.status}`);
  browser = await chromium.launch({ channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome", headless: true });
  evidence.browser = { name: "Chrome", engine: browser.version(), playwright: playwrightPackage.version };
  context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  context.on("request", (request) => {
    const method = request.method().toUpperCase();
    const requestUrl = new URL(request.url());
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && (requestUrl.pathname.includes("/api/mutation") || requestUrl.hostname.endsWith("convex.cloud"))) {
      evidence.writeRequests.push({ method, url: `${requestUrl.origin}${requestUrl.pathname}` });
    }
  });
  page = await context.newPage();
  page.on("pageerror", (error) => evidence.errors.push(scrub(error.message)));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Compare two loans");
    return Boolean(button && Object.keys(button).some((key) => key.startsWith("__reactProps$")));
  }, undefined, { timeout: 20_000 });
  await page.getByRole("button", { name: "Compare two loans", exact: true }).click();
  await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
  await page.goto(`${baseUrl}/compare`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 30_000 });
  for (const [index, lender, rate] of [[1, "Browser bank A", "8"], [2, "Browser bank B", "9"]]) {
    await page.getByLabel(`Lender name for offer ${index}`, { exact: true }).fill(lender);
    await page.getByLabel(`Loan amount for offer ${index}`, { exact: true }).fill("1000000");
    await page.getByLabel(`Interest rate for offer ${index}`, { exact: true }).fill(rate);
  }
  await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
  await page.getByText("Browser bank A", { exact: true }).first().waitFor();
  await assertNoPageOverflow(page, "1280px guest result");
  const region1280 = await inspectProductionTable(page, "1280px guest result");
  await page.screenshot({ path: resolve(evidenceDir, "results-table-guest-1280.png"), fullPage: true });
  evidence.screenshots.push("docs/evidence/results-table-guest-1280.png");
  await checkNumericValuesAtScrollExtents(region1280, "1280px guest result");
  await checkKeyboardScroll(page, region1280, "1280px guest result");

  await page.setViewportSize({ width: 320, height: 760 });
  await page.getByText("Browser bank A", { exact: true }).first().waitFor();
  await assertNoPageOverflow(page, "320px guest result");
  const region320 = await inspectProductionTable(page, "320px guest result");
  await page.screenshot({ path: resolve(evidenceDir, "results-table-guest-320.png"), fullPage: true });
  evidence.screenshots.push("docs/evidence/results-table-guest-320.png");
  await checkNumericValuesAtScrollExtents(region320, "320px guest result");
  await checkKeyboardScroll(page, region320, "320px guest result");
  assert.equal(evidence.writeRequests.length, 0, `guest browser check attempted provider/server writes: ${JSON.stringify(evidence.writeRequests)}`);
  check("guest comparison made no account or provider write requests");

  assert.deepEqual(evidence.errors, [], "browser check had uncaught page errors");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(scrub(error instanceof Error ? error.message : String(error)));
  await page?.screenshot({ path: resolve(evidenceDir, "results-table-browser-failed.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await writeFile(resolve(evidenceDir, "results-table-browser.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
