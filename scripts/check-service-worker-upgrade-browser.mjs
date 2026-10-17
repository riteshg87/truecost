import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TRUECOST_PLAYWRIGHT_MODULE || "playwright");
const swSource = await readFile(resolve(root, "public/sw.js"), "utf8");
const fixture = await readFile(resolve(root, "tests/fixtures/service-worker-harness.html"), "utf8");
const offlineVersion = /const VERSION = "([^"]+)"/.exec(swSource)?.[1];
assert.ok(offlineVersion, "offline worker version was not present");
const upgradedVersion = `${offlineVersion}-upgrade`;
const assets = JSON.parse(/const ASSETS = (\[[^;]+\]);/.exec(swSource)[1]);
const workerFor = (version) => swSource
  .replace(`const VERSION = "${offlineVersion}"`, `const VERSION = "${version}"`)
  .replace(
    'event.source?.postMessage({ type: "TC_SW_STATUS", version: VERSION, cache: CACHE });',
    'caches.keys().then((cacheKeys) => event.source?.postMessage({ type: "TC_SW_STATUS", version: VERSION, cache: CACHE, cacheKeys }));',
  );
const evidence = {
  checkedAt: new Date().toISOString(),
  status: "pending",
  browser: null,
  initialVersion: offlineVersion,
  upgradedVersion,
  checks: [],
  errors: [],
  limits: [
    "This check exercises an open browser tab with a local service worker; installed-app upgrade and rollback remain unverified.",
    "The fixture workers keep the generated asset list unchanged and change only their version/cache identity.",
  ],
};
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
let servedVersion = offlineVersion;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (path === "/harness") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(fixture);
    return;
  }
  if (path === "/sw.js") {
    response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    response.end(workerFor(servedVersion));
    return;
  }
  if (path === "/offline/index.html" || path.startsWith("/offline/assets/") || path === "/offline/manifest.json") {
    try {
      response.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/plain" });
      response.end(await readFile(resolve(root, "public", path.slice(1))));
    } catch {
      response.writeHead(404).end("missing asset");
    }
    return;
  }
  response.writeHead(404).end("not found");
});
await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = { name: "Chrome", engine: browser.version() };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/harness`);
  await page.locator("#seed").click();
  await page.locator("#output").filter({ hasText: "Seeded truecost-v2" }).waitFor();
  await page.locator("#register").click();
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/sw.js"));
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cacheState = async () => page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async (name) => [name, (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname).sort()]))));
  const before = await cacheState();
  assert.deepEqual(before[`truecost-offline-${offlineVersion}`], [...assets].sort());
  assert.equal(before["truecost-v2"], undefined);
  assert.deepEqual(before["fixture-unrelated"], ["/unrelated-canary"]);
  check("initial worker owns the generated asset cache and removes legacy private cache", before);

  servedVersion = upgradedVersion;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("service-worker registration was missing");
    await registration.update();
  });
  const activeStatus = await page.evaluate((expectedVersion) => new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("upgraded worker did not become active")), 30_000);
    const handler = (event) => {
      if (event.data?.type !== "TC_SW_STATUS") return;
      if (event.data.version !== expectedVersion) return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", handler);
      clearInterval(poll);
      resolvePromise({ version: event.data.version, cacheKeys: event.data.cacheKeys });
    };
    const poll = setInterval(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.active?.postMessage({ type: "TC_SW_STATUS" });
    }, 100);
    navigator.serviceWorker.addEventListener("message", handler);
    navigator.serviceWorker.getRegistration().then((registration) => registration?.active?.postMessage({ type: "TC_SW_STATUS" }));
  }), upgradedVersion);
  evidence.activeStatus = activeStatus;
  assert.equal(activeStatus.version, upgradedVersion);
  const cachePoll = [];
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const names = await page.evaluate(() => caches.keys());
    cachePoll.push({ attempt, names });
    if (names.includes(`truecost-offline-${upgradedVersion}`) && !names.includes(`truecost-offline-${offlineVersion}`)) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  evidence.cachePoll = cachePoll;
  const after = await cacheState();
  evidence.after = after;
  assert.deepEqual(after[`truecost-offline-${upgradedVersion}`], [...assets].sort());
  assert.equal(after[`truecost-offline-${offlineVersion}`], undefined);
  assert.deepEqual(after["fixture-unrelated"], ["/unrelated-canary"]);
  check("open tab activates N+1 with complete assets and preserves unrelated cache", after);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#controller").filter({ hasText: "/sw.js" }).waitFor();
  assert.deepEqual(pageErrors, []);
  check("open tab reload remains usable after worker upgrade", { controller: await page.locator("#controller").innerText() });

  servedVersion = offlineVersion;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) throw new Error("service-worker registration was missing before rollback");
    await registration.update();
  });
  const rollbackStatus = await page.evaluate((expectedVersion) => new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("rollback worker did not become active")), 30_000);
    const handler = (event) => {
      if (event.data?.type !== "TC_SW_STATUS" || event.data.version !== expectedVersion) return;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", handler);
      clearInterval(poll);
      resolvePromise({ version: event.data.version, cache: event.data.cache });
    };
    const poll = setInterval(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration?.active?.postMessage({ type: "TC_SW_STATUS" });
    }, 100);
    navigator.serviceWorker.addEventListener("message", handler);
    navigator.serviceWorker.getRegistration().then((registration) => registration?.active?.postMessage({ type: "TC_SW_STATUS" }));
  }), offlineVersion);
  evidence.rollbackStatus = rollbackStatus;
  const rollbackPoll = [];
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const names = await page.evaluate(() => caches.keys());
    rollbackPoll.push({ attempt, names });
    if (names.includes(`truecost-offline-${offlineVersion}`) && !names.includes(`truecost-offline-${upgradedVersion}`)) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  evidence.rollbackPoll = rollbackPoll;
  const rolledBack = await cacheState();
  evidence.rolledBack = rolledBack;
  assert.deepEqual(rolledBack[`truecost-offline-${offlineVersion}`], [...assets].sort());
  assert.equal(rolledBack[`truecost-offline-${upgradedVersion}`], undefined);
  assert.deepEqual(rolledBack["fixture-unrelated"], ["/unrelated-canary"]);
  check("open tab rolls back to N with complete assets and preserves unrelated cache", rolledBack);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#controller").filter({ hasText: "/sw.js" }).waitFor();
  assert.deepEqual(pageErrors, []);
  check("open tab reload remains usable after rollback", { controller: await page.locator("#controller").innerText() });
  evidence.status = "passed";
  await context.close();
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolvePromise) => server.close(() => resolvePromise()));
  await writeFile(resolve(evidenceDir, "service-worker-upgrade-browser.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
