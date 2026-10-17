import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// This checker is deliberately guest-only. It never creates an account and it
// defaults to intercepting every Mixpanel request before it can reach the
// provider. Live delivery requires both an explicit mode and an allow flag.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = resolve(root, "docs/evidence");
const require = createRequire(import.meta.url);
const playwrightModulePath = process.env.TRUECOST_PLAYWRIGHT_MODULE ||
  "C:/Users/RajeshShinde/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(playwrightModulePath);
const playwrightPackage = JSON.parse(await readFile(resolve(playwrightModulePath, "package.json"), "utf8"));

const mode = process.env.TRUECOST_MIXPANEL_MODE?.trim() || "intercept";
if (mode !== "intercept" && mode !== "live") throw new Error("TRUECOST_MIXPANEL_MODE must be intercept or live");
if (mode === "live" && process.env.TRUECOST_MIXPANEL_ALLOW_LIVE !== "1") {
  throw new Error("live Mixpanel delivery requires TRUECOST_MIXPANEL_ALLOW_LIVE=1");
}

const baseUrl = process.env.TRUECOST_MIXPANEL_BASE_URL?.trim() || "";
const expectedPort = Number(process.env.TRUECOST_MIXPANEL_PORT || 0);
const expectedBuildId = process.env.TRUECOST_MIXPANEL_BUILD_ID?.trim() || "";
if (!baseUrl || !expectedPort || !expectedBuildId) {
  throw new Error("Mixpanel browser check requires TRUECOST_MIXPANEL_BASE_URL, TRUECOST_MIXPANEL_PORT and TRUECOST_MIXPANEL_BUILD_ID");
}
const parsedBase = new URL(baseUrl);
if (parsedBase.protocol !== "http:" || parsedBase.hostname !== "localhost" || Number(parsedBase.port) !== expectedPort) {
  throw new Error("Mixpanel browser check accepts only the explicitly owned localhost target");
}
const actualBuildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim();
if (actualBuildId !== expectedBuildId) throw new Error("Mixpanel browser check build ID does not match the explicitly approved artifact");

const localEnv = await readFile(resolve(root, ".env.local"), "utf8").catch(() => "");
const readEnv = (name) => localEnv.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim() || "";
const mixpanelToken = readEnv("NEXT_PUBLIC_MIXPANEL_TOKEN");
if (!/^[a-f0-9]{32}$/i.test(mixpanelToken)) throw new Error("development Mixpanel token is missing or malformed");
const expectedAnalyticsEnabled = process.env.TRUECOST_MIXPANEL_EXPECT_ANALYTICS_ENABLED?.trim() || "true";
const expectedAnalyticsEnvironment = process.env.TRUECOST_MIXPANEL_EXPECT_ANALYTICS_ENVIRONMENT?.trim() || "development";
if (expectedAnalyticsEnabled !== "true" || expectedAnalyticsEnvironment !== "development") throw new Error("Mixpanel browser check requires an explicitly enabled development candidate");
const approvedTokenFingerprint = process.env.TRUECOST_MIXPANEL_APPROVED_TOKEN_SHA256?.trim().toLowerCase() || "";
const actualTokenFingerprint = createHash("sha256").update(mixpanelToken).digest("hex");
if (!/^[a-f0-9]{64}$/.test(approvedTokenFingerprint) || actualTokenFingerprint !== approvedTokenFingerprint) {
  throw new Error("Mixpanel token does not match the explicitly approved development project fingerprint");
}

