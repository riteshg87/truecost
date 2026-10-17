import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Attach to the already-running local development server. This script never
// starts Next, changes provider settings, or prints auth material.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "docs/evidence");
const baseUrl = "http://localhost:3337";
const staleSessionCheck = process.env.TRUECOST_EXPORT_STALE_SESSION_CHECK === "1";
const evidenceStem = staleSessionCheck ? "account-export-stale-session" : "account-export-browser";
const expectedIssuer = "live-tarpon-2666.clerk.accounts.dev";
const expectedConvexUrl = "https://dutiful-fly-37.convex.cloud";
const playwrightModulePath =
  process.env.TRUECOST_PLAYWRIGHT_MODULE ||
  "C:/Users/RajeshShinde/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const require = createRequire(import.meta.url);
const { chromium } = require(playwrightModulePath);
const playwrightPackage = JSON.parse(await readFile(resolve(playwrightModulePath, "package.json"), "utf8"));
const { setupClerkTestingToken } = await import("@clerk/testing/playwright");
const { ConvexHttpClient } = await import("convex/browser");
const { api: convexApi } = await import("../convex/_generated/api.js");

const evidence = {
  checkedAt: new Date().toISOString(),
  status: "pending",
  baseUrl,
  browser: null,
  checks: [],
  errors: [],
  cleanupErrors: [],
  diagnostics: [],
  logging: {
    clerkTestingDebug: false,
    lateTeardownWarningSuppression: "unavailable: @clerk/testing setup exposes no logger option; warnings remain visible",
  },
  authentication: {
    method: "Clerk email OTP through the supported development testing-token path",
    freshAuthentication: true,
    reVerification: {
      required: "unknown until the export button is exercised",
      modalObserved: false,
      completed: false,
      note: "Fresh sign-in is recorded separately from the export reverification modal. Fresh sign-in is never treated as later reverification."
    }
  },
  cleanup: "pending",
};
const checkpoint = () => {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(resolve(evidenceDir, `${evidenceStem}.json`), JSON.stringify(evidence, null, 2) + "\n");
};
const check = (name, details = {}) => {
  evidence.checks.push({ name, passed: true, details });
  checkpoint();
};
const scrub = (value) =>
  String(value)
    .replace(/__clerk_testing_token=[^&\s]+/gi, "__clerk_testing_token=[redacted]")
    .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-email]");
