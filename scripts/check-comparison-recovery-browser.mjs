import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });
const require = createRequire(import.meta.url);
const playwrightModulePath = process.env.TRUECOST_PLAYWRIGHT_MODULE ||
  "C:/Users/RajeshShinde/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(playwrightModulePath);
const playwrightPackage = JSON.parse(await readFile(resolve(playwrightModulePath, "package.json"), "utf8"));
const scrub = (value) => String(value)
  .replace(/__clerk_testing_token=[^&\s]+/gi, "__clerk_testing_token=[redacted]")
  .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted-key]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-email]");
const evidence = {
  checkedAt: new Date().toISOString(),
  buildId: null,
  sourceRevision: "unknown",
  browser: null,
  baseUrl: null,
  checks: [],
  errors: [],
  diagnostics: [],
  cleanupErrors: [],
  preservedIdentity: null,
  ownedRecords: [],
  faultInjection: {
    type: "Playwright route interception of saveComparison only",
    attempts: 8,
    response: "synthetic rate_limited result with retryAfterMs=0",
    purpose: "Exercise bounded local retry exhaustion without changing provider data",
  },
  status: "pending",
};
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sha256File = async (path) => sha256(await readFile(path));
const localEnv = await readFile(resolve(root, ".env.local"), "utf8").catch(() => "");
const envValue = (name) => localEnv.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim() || "";
const publishableKey = envValue("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
const secretKey = envValue("CLERK_SECRET_KEY");
const convexUrl = envValue("NEXT_PUBLIC_CONVEX_URL");
const expectedIssuer = "live-tarpon-2666.clerk.accounts.dev";
const expectedConvexUrl = "https://dutiful-fly-37.convex.cloud";
const expectedBuildId = process.env.TRUECOST_RECOVERY_EXPECTED_BUILD_ID?.trim() || "PcMbNRf0rAUZoMCH2rUlV";
const buildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim();
evidence.buildId = buildId;
assert.equal(buildId, expectedBuildId, "built artifact is not the approved recovery target");
assert.match(publishableKey, /^pk_test_[A-Za-z0-9_-]+$/);
assert.match(secretKey, /^sk_test_[A-Za-z0-9_-]{16,256}$/);
assert.equal(convexUrl, expectedConvexUrl);
const decodeIssuer = (key) => {
  const encoded = key.replace(/^pk_test_/, "");
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - encoded.length % 4) % 4);
  const decoded = atob(padded);
  return decoded.endsWith("$") ? decoded.slice(0, -1) : null;
};
assert.equal(decodeIssuer(publishableKey), expectedIssuer);
check("approved development Clerk and Convex target match the recovery build", { issuer: expectedIssuer, convexTarget: expectedConvexUrl, buildId });
try { evidence.sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { evidence.sourceRevision = "unavailable"; }

const clerkApi = async (path, options = {}) => {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json", ...options.headers },
  });
  if (!response.ok) throw new Error(`Clerk API request returned HTTP ${response.status}`);
  return response.json().catch(() => null);
};
const rows = (value, name) => {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  throw new Error(`Clerk ${name} response shape was invalid`);
};
const sessionIdsFor = async (email) => {
  const users = rows(await clerkApi(`/users?email_address=${encodeURIComponent(email)}&limit=10`), "users");
  const matches = users.filter((user) => user?.email_addresses?.some((address) => address?.email_address === email));
  if (matches.length > 1) throw new Error("Clerk returned multiple exact synthetic email matches");
  const userId = typeof matches[0]?.id === "string" ? matches[0].id : null;
  if (!userId) return { userId: null, ids: new Set() };
  const sessions = rows(await clerkApi(`/sessions?user_id=${encodeURIComponent(userId)}&limit=100`), "sessions");
  return { userId, ids: new Set(sessions.filter((session) => session?.status === "active" && typeof session.id === "string").map((session) => session.id)) };
};
const revokeNewSessions = async (email, baseline) => {
  const current = await sessionIdsFor(email);
  const fresh = [...current.ids].filter((id) => !baseline.ids.has(id));
  for (const id of fresh) await clerkApi(`/sessions/${encodeURIComponent(id)}/revoke`, { method: "POST" });
  return fresh.length;
};
const deleteDisposableUser = async (email, baseline) => {
  if (baseline.userId !== null) return { deleted: false, reason: "pre-existing user was never eligible for deletion" };
  const current = await sessionIdsFor(email);
  if (current.userId === null) return { deleted: false, reason: "signup did not create a user" };
  await clerkApi(`/users/${encodeURIComponent(current.userId)}`, { method: "DELETE" });
  return { deleted: true };
};

