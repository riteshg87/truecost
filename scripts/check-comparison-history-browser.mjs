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
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sha256File = async (path) => sha256(await readFile(path));
const localEnv = await readFile(resolve(root, ".env.local"), "utf8").catch(() => "");
const envValue = (name) => localEnv.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim() || "";
const publishableKey = envValue("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
const secretKey = envValue("CLERK_SECRET_KEY");
const convexUrl = envValue("NEXT_PUBLIC_CONVEX_URL");
const expectedIssuer = "live-tarpon-2666.clerk.accounts.dev";
const expectedConvexUrl = "https://dutiful-fly-37.convex.cloud";
const expectedBuildId = process.env.TRUECOST_HISTORY_EXPECTED_BUILD_ID || "";
const buildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim();
assert.ok(expectedBuildId, "TRUECOST_HISTORY_EXPECTED_BUILD_ID must be supplied by the reviewed build owner");
assert.equal(buildId, expectedBuildId, "built artifact is not the reviewed history target");
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

const evidence = {
  checkedAt: new Date().toISOString(), buildId, sourceRevision: "unknown", browser: null,
  baseUrl: null, checks: [], errors: [], cleanupErrors: [], preservedIdentities: [],
  ownedRecords: [], status: "pending", limits: ["Two-account cleanup and a second tab are browser checks; server ownership remains authoritative.", "Narrow captures use 320px and 390px CSS viewports. Full-page screenshots can stitch sticky headers repeatedly, so viewport captures are the visual reference."],
};
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
const ownedRefs = (account) => [...account.owned.values()].map((row) => ({
  comparisonId: typeof row?._id === "string" ? row._id : null,
  resultId: typeof row?.resultId === "string" ? row.resultId : null,
}));
const assertOwnedRowsResolved = (account) => {
  const unresolved = ownedRefs(account).filter((row) => row.comparisonId === null);
  if (unresolved.length > 0) throw new Error(`${account.label} has an unresolved save result; disposable identity must be retained`);
};
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
  return { deleted: true, userId: current.userId };
};

