import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "docs/evidence");
const evidencePath = resolve(evidenceDir, "hosted-performance-sample-2026-10-02.json");
await mkdir(evidenceDir, { recursive: true });

const target = process.env.TRUECOST_PERF_URL?.trim();
if (!target || !/^https:\/\//i.test(target)) {
  throw new Error("TRUECOST_PERF_URL must be an explicit HTTPS development URL");
}

const require = createRequire(import.meta.url);
const playwrightPath = process.env.TRUECOST_PLAYWRIGHT_MODULE ||
  "C:/Users/RajeshShinde/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(playwrightPath);
const playwrightPackage = JSON.parse(await readFile(resolve(playwrightPath, "package.json"), "utf8"));

const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "narrow-320", width: 320, height: 780 },
];
const routes = ["/", "/compare", "/compare/results", "/comparisons"];
const trials = 3;
const thresholds = {
  responseEndMs: 2500,
  domContentLoadedMs: 3000,
  loadEventEndMs: 5000,
  lcpMs: 4000,
  cls: 0.1,
  tbtMs: 300,
};
const errors = [];
const samples = [];
const scrub = (value) => String(value)
  .replace(/[?&](?:token|code|__clerk_testing_token)=[^&\s]+/gi, "")
  .replace(/__clerk_testing_token=[^&\s]+/gi, "__clerk_testing_token=[redacted]");

const initPerformance = () => {
  const state = { lcp: null, cls: 0, longTasks: [], unsupported: [] };
  window.__truecostPerformance = state;
  const supported = (name) => Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes(name);
  try {
    if (supported("largest-contentful-paint")) {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) state.lcp = entries[entries.length - 1].startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } else state.unsupported.push("largest-contentful-paint");
  } catch { state.unsupported.push("largest-contentful-paint"); }
  try {
    if (supported("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) state.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } else state.unsupported.push("layout-shift");
  } catch { state.unsupported.push("layout-shift"); }
  try {
    if (supported("longtask")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    } else state.unsupported.push("longtask");
  } catch { state.unsupported.push("longtask"); }
};

const browser = await chromium.launch({ headless: true });
try {
  for (let trial = 1; trial <= trials; trial += 1) {
    for (const viewport of viewports) {
      for (const route of routes) {
      const context = await browser.newContext({ viewport, colorScheme: "light", reducedMotion: "reduce" });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(scrub(message.text()));
      });
      page.on("pageerror", (error) => consoleErrors.push(scrub(error.message)));
      const startedAt = new Date().toISOString();
      try {
        await page.addInitScript(initPerformance);
        const response = await page.goto(new URL(route, target).toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForTimeout(1000);
        const metrics = await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0];
          const state = window.__truecostPerformance || { lcp: null, cls: null, longTasks: [], unsupported: [] };
          const longTaskTotal = state.longTasks.reduce((sum, duration) => sum + duration, 0);
          const tbt = state.longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0);
          return {
            responseEndMs: navigation?.responseEnd ?? null,
            domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
            loadEventEndMs: navigation?.loadEventEnd ?? null,
            durationMs: navigation?.duration ?? null,
            lcpMs: state.lcp,
            cls: state.cls,
            longTaskCount: state.longTasks.length,
            longTaskTotalMs: longTaskTotal,
            tbtMs: tbt,
            unsupportedObservers: state.unsupported,
          };
        });
        samples.push({ trial, route, viewport: viewport.name, width: viewport.width, height: viewport.height, startedAt, finalUrl: scrub(page.url()), responseStatus: response?.status() ?? null, title: await page.title(), status: "sample", metrics, consoleErrors });
      } catch (error) {
        const message = scrub(error instanceof Error ? error.message : String(error));
        errors.push({ trial, route, viewport: viewport.name, message });
        samples.push({ trial, route, viewport: viewport.name, width: viewport.width, height: viewport.height, startedAt, status: "failed", error: message, consoleErrors });
      } finally {
        await context.close();
      }
      }
    }
  }
} finally {
  await browser.close();
}

const median = (values) => {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
};
const metricNames = Object.keys(thresholds);
const aggregate = Object.fromEntries(metricNames.map((name) => {
  const values = samples.filter((sample) => sample.status === "sample").map((sample) => sample.metrics[name]);
  const value = median(values);
  return [name, { median: value, threshold: thresholds[name], withinLabThreshold: value === null ? null : value <= thresholds[name] }];
}));

const evidence = {
  checkedAt: new Date().toISOString(),
  target: scrub(target),
  environment: "hosted-development",
  browser: { engine: "chromium", version: browser.version(), playwright: playwrightPackage.version },
  trials,
  routes,
  viewports,
  samples,
  aggregate,
  status: errors.length === 0 && samples.length === trials * viewports.length * routes.length ? "partial-evidence" : "incomplete",
  releaseGate: "open",
  limitations: [
    "Read-only lab sample against the hosted development candidate; it is not production approval.",
    "The sample does not sign in, write provider data, submit Mixpanel events, deploy, or change hosted state.",
    "Network, browser, and hosted development variance means the lab thresholds are diagnostic only.",
  ],
  errors,
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
if (errors.length) process.exitCode = 1;