const { setupClerkTestingToken } = await import("@clerk/testing/playwright");
const testingToken = process.env.CLERK_TESTING_TOKEN || (await (async () => {
  const response = await fetch("https://api.clerk.com/v1/testing_tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json", "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`testing-token request returned HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload?.token !== "string" || payload.token.length < 10) throw new Error("testing-token response did not contain a token");
  return payload.token;
})());
process.env.CLERK_TESTING_TOKEN = testingToken;
check("short-lived Clerk testing token obtained without recording its value");

const { ConvexHttpClient } = await import("convex/browser");
const { api } = await import("../convex/_generated/api.js");
const convexClientForPage = async (page) => {
  const token = await page.evaluate(async () => {
    const session = globalThis.Clerk?.session;
    if (!session) return null;
    const defaultToken = await session.getToken();
    if (typeof defaultToken === "string") {
      try {
        const payload = defaultToken.split(".")[1];
        const decoded = payload ? atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")) : "";
        if (JSON.parse(decoded)?.aud === "convex") return defaultToken;
      } catch { /* Try the configured template below. */ }
    }
    return await session.getToken({ template: "convex" });
  });
  if (typeof token !== "string" || token.length < 32) throw new Error("verified Convex token was unavailable");
  return new ConvexHttpClient(expectedConvexUrl, { auth: token, logger: false });
};
const listComparisons = async (page) => {
  const client = await convexClientForPage(page);
  const result = await client.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 50, cursor: null } });
  if (result?.status !== "ok" || !Array.isArray(result.result?.page)) throw new Error("comparison list was not acknowledged");
  return { client, page: result.result.page };
};
const deleteComparison = async (client, row) => {
  const result = await client.mutation(api.comparisons.deleteComparison, { requestId: randomUUID(), resultId: row.resultId, createdAt: new Date().toISOString() });
  if (result?.status !== "deleted" && result?.status !== "replayed") throw new Error("comparison deletion was not acknowledged");
  const fetched = await client.query(api.comparisons.getComparison, { comparisonId: row._id });
  if (fetched !== null) throw new Error("deleted comparison remained readable by its owner");
};

