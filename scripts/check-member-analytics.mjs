import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Opt-in development verification. It uses new synthetic Clerk identities,
// intercepts Mixpanel by default, and never prints credentials, payload values,
// email addresses, Clerk IDs, Convex IDs, or analytics identities.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "docs/evidence");
const playwrightModulePath = process.env.TRUECOST_PLAYWRIGHT_MODULE ||
  "C:/Users/RajeshShinde/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const expectedIssuer = "live-tarpon-2666.clerk.accounts.dev";
const expectedConvexUrl = "https://dutiful-fly-37.convex.cloud";
const mode = process.env.TRUECOST_MEMBER_ANALYTICS_MODE?.trim() || "intercept";
const port = Number(process.env.TRUECOST_MEMBER_ANALYTICS_PORT || 0);
const expectedBuildId = process.env.TRUECOST_MEMBER_ANALYTICS_BUILD_ID?.trim() || "";
const suppliedBaseUrl = process.env.TRUECOST_MEMBER_ANALYTICS_BASE_URL?.trim() || "";
const guestJoinMode = process.env.TRUECOST_MEMBER_ANALYTICS_GUEST_JOIN === "1";
const logoutWithoutWithdrawal = process.env.TRUECOST_MEMBER_ANALYTICS_LOGOUT_WITHOUT_WITHDRAWAL === "1";
const accountSwitchMode = process.env.TRUECOST_MEMBER_ANALYTICS_ACCOUNT_SWITCH === "1";
const pendingTransitionMode = process.env.TRUECOST_MEMBER_ANALYTICS_PENDING_TRANSITION === "1";
const secondTabTransition = process.env.TRUECOST_MEMBER_ANALYTICS_SECOND_TAB === "1";
const transportOfflineMode = process.env.TRUECOST_MEMBER_ANALYTICS_TRANSPORT_OFFLINE === "1";
const deviceOfflineMode = process.env.TRUECOST_MEMBER_ANALYTICS_DEVICE_OFFLINE === "1";
const hardNavigation = process.env.TRUECOST_MEMBER_ANALYTICS_HARD_NAVIGATION === "1";
const navigationSettleMs = Number(process.env.TRUECOST_MEMBER_ANALYTICS_NAVIGATION_SETTLE_MS || 0);
if ((hardNavigation || navigationSettleMs !== 0) && !accountSwitchMode) throw new Error("navigation diagnostics require account-switch mode");
if (!Number.isInteger(navigationSettleMs) || navigationSettleMs < 0 || navigationSettleMs > 5000) throw new Error("navigation settle interval must be 0-5000ms");
if (logoutWithoutWithdrawal && !guestJoinMode) throw new Error("ordinary logout verification requires the consented guest join scenario");
if (accountSwitchMode && (guestJoinMode || logoutWithoutWithdrawal)) throw new Error("account-switch verification is exclusive of guest-join and ordinary-logout scenarios");
if (pendingTransitionMode && (!accountSwitchMode || mode !== "intercept" || hardNavigation)) throw new Error("pending account-transition verification requires intercepted in-app account switching");
if (secondTabTransition && !pendingTransitionMode) throw new Error("second-tab transition verification requires pending account-transition mode");
if (transportOfflineMode && (!accountSwitchMode || pendingTransitionMode || secondTabTransition || mode !== "intercept")) throw new Error("offline transport verification requires an intercepted account switch without a held transition");
if (deviceOfflineMode && (!accountSwitchMode || transportOfflineMode || pendingTransitionMode || secondTabTransition || hardNavigation || mode !== "intercept")) throw new Error("device offline verification requires a plain intercepted account switch");
const approvedTokenSha = (process.env.TRUECOST_MEMBER_ANALYTICS_APPROVED_TOKEN_SHA256 || process.env.TRUECOST_MIXPANEL_APPROVED_TOKEN_SHA256 || "").trim().toLowerCase();
if (mode !== "intercept" && mode !== "live") throw new Error("TRUECOST_MEMBER_ANALYTICS_MODE must be intercept or live");
if (mode === "live" && process.env.TRUECOST_MEMBER_ANALYTICS_ALLOW_LIVE !== "1") throw new Error("live mode requires TRUECOST_MEMBER_ANALYTICS_ALLOW_LIVE=1");
if (accountSwitchMode && mode !== "intercept") throw new Error("account-switch verification is restricted to Mixpanel interception");
if (!Number.isInteger(port) || port < 1024 || port > 65_535 || !expectedBuildId) throw new Error("member harness requires an explicitly owned port and exact build ID");
if (suppliedBaseUrl && suppliedBaseUrl !== `http://localhost:${port}`) throw new Error("member harness base URL must be the exact localhost URL for its owned port");
if (!approvedTokenSha || !/^[a-f0-9]{64}$/.test(approvedTokenSha)) throw new Error("member harness requires the approved Mixpanel token SHA256");

const envText = await readFile(resolve(root, ".env.local"), "utf8").catch(() => "");
const envValue = (name) => envText.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "") || "";
const publishableKey = envValue("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
const secretKey = envValue("CLERK_SECRET_KEY");
const convexUrl = envValue("NEXT_PUBLIC_CONVEX_URL");
const mixpanelToken = envValue("NEXT_PUBLIC_MIXPANEL_TOKEN");
const decodeIssuer = (key) => {
  try {
    const encoded = key.replace(/^pk_test_/, "");
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - encoded.length % 4) % 4);
    const decoded = atob(padded);
    return decoded.endsWith("$") ? decoded.slice(0, -1) : null;
  } catch { return null; }
};
if (!/^pk_test_[A-Za-z0-9_-]+$/.test(publishableKey) || decodeIssuer(publishableKey) !== expectedIssuer ||
    !/^sk_test_[A-Za-z0-9_-]{16,256}$/.test(secretKey) || convexUrl !== expectedConvexUrl || !/^[a-f0-9]{32}$/i.test(mixpanelToken)) {
  throw new Error("development Clerk, Convex, or Mixpanel configuration is not the approved instance");
}
if (createHash("sha256").update(mixpanelToken).digest("hex") !== approvedTokenSha) throw new Error("Mixpanel token did not match the approved SHA256");
const actualBuildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim();
if (actualBuildId !== expectedBuildId) throw new Error("member harness build ID does not match the explicitly approved artifact");
const harnessSourceSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
// Bundle the production event contract for the harness rather than copying
// its allowlist and parser rules into a second implementation.
const { build } = await import("esbuild");
const eventBundle = await build({ entryPoints: [resolve(root, "lib/analytics/events.ts")], bundle: true, platform: "browser", format: "esm", write: false });
const eventModule = await import(`data:text/javascript;base64,${Buffer.from(eventBundle.outputFiles[0].text).toString("base64")}`);
const parseAppAnalyticsEvent = eventModule.parseAnalyticsEvent;

const evidence = {
  checkedAt: new Date().toISOString(),
  status: "pending",
  mode,
  scenario: deviceOfflineMode ? "same-browser-account-switch-with-device-offline-reconnect" : transportOfflineMode ? "same-browser-account-switch-with-offline-analytics-transport" : secondTabTransition ? "same-browser-second-tab-account-switch-with-pending-analytics" : pendingTransitionMode ? "same-browser-account-switch-with-pending-analytics" : accountSwitchMode ? "same-browser-account-switch" : logoutWithoutWithdrawal ? "consented-guest-to-member-ordinary-logout" : guestJoinMode ? "consented-guest-to-member" : "fresh-member",
  navigation: accountSwitchMode ? { hardNavigation, settleMs: navigationSettleMs } : null,
  baseUrl: suppliedBaseUrl || `http://localhost:${port}`,
  buildId: actualBuildId,
  issuer: expectedIssuer,
  convexTarget: expectedConvexUrl,
  mixpanelToken: "matched-approved-sha256",
  harnessSourceSha256,
  timing: accountSwitchMode ? { clock: "node-date-ms", startedAt: Date.now(), markers: [], events: [], consentQueries: [], providerMarks: [] } : null,
  events: [],
  checks: [],
  errors: [],
  cleanupErrors: [],
  preservedIdentities: [],
  cleanup: { status: "pending", feedbackResidual: "not inspected", analyticsResidual: "not inspected" },
};
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
const markTiming = (name, details = {}) => {
  if (!evidence.timing) return;
  evidence.timing.markers.push({ name, phase, elapsedMs: Date.now() - evidence.timing.startedAt, ...details });
};
const preferenceQueryStarted = new Map();
const isAnalyticsPreferenceQuery = (request) => {
  if (!evidence.timing || !request.url().startsWith(expectedConvexUrl) || request.method() !== "POST") return false;
  const body = request.postData() || "";
  return /analytics(?::|%3a|%2f|[\\/]).*getPreference/i.test(body) || /getPreference.*analytics/i.test(body);
};
const recordPreferenceQuery = (request, status) => {
  if (!evidence.timing || !isAnalyticsPreferenceQuery(request)) return;
  const now = Date.now();
  const startedAt = preferenceQueryStarted.get(request);
  if (status === "started") {
    preferenceQueryStarted.set(request, now);
    evidence.timing.consentQueries.push({ status: "started", elapsedMs: now - evidence.timing.startedAt });
    markTiming("analytics_preference_query_started");
    return;
  }
  if (startedAt === undefined) return;
  preferenceQueryStarted.delete(request);
  const query = { status, elapsedMs: now - evidence.timing.startedAt, requestDurationMs: now - startedAt };
  evidence.timing.consentQueries.push(query);
  markTiming(`analytics_preference_query_${status}`, { requestDurationMs: query.requestDurationMs });
};
const markEventTiming = (event) => {
  if (!evidence.timing) return;
  evidence.timing.events.push({ event: event?.event ?? null, phase, elapsedMs: Date.now() - evidence.timing.startedAt });
};
async function markBrowserTiming(name) {
  if (!page || !evidence.timing) return;
  await page.evaluate((mark) => performance.mark(`truecost.harness.${mark}`), name);
}
async function collectProviderMarks(label) {
  if (!page || !evidence.timing) return;
  const marks = await page.evaluate(() => performance.getEntriesByType("mark")
    .filter((entry) => entry.name.startsWith("truecost.analytics.") || entry.name.startsWith("truecost.harness."))
    .map((entry) => ({ name: entry.name, documentElapsedMs: Math.round(entry.startTime) })));
  evidence.timing.providerMarks.push({ label, marks });
}
const safeError = (error) => {
  const message = error instanceof Error ? error.message : "";
  const http = message.match(/HTTP \d{3}/)?.[0];
  return http ? `request failed (${http})` : `${error?.name || "Error"}: ${message.split("\n")[0].replace(/https?:\/\/\S+/g, "[url]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").replace(/(?:sk|pk)_(?:test|live)_\S+/g, "[key]").slice(0, 180)}`;
};

