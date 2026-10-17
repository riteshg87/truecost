import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Bounded browser check for the explicit guest comparison path while the
// Clerk/Convex services are unavailable. The interception is local to this
// Playwright context and changes no provider or application configuration.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });

const expectedBuildId = process.env.TRUECOST_GUEST_OUTAGE_BUILD_ID?.trim();
if (!expectedBuildId) throw new Error("TRUECOST_GUEST_OUTAGE_BUILD_ID must identify the reviewed build");
const port = Number(process.env.TRUECOST_GUEST_OUTAGE_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("TRUECOST_GUEST_OUTAGE_PORT must be an explicitly-owned port from 1024 to 65535");
}

const buildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim();
assert.equal(buildId, expectedBuildId, "the built artifact is not the explicitly reviewed guest-outage target");

const sourcePaths = [
  "lib/auth/provider.tsx",
  "components/RouteGuard.tsx",
  "lib/store.tsx",
  "app/page.tsx",
  "components/landing/LandingPage.tsx",
  "app/compare/page.tsx",
];
const sha256File = async (relativePath) => createHash("sha256")
  .update(await readFile(resolve(root, relativePath)))
  .digest("hex");
const hashSources = async () => Object.fromEntries(await Promise.all(
  sourcePaths.map(async (relativePath) => [relativePath, await sha256File(relativePath)]),
));

const scrub = (value) => String(value)
  .replace(/__clerk_testing_token=[^&\s]+/gi, "__clerk_testing_token=[redacted]")
  .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
  .replace(/([?&](?:token|authKey|authorization|secret|code|email)=[^&\s]+)/gi, "[redacted-query]")
  .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted-key]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-email]");

const evidence = {
  checkedAt: new Date().toISOString(),
  status: "pending",
  buildId,
  baseUrl: `http://localhost:${port}`,
  sourceRevision: (() => {
    try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
    catch { return "unavailable"; }
  })(),
  sourceHashesBefore: {},
  sourceHashesAfter: {},
  browser: null,
  blockedProviderHosts: ["*.clerk.accounts.dev", "*.convex.cloud"],
  interceptors: { providerHttp: true, convexWebSocket: false },
  blockedRequests: [],
  checks: [],
  errors: [],
  consoleErrors: [],
  requestFailures: [],
  readinessProbes: [],
  screenshots: [],
  limits: [
    "Provider request blocking is scoped to this browser context; it does not change Clerk, Convex, or deployment settings.",
    "The build ID is supplied by the reviewer. Source hashes document the current checkout and do not independently prove build/source parity.",
    "This check covers guest comparison and private-route locking during outage; it does not prove member auth, persistence, or production behavior.",
  ],
};
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
evidence.sourceHashesBefore = await hashSources();

