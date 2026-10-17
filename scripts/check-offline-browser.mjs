import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Uses a disposable browser context and synthetic inputs, never a user profile.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TRUECOST_PLAYWRIGHT_MODULE || "playwright");
const evidenceDir = resolve(root, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });
const evidence = { checkedAt: new Date().toISOString(), browser: null, checks: [], errors: [] };
const check = (name, details) => evidence.checks.push({ name, passed: true, details });
const sw = await readFile(resolve(root, "public/sw.js"), "utf8");
evidence.offlineVersion = /const VERSION = "([^"]+)"/.exec(sw)?.[1];
const assets = JSON.parse(/const ASSETS = (\[[^;]+\]);/.exec(sw)[1]);
const routes = new Map([
  ["/harness", resolve(root, "tests/fixtures/service-worker-harness.html")],
  ["/sw.js", resolve(root, "public/sw.js")],
  ...assets.map((path) => [path, resolve(root, "public", path.slice(1))]),
]);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const file = routes.get(path);
  response.setHeader("Cache-Control", "no-store");
  if (!file) { response.writeHead(404).end("Synthetic test path unavailable"); return; }
  const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : "text/html";
  response.setHeader("Content-Type", `${type}; charset=utf-8`);
  try { response.end(await readFile(file)); }
  catch { response.writeHead(500).end("Fixture unavailable"); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const stopServer = async () => {
  if (!server.listening) return;
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
};
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/harness`);
  await page.evaluate(() => {
    localStorage.setItem("truecost.loan.v1", JSON.stringify({ loan: { lender: "PRIVATE_A_MUST_NOT_DISPLAY", outstanding: 987654 } }));
    localStorage.setItem("truecost.prepay.v1", JSON.stringify({ outstanding: 987654, surplus: 123456 }));
  });
  await page.locator("#seed").click();
  await page.locator("#output").filter({ hasText: "Seeded truecost-v2" }).waitFor();
  await page.locator("#register").click();
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/sw.js"));
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cacheState = await page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async (name) => [name, (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname).sort()]))));
  assert.equal(cacheState["truecost-v2"], undefined);
  assert.deepEqual(cacheState[`truecost-offline-${evidence.offlineVersion}`], [...assets].sort());
  assert.deepEqual(cacheState["fixture-unrelated"], ["/unrelated-canary"]);
  check("public cache allowlist and legacy cleanup", cacheState);

  await stopServer();
  await context.setOffline(true);
  const offlineResponse = await page.goto(`${origin}/account`);
  assert.equal(offlineResponse.fromServiceWorker(), true);
  await page.getByRole("heading", { name: "Compare two home loans" }).waitFor();
  assert.equal(await page.getByText("PRIVATE_A_MUST_NOT_DISPLAY").count(), 0);
  assert.match(await page.locator(".offline-label").innerText(), /public only/);
  check("cold navigation with stopped server shows only public calculator", { route: "/account" });
  for (const number of [1, 2]) {
    await page.locator(`#lender-${number}`).fill(`Synthetic lender ${number}`);
    await page.locator(`#amount-${number}`).fill("1000000");
    await page.locator(`#rate-${number}`).fill(number === 1 ? "8.5" : "9");
    await page.locator(`#tenure-${number}`).fill("20");
  }
  await page.getByRole("button", { name: "Calculate comparison", exact: true }).click();
  await page.locator("#result").waitFor({ state: "visible" });
  const firstResult = await page.locator("#result-body").innerText();
  assert.match(firstResult, /APR/);
  assert.match(firstResult, /Total repayment/i);
  assert.match(firstResult, /Total interest/i);
  assert.match(firstResult, /₹/);
  check("first offline calculation produces full result table", { table: firstResult });
  await page.screenshot({ path: resolve(evidenceDir, "offline-browser-desktop.png"), fullPage: true });

  await page.locator("#rate-1").fill("7");
  await page.getByRole("button", { name: "Calculate comparison", exact: true }).click();
  await page.locator("#status").waitFor({ state: "visible" });
  assert.equal(await page.locator("#result-body").innerText(), firstResult);
  assert.match(await page.locator("#status").innerText(), /sign.?in|online/i);
  check("changed-input recalculation preserves first guest result and shows gate");
  for (const action of ["new", "save", "download"]) {
    await page.locator(`[data-action="${action}"]`).click();
    assert.match(await page.locator("#status").innerText(), /sign.?in|online/i);
    assert.equal(await page.locator("#result-body").innerText(), firstResult);
    check(`offline ${action} action shows connectivity/auth requirement`);
  }
  await page.reload();
  await page.locator("#result").waitFor({ state: "visible" });
  assert.equal(await page.locator("#result-body").innerText(), firstResult);
  check("offline reload restores unchanged public first result");
  const requests = await page.evaluate(async () => {
    const outcomes = [];
    for (const [url, options] of [["/api/private-export", {}], ["/compare/results?_rsc=synthetic", { headers: { RSC: "1" } }]]) {
      try { const response = await fetch(url, options); outcomes.push({ url, status: response.status, body: await response.text() }); }
      catch { outcomes.push({ url, failed: true }); }
    }
    return outcomes;
  });
  assert.ok(requests.every((request) => request.failed === true));
  check("API and RSC requests never receive the calculator or private cache", requests);
  const retained = await page.evaluate(() => JSON.parse(localStorage.getItem("truecost.loan.v1")).loan.lender);
  assert.equal(retained, "PRIVATE_A_MUST_NOT_DISPLAY");
  check("legacy device data stays untouched and hidden");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const width = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  assert.ok(width.page <= width.viewport, `Page overflow: ${JSON.stringify(width)}`);
  await page.screenshot({ path: resolve(evidenceDir, "offline-browser-mobile.png"), fullPage: true });
  check("320px reduced-motion layout has no page overflow", width);
  const scrolledTable = await page.locator(".table-wrap").evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    const viewport = element.getBoundingClientRect();
    const lastColumn = element.querySelector("thead th:last-child").getBoundingClientRect();
    return { scrollLeft: element.scrollLeft, visible: lastColumn.left >= viewport.left - 1 && lastColumn.right <= viewport.right + 1 };
  });
  assert.ok(scrolledTable.scrollLeft > 0 && scrolledTable.visible);
  check("mobile comparison scroll exposes the complete second offer", scrolledTable);
  await page.screenshot({ path: resolve(evidenceDir, "offline-browser-mobile-scrolled.png"), fullPage: true });
  assert.deepEqual(pageErrors, []);
  check("no uncaught browser errors");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stopServer();
  await writeFile(resolve(evidenceDir, "offline-browser-smoke.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