const ALLOWED_EVENTS = new Set([
  "comparison_started", "comparison_completed", "auth_prompt_viewed", "auth_completed", "auth_intent_resumed", "comparison_save_status",
  "comparison_saved", "report_generation_status", "report_download_initiated", "feedback_submitted",
]);
const ALLOWED_KEYS = new Set([
  "event_version", "environment", "release", "auth_state", "feature", "route_name", "event_id",
  "occurred_at", "session_id", "draft_id", "result_id", "flow_id", "request_id", "offer_count",
  "calculation_version", "action", "mode", "method", "status", "error_code", "stage", "path",
  "source", "answer", "context_version", "$insert_id", "distinct_id", "$device_id", "$user_id",
  "token", "time",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseEnvelope(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.event && parsed?.properties) return parsed;
    if (typeof parsed?.data === "string") return parseEnvelope(parsed.data);
  } catch { /* Mixpanel may use form or base64 encoding. */ }
  return null;
}
function decodeBody(body) {
  const direct = parseEnvelope(body);
  if (direct) return direct;
  try {
    const encoded = new URLSearchParams(body).get("data");
    if (!encoded) return null;
    return parseEnvelope(encoded) || parseEnvelope(Buffer.from(encoded, "base64").toString("utf8"));
  } catch { return null; }
}
function validateEvent(payload) {
  if (!payload || typeof payload.event !== "string" || !payload.properties || typeof payload.properties !== "object") return "invalid envelope";
  if (!ALLOWED_EVENTS.has(payload.event)) return "event outside member contract";
  const properties = payload.properties;
  const unknown = Object.keys(properties).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length) return "unexpected property key";
  if (Object.prototype.hasOwnProperty.call(properties, "event_id")) return "raw event ID was not mapped to Mixpanel insert ID";
  if (properties.token !== mixpanelToken || typeof properties.$insert_id !== "string" || !UUID.test(properties.$insert_id)) return "Mixpanel acknowledgement identity was invalid";
  for (const key of ["distinct_id", "$device_id", "$user_id", "session_id", "draft_id", "result_id", "flow_id", "request_id", "metric_id"]) {
    if (key in properties && (typeof properties[key] !== "string" || !UUID.test(properties[key]))) return `non-opaque correlation value (${key})`;
  }
  for (const [key, value] of Object.entries(properties)) {
    if (key === "token") continue;
    if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return "non-scalar analytics property";
    if (typeof value === "string" && (/@|https?:\/\//i.test(value) || value.length > 128)) return "contact or private text reached analytics";
  }
  const appProperties = { ...properties };
  const eventId = appProperties.$insert_id;
  delete appProperties.$insert_id;
  delete appProperties.distinct_id;
  delete appProperties.$device_id;
  delete appProperties.$user_id;
  delete appProperties.token;
  delete appProperties.time;
  appProperties.event_id = eventId;
  const contract = parseAppAnalyticsEvent({ event: payload.event, properties: appProperties });
  if (!contract.ok) return `production analytics contract rejected event (${contract.code})`;
  const guestEvent = guestJoinMode && ["comparison_started", "comparison_completed", "auth_prompt_viewed"].includes(payload.event);
  if (properties.auth_state !== "member" && !(guestEvent && properties.auth_state === "guest")) return "event had an invalid auth state";
  if (properties.environment !== "development") return "unexpected analytics environment";
  if (properties.release !== "0.1.0" || properties.event_version !== 1 || typeof properties.occurred_at !== "string" || Number.isNaN(Date.parse(properties.occurred_at))) return "common analytics fields were invalid";
  if (payload.event === "comparison_started" && (properties.feature !== "comparison" || properties.route_name !== "compare" || !UUID.test(properties.draft_id))) return "comparison start shape was invalid";
  if (payload.event === "comparison_completed" && (properties.feature !== "comparison" || properties.route_name !== "compare_results" || !UUID.test(properties.draft_id) || !UUID.test(properties.result_id) || !Number.isInteger(properties.offer_count) || typeof properties.calculation_version !== "string")) return "comparison completion shape was invalid";
  if (payload.event === "auth_prompt_viewed" && (properties.auth_state !== "guest" || properties.feature !== "comparison" || properties.route_name !== "compare_results" || !UUID.test(properties.session_id) || !UUID.test(properties.result_id) || !["save", "download", "compare_again"].includes(properties.action))) return "authentication prompt shape was invalid";
  if (payload.event === "auth_completed" && (properties.feature !== "comparison" || properties.route_name !== "signin" || !UUID.test(properties.flow_id))) return "authentication completion shape was invalid";
  if (payload.event === "auth_intent_resumed" && (properties.feature !== "comparison" || properties.route_name !== "compare_results" || !UUID.test(properties.flow_id))) return "authentication resume shape was invalid";
  if (payload.event === "comparison_save_status" && (properties.feature !== "comparison" || properties.route_name !== "compare_results" || !UUID.test(properties.request_id))) return "save status shape was invalid";
  if (payload.event === "comparison_saved" && (properties.feature !== "comparison" || properties.route_name !== "compare_results" || !UUID.test(properties.request_id))) return "saved event shape was invalid";
  if (payload.event === "report_generation_status" && (properties.feature !== "comparison" || !["compare_results", "comparison_detail"].includes(properties.route_name) || !UUID.test(properties.request_id))) return "report status shape was invalid";
  if (payload.event === "report_download_initiated" && (properties.feature !== "comparison" || properties.route_name !== "comparison_detail" || !UUID.test(properties.request_id))) return "report download shape was invalid";
  if (payload.event === "feedback_submitted" && (properties.feature !== "comparison" && properties.feature !== "loan_health" || properties.answer !== "yes" && properties.answer !== "no" || properties.context_version !== "v1" || !UUID.test(properties.result_id))) return "feedback event shape was invalid";
  if (payload.event === "comparison_save_status" && properties.route_name !== "compare_results") return "save route was invalid";
  if (payload.event === "comparison_saved" && properties.route_name !== "compare_results") return "saved route was invalid";
  if (payload.event === "report_generation_status" && !["compare_results", "comparison_detail"].includes(properties.route_name)) return "report route was invalid";
  if (payload.event === "report_download_initiated" && properties.route_name !== "comparison_detail") return "download route was invalid";
  return null;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}
async function assertPortFree() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => { probe.once("error", reject); probe.listen(port, "localhost", resolvePromise); });
  await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
}
async function clerkRequest(path, options = {}) {
  const response = await fetch(`https://api.clerk.com/v1${path}`, { ...options, headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json", ...options.headers } });
  if (!response.ok) throw new Error(`Clerk API request failed with HTTP ${response.status}`);
  return response.json().catch(() => null);
}
function rowsFrom(payload) { return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []; }
async function syntheticUser(email) {
  const payload = await clerkRequest(`/users?email_address=${encodeURIComponent(email)}&limit=10`);
  const matches = rowsFrom(payload).filter((user) => user?.email_addresses?.some((address) => address?.email_address === email));
  if (matches.length > 1) throw new Error("synthetic address matched more than one Clerk user");
  return matches[0]?.id || null;
}
async function testingToken() {
  if (process.env.CLERK_TESTING_TOKEN) return process.env.CLERK_TESTING_TOKEN;
  const response = await fetch("https://api.clerk.com/v1/testing_tokens", { method: "POST", headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json", "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`Clerk testing token request failed with HTTP ${response.status}`);
  const payload = await response.json().catch(() => null);
  if (typeof payload?.token !== "string" || payload.token.length < 10) throw new Error("Clerk testing token response was invalid");
  return payload.token;
}
async function convexClientForPage(page, ConvexHttpClient) {
  const token = await page.evaluate(async () => {
    const session = globalThis.Clerk?.session;
    if (!session) return null;
    const token = await session.getToken();
    if (typeof token === "string" && token.split(".").length === 3) {
      try {
        const body = token.split(".")[1];
        const decoded = atob(body.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(body.length / 4) * 4, "="));
        if (JSON.parse(decoded)?.aud === "convex") return token;
      } catch { /* Try the named template below. */ }
    }
    return session.getToken({ template: "convex" });
  });
  if (typeof token !== "string" || token.length < 32) throw new Error("verified Convex token was unavailable");
  return new ConvexHttpClient(expectedConvexUrl, { auth: token, logger: false });
}
async function listComparisons(client, api) {
  const result = await client.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 50, cursor: null } });
  if (result?.status !== "ok" || !Array.isArray(result.result?.page)) throw new Error("authenticated comparison list was not acknowledged");
  return result.result.page;
}
async function deleteComparison(client, api, row) {
  const result = await client.mutation(api.comparisons.deleteComparison, { requestId: randomUUID(), resultId: row.resultId, createdAt: new Date().toISOString() });
  if (result?.status !== "deleted" && result?.status !== "replayed") throw new Error("owned comparison deletion was not acknowledged");
  const fetched = await client.query(api.comparisons.getComparison, { comparisonId: row._id });
  if (fetched !== null) throw new Error("owned comparison remained readable after cleanup");
}
async function cleanupSwitchComparisons(account) {
  if (!account.client) return { deleted: 0, remaining: null };
  const rows = await listComparisons(account.client, convexApi);
  const runOwned = rows.filter((row) => !account.baselineResultIds.has(row.resultId));
  for (const row of runOwned) await deleteComparison(account.client, convexApi, row);
  const remaining = (await listComparisons(account.client, convexApi)).filter((row) => !account.baselineResultIds.has(row.resultId));
  assert.equal(remaining.length, 0, `${account.label} retained a run-owned comparison after cleanup`);
  return { deleted: runOwned.length, remaining: remaining.length };
}
function assertAccountSwitchEventPair(payloads, label) {
  assert.equal(payloads.length, 2, `${label} emitted an unexpected event count`);
  assert.deepEqual(payloads.map((payload) => payload?.event).sort(), ["comparison_completed", "comparison_started"], `${label} emitted an unexpected event multiset`);
  const started = payloads.find((payload) => payload?.event === "comparison_started");
  const completed = payloads.find((payload) => payload?.event === "comparison_completed");
  assert.ok(started && completed, `${label} comparison pair was incomplete`);
  assert.equal(started.properties.draft_id, completed.properties.draft_id, `${label} changed draft correlation between events`);
  const identities = payloads.map((payload) => payload.properties);
  assert.ok(identities.every((properties) => properties.distinct_id === properties.$user_id), `${label} distinct ID did not equal user ID`);
  assert.ok(identities.every((properties) => properties.$device_id !== properties.$user_id), `${label} device ID matched its user ID`);
  const insertIds = identities.map((properties) => properties.$insert_id);
  assert.equal(new Set(insertIds).size, insertIds.length, `${label} reused a Mixpanel insert ID`);
}
async function fillOffers(page, prefix) {
  const values = [[1, `${prefix} A`, "1000000", "8.5", "10"], [2, `${prefix} B`, "1000000", "8.9", "10"]];
  for (const [index, lender, amount, rate, tenure] of values) {
    await page.getByLabel(`Lender name for offer ${index}`, { exact: true }).fill(lender);
    await page.getByLabel(`Loan amount for offer ${index}`, { exact: true }).fill(amount);
    await page.getByLabel(`Interest rate for offer ${index}`, { exact: true }).fill(rate);
    await page.getByLabel(`Tenure for offer ${index}`, { exact: true }).fill(tenure);
  }
}
async function signInMemberOnPage(page, accountEmail, label) {
  await page.goto(`${evidence.baseUrl}/signin`, { waitUntil: "domcontentloaded" });
  await waitClerk(page);
  await page.locator("#signin-email").fill(accountEmail);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 20_000 });
  await page.locator("#signin-code").fill("424242");
  await page.waitForURL(/\/home(?:\?|$)/, { timeout: 30_000 });
  try {
    await page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded && globalThis.Clerk?.session), undefined, { timeout: 30_000 });
  } catch (error) {
    if (!secondTabTransition) throw error;
    // A same-context second tab can leave the first Clerk runtime at the
    // signed-out boundary after the session completes. Reload that tab once
    // so this harness measures the auth transition instead of a stale client.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded && globalThis.Clerk?.session), undefined, { timeout: 30_000 });
  }
  check(`${label} disposable member reached the authenticated route`);
}
async function waitClerk(page) { await page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded), undefined, { timeout: 45_000 }); }
async function waitEvent(name) { await waitFor(() => evidence.events.some((event) => event.event === name), 20_000, `${name} Mixpanel request`); }
async function waitMixpanelAcks() {
  if (mode === "intercept") return;
  await waitFor(() => evidence.events.every((event) => event.acknowledgement !== "pending"), 20_000, "Mixpanel provider acknowledgements");
  assert.ok(evidence.events.every((event) => event.acknowledgement === "http-ack"), "Mixpanel did not acknowledge every member event");
}

