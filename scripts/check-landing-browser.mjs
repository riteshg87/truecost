import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Read-only guest acceptance for the landing page. It serves the already-built
// artifact, uses no Clerk identity, and records only local screenshots and
// diagnostics under docs/evidence.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });
const require = createRequire(import.meta.url);
const playwrightPath = process.env.TRUECOST_PLAYWRIGHT_MODULE ||
  "C:/Users/RajeshShinde/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(playwrightPath);
const playwrightPackage = JSON.parse(await readFile(resolve(playwrightPath, "package.json"), "utf8"));
const buildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim();
const expectedBuildId = process.env.TRUECOST_LANDING_BUILD_ID?.trim();
if (!expectedBuildId || expectedBuildId !== buildId) {
  throw new Error("landing acceptance requires TRUECOST_LANDING_BUILD_ID to match .next/BUILD_ID");
}

const port = Number(process.env.TRUECOST_LANDING_BROWSER_PORT || 0);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("TRUECOST_LANDING_BROWSER_PORT must be an explicitly-owned free port");
}
const nextScript = resolve(root, "node_modules/next/dist/bin/next");
const evidence = {
  checkedAt: new Date().toISOString(),
  buildId,
  baseUrl: `http://localhost:${port}`,
  browser: null,
  viewports: {},
  checks: [],
  errors: [],
  consoleErrors: [],
  requestFailures: [],
  sourceHashes: {},
  status: "pending",
};
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
const scrub = (value) => String(value)
  .replace(/__clerk_testing_token=[^&\s]+/gi, "__clerk_testing_token=[redacted]")
  .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted-key]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-email]");
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

const probePort = async () => {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once("error", reject);
    probe.listen(port, "localhost", resolvePromise);
  });
  await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
};
const waitForServer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${evidence.baseUrl}/`, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Next is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("built Next server did not become ready within 30 seconds");
};
let nextProcess;
let browser;
let activePage;
let activeLabel = "none";
const closeNext = async () => {
  if (!nextProcess || nextProcess.exitCode !== null) return;
  nextProcess.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, 3000);
    nextProcess.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
};

const pageDiagnostics = (page, label) => {
  const consoleErrors = [];
  const requestFailures = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(scrub(message.text()));
  });
  page.on("pageerror", (error) => consoleErrors.push(scrub(error.message)));
  page.on("requestfailed", (request) => requestFailures.push({
    url: scrub(request.url()),
    failure: request.failure()?.errorText || "unknown",
  }));
  return { label, consoleErrors, requestFailures };
};
const viewportMetrics = async (page) => page.evaluate(() => ({
  viewport: window.innerWidth,
  document: document.documentElement.scrollWidth,
  body: document.body.scrollWidth,
  height: document.documentElement.scrollHeight,
  theme: document.documentElement.dataset.theme || "system",
}));
const waitLanding = async (page) => {
  await page.locator("#landing-title").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByRole("button", { name: /Compare two loans/ }).waitFor({ state: "visible" });
};
const screenshot = async (page, name) => {
  const path = resolve(evidenceDir, `landing-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
};
const assertLanding = async (page, label, width) => {
  await waitLanding(page);
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) =>
    button.textContent?.trim() === "Compare two loans" && !(button instanceof HTMLButtonElement && button.disabled)), undefined, { timeout: 15_000 });
  const title = await page.locator("#landing-title").innerText();
  assert.match(title, /Compare the loan/);
  assert.match(title, /behind the rate/);
  await page.getByText("APR, EMI, fees and total borrowing cost", { exact: false }).waitFor();
  const metrics = await viewportMetrics(page);
  assert.ok(Math.max(metrics.document, metrics.body) <= metrics.viewport + 1,
    `${label} horizontal overflow at ${width}px: ${JSON.stringify(metrics)}`);
  const path = await screenshot(page, `${label}-${width}`);
  evidence.viewports[`${label}-${width}`] = { ...metrics, screenshot: path };
  check(`${label} landing content and enabled primary control are visible at ${width}px`, { metrics, screenshot: path, compareEnabled: true });
  return metrics;
};