const waitForServer = async (baseUrl) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${baseUrl}/signin`, { redirect: "manual" }); if (response.status >= 200 && response.status < 500) return; } catch { /* Starting. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("built Next server did not become ready within 60 seconds");
};
const closeNext = async (nextProcess) => {
  if (!nextProcess || nextProcess.exitCode !== null) return;
  nextProcess.kill("SIGTERM");
  await new Promise((resolvePromise) => { const timer = setTimeout(resolvePromise, 3_000); nextProcess.once("exit", () => { clearTimeout(timer); resolvePromise(); }); });
};
const waitForClerk = async (page) => {
  await page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded), undefined, { timeout: 45_000 });
};
const attachErrors = (page, errors) => page.on("pageerror", (error) => errors.push(scrub(error.message)));
const comparisonTableText = async (page) => {
  const table = page.locator("main .overflow-x-auto").first();
  await table.waitFor({ timeout: 30_000 });
  return (await table.innerText()).replace(/\s+/g, " ").trim();
};
const readLocalSave = async (page, resultId) => page.evaluate(async (wantedResultId) => {
  const db = await new Promise((resolvePromise, reject) => {
    const request = indexedDB.open("truecost-private-comparisons-v1");
    request.onsuccess = () => resolvePromise(request.result);
    request.onerror = () => reject(request.error);
  });
  const records = await new Promise((resolvePromise, reject) => {
    const request = db.transaction("partitions", "readonly").objectStore("partitions").getAll();
    request.onsuccess = () => resolvePromise(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const jobs = records.flatMap((record) => record?.kind === "account" && Array.isArray(record.saves) ? record.saves : []);
  const job = jobs.find((candidate) => candidate.resultId === wantedResultId);
  if (!job) return null;
  const snapshotHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(job.snapshotJson));
  return {
    requestId: job.requestId,
    resultId: job.resultId,
    createdAt: job.createdAt,
    snapshotHash: Array.from(new Uint8Array(snapshotHash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    status: job.status,
    attempts: job.attempts,
    pauseReason: job.pauseReason,
  };
}, resultId);
const ageLocalSave = async (page, resultId) => page.evaluate(async (wantedResultId) => {
  const db = await new Promise((resolvePromise, reject) => { const request = indexedDB.open("truecost-private-comparisons-v1"); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
  const transaction = db.transaction("partitions", "readwrite");
  const store = transaction.objectStore("partitions");
  const records = await new Promise((resolvePromise, reject) => { const request = store.getAll(); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
  const account = records.find((record) => record?.kind === "account" && record.saves?.some((job) => job.resultId === wantedResultId));
  const job = account?.saves?.find((candidate) => candidate.resultId === wantedResultId);
  if (!job) throw new Error("local queued save was not found for expiry injection");
  job.createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  store.put(account);
  await new Promise((resolvePromise, reject) => { transaction.oncomplete = resolvePromise; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
  db.close();
}, resultId);

let nextProcess;
let browser;
let context;
let page;
let disposableEmail;
let baseline;
let serverCleanupComplete = false;
const ownedResultIds = new Set();
const browserErrors = [];
const clerkResponses = [];
const clerkFailures = [];
const recordClerkResponse = (response) => {
  try {
    const responseUrl = new URL(response.url());
    if (responseUrl.hostname !== expectedIssuer || !responseUrl.pathname.startsWith("/v1/")) return;
    const entry = { request: `${response.request().method()} ${responseUrl.pathname}`, status: response.status() };
    clerkResponses.push(entry);
    if (response.status() >= 400) {
      void response.json().then((body) => {
        const errors = Array.isArray(body?.errors) ? body.errors : [];
        entry.errors = errors.slice(0, 3).map((item) => ({
          code: typeof item?.code === "string" ? scrub(item.code) : null,
          message: typeof item?.message === "string" ? scrub(item.message) : null,
          longMessage: typeof item?.long_message === "string" ? scrub(item.long_message) : null,
        }));
      }).catch(() => {});
    }
  } catch { /* Ignore malformed/non-HTTP diagnostic URLs. */ }
};
try {
  const port = Number(process.env.TRUECOST_RECOVERY_BROWSER_PORT || 0);
  if (!port) throw new Error("TRUECOST_RECOVERY_BROWSER_PORT must be an explicitly owned free port");
  const probe = createServer();
  await new Promise((resolvePromise, reject) => { probe.once("error", reject); probe.listen(port, "localhost", resolvePromise); });
  await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
  nextProcess = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", "-H", "localhost", "-p", String(port)], { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: "ignore" });
  evidence.baseUrl = `http://localhost:${port}`;
  await waitForServer(evidence.baseUrl);
  browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = { name: "Chrome", playwright: playwrightPackage.version, engine: browser.version() };
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
  await setupClerkTestingToken({ context, options: { frontendApiUrl: expectedIssuer } });
  disposableEmail = process.env.TRUECOST_RECOVERY_EMAIL || `tc-recovery-${randomUUID()}+clerk_test@example.com`;
  assert.ok(disposableEmail.split("@", 1)[0].length <= 64, "recovery email local-part exceeds RFC 5321 limit");
  baseline = await sessionIdsFor(disposableEmail);
  if (process.env.TRUECOST_RECOVERY_EMAIL) assert.ok(baseline.userId, "requested recovery identity does not exist");
  else assert.equal(baseline.userId, null, "generated recovery address unexpectedly exists");
  page = await context.newPage();
  attachErrors(page, browserErrors);
  page.on("response", recordClerkResponse);
  page.on("requestfailed", (request) => {
    try {
      const requestUrl = new URL(request.url());
      if (requestUrl.hostname === expectedIssuer && requestUrl.pathname.startsWith("/v1/")) {
        const code = request.failure()?.errorText?.match(/(?:net::)?ERR_[A-Z0-9_]+|net::[A-Z0-9_]+/i)?.[0] || "unknown";
        clerkFailures.push(`${request.method()} ${requestUrl.pathname} ${code}`);
      }
    } catch { /* Ignore malformed/non-HTTP diagnostic URLs. */ }
  });
  await page.goto(`${evidence.baseUrl}/signin`, { waitUntil: "domcontentloaded" });
  await waitForClerk(page);
  await page.getByRole("link", { name: /carry on as a guest/i }).click();
  await page.waitForURL(/\/home(?:\?|$)/, { timeout: 12_000 });
  await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 30_000 });
  const fillOffer = async (index, lender, amount, rate, tenure) => {
    await page.getByLabel(`Lender name for offer ${index}`, { exact: true }).fill(lender);
    await page.getByLabel(`Loan amount for offer ${index}`, { exact: true }).fill(String(amount));
    await page.getByLabel(`Interest rate for offer ${index}`, { exact: true }).fill(String(rate));
    await page.getByLabel(`Tenure for offer ${index}`, { exact: true }).fill(String(tenure));
  };
  await fillOffer(1, "Recovery bank A", 1000000, 8.5, 10);
  await fillOffer(2, "Recovery bank B", 1_000_000, 8.9, 10);
  await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
  const guestTable = await comparisonTableText(page);
  assert.match(guestTable, /Recovery bank A/);
  assert.match(guestTable, /Recovery bank B/);
  check("guest result mounted with the complete synthetic two-offer comparison");
  await page.getByRole("button", { name: "Sign in to save comparison", exact: true }).click();
  await page.waitForURL(/\/signin\?/, { timeout: 12_000 });
  const nextUrl = new URL(page.url()).searchParams.get("next");
  const requestIdBefore = nextUrl ? new URL(nextUrl, evidence.baseUrl).searchParams.get("requestId") : null;
  assert.match(requestIdBefore || "", /^[0-9a-f-]{36}$/i);
  await page.locator("#signin-email").fill(disposableEmail);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 45_000 });
  let interceptedSaves = 0;
  await context.route("**/api/mutation", async (route) => {
    const body = route.request().postData() || "";
    if (!body.includes("saveComparison")) return route.continue();
    interceptedSaves += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "success", value: { status: "limited", code: "rate_limited", retryAfterMs: 0 }, logLines: [] }) });
  });
  await page.locator("#signin-code").fill("424242");
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 30_000 });
  await page.getByRole("status").filter({ hasText: /Saving|Queued|paused/i }).first().waitFor({ timeout: 15_000 });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const deadline = Date.now() + 8_000;
    while (interceptedSaves < attempt + 1 && Date.now() < deadline) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    assert.ok(interceptedSaves >= attempt + 1, `fault injection did not receive bounded save attempt ${attempt + 1}`);
    if (attempt < 7) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_100));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    }
  }
  await page.getByRole("status").filter({ hasText: "Saving paused after eight attempts" }).waitFor({ timeout: 15_000 });
  const pausedResult = await page.evaluate(() => document.querySelector('table tbody tr td:nth-child(2)')?.textContent || "");
  assert.match(await comparisonTableText(page), /Recovery bank A/);
  const localRows = await page.evaluate(async () => {
    const db = await new Promise((resolvePromise, reject) => { const request = indexedDB.open("truecost-private-comparisons-v1"); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
    const records = await new Promise((resolvePromise, reject) => { const request = db.transaction("partitions", "readonly").objectStore("partitions").getAll(); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
    db.close();
    return records.flatMap((record) => record?.kind === "account" ? record.saves || [] : []).map((job) => ({ resultId: job.resultId, requestId: job.requestId, status: job.status, attempts: job.attempts }));
  });
  const pausedJob = localRows.find((job) => job.status === "paused");
  assert.ok(pausedJob, "paused save was not present in the mounted browser workspace");
  ownedResultIds.add(pausedJob.resultId);
  const pausedSnapshot = await readLocalSave(page, pausedJob.resultId);
  assert.equal(pausedSnapshot?.attempts, 8);
  await page.screenshot({ path: resolve(evidenceDir, "comparison-recovery-paused.png"), fullPage: true });
  check("mounted member result reached paused after exactly eight intercepted transient failures", { attempts: interceptedSaves, resultId: pausedJob.resultId, requestId: pausedJob.requestId });
  await context.unroute("**/api/mutation");
  await page.getByRole("button", { name: "Try saving again", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved to your account." }).waitFor({ timeout: 30_000 });
  const savedSnapshot = await readLocalSave(page, pausedJob.resultId);
  assert.equal(savedSnapshot?.status, "saved");
  assert.equal(savedSnapshot?.requestId, pausedSnapshot?.requestId);
  assert.equal(savedSnapshot?.snapshotHash, pausedSnapshot?.snapshotHash);
  assert.equal(savedSnapshot?.createdAt, pausedSnapshot?.createdAt);
  const serverAfterRetry = await listComparisons(page);
  const matchingRows = serverAfterRetry.page.filter((row) => row.resultId === pausedJob.resultId);
  assert.equal(matchingRows.length, 1, "explicit retry did not produce exactly one matching server comparison");
  assert.equal(sha256(matchingRows[0].snapshot), pausedSnapshot.snapshotHash);
  evidence.ownedRecords.push({ resultId: pausedJob.resultId, comparisonId: matchingRows[0]._id, requestId: pausedSnapshot.requestId });
  await page.screenshot({ path: resolve(evidenceDir, "comparison-recovery-saved.png"), fullPage: true });
  check("explicit recovery saved one matching Convex record with stable request and snapshot identity", { resultId: pausedJob.resultId, requestId: pausedSnapshot.requestId });

  await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.waitForFunction(() => {
    const reset = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Reset");
    const amount = document.querySelector('[aria-label="Loan amount for offer 1"]');
    return reset instanceof HTMLButtonElement && !reset.disabled && amount instanceof HTMLInputElement && amount.value === "";
  }, undefined, { timeout: 15_000 });
  await fillOffer(1, "Expired bank A", 1000000, 8.6, 10);
  await fillOffer(2, "Expired bank B", 1000000, 8.9, 10);
  await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
  const expiredResultId = await page.evaluate(async () => {
    const db = await new Promise((resolvePromise, reject) => { const request = indexedDB.open("truecost-private-comparisons-v1"); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
    const records = await new Promise((resolvePromise, reject) => { const request = db.transaction("partitions", "readonly").objectStore("partitions").getAll(); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
    db.close();
    const tabs = records.filter((record) => record?.kind === "tab");
    return tabs.map((record) => record.snapshotJson ? JSON.parse(record.snapshotJson).resultId : null).find(Boolean);
  });
  assert.match(expiredResultId || "", /^[0-9a-f-]{36}$/i);
  ownedResultIds.add(expiredResultId);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save comparison", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Queued in this browser" }).waitFor({ timeout: 15_000 });
  await ageLocalSave(page, expiredResultId);
  await context.setOffline(false);
  await page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
  await page.getByRole("status").filter({ hasText: "This save is too old to retry" }).waitFor({ timeout: 20_000 });
  assert.equal(await page.getByRole("button", { name: "Try saving again", exact: true }).count(), 0);
  await page.screenshot({ path: resolve(evidenceDir, "comparison-recovery-expired.png"), fullPage: true });
  check("expired queued save stayed local, surfaced honest unknown-acknowledgement copy, and offered no blind retry", { resultId: expiredResultId });

  const serverBeforeCleanup = await listComparisons(page);
  const ownedRows = serverBeforeCleanup.page.filter((row) => ownedResultIds.has(row.resultId));
  for (const row of ownedRows) await deleteComparison(serverBeforeCleanup.client, row);
  const serverAfterCleanup = await listComparisons(page);
  assert.equal(serverAfterCleanup.page.filter((row) => ownedResultIds.has(row.resultId)).length, 0);
  serverCleanupComplete = true;
  check("cleanup deleted only this run's acknowledged comparison record", { deleted: ownedRows.map((row) => row.resultId) });
  assert.deepEqual(browserErrors, [], "recovery browser run had uncaught page errors");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(scrub(error instanceof Error ? error.message : String(error)));
  evidence.errors.push(`owned result IDs: ${JSON.stringify([...ownedResultIds])}`);
  evidence.diagnostics.push({ clerkResponses: clerkResponses.slice(-20), requestFailures: clerkFailures.slice(-20) });
  await page?.screenshot({ path: resolve(evidenceDir, "comparison-recovery-failed.png"), fullPage: true }).catch(() => {});
  if (page) evidence.diagnostics.push({ url: page.url(), body: scrub((await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ")).slice(-1200) });
  process.exitCode = 1;
} finally {
  try {
    if (!serverCleanupComplete && page && ownedResultIds.size > 0) {
      const server = await listComparisons(page);
      for (const row of server.page.filter((candidate) => ownedResultIds.has(candidate.resultId))) await deleteComparison(server.client, row);
      serverCleanupComplete = true;
    }
  } catch (error) {
    evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
  }
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await closeNext(nextProcess);
  if (disposableEmail && baseline && serverCleanupComplete) {
    try {
      const revoked = await revokeNewSessions(disposableEmail, baseline);
      const removed = await deleteDisposableUser(disposableEmail, baseline);
      check("cleanup revoked new sessions and deleted only the owned disposable identity", { revoked, deleted: removed.deleted, reason: removed.reason });
    } catch (error) {
      evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
    }
  } else if (disposableEmail && !serverCleanupComplete && ownedResultIds.size === 0) {
    try {
      const revoked = await revokeNewSessions(disposableEmail, baseline);
      const removed = await deleteDisposableUser(disposableEmail, baseline);
      check("cleanup deleted the disposable identity after a pre-save flow failure", { revoked, deleted: removed.deleted, reason: removed.reason });
    } catch (error) {
      evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
    }
  } else if (disposableEmail && !serverCleanupComplete) {
    evidence.cleanupErrors.push("server cleanup did not complete; disposable identity was intentionally preserved");
    try {
      const current = await sessionIdsFor(disposableEmail);
      evidence.preservedIdentity = {
        userId: current.userId,
        ownedResultIds: [...ownedResultIds],
        serverCleanupComplete,
        reason: "server cleanup failed; identity retained for manual cleanup",
      };
    } catch (error) {
      evidence.preservedIdentity = {
        userId: null,
        ownedResultIds: [...ownedResultIds],
        serverCleanupComplete,
        reason: `server cleanup failed and Clerk lookup failed: ${scrub(error instanceof Error ? error.message : String(error))}`,
      };
    }
  }
  if (evidence.cleanupErrors.length > 0) { evidence.status = "failed"; process.exitCode = 1; }
  evidence.scriptSha256 = await sha256File(fileURLToPath(import.meta.url));
  evidence.sourceHashes = {};
  for (const path of ["lib/comparison/private-workspace.ts", "lib/comparison/transport.ts", "lib/store.tsx", "components/ComparisonStatus.tsx", "scripts/check-comparison-recovery-browser.mjs", ".next/BUILD_ID"]) {
    evidence.sourceHashes[path] = await sha256File(resolve(root, path));
  }
  await writeFile(resolve(evidenceDir, "comparison-recovery-browser.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