const EXPECTED_MEMBER_EVENT_COUNTS = Object.freeze({
  comparison_started: 1,
  comparison_completed: 1,
  comparison_save_status: 2,
  comparison_saved: 1,
  feedback_submitted: 1,
  report_generation_status: 2,
  report_download_initiated: 1,
});
const EXPECTED_MEMBER_EVENT_COUNT = Object.values(EXPECTED_MEMBER_EVENT_COUNTS).reduce((total, count) => total + count, 0);

function assertFreshMemberFlowContracts() {
  assert.equal(observedMemberPayloads.length, EXPECTED_MEMBER_EVENT_COUNT, "member flow emitted an unexpected event count");
  const eventNames = observedMemberPayloads.map((payload) => payload?.event);
  const eventCounts = Object.fromEntries(Object.keys(EXPECTED_MEMBER_EVENT_COUNTS).map((name) => [name, eventNames.filter((event) => event === name).length]));
  assert.deepEqual(eventCounts, EXPECTED_MEMBER_EVENT_COUNTS, "member flow emitted an unexpected event multiset");

  const payloads = observedMemberPayloads;
  const props = (eventName) => payloads.filter((payload) => payload?.event === eventName).map((payload) => payload.properties);
  const started = props("comparison_started");
  const completed = props("comparison_completed");
  assert.equal(started.length, 1, "member flow must have one comparison start");
  assert.equal(completed.length, 1, "member flow must have one comparison completion");
  assert.ok(started[0].draft_id === completed[0].draft_id, "comparison draft correlation changed between start and completion");

  const memberIdentityFields = ["distinct_id", "$user_id"];
  const memberIdentityFieldsPresent = payloads.every((payload) => memberIdentityFields.every((field) => typeof payload?.properties?.[field] === "string"));
  assert.ok(memberIdentityFieldsPresent, "every member event must carry the member identity fields");
  const identityConsistentAcrossEvents = memberIdentityFields.every((field) => {
    const first = payloads[0]?.properties?.[field];
    return typeof first === "string" && payloads.every((payload) => payload.properties[field] === first);
  });
  assert.ok(identityConsistentAcrossEvents, "member identity changed between analytics events");
  const distinctIdEqualsUserId = payloads.every((payload) => payload.properties.distinct_id === payload.properties.$user_id);
  assert.ok(distinctIdEqualsUserId, "member distinct ID did not equal member user ID");
  const deviceIdsPresent = payloads.every((payload) => typeof payload?.properties?.$device_id === "string");
  const deviceIdsValid = payloads.every((payload) => UUID.test(payload.properties.$device_id));
  const deviceEqualsUser = payloads.some((payload) => payload.properties.$device_id === payload.properties.$user_id);
  const deviceDifferentFromUser = payloads.every((payload) => payload.properties.$device_id !== payload.properties.$user_id);
  assert.ok(deviceIdsPresent && deviceIdsValid, "every member event must carry a valid device ID");
  assert.ok(!deviceEqualsUser, "fresh member device ID must remain distinct from member user ID");

  const preNavigationEvents = payloads.filter((payload) => [
    "comparison_started", "comparison_completed", "comparison_save_status", "comparison_saved", "feedback_submitted",
  ].includes(payload?.event));
  const reportEvents = payloads.filter((payload) => ["report_generation_status", "report_download_initiated"].includes(payload?.event));
  const preNavigationDeviceStable = preNavigationEvents.every((payload) => payload.properties.$device_id === preNavigationEvents[0]?.properties?.$device_id);
  const reportDeviceStable = reportEvents.every((payload) => payload.properties.$device_id === reportEvents[0]?.properties?.$device_id);
  assert.ok(preNavigationEvents.length === 6 && preNavigationDeviceStable, "member device ID changed within the pre-navigation flow");
  assert.ok(reportEvents.length === 3 && reportDeviceStable, "member device ID changed within the report flow");
  const deviceIdentityCount = new Set(payloads.map((payload) => payload.properties.$device_id)).size;

  const insertIds = payloads.map((payload) => payload?.properties?.$insert_id);
  assert.ok(insertIds.every((value) => typeof value === "string" && UUID.test(value)), "every member event must have a UUID Mixpanel insert ID");
  assert.equal(new Set(insertIds).size, insertIds.length, "Mixpanel insert IDs must be unique per member event");

  const saveStatus = props("comparison_save_status");
  const saved = props("comparison_saved");
  const saveStages = saveStatus.map((property) => property.stage);
  assert.deepEqual(saveStages, ["attempted", "queued"], "save status stages did not match the member save contract");
  assert.equal(saved.length, 1, "member flow must have one saved event");
  assert.ok(saveStatus[0].request_id === saveStatus[1].request_id, "save status request correlation changed between stages");
  assert.ok(saved[0].request_id === saveStatus[0].request_id, "saved event request correlation did not match save status");
  assert.equal(saved[0].path, "queued", "member save should be acknowledged from the durable queued path");

  const reportStatus = props("report_generation_status");
  const reportDownload = props("report_download_initiated");
  const reportStages = reportStatus.map((property) => property.stage);
  assert.deepEqual(reportStages, ["requested", "generated"], "report generation stages did not match the member report contract");
  assert.equal(reportStatus.length, 2, "member flow must have requested and generated report events");
  assert.equal(reportDownload.length, 1, "member flow must have one report download event");
  assert.ok(reportStatus[0].request_id === reportStatus[1].request_id, "report request correlation changed between generation stages");
  assert.ok(reportDownload[0].request_id === reportStatus[0].request_id, "report download request correlation did not match generation");

  check("member event identity remained equal across the current flow", {
    eventCount: payloads.length,
    memberIdentityFieldsPresent,
    identityConsistentAcrossEvents,
    memberIdentityConsistent: identityConsistentAcrossEvents,
    distinctIdEqualsUserId,
    deviceEqualsUser,
    deviceIdsPresent,
    deviceIdsValid,
    deviceDifferentFromUser,
    preNavigationDeviceStable,
    reportDeviceStable,
    deviceIdentityCount,
  });
  check("member Mixpanel insert IDs were unique", { totalEvents: insertIds.length, uniqueInsertIds: new Set(insertIds).size });
  check("comparison draft correlation was preserved", { comparisonStartedCount: started.length, comparisonCompletedCount: completed.length, matched: true });
  check("save status and saved event shared one request correlation", { statusStages: saveStages, savedPath: saved[0].path, matched: true });
  check("report requested, generated, and downloaded events shared one request correlation", { generationStages: reportStages, matched: true });
  check("current single-member flow emitted exact event counts and stages", { eventCount: payloads.length, eventCounts, saveStages, reportStages });
}