try {
  await probePort();
  nextProcess = spawn(process.execPath, [nextScript, "start", "-H", "localhost", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "ignore",
  });
  await waitForServer();
  browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = { name: "Chrome", engine: browser.version(), playwright: playwrightPackage.version };

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "no-preference" });
  const desktopPage = await desktop.newPage();
  activePage = desktopPage;
  activeLabel = "desktop";
  const desktopDiag = pageDiagnostics(desktopPage, "desktop");
  await desktopPage.goto(`${evidence.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await assertLanding(desktopPage, "desktop-light", 1440);
  assert.equal(await desktopPage.locator("html").getAttribute("data-theme"), null);
  check("light color scheme follows the system when no theme override is stored");

  const themeToggle = desktopPage.getByRole("button", { name: /Appearance:/ });
  await themeToggle.click();
  await desktopPage.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await themeToggle.click();
  await desktopPage.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  const darkMetrics = await viewportMetrics(desktopPage);
  assert.equal(darkMetrics.theme, "dark");
  const darkShot = await screenshot(desktopPage, "desktop-dark");
  check("theme control cycles through light and dark without changing layout", { screenshot: darkShot, metrics: darkMetrics });
  assert.equal(await desktopPage.evaluate(() => localStorage.getItem("truecost.theme")), "dark");
  check("dark theme choice is stored locally for the next visit");

  await desktopPage.goto(`${evidence.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await desktopPage.getByRole("link", { name: "Sign in", exact: true }).click();
  await desktopPage.waitForURL(/\/signin\?next=%2Fhome$/);
  assert.equal(new URL(desktopPage.url()).pathname, "/signin");
  check("Sign in CTA preserves the intended /home destination", { url: desktopPage.url() });
  await desktopPage.goto(`${evidence.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await desktopPage.getByRole("link", { name: "Already have a loan?" }).click();
  await desktopPage.waitForFunction(() => window.location.hash === "#after-loan");
  assert.equal(new URL(desktopPage.url()).pathname, "/");
  check("loan-context CTA stays on the landing page and reaches its in-page section", { url: desktopPage.url() });
  const anonymousContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "no-preference" });
  const anonymousPage = await anonymousContext.newPage();
  activePage = anonymousPage;
  activeLabel = "anonymous";
  const anonymousDiag = pageDiagnostics(anonymousPage, "anonymous");
  await anonymousPage.goto(`${evidence.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await waitLanding(anonymousPage);
  await anonymousPage.getByRole("link", { name: "Sign in to your account" }).click();
  await anonymousPage.waitForURL(/\/signin\?next=%2Fhome$/);
  check("anonymous footer account CTA preserves the intended sign-in destination", { url: anonymousPage.url() });
  anonymousDiag.consoleErrors.forEach((error) => evidence.consoleErrors.push({ label: anonymousDiag.label, error }));
  anonymousDiag.requestFailures.forEach((failure) => evidence.requestFailures.push({ label: anonymousDiag.label, ...failure }));
  assert.deepEqual(anonymousDiag.consoleErrors, [], "anonymous footer flow emitted browser errors");
  await anonymousContext.close();

  await desktopPage.goto(`${evidence.baseUrl}/`, { waitUntil: "domcontentloaded" });
  const compare = desktopPage.getByRole("button", { name: "Compare two loans" });
  await desktopPage.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) =>
    button.textContent?.trim() === "Compare two loans" && !(button instanceof HTMLButtonElement && button.disabled)));
  await compare.focus();
  await desktopPage.keyboard.press("Enter");
  await desktopPage.waitForFunction(() => window.location.pathname === "/compare", undefined, { timeout: 10_000 });
  await desktopPage.getByRole("heading", { name: "True cost comparison" }).waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(new URL(desktopPage.url()).pathname, "/compare");
  check("Compare CTA works from keyboard focus and stays on the comparison route", { url: desktopPage.url() });
  await desktopPage.goto(`${evidence.baseUrl}/home`, { waitUntil: "domcontentloaded" });
  await desktopPage.waitForFunction(() => window.location.pathname === "/home", undefined, { timeout: 10_000 });
  await desktopPage.getByRole("heading", { name: "What are you looking for?" }).waitFor({ state: "visible", timeout: 10_000 });
  check("guest comparison can return to the guest home route without landing redirect", { url: desktopPage.url() });
  desktopDiag.consoleErrors.forEach((error) => evidence.consoleErrors.push({ label: desktopDiag.label, error }));
  desktopDiag.requestFailures.forEach((failure) => evidence.requestFailures.push({ label: desktopDiag.label, ...failure }));
  assert.deepEqual(desktopDiag.consoleErrors, [], "desktop emitted browser errors");

  const mobileLight = await browser.newContext({ viewport: { width: 320, height: 780 }, colorScheme: "light", reducedMotion: "reduce" });
  const mobilePage = await mobileLight.newPage();
  activePage = mobilePage;
  activeLabel = "mobile-320-reduced";
  const mobileDiag = pageDiagnostics(mobilePage, "mobile-320-reduced");
  await mobilePage.goto(`${evidence.baseUrl}/`, { waitUntil: "domcontentloaded" });
  await assertLanding(mobilePage, "mobile-320-reduced", 320);
  const reducedStyle = await mobilePage.getByRole("button", { name: /Compare two loans/ }).evaluate((element) => getComputedStyle(element).transitionDuration);
  assert.ok(reducedStyle.split(",").every((duration) => Number.parseFloat(duration) <= 0.001), `reduced-motion transition remained ${reducedStyle}`);
  check("reduced-motion mobile view removes landing transition timing", { transitionDuration: reducedStyle });
  await mobilePage.getByRole("link", { name: "Sign in", exact: true }).focus();
  assert.equal(await mobilePage.evaluate(() => document.activeElement?.textContent), "Sign in");
  check("mobile keyboard focus reaches the sign-in link");
  mobileDiag.consoleErrors.forEach((error) => evidence.consoleErrors.push({ label: mobileDiag.label, error }));
  mobileDiag.requestFailures.forEach((failure) => evidence.requestFailures.push({ label: mobileDiag.label, ...failure }));
  assert.deepEqual(mobileDiag.consoleErrors, [], "mobile emitted browser errors");

  const mobile390 = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "no-preference" });
  const mobile390Page = await mobile390.newPage();
  activePage = mobile390Page;
  activeLabel = "mobile-390-dark";
  const mobile390Diag = pageDiagnostics(mobile390Page, "mobile-390-dark");
  await mobile390Page.addInitScript(() => localStorage.setItem("truecost.theme", "dark"));
  await mobile390Page.goto(`${evidence.baseUrl}/`, { waitUntil: "domcontentloaded" });
  const metrics390 = await assertLanding(mobile390Page, "mobile-390-dark", 390);
  assert.equal(metrics390.theme, "dark");
  mobile390Diag.consoleErrors.forEach((error) => evidence.consoleErrors.push({ label: mobile390Diag.label, error }));
  mobile390Diag.requestFailures.forEach((failure) => evidence.requestFailures.push({ label: mobile390Diag.label, ...failure }));
  assert.deepEqual(mobile390Diag.consoleErrors, [], "mobile dark emitted browser errors");

  await desktop.close();
  await mobileLight.close();
  await mobile390.close();
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(scrub(error instanceof Error ? error.message : String(error)));
  if (activePage) {
    evidence.diagnostics = await activePage.evaluate(() => ({
      url: window.location.href,
      pathname: window.location.pathname,
      compareEnabled: Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Compare two loans")?.disabled === false,
      heading: document.querySelector("h1")?.textContent?.trim() || null,
    })).catch(() => ({ url: null, pathname: null, compareEnabled: null, heading: null }));
    evidence.diagnostics.activeLabel = activeLabel;
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await closeNext();
  evidence.sourceHashes[".next/BUILD_ID"] = createHash("sha256").update(await readFile(resolve(root, ".next/BUILD_ID"))).digest("hex");
  evidence.scriptSha256 = await sha256(fileURLToPath(import.meta.url));
  await writeFile(resolve(evidenceDir, "landing-browser.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