const checkedAt = new Date().toISOString();
const runId = checkedAt.replace(/[:.]/g, "-");
const screenshotsDir = resolve(evidenceRoot, `mixpanel-browser-${runId}`);
await mkdir(screenshotsDir, { recursive: true });
const evidence = {
  checkedAt,
  mode,
  baseUrl,
  buildId: actualBuildId,
  browser: null,
  checks: [],
  errors: [],
  diagnostics: [],
  mixpanelRequests: [],
  interceptedResponses: [],
  providerResponses: [],
  cleanup: mode === "intercept"
    ? "guest-only; no identities or product records created; intercepted requests never reached Mixpanel"
    : "guest-only; no identities or product records created; synthetic Mixpanel events may remain and require approved provider retention/deletion handling",
  provider: { projectId: "4064154", storageRegion: "US", tokenFingerprintVerified: true },
  candidateConfig: { analyticsEnabled: expectedAnalyticsEnabled === "true", environment: expectedAnalyticsEnvironment, localEnvFileEnabled: readEnv("NEXT_PUBLIC_ANALYTICS_ENABLED") === "true" },
};
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
const scrub = (value) => String(value)
  .replace(/(?:token|distinct_id|\$device_id|\$user_id)=?[^,\s}]+/gi, "[redacted]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-email]")
  .replace(/https?:\/\/[^\s)]+/gi, "[url]");
const sha256File = async (path) => {
  try { return createHash("sha256").update(await readFile(resolve(root, path))).digest("hex"); }
  catch { return null; }
};
const sourcePaths = [
  "lib/analytics/config.ts",
  "lib/analytics/events.ts",
  "lib/analytics/mixpanel-adapter.ts",
  "lib/analytics/provider.tsx",
  "components/AnalyticsConsent.tsx",
  "lib/store.tsx",
  "app/compare/page.tsx",
  ".next/BUILD_ID",
];
const collectSourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, await sha256File(path)])));
evidence.sourceHashes = await collectSourceHashes();

const ALLOWED_EVENTS = new Set([
  "comparison_started", "comparison_completed", "auth_prompt_viewed", "auth_completed",
  "auth_intent_resumed", "comparison_save_status", "comparison_saved", "report_generation_status",
  "report_download_initiated", "feedback_submitted", "web_vital",
]);
const ALLOWED_KEYS = new Set([
  "event_version", "environment", "release", "auth_state", "feature", "route_name", "session_id",
  "draft_id", "result_id", "flow_id", "request_id", "offer_count", "calculation_version", "action",
  "mode", "method", "status", "error_code", "stage", "path", "source", "answer", "context_version",
  "metric_id", "metric", "unit", "value", "device_class", "occurred_at", "$insert_id", "distinct_id",
  "$device_id", "$user_id", "token", "time",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseEnvelope(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && parsed.event && parsed.properties) return parsed;
    if (parsed && typeof parsed === "object" && typeof parsed.data === "string") return parseEnvelope(parsed.data);
  } catch { /* Try the next transport encoding. */ }
  return null;
}

function decodeRequestBody(body) {
  if (!body) return null;
  const direct = parseEnvelope(body);
  if (direct) return direct;
  try {
    const encoded = new URLSearchParams(body).get("data");
    if (!encoded) return null;
    // Mixpanel 2.83 sends JSON in the data form field when configured for JSON.
    const json = parseEnvelope(encoded);
    if (json) return json;
    return parseEnvelope(Buffer.from(encoded, "base64").toString("utf8"));
  } catch { return null; }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || typeof payload.event !== "string" || !payload.properties || typeof payload.properties !== "object") return "invalid event envelope";
  if (!ALLOWED_EVENTS.has(payload.event)) return "event is outside the closed contract";
  const keys = Object.keys(payload.properties);
  const unknown = keys.filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length) return `unexpected SDK/property keys: ${unknown.join(",")}`;
  if (typeof payload.properties.distinct_id !== "string" || typeof payload.properties.$insert_id !== "string") return "missing Mixpanel identity or insert ID";
  if (!UUID.test(payload.properties.$insert_id)) return "insert ID is not an opaque UUID";
  if (Object.prototype.hasOwnProperty.call(payload.properties, "event_id")) return "raw event ID was not mapped to insert ID";
  if (payload.properties.token !== mixpanelToken) return "Mixpanel token did not match the approved development token";
  for (const key of ["distinct_id", "$device_id", "$user_id", "session_id", "draft_id", "result_id", "flow_id", "request_id", "metric_id"]) {
    if (key in payload.properties && (typeof payload.properties[key] !== "string" || !UUID.test(payload.properties[key]))) return `non-opaque correlation value: ${key}`;
  }
  for (const [key, value] of Object.entries(payload.properties)) {
    if (key === "token") continue;
    if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return `non-scalar property: ${key}`;
    if (typeof value === "string" && (/@|https?:\/\/|lender|principal|amount|rate|tenure|fee|gst|insurance|loan|bank/i.test(value))) return `sensitive or contact text in property: ${key}`;
  }
  if (payload.properties.environment !== "development" || payload.properties.feature !== "comparison") return "unexpected environment or feature";
  return null;
}