const EXPECTED_GUEST_JOIN_EVENT_COUNTS = Object.freeze({
  comparison_started: 2,
  comparison_completed: 2,
  auth_prompt_viewed: 1,
  auth_completed: 1,
});
const EXPECTED_GUEST_JOIN_EVENT_COUNT = Object.values(EXPECTED_GUEST_JOIN_EVENT_COUNTS).reduce((total, count) => total + count, 0);

function assertGuestJoinFlowContracts() {
  assert.equal(observedMemberPayloads.length, EXPECTED_GUEST_JOIN_EVENT_COUNT, "guest join flow emitted an unexpected event count");
  const eventNames = observedMemberPayloads.map((payload) => payload?.event);
  const eventCounts = Object.fromEntries(Object.keys(EXPECTED_GUEST_JOIN_EVENT_COUNTS).map((name) => [name, eventNames.filter((event) => event === name).length]));
  assert.deepEqual(eventCounts, EXPECTED_GUEST_JOIN_EVENT_COUNTS, "guest join flow emitted an unexpected event multiset");
  assert.ok(evidence.events.every((event) => event.valid), "guest join flow emitted a payload outside the closed analytics contract");

  const props = (eventName) => observedMemberPayloads.filter((payload) => payload?.event === eventName).map((payload) => payload.properties);
  const started = props("comparison_started");
  const completed = props("comparison_completed");
  const prompt = props("auth_prompt_viewed");
  const authCompleted = props("auth_completed");
  const guestStarted = started.filter((property) => property.auth_state === "guest");
  const guestCompleted = completed.filter((property) => property.auth_state === "guest");
  const memberStarted = started.filter((property) => property.auth_state === "member");
  const memberCompleted = completed.filter((property) => property.auth_state === "member");
  assert.equal(guestStarted.length, 1, "guest join flow must include one guest comparison start");
  assert.equal(guestCompleted.length, 1, "guest join flow must include one guest comparison completion");
  assert.equal(memberStarted.length, 1, "guest join flow must include one member comparison start");
  assert.equal(memberCompleted.length, 1, "guest join flow must include one member comparison completion");
  assert.ok(guestStarted[0].draft_id === guestCompleted[0].draft_id, "guest comparison draft correlation changed at completion");
  assert.ok(memberStarted[0].draft_id === memberCompleted[0].draft_id, "member comparison draft correlation changed at completion");
  assert.ok(prompt[0].result_id === guestCompleted[0].result_id, "guest auth gate result correlation changed");
  assert.ok(prompt[0].action === "save", "guest auth gate action was invalid");
  assert.ok(authCompleted[0].action === "save" && authCompleted[0].method === "email", "guest save auth completion shape was invalid");

  const guestPayloads = observedMemberPayloads.filter((payload) => payload?.properties?.auth_state === "guest");
  const memberPayloads = observedMemberPayloads.filter((payload) => payload?.properties?.auth_state === "member");
  assert.equal(guestPayloads.length, 3, "guest join flow must include comparison start, completion, and auth gate events");
  assert.equal(memberPayloads.length, 3, "guest join flow must include auth completion and one member comparison");
  const guestDeviceId = guestPayloads[0]?.properties?.$device_id;
  const firstMember = memberPayloads.find((payload) => payload.event === "auth_completed")?.properties ?? memberPayloads[0]?.properties;
  const guestDevicePreserved = typeof guestDeviceId === "string" && firstMember?.$device_id === guestDeviceId;
  const memberUserDiffersFromGuest = typeof firstMember?.$user_id === "string" && firstMember.$user_id !== guestDeviceId;
  assert.ok(guestDevicePreserved, "guest device ID was not preserved by the first member transport");
  assert.ok(memberUserDiffersFromGuest, "member user ID did not differ from the guest device identity");

  const memberIdentityFields = ["distinct_id", "$user_id"];
  const memberIdentityConsistent = memberPayloads.every((payload) => memberIdentityFields.every((field) => payload.properties[field] === memberPayloads[0].properties[field]));
  const memberDistinctEqualsUser = memberPayloads.every((payload) => payload.properties.distinct_id === payload.properties.$user_id);
  const memberDeviceIdsPresent = memberPayloads.every((payload) => typeof payload.properties.$device_id === "string" && UUID.test(payload.properties.$device_id));
  const memberDeviceDifferentFromUser = memberPayloads.every((payload) => payload.properties.$device_id !== payload.properties.$user_id);
  const guestDeviceStable = guestPayloads.every((payload) => payload.properties.$device_id === guestDeviceId);
  const guestIdentityAnonymous = guestPayloads.every((payload) => !Object.hasOwn(payload.properties, "$user_id") && payload.properties.distinct_id === guestDeviceId);
  const memberDeviceStable = memberPayloads.every((payload) => payload.properties.$device_id === firstMember?.$device_id);
  assert.ok(memberIdentityConsistent && memberDistinctEqualsUser, "member identity changed during the guest join flow");
  assert.ok(memberDeviceIdsPresent && memberDeviceDifferentFromUser && guestDeviceStable && memberDeviceStable, "guest join device identity was invalid or unstable");
  assert.ok(guestIdentityAnonymous, "guest events unexpectedly carried a member identity");

  const insertIds = observedMemberPayloads.map((payload) => payload?.properties?.$insert_id);
  assert.ok(insertIds.every((value) => typeof value === "string" && UUID.test(value)), "every guest join event must have a UUID Mixpanel insert ID");
  assert.equal(new Set(insertIds).size, insertIds.length, "guest join Mixpanel insert IDs must be unique");
  const deviceIdentityCount = new Set(memberPayloads.map((payload) => payload.properties.$device_id)).size;
  check("consented guest activity joined the verified member identity", {
    eventCount: observedMemberPayloads.length,
    guestEventCount: guestPayloads.length,
    memberEventCount: memberPayloads.length,
    guestDevicePreserved,
    memberUserDiffersFromGuest,
    memberIdentityConsistent,
    memberDistinctEqualsUser,
    memberDeviceIdsPresent,
    memberDeviceDifferentFromUser,
    guestDeviceStable,
    guestIdentityAnonymous,
    memberDeviceStable,
    deviceIdentityCount,
  });
  check("guest gate auth flow correlated through member acceptance", { promptResultMatched: true, action: "save", method: "email" });
  check("consented guest join emitted exact event counts and identity stages", { eventCount: observedMemberPayloads.length, eventCounts, guestDevicePreserved, memberDeviceStable });
}

const nextScript = resolve(root, "node_modules/next/dist/bin/next");
let nextProcess;
let browser;
let context;
let page;
let secondTab;
let ConvexHttpClient;
let convexApi;
let cleanupClient;
let ownedComparisons = [];
let ownedCleanupCompleted = false;
const ownedResultIds = new Set();
const liveTrackRecords = new Map();
// Raw request payloads stay in this process only. Evidence receives only
// booleans, counts, enums, and property-key names below.
const observedMemberPayloads = [];
const blockedMemberPayloads = [];
const successfulMemberPayloads = [];
const heldMixpanelRoutes = [];
const heldMixpanelInsertIds = new Set();
let heldMixpanelReleased = false;
let mixpanelTransportOnline = !transportOfflineMode;
const releaseHeldMixpanelRoutes = () => {
  heldMixpanelReleased = true;
  while (heldMixpanelRoutes.length > 0) heldMixpanelRoutes.shift()();
};
const email = `truecost-member-${randomUUID()}+clerk_test@example.com`;
const accountSwitchAccounts = [];
let baselineUser = null;
let baselineConfirmed = false;
let phase = "setup";