const probePort = async () => {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolvePromise);
  });
  await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
};
const waitForServer = async (url) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (nextProcess?.exitCode !== null) {
      throw new Error(`the reviewed Next server exited before readiness: ${serverOutput.join(" ").slice(-1200) || "no startup output"}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(url, { redirect: "manual", signal: controller.signal });
      evidence.readinessProbes.push({ status: response.status });
      if (response.status >= 200 && response.status < 500) return;
    } catch (error) {
      evidence.readinessProbes.push({ error: scrub(error instanceof Error ? error.message : String(error)) });
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("the reviewed Next build did not become ready within 30 seconds");
};

const require = createRequire(import.meta.url);
const playwrightPath = process.env.TRUECOST_PLAYWRIGHT_MODULE ||
  "C:/Users/RajeshShinde/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(playwrightPath);
const playwrightPackage = JSON.parse(await readFile(resolve(playwrightPath, "package.json"), "utf8"));
const nextScript = resolve(root, "node_modules/next/dist/bin/next");
let nextProcess;
const serverOutput = [];
let browser;
let context;
let page;
const closeNext = async () => {
  if (!nextProcess) return;
  if (nextProcess.exitCode !== null) return;
  nextProcess.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, 3_000);
    nextProcess.once("exit", () => { clearTimeout(timer); resolvePromise(); });
  });
};

try {
  await probePort();
  nextProcess = spawn(process.execPath, [nextScript, "start", "-H", "localhost", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const captureServerOutput = (chunk) => {
    const text = scrub(chunk.toString());
    if (text) serverOutput.push(text.slice(0, 1200));
    while (serverOutput.length > 8) serverOutput.shift();
  };
  nextProcess.stdout?.on("data", captureServerOutput);
  nextProcess.stderr?.on("data", captureServerOutput);
  evidence.serverOutput = serverOutput;
  await waitForServer(evidence.baseUrl);
  browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = { name: "Chrome", engine: browser.version(), playwright: playwrightPackage.version };
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  if (typeof context.routeWebSocket === "function") {
    await context.routeWebSocket("wss://**.convex.cloud/**", (webSocket) => {
      const socketUrl = new URL(webSocket.url());
      evidence.blockedRequests.push({ hostname: socketUrl.hostname.toLowerCase(), resourceType: "websocket" });
      webSocket.close();
    });
    evidence.interceptors.convexWebSocket = true;
  }
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const hostname = requestUrl.hostname.toLowerCase();
    const provider = hostname.endsWith(".clerk.accounts.dev") || hostname.endsWith(".convex.cloud");
    if (!provider) return route.continue();
    evidence.blockedRequests.push({ hostname, resourceType: route.request().resourceType() });
    return route.abort();
  });
  page = await context.newPage();
  page.on("console", (message) => { if (message.type() === "error") evidence.consoleErrors.push(scrub(message.text())); });
  page.on("pageerror", (error) => evidence.errors.push(scrub(error.message)));
  page.on("requestfailed", (request) => {
    const requestUrl = new URL(request.url());
    const hostname = requestUrl.hostname.toLowerCase();
    if (hostname.endsWith(".clerk.accounts.dev") || hostname.endsWith(".convex.cloud")) return;
    evidence.requestFailures.push({ hostname, resourceType: request.resourceType(), failure: request.failure()?.errorText || "unknown" });
  });

  // Fresh context + immediate click is the outage condition: auth requests
  // are blocked before the public guest action is selected.
  await page.goto(`${evidence.baseUrl}/`, { waitUntil: "domcontentloaded" });
  const compareCta = page.getByRole("button", { name: "Compare two loans", exact: true });
  await compareCta.waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await compareCta.isEnabled(), true, "the explicit guest action stayed disabled during auth outage");
  await compareCta.click();
  await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 15_000 });
  await page.getByRole("heading", { name: "True cost comparison", exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  check("fresh outage context enters public comparison after immediate explicit guest action", { path: new URL(page.url()).pathname });

  for (const [index, lender, rate] of [[1, "Guest bank A", "8.5"], [2, "Guest bank B", "8.9"]]) {
    await page.getByLabel(`Lender name for offer ${index}`, { exact: true }).fill(lender);
    await page.getByLabel(`Loan amount for offer ${index}`, { exact: true }).fill("1000000");
    await page.getByLabel(`Interest rate for offer ${index}`, { exact: true }).fill(rate);
  }
  await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
  await page.getByRole("heading", { name: "Results", exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText("Guest bank A", { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText("Guest bank B", { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.getByRole("link", { name: "Saved comparisons", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Account", exact: true }).count(), 0);
  assert.equal(await page.getByText("Loan Health Monitor", { exact: true }).count(), 0);
  const resultsScreenshot = resolve(evidenceDir, "guest-provider-outage-results-390.png");
  await page.screenshot({ path: resultsScreenshot, fullPage: true });
  evidence.screenshots.push(resultsScreenshot);
  check("guest result shows both synthetic offers without private account content", { screenshot: resultsScreenshot });

  for (const route of ["/loan", "/account"]) {
    await page.goto(`${evidence.baseUrl}${route}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("status").filter({ hasText: "Verifying your account" }).waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(new URL(page.url()).pathname, route);
    assert.equal(await page.getByRole("heading", { name: "Loan Health Monitor", exact: true }).count(), 0);
    assert.equal(await page.getByText("Saved comparisons", { exact: true }).count(), 0);
    check(`${route} remains locked while authentication services are unavailable`, { path: route });
  }

  assert.ok(evidence.blockedRequests.some(({ hostname }) => hostname.endsWith(".clerk.accounts.dev")), "no Clerk request was intercepted");
  const convexHttpBlocked = evidence.blockedRequests.some(({ hostname, resourceType }) => hostname.endsWith(".convex.cloud") && resourceType !== "websocket");
  const convexSocketBlocked = evidence.blockedRequests.some(({ hostname, resourceType }) => hostname.endsWith(".convex.cloud") && resourceType === "websocket");
  assert.ok(convexHttpBlocked || convexSocketBlocked || evidence.interceptors.convexWebSocket, "the Convex outage interceptor was not installed or observed");
  assert.equal(evidence.errors.length, 0, `guest outage browser emitted page errors: ${evidence.errors.join(" | ")}`);
  check("Clerk outage interception and Convex interceptors were installed without uncaught page errors", { blockedRequests: evidence.blockedRequests.length, convexHttpBlocked, convexSocketBlocked, convexWebSocketInterceptor: evidence.interceptors.convexWebSocket });
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(scrub(error instanceof Error ? error.message : String(error)));
  if (page) {
    evidence.diagnostics = await page.evaluate(() => ({
      url: window.location.href,
      pathname: window.location.pathname,
      bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 800),
    })).catch(() => ({ url: null, pathname: null, bodyText: null }));
  }
  process.exitCode = 1;
} finally {
  evidence.sourceHashesAfter = await hashSources();
  if (JSON.stringify(evidence.sourceHashesBefore) !== JSON.stringify(evidence.sourceHashesAfter)) {
    evidence.errors.push("guest outage source files changed during the browser run");
    evidence.status = "failed";
    process.exitCode = 1;
  }
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await closeNext();
  evidence.scriptSha256 = await sha256File("scripts/check-guest-provider-outage.mjs");
  const attemptName = `guest-provider-outage-browser-attempt-${evidence.checkedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json`;
  evidence.attemptFile = resolve(evidenceDir, attemptName);
  await writeFile(evidence.attemptFile, `${JSON.stringify(evidence, null, 2)}\n`);
  if (evidence.status === "passed") {
    await writeFile(resolve(evidenceDir, "guest-provider-outage-browser.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
}
console.log(JSON.stringify({ status: evidence.status, buildId: evidence.buildId, checks: evidence.checks.length, blockedRequests: evidence.blockedRequests.length, errors: evidence.errors.length }));