async function waitFor(predicate, timeoutMs = 20_000, label = "condition") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function fillGuestComparison(page, prefix) {
  await page.getByLabel("Lender name for offer 1", { exact: true }).fill(`${prefix} A`);
  await page.getByLabel("Loan amount for offer 1", { exact: true }).fill("1000000");
  await page.getByLabel("Interest rate for offer 1", { exact: true }).fill("8.5");
  await page.getByLabel("Tenure for offer 1", { exact: true }).fill("10");
  await page.getByLabel("Lender name for offer 2", { exact: true }).fill(`${prefix} B`);
  await page.getByLabel("Loan amount for offer 2", { exact: true }).fill("1000000");
  await page.getByLabel("Interest rate for offer 2", { exact: true }).fill("8.9");
  await page.getByLabel("Tenure for offer 2", { exact: true }).fill("10");
  await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
  await page.getByText(`${prefix} A`, { exact: false }).first().waitFor({ timeout: 20_000 });
}

async function runContext(browser, label, consentAction, expectTraffic) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const requestOffset = evidence.mixpanelRequests.length;
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(scrub(error.message)));
  await context.route("https://api-js.mixpanel.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const payload = decodeRequestBody(request.postData() || "");
    const issue = url.pathname === "/track" || url.pathname === "/track/" ? validatePayload(payload) : "non-track Mixpanel request";
    const record = {
      method: request.method(),
      path: url.pathname,
      contentType: request.headers()["content-type"] || null,
      bodyBytes: Buffer.byteLength(request.postData() || "", "utf8"),
      event: payload?.event || null,
      propertyKeys: payload?.properties && typeof payload.properties === "object" ? Object.keys(payload.properties).sort() : [],
      valid: issue === null,
    };
    if (mode === "intercept") {
      evidence.mixpanelRequests.push(record);
      if (issue) evidence.errors.push(`${label}: ${issue}`);
      // Mixpanel's non-verbose XHR callback parses the response as Number,
      // so the local interception must return the SDK's plain-text 1/0 ack.
      await route.fulfill({ status: issue ? 400 : 200, contentType: "text/plain", body: issue ? "0" : "1" });
    } else if (issue) {
      evidence.mixpanelRequests.push(record);
      evidence.errors.push(`${label}: blocked invalid live request: ${issue}`);
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ status: 0 }) });
    } else {
      evidence.mixpanelRequests.push(record);
      await route.continue();
    }
  });
  page.on("response", async (response) => {
    try {
      const url = new URL(response.url());
      if (url.hostname === "api-js.mixpanel.com") {
        const record = { path: url.pathname, status: response.status() };
        if (mode === "intercept") evidence.interceptedResponses.push(record);
        else evidence.providerResponses.push({ ...record, accepted: (await response.text()).trim() === "1" });
      }
    } catch { /* Ignore non-HTTP responses. */ }
  });
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    const compareButton = page.getByRole("button", { name: "Compare two loans", exact: true });
    await compareButton.waitFor({ timeout: 30_000 });
    await compareButton.click();
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 30_000 });
    if (consentAction === "Withdraw analytics") {
      await page.getByRole("button", { name: "Accept analytics", exact: true }).waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: "Accept analytics", exact: true }).click();
      await waitFor(() => page.getByRole("button", { name: "Turn off analytics", exact: true }).count().then((count) => count === 1), 15_000, `${label} acceptance`);
      await page.getByRole("button", { name: "Turn off analytics", exact: true }).click();
      await waitFor(() => page.evaluate(() => {
        try { return JSON.parse(localStorage.getItem("truecost.analytics.preference.v1") || "null")?.consent === "declined"; }
        catch { return false; }
      }), 15_000, `${label} persisted withdrawal`);
      await waitFor(() => page.getByRole("button", { name: "Accept analytics", exact: true }).count().then((count) => count === 1), 15_000, `${label} withdrawal`);
    } else if (consentAction) {
      await page.getByRole("button", { name: "Accept analytics", exact: true }).waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: consentAction, exact: true }).click();
      if (consentAction === "Accept analytics") {
        await waitFor(() => page.evaluate(() => {
          try { return JSON.parse(localStorage.getItem("truecost.analytics.preference.v1") || "null")?.consent === "accepted"; }
          catch { return false; }
        }), 15_000, `${label} persisted acceptance`);
        await waitFor(() => page.getByRole("button", { name: "Accept analytics", exact: true }).count().then((count) => count === 0), 15_000, `${label} consent transition`);
      } else {
        await waitFor(() => page.evaluate(() => {
          try { return JSON.parse(localStorage.getItem("truecost.analytics.preference.v1") || "null")?.consent === "declined"; }
          catch { return false; }
        }), 15_000, `${label} persisted decline`);
        await waitFor(() => page.getByRole("button", { name: "Turn off analytics", exact: true }).count().then((count) => count === 0), 15_000, `${label} consent transition`);
      }
    }
    await fillGuestComparison(page, label);
    const screenshot = resolve(screenshotsDir, `${label}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    const contextRequests = () => evidence.mixpanelRequests.slice(requestOffset);
    const traffic = () => contextRequests().filter((request) => request.path === "/track" || request.path === "/track/");
    if (expectTraffic) {
      await waitFor(() => contextRequests().some((request) => request.event === "comparison_started") && contextRequests().some((request) => request.event === "comparison_completed"), 15_000, `${label} allowlisted event delivery`);
      const events = contextRequests().filter((request) => request.event).map((request) => request.event);
      assert.deepEqual(events, ["comparison_started", "comparison_completed"], `${label} emitted an unexpected event sequence`);
      assert.ok(traffic().every((request) => request.valid), `${label} had an invalid intercepted payload`);
      if (mode === "live") {
        await waitFor(() => evidence.providerResponses.length >= traffic().length, 15_000, "provider acknowledgements");
        assert.ok(evidence.providerResponses.every((response) => response.status === 200 && response.accepted), "provider did not acknowledge every event");
      }
      check(`${label} produced only the expected comparison event sequence`, { events, screenshot });
    } else {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      assert.equal(traffic().length, 0, `${label} emitted analytics without consent`);
      check(`${label} calculation remained usable with analytics off`, { screenshot });
    }
    assert.deepEqual(pageErrors, [], `${label} had uncaught browser errors`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
evidence.browser = { name: "Chrome", playwright: playwrightPackage.version, engine: browser.version() };
try {
  const response = await fetch(`${baseUrl}/compare`, { redirect: "manual" });
  if (response.status < 200 || response.status >= 500) throw new Error(`approved local server returned HTTP ${response.status}`);
  check("approved localhost candidate responded before browser checks", { status: response.status, buildId: actualBuildId });
  await runContext(browser, "no-consent", null, false);
  await runContext(browser, "declined", "Decline analytics", false);
  await runContext(browser, "withdrawn", "Withdraw analytics", false);
  await runContext(browser, "accepted", "Accept analytics", true);
  evidence.sourceHashesAfterRun = await collectSourceHashes();
  assert.deepEqual(evidence.sourceHashesAfterRun, evidence.sourceHashes, "source files changed during browser verification");
  check("source hashes remained unchanged for the whole browser run");
  if (evidence.errors.length) throw new Error(`${evidence.errors.length} intercepted payload or browser issue(s)`);
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(scrub(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  await browser.close();
  evidence.scriptSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
  const output = resolve(evidenceRoot, `analytics-mixpanel-browser-${runId}.json`);
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ...evidence, output }, null, 2));
}