try {
  if (!suppliedBaseUrl) await assertPortFree();
  baselineUser = await syntheticUser(email);
  assert.equal(baselineUser, null, "generated synthetic address unexpectedly exists");
  baselineConfirmed = true;
  const playwright = createRequire(import.meta.url)(playwrightModulePath);
  const browserPackage = JSON.parse(await readFile(resolve(playwrightModulePath, "package.json"), "utf8"));
  const { setupClerkTestingToken } = await import("@clerk/testing/playwright");
  process.env.CLERK_TESTING_TOKEN = await testingToken();
  ({ ConvexHttpClient } = await import("convex/browser"));
  ({ api: convexApi } = await import("../convex/_generated/api.js"));
  if (!suppliedBaseUrl) nextProcess = spawn(process.execPath, [nextScript, "start", "-H", "localhost", "-p", String(port)], { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: "ignore" });
  await waitFor(async () => { try { const response = await fetch(`${evidence.baseUrl}/signin`); return response.status >= 200 && response.status < 500; } catch { return false; } }, 60_000, "approved Next server");
  browser = await playwright.chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = { name: "Chrome", playwright: browserPackage.version, engine: browser.version() };
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(() => {
    document.addEventListener("input", (event) => {
      if (event.target instanceof HTMLInputElement) performance.mark("truecost.harness.input_dispatch");
    }, true);
    document.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (button?.textContent?.trim() === "See the full breakdown") performance.mark("truecost.harness.calculation_click");
    }, true);
  });
  context.on("request", (request) => recordPreferenceQuery(request, "started"));
  context.on("response", (response) => recordPreferenceQuery(response.request(), response.ok() ? "completed" : "rejected"));
  context.on("requestfailed", (request) => recordPreferenceQuery(request, "failed"));
  await setupClerkTestingToken({ context, options: { frontendApiUrl: expectedIssuer } });
  page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", () => pageErrors.push("uncaught browser error"));
  await context.route("https://api-js.mixpanel.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (!["/track", "/track/"].includes(url.pathname)) {
      evidence.errors.push("unexpected Mixpanel endpoint was blocked");
      await route.abort("blockedbyclient");
      return;
    }
    const payload = decodeBody(route.request().postData() || "");
    const issue = validateEvent(payload);
    const properties = payload?.properties && typeof payload.properties === "object" ? payload.properties : {};
    const holdForPendingAccountTransition = pendingTransitionMode && !heldMixpanelReleased && payload?.event === "comparison_completed";
    const insertId = typeof properties.$insert_id === "string" ? properties.$insert_id : null;
    const duplicateHeldEvent = holdForPendingAccountTransition && insertId !== null && heldMixpanelInsertIds.has(insertId);
    if (holdForPendingAccountTransition && !duplicateHeldEvent && insertId !== null) heldMixpanelInsertIds.add(insertId);
    if (duplicateHeldEvent) {
      await new Promise((resolvePromise) => heldMixpanelRoutes.push(resolvePromise));
      await route.fulfill({ status: issue ? 400 : 200, contentType: "text/plain", body: issue ? "0" : "1" });
      return;
    }
    if (transportOfflineMode && !mixpanelTransportOnline) {
      blockedMemberPayloads.push(payload);
      markEventTiming(payload);
      const blockedRecord = {
        event: typeof payload?.event === "string" ? payload.event : null,
        propertyKeys: Object.keys(properties).sort(),
        acknowledgement: "transport-blocked",
        valid: issue === null,
        identity: {
          distinctIdPresent: typeof properties.distinct_id === "string",
          userIdPresent: typeof properties.$user_id === "string",
          deviceIdPresent: typeof properties.$device_id === "string",
        },
      };
      for (const key of ["stage", "source", "path", "auth_state", "action", "method", "status"]) {
        if (issue === null && typeof properties[key] === "string") blockedRecord[key] = properties[key];
      }
      evidence.events.push(blockedRecord);
      if (issue) evidence.errors.push(issue);
      await route.abort("failed");
      return;
    }
    observedMemberPayloads.push(payload);
    markEventTiming(payload);
    const record = {
      event: typeof payload?.event === "string" ? payload.event : null,
      propertyKeys: Object.keys(properties).sort(),
      acknowledgement: mode === "intercept" ? "local-1" : "pending",
      valid: issue === null,
      identity: {
        distinctIdPresent: typeof properties.distinct_id === "string",
        userIdPresent: typeof properties.$user_id === "string",
        deviceIdPresent: typeof properties.$device_id === "string",
      },
    };
    for (const key of ["stage", "source", "path", "auth_state", "action", "method", "status"]) {
      if (issue === null && typeof properties[key] === "string") record[key] = properties[key];
    }
    evidence.events.push(record);
    if (mode === "live") liveTrackRecords.set(route.request(), record);
    if (issue) evidence.errors.push(issue);
    if (holdForPendingAccountTransition) {
      record.acknowledgement = "held-before-account-transition";
      await new Promise((resolvePromise) => heldMixpanelRoutes.push(resolvePromise));
    }
    if (mode === "intercept") await route.fulfill({ status: issue ? 400 : 200, contentType: "text/plain", body: issue ? "0" : "1" });
    else if (issue) await route.fulfill({ status: 400, contentType: "text/plain", body: "0" });
    else await route.continue();
    if (mode === "intercept" && !issue && !holdForPendingAccountTransition) successfulMemberPayloads.push(payload);
  });
  page.on("response", (response) => {
    if (mode !== "live") return;
    try {
      const url = new URL(response.url());
      if (url.hostname === "api-js.mixpanel.com" && url.pathname.startsWith("/track")) {
        const record = liveTrackRecords.get(response.request());
        if (record) {
          record.httpStatus = response.status(); void response.text().then((body) => {
            record.acknowledgement = response.status() === 200 && body.trim() === "1" ? "http-ack" : "http-rejected";
          }).catch(() => { record.acknowledgement = "response-unreadable"; });
        }
      }
    } catch { /* Keep diagnostics free of response details. */ }
  });
  page.on("requestfailed", (request) => {
    if (mode !== "live") return;
    const record = liveTrackRecords.get(request);
    if (record) record.acknowledgement = "request-failed";
  });

  if (accountSwitchMode) {
    phase = "account-switch setup";
    evidence.cleanup.analyticsResidual = "Convex profiles and analytics preferences may remain; Mixpanel requests are intercepted locally and not ingested.";
    evidence.cleanup.feedbackResidual = "No feedback is submitted in the account-switch scenario.";
    const switchEmailB = `truecost-member-${randomUUID()}+clerk_test@example.com`;
    for (const [label, accountEmail] of [["account A", email], ["account B", switchEmailB]]) {
      const baseline = await syntheticUser(accountEmail);
      assert.equal(baseline, null, `${label} generated synthetic address unexpectedly exists`);
      accountSwitchAccounts.push({ label, email: accountEmail, baselineUser: baseline, clerkUserId: null, client: null, comparisonsCleaned: false, baselineResultIds: new Set() });
    }
    const accountA = accountSwitchAccounts[0];
    const accountB = accountSwitchAccounts[1];
    phase = "account A authentication";
    await signInMemberOnPage(page, accountA.email, accountA.label);
    accountA.clerkUserId = await syntheticUser(accountA.email);
    assert.ok(accountA.clerkUserId, "account A Clerk identity was not visible after sign-in");
    accountA.client = await convexClientForPage(page, ConvexHttpClient);
    await accountA.client.mutation(convexApi.users.ensureCurrentUser, {});
    accountA.baselineResultIds = new Set((await listComparisons(accountA.client, convexApi)).map((row) => row.resultId));
    check("account A was created from a verified synthetic baseline and its cleanup client was captured");

    phase = "account A analytics consent";
    // Start from a direct account load so the consent baseline is stable. The
    // pending-transition assertion begins after the member comparison, where
    // the account remains mounted through client-side navigation and sign-out.
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    markTiming("account_a_accept_click");
    await page.getByRole("button", { name: "Accept analytics", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Analytics is on." }).waitFor({ timeout: 20_000 });
    markTiming("account_a_analytics_on_observed");
    check("account A explicitly accepted analytics");
    phase = "account A comparison";
    const accountAEventStart = observedMemberPayloads.length;
    assert.equal(accountAEventStart, 0, "unexpected analytics before account A comparison");
    if (hardNavigation) {
      markTiming("account_a_hard_navigation_start", { settleMs: navigationSettleMs });
      await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
      markTiming("account_a_domcontentloaded");
      await page.waitForTimeout(navigationSettleMs);
      markTiming("account_a_settle_complete", { settleMs: navigationSettleMs });
    } else {
    await page.getByRole("link", { name: "Back", exact: true }).click();
    await page.waitForURL(/\/home(?:\?|$)/, { timeout: 20_000 });
    await page.getByRole("link", { name: /Compare Loan Offers/ }).click();
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    }
    await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 20_000 });
    await collectProviderMarks("account_a_before_inputs");
    if (deviceOfflineMode) {
      await context.setOffline(true);
      await page.waitForFunction(() => navigator.onLine === false, undefined, { timeout: 10_000 });
      markTiming("device_offline_enabled");
    }
    await fillOffers(page, "Account A");
    markTiming("account_a_inputs_filled");
    await markBrowserTiming("account_a_inputs_filled");
    markTiming("account_a_click_attempt");
    if (deviceOfflineMode) {
      assert.equal(observedMemberPayloads.length, accountAEventStart, "account A delivered analytics while the browser was offline");
      check("account A input remained usable while the browser was offline", { eventsWhileOffline: 0 });
      await context.setOffline(false);
      await page.waitForFunction(() => navigator.onLine === true, undefined, { timeout: 10_000 });
      markTiming("device_offline_disabled");
      await waitFor(() => observedMemberPayloads.length >= accountAEventStart + 1, 20_000, "account A start event after reconnect");
      await waitMixpanelAcks();
      check("account A analytics queue delivered once after device reconnect", { eventCount: observedMemberPayloads.length - accountAEventStart });
    }
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    markTiming("account_a_calculation_click");
    await collectProviderMarks("account_a_after_calculation_click");
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
    if (transportOfflineMode) {
      await waitFor(() => blockedMemberPayloads.length >= 1, 20_000, "account A blocked analytics event");
    } else {
      await waitFor(() => observedMemberPayloads.length >= accountAEventStart + 2, 20_000, "account A comparison events");
    }
    if (!pendingTransitionMode && !transportOfflineMode) await waitMixpanelAcks();
    const accountAEvents = transportOfflineMode ? blockedMemberPayloads.slice(0, 1) : observedMemberPayloads.slice(accountAEventStart);
    if (transportOfflineMode) {
      assert.equal(accountAEvents[0]?.event, "comparison_started", "account A did not reach the blocked analytics transport");
      assert.ok(blockedMemberPayloads.every((payload) => payload?.event === "comparison_started"), "account A advanced past the blocked queue head while offline");
      assert.equal(new Set(blockedMemberPayloads.map((payload) => payload?.properties?.$insert_id)).size, 1, "account A changed its blocked insert ID during retries");
    } else {
      assertAccountSwitchEventPair(accountAEvents, "account A");
    }
    assert.ok(accountAEvents.every((payload) => payload?.properties?.auth_state === "member" && payload?.properties?.environment === "development"), "account A emitted an invalid event label");
    if (transportOfflineMode) {
      const accountARecords = evidence.events.slice(accountAEventStart);
      assert.ok(accountARecords.some((event) => event.event === "comparison_started" && event.valid && event.acknowledgement === "transport-blocked"), "account A start was not blocked by the analytics transport outage");
      assert.equal(accountARecords.some((event) => event.event === "comparison_completed"), false, "account A completion bypassed the blocked analytics queue head");
    } else if (pendingTransitionMode) {
      const accountARecords = evidence.events.slice(accountAEventStart);
      assert.ok(accountARecords.some((event) => event.event === "comparison_completed" && event.valid && event.acknowledgement === "held-before-account-transition"), "account A completion was not held at the analytics transport");
      assert.ok(accountARecords.some((event) => event.event === "comparison_started" && event.valid && event.acknowledgement === "local-1"), "account A start was not acknowledged before the pending completion");
    } else {
      assert.ok(evidence.events.slice(accountAEventStart).every((event) => event.valid && event.acknowledgement === "local-1"), "account A did not receive local Mixpanel acknowledgements");
    }
    const accountAUserIds = new Set(accountAEvents.map((payload) => payload.properties.$user_id));
    const accountADeviceIds = new Set(accountAEvents.map((payload) => payload.properties.$device_id));
    const accountAInsertIds = new Set(accountAEvents.map((payload) => payload.properties.$insert_id));
    assert.equal(accountAUserIds.size, 1, "account A changed its user identity within the flow");
    assert.equal(accountADeviceIds.size, 1, "account A changed its device identity within the flow");
    check(transportOfflineMode ? "account A comparison stayed queued behind the blocked analytics transport" : "account A emitted acknowledged member comparison events", { eventCount: accountAEvents.length, blockedAttempts: transportOfflineMode ? blockedMemberPayloads.length : 0, userIdentityStable: true, deviceIdentityStable: true });

    phase = "account A comparison cleanup";
    const accountACleanup = await cleanupSwitchComparisons(accountA);
    accountA.comparisonsCleaned = true;
    const deliveredBeforeAccountTransition = successfulMemberPayloads.length;
    phase = "account A confirmed sign out";
    if (pendingTransitionMode) {
      if (secondTabTransition) {
        secondTab = await context.newPage();
        secondTab.on("pageerror", () => evidence.errors.push("uncaught browser error in second tab"));
        await secondTab.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
        await secondTab.getByRole("button", { name: "Sign out", exact: true }).waitFor({ timeout: 20_000 });
        check("second tab observed account A before the auth transition");
        await secondTab.getByRole("button", { name: "Sign out", exact: true }).click();
        await secondTab.getByRole("region", { name: "Confirm sign out", exact: true }).waitFor();
        await secondTab.getByRole("button", { name: "Confirm sign out", exact: true }).click();
        await secondTab.waitForURL(/\/(?:$|home|signin)(?:\?|$)/, { timeout: 20_000 });
        await page.waitForURL(/\/(?:$|home|signin)(?:\?|$)/, { timeout: 20_000 });
        await page.waitForTimeout(1_000);
        await waitClerk(page);
        check("second-tab sign out propagated to the mounted account A tab");
      } else {
        await page.getByRole("link", { name: /Edit offers/ }).click();
        await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
        await page.getByRole("link", { name: "← Back", exact: true }).click();
        await page.waitForURL(/\/home(?:\?|$)/, { timeout: 20_000 });
        await page.getByRole("link", { name: "Account", exact: true }).click();
        await page.waitForURL(/\/account(?:\?|$)/, { timeout: 20_000 });
      }
    } else {
      await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    }
    const beforeAccountASignout = observedMemberPayloads.length;
    const accountASignedOutInSecondTab = secondTabTransition;
    if (!accountASignedOutInSecondTab) {
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.getByRole("region", { name: "Confirm sign out", exact: true }).waitFor();
      await page.getByRole("button", { name: "Confirm sign out", exact: true }).click();
      await page.waitForURL(/\/(?:$|home|signin)(?:\?|$)/, { timeout: 20_000 });
      if (transportOfflineMode) {
        await page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded && !globalThis.Clerk?.session), undefined, { timeout: 20_000 });
        await page.waitForTimeout(1_000);
      }
    }
    if (pendingTransitionMode) {
      releaseHeldMixpanelRoutes();
      assert.equal(successfulMemberPayloads.length, deliveredBeforeAccountTransition, "account A completion was delivered before the account transition");
      check("account A completion stayed held until confirmed sign out while the app remained mounted", { heldEvents: 1, deliveredBeforeTransition: deliveredBeforeAccountTransition });
    }
    await page.waitForTimeout(1_000);
    assert.equal(observedMemberPayloads.length, beforeAccountASignout, "analytics sent during or after account A sign out");
    check("confirmed account A sign out emitted no analytics", { secondTab: accountASignedOutInSecondTab });

    phase = "account B authentication";
    await signInMemberOnPage(page, accountB.email, accountB.label);
    accountB.clerkUserId = await syntheticUser(accountB.email);
    assert.ok(accountB.clerkUserId, "account B Clerk identity was not visible after sign-in");
    accountB.client = await convexClientForPage(page, ConvexHttpClient);
    await accountB.client.mutation(convexApi.users.ensureCurrentUser, {});
    accountB.baselineResultIds = new Set((await listComparisons(accountB.client, convexApi)).map((row) => row.resultId));
    const accountBUnknownPreference = await accountB.client.query(convexApi.analytics.getPreference, {});
    assert.equal(accountBUnknownPreference.consent, "unknown", "account B did not begin with unknown analytics consent");
    assert.equal(accountBUnknownPreference.analyticsAccountId, null, "account B unknown preference exposed an analytics ID");
    assert.equal(accountBUnknownPreference.sendPermission, false, "account B unknown preference granted send permission");
    check("account B reached the same browser with a fresh verified identity and cleanup client");

    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    if (secondTabTransition) {
      await page.waitForTimeout(1_000);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await page.getByRole("button", { name: "Accept analytics", exact: true }).waitFor({ timeout: 20_000 });
    check("account B began with unknown analytics consent after account A sign out");
    phase = "account B unknown comparison";
    const beforeBUnknown = observedMemberPayloads.length;
    await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 20_000 });
    await fillOffers(page, "Account B unknown");
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
    await page.waitForTimeout(1_000);
    assert.equal(observedMemberPayloads.length, beforeBUnknown, "account B emitted analytics before opting in");
    check("account B unknown preference kept the comparison usable and analytics-silent", { eventsBeforeOptIn: 0 });

    phase = "account B analytics consent";
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    if (secondTabTransition) {
      await page.waitForTimeout(1_000);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    markTiming("account_b_accept_click");
    await page.getByRole("button", { name: "Accept analytics", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Analytics is on." }).waitFor({ timeout: 20_000 });
    if (transportOfflineMode) mixpanelTransportOnline = true;
    markTiming("account_b_analytics_on_observed");
    check("account B explicitly opted in after the unknown comparison");
    phase = "account B accepted comparison";
    const accountBEventStart = observedMemberPayloads.length;
    if (transportOfflineMode) {
      assert.equal(accountBEventStart, 0, "an analytics request from account A was delivered after its transport outage and sign-out");
    }
    if (hardNavigation) {
      markTiming("account_b_hard_navigation_start", { settleMs: navigationSettleMs });
      await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
      markTiming("account_b_domcontentloaded");
      await page.waitForTimeout(navigationSettleMs);
      markTiming("account_b_settle_complete", { settleMs: navigationSettleMs });
    } else {
    await page.getByRole("link", { name: "Back", exact: true }).click();
    await page.waitForURL(/\/home(?:\?|$)/, { timeout: 20_000 });
    await page.getByRole("link", { name: /Compare Loan Offers/ }).click();
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Loan amount for offer 1"]')?.value === "", undefined, { timeout: 15_000 });
    await collectProviderMarks("account_b_before_inputs");
    await fillOffers(page, "Account B accepted");
    markTiming("account_b_inputs_filled");
    await markBrowserTiming("account_b_inputs_filled");
    markTiming("account_b_click_attempt");
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    markTiming("account_b_calculation_click");
    await collectProviderMarks("account_b_after_calculation_click");
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
    await waitFor(() => observedMemberPayloads.length >= accountBEventStart + 2, 20_000, "account B comparison events after opt-in");
    await waitMixpanelAcks();
    const accountBEvents = observedMemberPayloads.slice(accountBEventStart);
    assertAccountSwitchEventPair(accountBEvents, "account B");
    assert.ok(accountBEvents.every((payload) => payload?.properties?.auth_state === "member" && payload?.properties?.environment === "development"), "account B emitted an invalid event label");
    if (!transportOfflineMode) assert.ok(evidence.events.slice(accountBEventStart).every((event) => event.valid && event.acknowledgement === "local-1"), "account B did not receive local Mixpanel acknowledgements");
    const accountBUserIds = new Set(accountBEvents.map((payload) => payload.properties.$user_id));
    const accountBDeviceIds = new Set(accountBEvents.map((payload) => payload.properties.$device_id));
    const accountBInsertIds = new Set(accountBEvents.map((payload) => payload.properties.$insert_id));
    assert.equal(accountBUserIds.size, 1, "account B changed its user identity within the flow");
    assert.equal(accountBDeviceIds.size, 1, "account B changed its device identity within the flow");
    assert.equal(accountAUserIds.size, 1);
    assert.notEqual([...accountAUserIds][0], [...accountBUserIds][0], "account B reused account A's user identity");
    assert.notEqual([...accountADeviceIds][0], [...accountBDeviceIds][0], "account B reused account A's device identity");
    assert.equal([...accountAInsertIds].some((insertId) => accountBInsertIds.has(insertId)), false, "account B replayed account A's Mixpanel insert ID");
    if (pendingTransitionMode) {
      const postTransitionSuccessfulPayloads = successfulMemberPayloads.slice(deliveredBeforeAccountTransition);
      assert.equal(postTransitionSuccessfulPayloads.length, accountBEvents.length, "only account B events were delivered after the transition");
      assert.equal(postTransitionSuccessfulPayloads.some((payload) => accountAInsertIds.has(payload?.properties?.$insert_id)), false, "a held account A event was delivered after the transition");
    }
    check("same-browser account switch isolated B identities and emitted no A replay", {
      accountAEvents: accountAEvents.length,
      accountBEvents: accountBEvents.length,
      distinctUserIds: true,
      distinctDeviceIds: true,
      disjointInsertIds: true,
      pendingAccountAEventsCleared: pendingTransitionMode,
    });

    phase = "account B comparison cleanup";
    const accountBCleanup = await cleanupSwitchComparisons(accountB);
    accountB.comparisonsCleaned = true;
    evidence.cleanup.status = "account A and B owned comparisons deleted";
    evidence.cleanup.analyticsResidual = "Convex profiles and analytics preferences remain; Mixpanel events were intercepted locally and not ingested.";
    evidence.cleanup.accounts = [
      { label: accountA.label, comparisonsDeleted: accountACleanup.deleted, remaining: accountACleanup.remaining },
      { label: accountB.label, comparisonsDeleted: accountBCleanup.deleted, remaining: accountBCleanup.remaining },
    ];
    check("run-owned comparison records were deleted before account B sign out", { accountA: accountACleanup.deleted, accountB: accountBCleanup.deleted });
    phase = "account B confirmed sign out";
    const beforeAccountBSignout = observedMemberPayloads.length;
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("region", { name: "Confirm sign out", exact: true }).waitFor();
    await page.getByRole("button", { name: "Confirm sign out", exact: true }).click();
    await page.waitForURL(/\/(?:$|home|signin)(?:\?|$)/, { timeout: 20_000 });
    await page.waitForTimeout(1_000);
    assert.equal(observedMemberPayloads.length, beforeAccountBSignout, "analytics sent during or after account B sign out");
    const expectedDeliveredEvents = transportOfflineMode ? 2 : 4;
    assert.equal(observedMemberPayloads.length, accountAEventStart + expectedDeliveredEvents, "account switch emitted an unexpected total event count");
    check("account B confirmed sign out emitted no analytics and total event count stayed isolated", { totalEvents: observedMemberPayloads.length, blockedAccountAEvents: blockedMemberPayloads.length, transportOffline: transportOfflineMode });
    ownedCleanupCompleted = true;
  } else {
  phase = "guest comparison";
  await page.goto(`${evidence.baseUrl}/signin`, { waitUntil: "domcontentloaded" });
  await waitClerk(page);
  await page.getByRole("link", { name: /carry on as a guest/i }).click();
  await page.waitForURL(/\/home(?:\?|$)/, { timeout: 15_000 });
  await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 30_000 });
  if (guestJoinMode) {
    phase = "consented guest analytics";
    await page.getByRole("button", { name: "Accept analytics", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Analytics is on." }).waitFor({ timeout: 20_000 });
    check("guest analytics was explicitly accepted before comparison");
  }
  await fillOffers(page, "Member harness guest");
  await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
  await page.getByText("Member harness guest A", { exact: false }).first().waitFor();
  if (guestJoinMode) {
    await waitEvent("comparison_started");
    await waitEvent("comparison_completed");
    check("consented guest comparison emitted the expected start and completion events", { guestEventsBeforeGate: 2 });
  } else {
    assert.equal(evidence.events.length, 0, "guest comparison emitted analytics before member consent");
    check("guest comparison completed before authentication and consent", { memberEventsBeforeConsent: 0 });
  }
  phase = "synthetic member authentication";
  await page.getByRole("button", { name: "Sign in to save comparison", exact: true }).click();
  await page.waitForURL(/\/signin\?/, { timeout: 15_000 });
  const next = new URL(page.url()).searchParams.get("next") || "/compare/results";
  await page.locator("#signin-email").fill(email);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 20_000 });
  await page.locator("#signin-code").fill("424242");
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 30_000 });
  if (guestJoinMode) {
    await page.getByRole("status").filter({ hasText: "Saved to your account." }).waitFor({ timeout: 30_000 });
    cleanupClient = await convexClientForPage(page, ConvexHttpClient);
    ownedComparisons = await listComparisons(cleanupClient, convexApi);
    ownedComparisons.forEach((row) => ownedResultIds.add(row.resultId));
    phase = "member analytics consent after guest join";
    // Keep this as in-app navigation so the same auth completion epoch and
    // guest-join marker reach the member provider activation.
    phase = "navigate from guest result to compare";
    await page.getByRole("link", { name: /Edit offers/ }).click();
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    phase = "navigate from compare to home";
    await page.getByRole("link", { name: "← Back", exact: true }).click();
    await page.waitForURL(/\/home(?:\?|$)/, { timeout: 20_000 });
    phase = "navigate from home to account";
    await page.getByRole("link", { name: "Account", exact: true }).click();
    await page.waitForURL(/\/account(?:\?|$)/, { timeout: 20_000 });
    await page.getByRole("button", { name: "Accept analytics", exact: true }).waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Accept analytics", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Analytics is on." }).waitFor({ timeout: 20_000 });
    check("member analytics was explicitly accepted via in-app navigation");
    await page.getByRole("link", { name: "Back", exact: true }).click();
    await page.waitForURL(/\/home(?:\?|$)/, { timeout: 20_000 });
    await page.getByRole("link", { name: /Compare Loan Offers/ }).click();
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Loan amount for offer 1"]')?.value === "", undefined, { timeout: 15_000 });
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 20_000 });
    await fillOffers(page, "Member harness joined");
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
  } else {
    await page.getByRole("status").filter({ hasText: "Saved to your account." }).waitFor({ timeout: 30_000 });
  }
  cleanupClient = await convexClientForPage(page, ConvexHttpClient);
  ownedComparisons = await listComparisons(cleanupClient, convexApi);
  ownedComparisons.forEach((row) => ownedResultIds.add(row.resultId));
  if (guestJoinMode) {
    assert.ok(ownedComparisons.length >= 1, "guest join did not preserve an owned comparison");
    check("synthetic Clerk OTP restored the consented guest result", { savedRows: ownedComparisons.length });
  } else {
    assert.ok(ownedComparisons.length >= 1, "member save did not create an owned comparison");
    check("synthetic Clerk OTP restored the guest result and member save", { savedRows: ownedComparisons.length });
  }

  if (!guestJoinMode) {
    phase = "member analytics consent";
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Account", exact: true }).waitFor();
    await page.getByRole("button", { name: "Accept analytics", exact: true }).waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Accept analytics", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Analytics is on." }).waitFor({ timeout: 20_000 });
    check("member analytics was explicitly accepted after authentication");

    phase = "member save";
    await page.getByRole("link", { name: "Back", exact: true }).click(); await page.waitForURL(/\/home(?:\?|$)/); await page.getByRole("link", { name: /Compare Loan Offers/ }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await page.waitForFunction(() => document.querySelector('input[aria-label="Loan amount for offer 1"]')?.value === "", undefined, { timeout: 15000 });
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector('input[aria-label="Loan amount for offer 1"]')?.value === "", undefined, { timeout: 15000 }); phase = "member fill offers"; await fillOffers(page, "Member harness saved"); phase = "member calculate";
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
    phase = "member click save"; await page.getByRole("button", { name: "Save comparison", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Saved to your account." }).waitFor({ timeout: 30_000 });
    ownedComparisons = await listComparisons(cleanupClient, convexApi);
    ownedComparisons.forEach((row) => ownedResultIds.add(row.resultId));
    await waitEvent("comparison_started");
    await waitEvent("comparison_completed");
    await waitEvent("comparison_saved");
    await waitFor(async () => (await page.getByRole("region", { name: "Feedback", exact: true }).count()) === 1, 30_000, "feedback prompt");
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await waitFor(async () => (await page.getByRole("region", { name: "Feedback", exact: true }).count()) === 0, 30_000, "feedback acknowledgement");
    await waitEvent("feedback_submitted");
    await waitMixpanelAcks(); phase = "saved history and PDF";
    await page.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /Member harness saved A/ }).first().click();
    await page.waitForURL(/\/comparisons\/[^/]+$/, { timeout: 20_000 });
    await page.getByText("Recorded comparison", { exact: false }).first().waitFor();
    const { checkReportDownload } = await import("./check-report-download.mjs");
    const selectedId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()); const selectedRow = ownedComparisons.find((row) => row._id === selectedId); assert.ok(selectedRow, "history did not open a run-owned comparison"); const savedSnapshot = JSON.parse(selectedRow.snapshot);
    const pdfScenario = `member-analytics-${evidence.checkedAt.replace(/[:.]/g, "-")}`;
    await checkReportDownload({ page, snapshot: savedSnapshot, evidenceDir, check, scenario: pdfScenario });
    await waitEvent("report_generation_status");
    await waitEvent("report_download_initiated");
    check("member save, saved history, PDF generation/download, and acknowledged feedback completed", {
      eventNames: evidence.events.map((event) => event.event),
      pdf: "%PDF-",
    });
    check("saved comparison history opened the synthetic member record");
    await waitMixpanelAcks();
    assertFreshMemberFlowContracts();
  } else {
    phase = "guest join analytics assertions";
    await waitFor(() => observedMemberPayloads.some((payload) => payload?.event === "auth_completed" && payload.properties?.auth_state === "member"), 30_000, "member auth completion event");
    await waitFor(() => observedMemberPayloads.some((payload) => payload?.event === "comparison_started" && payload.properties?.auth_state === "member"), 30_000, "member comparison start event");
    await waitFor(() => observedMemberPayloads.some((payload) => payload?.event === "comparison_completed" && payload.properties?.auth_state === "member"), 30_000, "member comparison completion event");
    await waitMixpanelAcks();
    assertGuestJoinFlowContracts();
  }

  }
  if (!accountSwitchMode) {
  // Delete only rows observed after the run's verified empty baseline. Keep
  // this while the authenticated Convex token is valid; sign-out invalidates
  // it and cannot be used for cleanup or retry.
  const ownedBeforeWithdrawal = await listComparisons(cleanupClient, convexApi);
  const runOwnedRows = ownedBeforeWithdrawal.filter((row) => ownedResultIds.has(row.resultId));
  for (const row of runOwnedRows) await deleteComparison(cleanupClient, convexApi, row);
  const remainingOwnedRows = (await listComparisons(cleanupClient, convexApi)).filter((row) => ownedResultIds.has(row.resultId));
  assert.equal(remainingOwnedRows.length, 0, "a run-owned comparison remained after authenticated cleanup");
  ownedCleanupCompleted = true;
  evidence.cleanup.status = "owned comparisons deleted";
  evidence.cleanup.feedbackResidual = "feedback rows may remain; no feedback deletion mutation is exposed by this harness";
  check("run-owned Convex comparisons were deleted before sign out", { deleted: runOwnedRows.length });

  if (!logoutWithoutWithdrawal) {
    phase = "analytics withdrawal";
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    phase = "withdraw consent"; await page.getByRole("button", { name: "Turn off analytics", exact: true }).click();
    await page.getByRole("button", { name: "Accept analytics", exact: true }).waitFor({ timeout: 20_000 });
    const afterWithdrawal = evidence.events.length;
    await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Reset", exact: true }).click(); await page.waitForFunction(() => document.querySelector('input[aria-label="Loan amount for offer 1"]')?.value === "", undefined, { timeout: 15000 });
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 20_000 });
    phase = "calculate after withdrawal"; await fillOffers(page, "After withdrawal");
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
    await page.waitForTimeout(1_000);
    assert.equal(evidence.events.length, afterWithdrawal, "analytics sent after withdrawal");
    check("no Mixpanel event was sent after explicit analytics withdrawal");
  }

  phase = "confirmed sign out";
  await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
  if (logoutWithoutWithdrawal) {
    await page.getByRole("button", { name: "Turn off analytics", exact: true }).waitFor({ timeout: 20_000 });
    check("member analytics remained accepted immediately before ordinary sign out");
  }
  const beforeSignout = evidence.events.length;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("region", { name: "Confirm sign out", exact: true }).waitFor();
  await page.getByRole("button", { name: "Confirm sign out", exact: true }).click();
  await page.waitForURL(/\/(?:$|home|signin)(?:\?|$)/, { timeout: 20_000 });
  const afterSignout = evidence.events.length;
  assert.equal(afterSignout, beforeSignout, "analytics sent during confirmed sign out");
  await page.waitForTimeout(1_000);
  assert.equal(evidence.events.length, afterSignout, "analytics sent after sign out");
  check("no Mixpanel event was sent after confirmed sign out");
  if (guestJoinMode) {
    const guestReentryBaseline = afterSignout;
    phase = "guest re-entry after sign out";
    await page.goto(`${evidence.baseUrl}/`, { waitUntil: "domcontentloaded" });
    await waitClerk(page);
    await page.getByRole("button", { name: "Compare two loans", exact: true }).click();
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    phase = "guest hard reload after sign out";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 20_000 });
    phase = "guest result reopening after sign out and reload";
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
    phase = "guest gated recalculation after sign out and reload";
    await page.getByRole("link", { name: /Edit offers/ }).click();
    await page.waitForURL(/\/compare(?:\?|$)/, { timeout: 20_000 });
    await page.getByLabel("Lender name for offer 1", { exact: true }).fill("Guest after sign out");
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    await page.waitForURL(/\/signin\?/, { timeout: 20_000 });
    await page.waitForTimeout(1_000);
    assert.equal(evidence.events.length, guestReentryBaseline, "guest activity after sign out and reload sent analytics without re-consent");
    check("guest result reopened and gated recalculation stayed analytics-silent after hard reload", { resultsReopened: true, recalculationGated: true, reconsentAttempted: false, newEventsWithoutReconsent: 0 });
  }
  }
  assert.deepEqual(pageErrors, [], "synthetic member flow had an uncaught browser error");
  assert.ok(evidence.events.every((event) => event.valid), "one or more intercepted member events failed the closed contract");
  await waitMixpanelAcks();
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(`${phase}: ${safeError(error)}`);
  if (page && evidence.timing) await collectProviderMarks("failure_after_error").catch(() => {});
  if (page) { evidence.diagnostics = { feedbackRegions: await page.getByRole("region", { name: "Feedback", exact: true }).count().catch(() => -1), feedbackHeadings: await page.getByText("Was this useful?", { exact: true }).count().catch(() => -1), alertCount: await page.getByRole("alert").count().catch(() => -1) }; }
  if (accountSwitchMode && page) {
    try {
      const text = await page.locator("body").innerText();
      evidence.diagnostics.consent = {
        pathname: new URL(page.url()).pathname,
        on: text.includes("Analytics is on."),
        off: text.includes("Analytics is off"),
        preferenceReadFailed: text.includes("Analytics preference could not be checked."),
        memberCleanupFailed: text.includes("Member analytics context could not be fully cleared"),
        logoutResetFailed: text.includes("could not save the sign-out reset"),
        acceptButton: await page.getByRole("button", { name: "Accept analytics", exact: true }).count(),
      };
    } catch { evidence.diagnostics.consent = { inspectionFailed: true }; }
  }
  process.exitCode = 1;
} finally {
  releaseHeldMixpanelRoutes();
  try {
    if (ownedCleanupCompleted) {
      // The authenticated cleanup already completed before sign-out. The
      // Convex token is intentionally no longer used after that boundary.
    } else if (cleanupClient && convexApi) {
      const rows = await listComparisons(cleanupClient, convexApi);
      for (const row of rows) if (ownedResultIds.has(row.resultId)) await deleteComparison(cleanupClient, convexApi, row);
      ownedCleanupCompleted = true;
      evidence.cleanup.status = "owned comparisons deleted";
      evidence.cleanup.feedbackResidual = "feedback rows may remain; no feedback deletion mutation is exposed by this harness";
    } else evidence.cleanup.status = "no authenticated Convex cleanup client was available";
  } catch (error) {
    evidence.cleanup.status = "failed";
    evidence.errors.push(`owned comparison cleanup failed: ${safeError(error)}`);
  }
  try {
    if (accountSwitchMode) {
      const identityCleanup = [];
      for (const account of accountSwitchAccounts) {
        try {
          if (!account.comparisonsCleaned && account.client) {
            const cleanup = await cleanupSwitchComparisons(account);
            account.comparisonsCleaned = true;
            evidence.cleanup.accounts = [...(evidence.cleanup.accounts || []), { label: account.label, comparisonsDeleted: cleanup.deleted, remaining: cleanup.remaining }];
          }
        } catch (error) {
          evidence.cleanupErrors.push(`${account.label} comparison cleanup failed: ${safeError(error)}`);
        }
        try {
          const userId = account.baselineUser === null ? await syntheticUser(account.email) : null;
          let revoked = 0;
          if (userId && account.baselineUser === null) {
            const sessions = rowsFrom(await clerkRequest(`/sessions?user_id=${encodeURIComponent(userId)}&limit=100`));
            for (const session of sessions) {
              if (session?.status === "active" && typeof session.id === "string") {
                await clerkRequest(`/sessions/${encodeURIComponent(session.id)}/revoke`, { method: "POST" });
                revoked += 1;
              }
            }
            await clerkRequest(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
          }
          identityCleanup.push({ label: account.label, revoked, deleted: Boolean(userId) });
        } catch (error) {
          evidence.cleanupErrors.push(`${account.label} identity cleanup failed: ${safeError(error)}`);
          evidence.preservedIdentities.push({ account: account.label, reason: "cleanup failed; synthetic identity retained" });
        }
      }
      evidence.cleanup.clerkUsers = identityCleanup;
      if (evidence.cleanupErrors.length === 0) evidence.cleanup.status = "run-owned comparisons checked; disposable Clerk cleanup completed";
    } else {
      const userId = await syntheticUser(email);
      if (userId && baselineConfirmed && baselineUser === null) {
        const sessions = rowsFrom(await clerkRequest(`/sessions?user_id=${encodeURIComponent(userId)}&limit=100`));
        for (const session of sessions) {
          if (session?.status === "active" && typeof session.id === "string") {
            await clerkRequest(`/sessions/${encodeURIComponent(session.id)}/revoke`, { method: "POST" });
          }
        }
        await clerkRequest(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
      }
      if (baselineConfirmed && baselineUser === null) {
        evidence.cleanup.clerkUser = userId ? "new synthetic user and sessions deleted" : "no synthetic user remained";
      } else {
        evidence.cleanup.clerkUser = "synthetic user cleanup not authorized because the empty baseline was not confirmed";
      }
    }
  } catch (error) {
    evidence.cleanup.clerkUser = "cleanup failed";
    evidence.errors.push(`synthetic Clerk cleanup failed: ${safeError(error)}`);
  }
  await page?.close().catch(() => {});
  await secondTab?.close().catch(() => {});
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
    if (nextProcess && nextProcess.exitCode === null) {
    nextProcess.kill("SIGTERM");
    await new Promise((resolvePromise) => { const timer = setTimeout(resolvePromise, 3_000); nextProcess.once("exit", () => { clearTimeout(timer); resolvePromise(); }); });
  }
  if (evidence.errors.length > 0 || evidence.cleanupErrors.length > 0 || evidence.preservedIdentities.length > 0) {
    evidence.status = "failed";
    process.exitCode = 1;
  }
  if (mode === "live" && evidence.events.some((event) => event.acknowledgement !== "http-ack")) {
    evidence.status = "failed";
    process.exitCode = 1;
    evidence.errors.push("one or more Mixpanel track requests lacked an HTTP 200 body of 1");
  }
  await mkdir(evidenceDir, { recursive: true });
  const evidenceStamp = evidence.checkedAt.replace(/[:.]/g, "-");
  const output = resolve(evidenceDir, `member-analytics-browser-${evidenceStamp}.json`);
  await writeFile(output, `${JSON.stringify({ ...evidence, output }, null, 2)}\n`);
  console.log(JSON.stringify({ status: evidence.status, mode, baseUrl: evidence.baseUrl, buildId: actualBuildId, eventNames: evidence.events.map((event) => event.event), checks: evidence.checks.length, cleanup: evidence.cleanup, output }, null, 2));
}