const escapeRegex = (value) => value.replace(/[.*+?^()|[\]\\]/g, "\\$&");
const sha256File = async (path) => {
  try { return createHash("sha256").update(await readFile(path)).digest("hex"); } catch { return null; }
};
const localEnv = await readFile(resolve(root, ".env.local"), "utf8").catch(() => "");
const readLocalEnv = (name) => {
  const line = localEnv.split(/\r?\n/).find((entry) => entry.startsWith(name + "="));
  return line ? line.slice(name.length + 1).trim() : (process.env[name] || "").trim();
};
const decodeClerkIssuer = (key) => {
  const encoded = key.replace(/^pk_test_/, "");
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encoded.length % 4)) % 4);
  try {
    const decoded = atob(padded);
    return decoded.endsWith("$") && decoded.indexOf("$") === decoded.length - 1 ? decoded.slice(0, -1) : null;
  } catch { return null; }
};
const publishableKey = readLocalEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
const secretKey = readLocalEnv("CLERK_SECRET_KEY");
const convexUrl = readLocalEnv("NEXT_PUBLIC_CONVEX_URL");
if (!/^pk_test_[A-Za-z0-9_-]+$/.test(publishableKey) ||
    !/^sk_test_[A-Za-z0-9_-]{16,256}$/.test(secretKey) ||
    decodeClerkIssuer(publishableKey) !== expectedIssuer ||
    convexUrl !== expectedConvexUrl) {
  throw new Error("development Clerk issuer or Convex target is not the approved local instance");
}
if (process.env.TRUECOST_EXPORT_BROWSER_BASE_URL &&
    process.env.TRUECOST_EXPORT_BROWSER_BASE_URL.trim() !== baseUrl) {
  throw new Error("account-export browser check only accepts http://localhost:3337");
}
check("development Clerk configuration matches the exact issuer and Convex deployment", {
  environment: "test", issuer: expectedIssuer, convexTarget: expectedConvexUrl,
});
evidence.sourceRevision = await (async () => {
  try {
    const { execFileSync } = await import("node:child_process");
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch { return "unavailable"; }
})();
evidence.sourceHashes = Object.fromEntries(await Promise.all([
  "app/account/page.tsx",
  "app/api/privacy/approval/route.ts",
  "convex/accountExports.ts",
  "convex/privacyApprovals.ts",
  "scripts/check-clerk-browser.mjs",
  "scripts/check-account-export-browser.mjs",
].map(async (path) => [path, await sha256File(resolve(root, path))])));

const testingToken = process.env.CLERK_TESTING_TOKEN || await (async () => {
  const response = await fetch("https://api.clerk.com/v1/testing_tokens", {
    method: "POST",
    headers: { Authorization: "Bearer " + secretKey, Accept: "application/json", "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("testing-token request returned HTTP " + response.status);
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload.token !== "string" || payload.token.length < 10) {
    throw new Error("testing-token response did not contain a token");
  }
  return payload.token;
})();
process.env.CLERK_TESTING_TOKEN = testingToken;
check("short-lived Clerk testing token obtained without recording its value");

const clerkApi = async (path, options = {}) => {
  const response = await fetch("https://api.clerk.com/v1" + path, {
    ...options,
    headers: { Authorization: "Bearer " + secretKey, Accept: "application/json", ...options.headers },
  });
  if (!response.ok) throw new Error("Clerk API request returned HTTP " + response.status);
  return response.json().catch(() => null);
};
const listRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) return payload.data;
  throw new Error("Clerk API response shape was invalid");
};
const sessionIdsFor = async (email) => {
  const users = listRows(await clerkApi("/users?email_address=" + encodeURIComponent(email) + "&limit=10"));
  const matches = users.filter((user) =>
    Array.isArray(user?.email_addresses) &&
    user.email_addresses.some((address) => address?.email_address === email));
  if (matches.length > 1) throw new Error("multiple exact synthetic email matches returned");
  const user = matches[0];
  if (!user || typeof user.id !== "string") return { userId: null, ids: new Set() };
  const sessions = listRows(await clerkApi("/sessions?user_id=" + encodeURIComponent(user.id) + "&limit=100"));
  return {
    userId: user.id,
    ids: new Set(sessions.filter((session) => session?.status === "active" && typeof session.id === "string").map((session) => session.id)),
  };
};
const revokeNewSessions = async (email, baseline) => {
  try {
    const current = await sessionIdsFor(email);
    const fresh = [...current.ids].filter((id) => !baseline.ids.has(id));
    for (const id of fresh) await clerkApi("/sessions/" + encodeURIComponent(id) + "/revoke", { method: "POST" });
    return fresh.length;
  } catch (error) {
    evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
    return null;
  }
};
const deleteDisposableUser = async (email, baseline) => {
  try {
    if (baseline.userId !== null) return { deleted: false, reason: "pre-existing user was never eligible for deletion" };
    const current = await sessionIdsFor(email);
    if (current.userId === null) return { deleted: false, reason: "signup did not create a user" };
    await clerkApi("/users/" + encodeURIComponent(current.userId), { method: "DELETE" });
    return { deleted: true };
  } catch (error) {
    evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
    return { deleted: false, reason: "disposable-user deletion failed" };
  }
};
const attachDiagnostics = (page, label) => {
  const value = { label, pageErrors: [], clerkResponses: [], clerkFailures: [] };
  page.on("pageerror", (error) => value.pageErrors.push(scrub(error.message)));
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.hostname === expectedIssuer && url.pathname.startsWith("/v1/")) {
        value.clerkResponses.push(response.request().method() + " " + url.pathname + " " + response.status());
      }
    } catch {}
  });
  page.on("requestfailed", (request) => {
    try {
      const url = new URL(request.url());
      if (url.hostname === expectedIssuer && url.pathname.startsWith("/v1/")) {
        value.clerkFailures.push(request.method() + " " + url.pathname + " " + (request.failure()?.errorText || "failed"));
      }
    } catch {}
  });
  return value;
};
const authenticate = async (page, email, label) => {
  const diagnostics = attachDiagnostics(page, label);
  await page.goto(baseUrl + "/signin", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded), undefined, { timeout: 45_000 });
  check(label + " Clerk SDK loaded before interaction");
  await page.locator("#signin-email").fill(email);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 20_000 });
  await page.locator("#signin-code").fill("111111");
  await page.getByText(/could not|incorrect|invalid|try again|failed/i).first().waitFor({ timeout: 8_000 });
  assert.equal(await page.locator("#signin-code").inputValue(), "", label + " invalid OTP was not cleared");
  check(label + " invalid OTP remained on verification with safe error");
  await page.locator("#signin-code").fill("424242");
  await page.waitForURL(/\/home(?:\?|$)/, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(globalThis.Clerk?.user && globalThis.Clerk?.session));
  check(label + " fresh email OTP authentication reached home");
  return diagnostics;
};
const convexClientForPage = async (page) => {
  const token = await page.evaluate(async () => {
    const session = globalThis.Clerk?.session;
    if (!session) return null;
    const direct = await session.getToken();
    if (typeof direct === "string") {
      try {
        const payload = direct.split(".")[1];
        const decoded = payload ? atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")) : "";
        if (JSON.parse(decoded)?.aud === "convex") return direct;
      } catch {}
    }
    return session.getToken({ template: "convex" });
  });
  if (typeof token !== "string" || token.length < 32) throw new Error("verified Convex token was unavailable");
  return new ConvexHttpClient(expectedConvexUrl, { auth: token, logger: false });
};
const listComparisons = async (page) => {
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const client = await convexClientForPage(page);
      return { client, rows: await queryComparisons(client) };
    } catch (error) {
      lastError = error;
      if (!/Unauthorized/i.test(error instanceof Error ? error.message : String(error))) throw error;
      // Clerk can expose a fresh session before Convex has observed the
      // matching profile. Poll the existing session rather than starting a
      // second auth flow, which also avoids adding provider rate-limit load.
      await page.waitForTimeout(500);
    }
  }
  throw lastError || new Error("authenticated comparison list was not acknowledged");
};
const queryComparisons = async (client) => {
  const result = await client.query(convexApi.comparisons.listComparisons, { paginationOpts: { numItems: 50, cursor: null } });
  if (!result || result.status !== "ok" || !Array.isArray(result.result?.page)) throw new Error("authenticated comparison list was not acknowledged");
  return result.result.page;
};
const getComparison = async (client, comparisonId) => {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return { status: "visible-or-hidden", value: await client.query(convexApi.comparisons.getComparison, { comparisonId }) };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/Unauthorized/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  // The query authenticates the caller before applying the owner filter. A
  // foreign ID may therefore be hidden as null or rejected as Unauthorized,
  // and both outcomes prove that account B cannot read account A's row.
  if (/Unauthorized/i.test(lastError instanceof Error ? lastError.message : String(lastError))) return { status: "unauthorized", value: null };
  throw lastError || new Error("foreign comparison lookup failed");
};
const comparisonCleanup = { requested: 0, deleted: 0, alreadyGone: 0, remaining: null };
const cleanupComparisons = async (client, resultIds, { allowAlreadyGone = false } = {}) => {
  if (resultIds.size === 0) return;
  comparisonCleanup.requested = resultIds.size;
  const rows = await queryComparisons(client);
  const targets = rows.filter((row) => resultIds.has(row.resultId));
  if (!allowAlreadyGone) {
    assert.equal(targets.length, resultIds.size, "cleanup could not find every comparison created by this run");
  }
  let deletedCount = 0;
  for (const row of targets) {
    const deleted = await client.mutation(convexApi.comparisons.deleteComparison, {
      requestId: randomUUID(), resultId: row.resultId, createdAt: new Date().toISOString(),
    });
    if (!deleted || (deleted.status !== "deleted" && deleted.status !== "replayed")) throw new Error("comparison cleanup was not acknowledged");
    deletedCount += 1;
  }
  const after = await queryComparisons(client);
  const remaining = after.filter((row) => resultIds.has(row.resultId));
  assert.equal(remaining.length, 0, "cleanup left a comparison created by this run on the server");
  comparisonCleanup.deleted += deletedCount;
  comparisonCleanup.alreadyGone = resultIds.size - targets.length;
  comparisonCleanup.remaining = remaining.length;
  check("cleanup removed only comparisons created by this run", {
    count: deletedCount, alreadyGone: resultIds.size - targets.length, remaining: remaining.length,
  });
};
const fillComparison = async (page, marker) => {
  await page.goto(baseUrl + "/compare", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 30_000 });
  const fillOffer = async (index, lender, amount, rate) => {
    await page.getByLabel("Lender name for offer " + index, { exact: true }).fill(lender);
    await page.getByLabel("Loan amount for offer " + index, { exact: true }).fill(String(amount));
    await page.getByLabel("Interest rate for offer " + index, { exact: true }).fill(String(rate));
    await page.getByLabel("Tenure for offer " + index, { exact: true }).fill("10");
  };
  await fillOffer(1, marker + " A", 1_000_000, 8.5);
  await fillOffer(2, marker + " B", 1_000_000, 8.9);
  await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
  await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 25_000 });
  await page.getByRole("table").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Save comparison", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved to your account." }).waitFor({ timeout: 30_000 });
  check("UI-created synthetic comparison received a server save acknowledgement");
};
const requestUnauthorizedApproval = async (page) => {
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/privacy/approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "account_export" }),
    });
    return { status: result.status };
  });
  assert.equal(response.status, 401, "signed-out approval must be rejected as unauthenticated");
  check("signed-out account export approval was rejected before any grant", response);
};
const exportThroughUi = async (page) => {
  await page.goto(baseUrl + "/account", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Account", exact: true }).waitFor({ timeout: 30_000 });
  const button = page.getByRole("button", { name: "Download my data", exact: true });
  await button.waitFor({ timeout: 30_000 });
  const modal = page.locator(".cl-userVerification-root").first();
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 })
    .then((download) => ({ kind: "download", download }))
    .catch((error) => ({ kind: "download-error", error }));
  const modalPromise = modal.waitFor({ state: "visible", timeout: 60_000 })
    .then(() => ({ kind: "modal" }))
    .catch(() => ({ kind: "modal-timeout" }));
  await button.click();
  const first = await Promise.race([downloadPromise, modalPromise]);
  if (first.kind === "modal") {
    evidence.authentication.reVerification.required = true;
    evidence.authentication.reVerification.modalObserved = true;
    check("export opened Clerk's actual reverification modal");
    const { createPageObjects } = await import("@clerk/testing/playwright/unstable");
    const objects = createPageObjects({ page, useTestingToken: true, baseURL: baseUrl });
    await objects.userVerification.enterTestOtpCode();
    await objects.userVerification.waitForClosed();
    evidence.authentication.reVerification.completed = true;
    check("Clerk reverification modal completed with the supported test OTP");
  }
  if (first.kind === "download-error" || first.kind === "modal-timeout") {
    throw first.error || new Error("export produced neither a download nor a reverification modal");
  }
  if (first.kind === "download") {
    assert.equal(staleSessionCheck, false, "aged session downloaded without the expected reverification challenge");
    // The download path means the live Clerk policy did not request a modal
    // for this freshly authenticated session. Keep that observation separate
    // from the fresh sign-in check instead of implying reverification ran.
    evidence.authentication.reVerification.required = false;
    check("export downloaded without a reverification modal after fresh sign-in");
    return first.download;
  }
  const result = await downloadPromise;
  if (result.kind !== "download") throw result.error;
  return result.download;
};
const saveExportSummary = async (download, marker) => {
  const artifact = resolve(evidenceDir, `${evidenceStem}-download.json`);
  await mkdir(evidenceDir, { recursive: true });
  await download.saveAs(artifact);
  const raw = await readFile(artifact, "utf8");
  const payload = JSON.parse(raw);
  assert.equal(payload.version, 1);
  assert.deepEqual(payload.dataScope, ["comparisons", "savedLoan", "feedback", "feedbackDismissals"]);
  assert.ok(Array.isArray(payload.comparisons) && payload.comparisons.length > 0, "export did not contain the UI-created comparison");
  const markerFound = payload.comparisons.some((entry) => {
    try {
      const snapshot = JSON.parse(entry.snapshot);
      return snapshot.offers?.some((offer) => typeof offer?.lender === "string" && offer.lender.startsWith(marker));
    } catch { return false; }
  });
  assert.equal(markerFound, true, "export did not contain the synthetic comparison marker");
  const summary = {
    artifact: `docs/evidence/${evidenceStem}-download.json`,
    bytes: Buffer.byteLength(raw), version: payload.version, dataScope: payload.dataScope,
    comparisons: payload.comparisons.length, hasSavedLoan: payload.savedLoan !== null,
    feedback: Array.isArray(payload.feedback) ? payload.feedback.length : null,
    feedbackDismissals: Array.isArray(payload.feedbackDismissals) ? payload.feedbackDismissals.length : null,
    containsSyntheticComparison: markerFound,
  };
  evidence.export = summary;
  check("account export download was nonempty and contained the scoped synthetic comparison", {
    artifact: summary.artifact, bytes: summary.bytes, dataScope: summary.dataScope,
    counts: { comparisons: summary.comparisons, feedback: summary.feedback, feedbackDismissals: summary.feedbackDismissals, hasSavedLoan: summary.hasSavedLoan },
  });
};