const { setupClerkTestingToken } = await import("@clerk/testing/playwright");
const testingToken = process.env.CLERK_TESTING_TOKEN || (await (async () => {
  const response = await fetch("https://api.clerk.com/v1/testing_tokens", { method: "POST", headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json", "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`testing-token request returned HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload?.token !== "string" || payload.token.length < 10) throw new Error("testing-token response did not contain a token");
  return payload.token;
})());
process.env.CLERK_TESTING_TOKEN = testingToken;
check("reviewed build, Clerk issuer and Convex target match");
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
const listRows = async (page) => {
  const client = await convexClientForPage(page);
  const result = await client.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 50, cursor: null } });
  if (result?.status !== "ok" || !Array.isArray(result.result?.page)) throw new Error("comparison list was not acknowledged");
  return { client, rows: result.result.page };
};
const deleteRow = async (client, row) => {
  const requestId = randomUUID();
  const createdAt = new Date().toISOString();
  const result = await client.mutation(api.comparisons.deleteComparison, { requestId, resultId: row.resultId, createdAt });
  if (result?.status !== "deleted" && result?.status !== "replayed") throw new Error("comparison cleanup was not acknowledged");
  const fetched = await client.query(api.comparisons.getComparison, { comparisonId: row._id });
  if (fetched !== null) throw new Error("owned comparison remained after cleanup");
};
const waitForClerk = (page) => page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded), undefined, { timeout: 45_000 });
const waitText = async (page, text, timeout = 30_000) => { await page.getByText(text, { exact: false }).first().waitFor({ timeout }); };
const fillOffer = async (page, index, lender, amount, rate, tenure) => {
  await page.getByLabel(`Lender name for offer ${index}`, { exact: true }).fill(lender);
  await page.getByLabel(`Loan amount for offer ${index}`, { exact: true }).fill(String(amount));
  await page.getByLabel(`Interest rate for offer ${index}`, { exact: true }).fill(String(rate));
  await page.getByLabel(`Tenure for offer ${index}`, { exact: true }).fill(String(tenure));
};
const currentResultId = async (page) => page.evaluate(async () => {
  const db = await new Promise((resolvePromise, reject) => { const request = indexedDB.open("truecost-private-comparisons-v1"); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
  const records = await new Promise((resolvePromise, reject) => { const request = db.transaction("partitions", "readonly").objectStore("partitions").getAll(); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
  db.close();
  const tab = records.find((record) => record?.kind === "tab" && typeof record.snapshotJson === "string");
  try { return tab?.snapshotJson ? JSON.parse(tab.snapshotJson).resultId : null; } catch { return null; }
});
const localDeletion = async (page, resultId) => page.evaluate(async (wantedResultId) => {
  const db = await new Promise((resolvePromise, reject) => { const request = indexedDB.open("truecost-private-comparisons-v1"); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
  const records = await new Promise((resolvePromise, reject) => { const request = db.transaction("partitions", "readonly").objectStore("partitions").getAll(); request.onsuccess = () => resolvePromise(request.result); request.onerror = () => reject(request.error); });
  db.close();
  const account = records.find((record) => record?.kind === "account" && Array.isArray(record.deletions) && record.deletions.some((job) => job.resultId === wantedResultId));
  const job = account?.deletions?.find((candidate) => candidate.resultId === wantedResultId);
  return job ? { requestId: job.requestId, createdAt: job.createdAt, status: job.status } : null;
}, resultId);
const waitForLocalDeletion = async (page, resultId, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const job = await localDeletion(page, resultId);
    if (job) return job;
    await page.waitForTimeout(100);
  }
  return null;
};
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const formatINR = (value) => `₹${inr.format(Math.round(value))}`;
const formatCompactINR = (value) => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1000) return `${sign}₹${inr.format(Math.round(abs))}`;
  return `${sign}₹${Math.round(abs)}`;
};
const formatPct = (value) => value === null ? "—" : `${value.toFixed(2)}%`;
const signInMember = async (context, email, label) => {
  const page = await context.newPage();
  page.on("pageerror", (error) => evidence.errors.push(`${label}: ${scrub(error.message)}`));
  await page.goto(`${evidence.baseUrl}/signin`, { waitUntil: "domcontentloaded" });
  await waitForClerk(page);
  await page.locator("#signin-email").fill(email);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 30_000 });
  await page.locator("#signin-code").fill("424242");
  await page.waitForURL(/\/home(?:\?|$)/, { timeout: 30_000 });
  return page;
};
const makeSavedResult = async (page, lenderA, lenderB, owner = null) => {
  await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 30_000 });
  await fillOffer(page, 1, lenderA, 1_000_000, 8.5, 10);
  await fillOffer(page, 2, lenderB, 1_000_000, 8.9, 10);
  await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
  const expectedResultId = await currentResultId(page);
  assert.equal(typeof expectedResultId, "string", "calculated result ID was unavailable before save");
  if (owner) {
    owner.saveAttempted = true;
    owner.owned.set(expectedResultId, { resultId: expectedResultId });
  }
  await page.getByRole("button", { name: "Save comparison", exact: true }).click();
  await waitText(page, "Saved to your account.");
  const capturedResultId = await currentResultId(page);
  assert.equal(capturedResultId, expectedResultId, "save changed the active result ID");
  const listed = await listRows(page);
  const row = listed.rows.find((candidate) => candidate.resultId === expectedResultId);
  if (!row) throw new Error("saved comparison was absent from authenticated history");
  if (owner) owner.owned.set(expectedResultId, row);
  return { ...listed, row };
};

let nextProcess;
let browser;
const contexts = [];
const accounts = [];
try {
  const port = Number(process.env.TRUECOST_HISTORY_BROWSER_PORT || 0);
  if (!port) throw new Error("TRUECOST_HISTORY_BROWSER_PORT must be an explicitly owned free port");
  const probe = createServer();
  await new Promise((resolvePromise, reject) => { probe.once("error", reject); probe.listen(port, "localhost", resolvePromise); });
  await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
  nextProcess = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", "-H", "localhost", "-p", String(port)], { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: "ignore" });
  evidence.baseUrl = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  let serverReady = false;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${evidence.baseUrl}/comparisons`, { redirect: "manual" }); if (response.status >= 200 && response.status < 500) { serverReady = true; break; } } catch { /* Starting. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  if (!serverReady) throw new Error("built Next server did not become ready within 60 seconds");
  browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = { name: "Chrome", playwright: playwrightPackage.version, engine: browser.version() };

  for (const accountLabel of ["a", "b"]) {
    const email = `tc-history-${randomUUID()}+clerk_test@example.com`;
    assert.ok(email.split("@", 1)[0].length <= 64, "history email local-part exceeds RFC 5321 limit");
    const baseline = await sessionIdsFor(email);
    assert.equal(baseline.userId, null);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
    await setupClerkTestingToken({ context, options: { frontendApiUrl: expectedIssuer } });
    contexts.push(context);
    const account = { label: accountLabel, email, baseline, context, page: null, owned: new Map(), saveAttempted: false };
    accounts.push(account);
    const page = await signInMember(context, email, accountLabel);
    account.page = page;
    await page.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
    await waitText(page, "No saved comparisons yet");
    await page.screenshot({ path: resolve(evidenceDir, `comparison-history-${accountLabel}-empty.png`), fullPage: true });
    check(`${accountLabel} disposable member opened empty history`);
  }

  const accountA = accounts[0];
  const savedA = await makeSavedResult(accountA.page, "History bank A", "History bank B", accountA);
  accountA.owned.set(savedA.row.resultId, savedA.row);
  check("member save appeared in list with the original lender inputs", { resultId: savedA.row.resultId });
  await accountA.page.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
  await waitText(accountA.page, "History bank A");
  await accountA.page.getByRole("link", { name: /History bank A/ }).click();
  await accountA.page.waitForURL(/\/comparisons\/[^/]+$/);
  await waitText(accountA.page, "Recorded comparison");
  const storedDetails = accountA.page.locator("details");
  const storedDetailCount = await storedDetails.count();
  for (let index = 0; index < storedDetailCount; index += 1) await storedDetails.nth(index).locator("summary").click();
  await waitText(accountA.page, "Recorded figures");
  const detailText = await accountA.page.locator("main").innerText();
  assert.match(detailText, /History bank A/);
  assert.match(detailText, /History bank B/);
  const savedSnapshot = JSON.parse(savedA.row.snapshot);
  const detailRecord = await (await convexClientForPage(accountA.page)).query(api.comparisons.getComparison, { comparisonId: savedA.row._id });
  assert.equal(detailRecord?._id, savedA.row._id);
  assert.equal(detailRecord?.resultId, savedA.row.resultId);
  assert.equal(detailRecord?.snapshot, savedA.row.snapshot);
  for (const row of savedSnapshot.result.rows) {
    assert.ok(detailText.includes(formatPct(row.derived.effectiveAprPct)), "history detail did not show the stored APR");
    assert.ok(detailText.includes(formatINR(row.derived.emi)), "history detail did not show the stored EMI");
    assert.ok(detailText.includes(formatCompactINR(row.derived.totalRepayment)), "history detail did not show the stored total repayment");
  }
  await accountA.page.screenshot({ path: resolve(evidenceDir, "comparison-history-detail.png"), fullPage: true });
  await accountA.page.evaluate(() => window.scrollTo(0, 0));
  await accountA.page.screenshot({ path: resolve(evidenceDir, "comparison-history-detail-top.png"), fullPage: false });
  await accountA.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await accountA.page.screenshot({ path: resolve(evidenceDir, "comparison-history-detail-bottom.png"), fullPage: false });
  check("history detail rendered the stored snapshot without changing lenders or figures");

  if (process.env.TRUECOST_CHECK_REPORTS === "1") {
    const { checkReportDownload, checkWarmOfflineReport } = await import("./check-report-download.mjs");
    await checkReportDownload({ page: accountA.page, snapshot: savedSnapshot, evidenceDir, check });
    await checkWarmOfflineReport({ page: accountA.page, snapshot: savedSnapshot, evidenceDir, check });
  }

  await accountA.page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
  await fillOffer(accountA.page, 1, "Unsaved draft A", 1_200_000, 7.5, 12);
  await fillOffer(accountA.page, 2, "Unsaved draft B", 1_200_000, 7.9, 12);
  await accountA.page.goto(`${evidence.baseUrl}/comparisons/${encodeURIComponent(savedA.row._id)}`, { waitUntil: "domcontentloaded" });
  await waitText(accountA.page, "Recorded comparison");
  await accountA.page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
  assert.equal(await accountA.page.getByLabel("Lender name for offer 1", { exact: true }).inputValue(), "Unsaved draft A");
  check("opening history left the active comparison draft unchanged");

  await accountA.page.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
  await waitText(accountA.page, "History bank A");
  const secondTab = await accountA.context.newPage();
  await secondTab.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
  await waitText(secondTab, "History bank A");
  const cold = await accountA.context.newPage();
  await cold.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
  await waitText(cold, "History bank A");
  await accountA.context.setOffline(true);
  await accountA.page.waitForFunction(() => navigator.onLine === false, undefined, { timeout: 5_000 });
  await accountA.page.getByRole("button", { name: "Delete", exact: true }).click();
  await accountA.page.getByRole("button", { name: "Keep it", exact: true }).click();
  await waitText(accountA.page, "History bank A");
  check("deletion confirmation can be cancelled without hiding the saved result");

  await accountA.page.getByRole("button", { name: "Delete", exact: true }).click();
  await accountA.page.getByRole("button", { name: "Confirm deletion", exact: true }).click();
  await waitText(accountA.page, "Deletion pending");
  await waitText(secondTab, "Deletion pending");
  const queuedDeletion = await waitForLocalDeletion(accountA.page, savedA.row.resultId);
  const mirroredDeletion = await waitForLocalDeletion(secondTab, savedA.row.resultId);
  assert.ok(queuedDeletion && (queuedDeletion.status === "queued" || queuedDeletion.status === "sending"));
  assert.equal(mirroredDeletion?.requestId, queuedDeletion.requestId);
  assert.equal(mirroredDeletion?.createdAt, queuedDeletion.createdAt);
  check("a second same-account tab reflected the queued deletion update");
  await secondTab.close();

  await accountA.page.screenshot({ path: resolve(evidenceDir, "comparison-history-pending.png"), fullPage: true });
  check("warm offline history retained the durable pending deletion state");
  await cold.reload({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {});
  const coldText = await cold.locator("body").innerText();
  assert.doesNotMatch(coldText, /History bank A|History bank B|Recorded figures/);
  assert.match(coldText, /Verify your account|You are offline|connection|offline/i);
  await cold.screenshot({ path: resolve(evidenceDir, "comparison-history-cold-locked.png"), fullPage: true });
  check("cold offline history reload stayed locked without a fresh private grant");
  await cold.close();
  await accountA.context.setOffline(false);
  await accountA.page.waitForFunction(() => navigator.onLine === true, undefined, { timeout: 5_000 });
  await accountA.page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
  await accountA.page.waitForFunction(() => {
    const text = document.body.innerText;
    return !text.includes("History bank A") && (text.includes("No saved comparisons yet") || text.includes("Your saved results, newest first."));
  }, undefined, { timeout: 45_000 });
  await accountA.page.waitForFunction(() => !document.body.innerText.includes("Deletion pending"), undefined, { timeout: 45_000 });
  const afterReconnect = await listRows(accountA.page);
  assert.equal(afterReconnect.rows.some((row) => row.resultId === savedA.row.resultId), false);
  assert.equal(await afterReconnect.client.query(api.comparisons.getComparison, { comparisonId: savedA.row._id }), null);
  const completedDeletion = await localDeletion(accountA.page, savedA.row.resultId);
  assert.equal(completedDeletion?.requestId, queuedDeletion.requestId);
  assert.equal(completedDeletion?.createdAt, queuedDeletion.createdAt);
  assert.equal(completedDeletion?.status, "deleted");
  check("reconnect pumped the queued deletion and removed the record from history");

  await accountA.page.goto(`${evidence.baseUrl}/comparisons/${encodeURIComponent(savedA.row._id)}`, { waitUntil: "domcontentloaded" });
  await waitText(accountA.page, "Saved comparison unavailable");
  check("direct missing history ID showed an honest unavailable state");

  const savedAIsolation = await makeSavedResult(accountA.page, "A private bank A", "A private bank B", accountA);
  accountA.owned.set(savedAIsolation.row.resultId, savedAIsolation.row);

  const savedB = await makeSavedResult(accounts[1].page, "Other account bank A", "Other account bank B", accounts[1]);
  accounts[1].owned.set(savedB.row.resultId, savedB.row);
  await accounts[1].page.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
  await waitText(accounts[1].page, "Other account bank A");
  assert.doesNotMatch(await accounts[1].page.locator("main").innerText(), /A private bank A/);
  check("second disposable account listed only its own comparison");
  await accounts[1].page.goto(`${evidence.baseUrl}/comparisons/${encodeURIComponent(savedAIsolation.row._id)}`, { waitUntil: "domcontentloaded" });
  await waitText(accounts[1].page, "Saved comparison unavailable");
  check("second account could not read the first account's comparison ID");
  const foreignResult = await (await convexClientForPage(accounts[1].page)).mutation(api.comparisons.deleteComparison, { requestId: randomUUID(), resultId: savedAIsolation.row.resultId, createdAt: new Date().toISOString() });
  assert.ok(foreignResult?.status === "deleted" || foreignResult?.status === "replayed");
  assert.equal(foreignResult.comparisonId, null);
  const accountARows = await listRows(accountA.page);
  const originalA = accountARows.rows.find((row) => row.resultId === savedAIsolation.row.resultId);
  assert.equal(originalA?.snapshot, savedAIsolation.row.snapshot);
  check("second account could not delete the first account's comparison");

  await accountA.page.setViewportSize({ width: 320, height: 800 });
  await accountA.page.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
  await waitText(accountA.page, "A private bank A");
  assert.equal(await accountA.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await accountA.page.screenshot({ path: resolve(evidenceDir, "comparison-history-narrow-320.png"), fullPage: true });
  const narrowArticle = accountA.page.locator("article").filter({ hasText: "A private bank A" }).first();
  const narrowTrigger = narrowArticle.getByRole("button", { name: "Delete", exact: true });
  await narrowTrigger.focus();
  await narrowTrigger.press("Enter");
  const narrowCancel = narrowArticle.getByRole("button", { name: "Keep it", exact: true });
  const narrowConfirm = narrowArticle.getByRole("button", { name: "Confirm deletion", exact: true });
  await narrowCancel.waitFor();
  assert.equal(await accountA.page.evaluate(() => (document.activeElement instanceof HTMLElement) ? document.activeElement.innerText : ""), "Keep it");
  await narrowCancel.press("Tab");
  assert.equal(await accountA.page.evaluate(() => (document.activeElement instanceof HTMLElement) ? document.activeElement.innerText : ""), "Confirm deletion");
  await narrowConfirm.press("Shift+Tab");
  assert.equal(await accountA.page.evaluate(() => (document.activeElement instanceof HTMLElement) ? document.activeElement.innerText : ""), "Keep it");
  await narrowCancel.press("Enter");
  await waitText(accountA.page, "A private bank A");
  const restoredNarrowTrigger = accountA.page.locator("article").filter({ hasText: "A private bank A" }).first().getByRole("button", { name: "Delete", exact: true });
  await restoredNarrowTrigger.waitFor();
  await accountA.page.waitForFunction(() => document.activeElement?.textContent === "Delete", undefined, { timeout: 5_000 });
  assert.equal(await restoredNarrowTrigger.evaluate((element) => document.activeElement === element), true);
  check("320px history layout keeps delete controls keyboard reachable and restores focus after cancel");

  await accounts[1].page.setViewportSize({ width: 390, height: 844 });
  await accounts[1].page.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
  await waitText(accounts[1].page, "Other account bank A");
  assert.equal(await accounts[1].page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await accounts[1].page.screenshot({ path: resolve(evidenceDir, "comparison-history-narrow-390.png"), fullPage: true });
  check("390px history layout fits without horizontal overflow");

  for (const account of accounts) {
    const listed = await listRows(account.page);
    for (const row of listed.rows.filter((candidate) => account.owned.has(candidate.resultId))) await deleteRow(listed.client, row);
  }
  check("cleanup deleted only this run's owned comparison rows");
  evidence.ownedRecords = accounts.flatMap((account) => [...account.owned.values()].map((row) => ({ account: account.label, comparisonId: row._id, resultId: row.resultId })));
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(scrub(error instanceof Error ? error.message : String(error)));
} finally {
  for (const account of accounts) {
    try {
      await account.context.setOffline(false).catch(() => {});
      const page = account.page;
      if (page && !(account.saveAttempted && account.owned.size === 0)) {
        const listed = await listRows(page);
        for (const row of listed.rows.filter((candidate) => account.owned.has(candidate.resultId))) await deleteRow(listed.client, row);
      }
      assertOwnedRowsResolved(account);
    } catch (error) {
      evidence.cleanupErrors.push(`${account.label}: ${scrub(error instanceof Error ? error.message : String(error))}`);
      try {
        const current = await sessionIdsFor(account.email);
        evidence.preservedIdentities.push({ account: account.label, userId: current.userId, ownedRecords: ownedRefs(account), reason: "cleanup failed; identity retained" });
      } catch { evidence.preservedIdentities.push({ account: account.label, userId: null, ownedRecords: ownedRefs(account), reason: "cleanup and identity lookup failed" }); }
    }
  }
  for (const account of accounts) {
    if (evidence.preservedIdentities.some((item) => item.account === account.label)) continue;
    if (account.saveAttempted && account.owned.size === 0) {
      try { const current = await sessionIdsFor(account.email); evidence.preservedIdentities.push({ account: account.label, userId: current.userId, ownedRecords: ownedRefs(account), reason: "save acknowledgement was uncertain; identity retained" }); } catch { evidence.preservedIdentities.push({ account: account.label, userId: null, ownedRecords: ownedRefs(account), reason: "save acknowledgement and identity lookup were uncertain" }); }
      continue;
    }
    try {
      const revoked = await revokeNewSessions(account.email, account.baseline);
      const removed = await deleteDisposableUser(account.email, account.baseline);
      check(`${account.label} cleanup revoked sessions and deleted only its disposable identity`, { revoked, deleted: removed.deleted, reason: removed.reason });
    } catch (error) {
      evidence.cleanupErrors.push(`${account.label} identity cleanup: ${scrub(error instanceof Error ? error.message : String(error))}`);
      try { const current = await sessionIdsFor(account.email); evidence.preservedIdentities.push({ account: account.label, userId: current.userId, ownedRecords: ownedRefs(account), reason: "identity cleanup failed; identity retained" }); } catch { evidence.preservedIdentities.push({ account: account.label, userId: null, ownedRecords: ownedRefs(account), reason: "identity cleanup and lookup failed" }); }
    }
  }
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  await browser?.close().catch(() => {});
  if (nextProcess && nextProcess.exitCode === null) nextProcess.kill("SIGTERM");
  evidence.ownedRecords = accounts.flatMap((account) => ownedRefs(account).map((row) => ({ account: account.label, ...row })));
  evidence.scriptSha256 = await sha256File(fileURLToPath(import.meta.url));
  evidence.sourceHashes = {};
  for (const path of ["lib/comparison/private-workspace.ts", "lib/comparison/history-transport.ts", "lib/comparison/history-provider.tsx", "components/SavedComparisonView.tsx", "app/comparisons/page.tsx", "app/comparisons/[id]/page.tsx", "scripts/check-comparison-history-browser.mjs", "scripts/check-report-download.mjs", ".next/BUILD_ID"]) {
    evidence.sourceHashes[path] = await sha256File(resolve(root, path));
  }
  if (evidence.cleanupErrors.length > 0 || evidence.preservedIdentities.length > 0) { evidence.status = "failed"; process.exitCode = 1; }
  if (evidence.status !== "passed") process.exitCode = 1;
  await writeFile(resolve(evidenceDir, "comparison-history-browser.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