const emailA = "truecost-export-" + randomUUID() + "+clerk_test@example.com";
const emailB = "truecost-export-" + randomUUID() + "+clerk_test@example.com";
// Synthetic UUID suffixes permit narrowly scoped recovery after interruption.
// Do not record credentials, tokens, signed proofs or actual user addresses.
evidence.syntheticAccountSuffixes = [emailA, emailB].map((email) => email.slice("truecost-export-".length, email.indexOf("+")));
checkpoint();
const marker = "Export browser " + randomUUID();
const baselineA = await sessionIdsFor(emailA);
const baselineB = await sessionIdsFor(emailB);
assert.equal(baselineA.userId, null, "generated export account A unexpectedly exists");
assert.equal(baselineB.userId, null, "generated export account B unexpectedly exists");
let browser;
let context;
let page;
const createdResultIds = new Set();
const createdComparisonIds = new Set();
let accountAClient;
let comparisonsCleaned = false;
try {
  const response = await fetch(baseUrl + "/signin", { redirect: "manual" });
  if (response.status < 200 || response.status >= 500) throw new Error("localhost:3337 returned HTTP " + response.status);
  browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = { name: "Chrome", playwright: playwrightPackage.version, engine: browser.version() };
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
  await setupClerkTestingToken({ context, options: { frontendApiUrl: expectedIssuer } });
  page = await context.newPage();
  await authenticate(page, emailA, "export account A");
  await fillComparison(page, marker);
  const beforeExport = await listComparisons(page);
  accountAClient = beforeExport.client;
  for (const row of beforeExport.rows) {
    try {
      const snapshot = JSON.parse(row.snapshot);
      if (snapshot.offers?.some((offer) => typeof offer?.lender === "string" && offer.lender.startsWith(marker))) {
        createdResultIds.add(row.resultId);
        createdComparisonIds.add(row._id);
      }
    } catch {}
  }
  assert.ok(createdResultIds.size > 0, "UI save did not produce a discoverable synthetic comparison");
  assert.equal(createdComparisonIds.size, createdResultIds.size, "saved comparison view omitted an id required for the account-switch check");
  if (staleSessionCheck) {
    // Age the real session past Clerk's ten-minute strict window. Never alter
    // the browser clock, JWT claims, or provider policy to simulate recency.
    const started = Date.now();
    console.log("Waiting eleven real minutes for the development session to age.");
    for (let interval = 0; interval < 22; interval++) {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    evidence.authentication.realElapsedBeforeExportMs = Date.now() - started;
    check("session aged beyond the strict window without clock or token alteration", {
      elapsedMs: evidence.authentication.realElapsedBeforeExportMs,
    });
  }
  await saveExportSummary(await exportThroughUi(page), marker);
  await page.evaluate(() => globalThis.Clerk?.signOut());
  await page.waitForFunction(() => !globalThis.Clerk?.user, undefined, { timeout: 20_000 });
  await requestUnauthorizedApproval(page);
  await authenticate(page, emailB, "export account B");
  await page.goto(baseUrl + "/comparisons", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(globalThis.Clerk?.user && globalThis.Clerk?.session), undefined, { timeout: 20_000 });
  const accountBComparisons = await listComparisons(page);
  assert.equal(accountBComparisons.rows.length, 0, "disposable account B unexpectedly had persisted comparisons");
  const foreignIdResults = [];
  for (const comparisonId of createdComparisonIds) {
    const result = await getComparison(accountBComparisons.client, comparisonId);
    assert.equal(result.value, null, "account B could read account A's comparison by id");
    foreignIdResults.push(result.status);
  }
  const accountBText = await page.locator("body").innerText();
  assert.doesNotMatch(accountBText, new RegExp(escapeRegex(marker)), "account B displayed account A's synthetic comparison");
  const accountBMarkerRows = accountBComparisons.rows.filter((row) => {
    try {
      const snapshot = JSON.parse(row.snapshot);
      return snapshot.offers?.some((offer) => typeof offer?.lender === "string" && offer.lender.startsWith(marker));
    } catch { return false; }
  });
  assert.equal(accountBMarkerRows.length, 0, "account B server list contained account A's synthetic comparison");
  check("same-browser account switch to B did not expose account A's comparison", {
    accountBServerRows: accountBComparisons.rows.length,
    directIdChecks: createdComparisonIds.size,
    foreignIdResults,
  });
  // Keep A's row present through the B query. Reuse A's client while its
  // short-lived JWT is still valid; only perform another auth flow if the
  // cleanup query proves that token has expired.
  try {
    await cleanupComparisons(accountAClient, createdResultIds);
  } catch (error) {
    if (!/Unauthorized/i.test(error instanceof Error ? error.message : String(error))) throw error;
    await page.evaluate(() => globalThis.Clerk?.signOut());
    await page.waitForFunction(() => !globalThis.Clerk?.user, undefined, { timeout: 20_000 });
    await authenticate(page, emailA, "export cleanup account A");
    const freshA = await listComparisons(page);
    accountAClient = freshA.client;
    await cleanupComparisons(accountAClient, createdResultIds);
  }
  comparisonsCleaned = true;
  await page.evaluate(() => globalThis.Clerk?.signOut());
  await page.waitForFunction(() => !globalThis.Clerk?.user, undefined, { timeout: 20_000 });
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(scrub(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  try {
    if (!comparisonsCleaned && accountAClient && createdResultIds.size > 0) {
      // Reuse the original A client first. Reauthenticate only when Convex
      // proves that token has expired, which avoids an unnecessary Clerk
      // request during failure cleanup and makes rate limits observable.
      try {
        await cleanupComparisons(accountAClient, createdResultIds, { allowAlreadyGone: true });
      } catch (error) {
        if (!/Unauthorized/i.test(error instanceof Error ? error.message : String(error))) throw error;
        if (page) {
          await page.evaluate(() => globalThis.Clerk?.signOut()).catch(() => {});
          await page.waitForFunction(() => !globalThis.Clerk?.user, undefined, { timeout: 20_000 }).catch(() => {});
          await authenticate(page, emailA, "failure cleanup account A");
          accountAClient = (await listComparisons(page)).client;
        }
        await cleanupComparisons(accountAClient, createdResultIds, { allowAlreadyGone: true });
      }
    }
  } catch (error) {
    evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
  }
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  const revokedA = await revokeNewSessions(emailA, baselineA);
  const revokedB = await revokeNewSessions(emailB, baselineB);
  const removedA = await deleteDisposableUser(emailA, baselineA);
  const removedB = await deleteDisposableUser(emailB, baselineB);
  evidence.cleanup = {
    browserClosed: true,
    convex: {
      comparisons: {
        requested: comparisonCleanup.requested,
        deleted: comparisonCleanup.deleted,
        alreadyGone: comparisonCleanup.alreadyGone,
        remaining: comparisonCleanup.remaining,
      },
      profile: {
        deleted: false,
        verified: false,
        note: "Convex users/profile rows were not queried or deleted by this browser verifier.",
      },
      receipts: {
        deleted: false,
        verified: false,
        note: "Operation/comparison receipts and tombstones were not queried or deleted by this browser verifier.",
      },
      exportMetadata: {
        deleted: false,
        verified: false,
        note: "Export sessions and sensitive grants were not queried or deleted by this browser verifier; backend expiry/purge remains separate.",
      },
    },
    accountA: { revokedSessions: revokedA, user: removedA },
    accountB: { revokedSessions: revokedB, user: removedB },
  };
  if (evidence.cleanupErrors.length > 0) {
    evidence.status = "failed";
    evidence.errors.push("cleanup failed for " + evidence.cleanupErrors.length + " item(s)");
    process.exitCode = 1;
  }
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, `${evidenceStem}.json`), JSON.stringify(evidence, null, 2) + "\n");
}
console.log(JSON.stringify(evidence, null, 2));
