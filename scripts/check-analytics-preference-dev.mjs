import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
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
const sha256File = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const localEnv = await readFile(resolve(root, ".env.local"), "utf8");
const envValue = (name) => localEnv.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim() || "";
const publishableKey = envValue("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
const secretKey = envValue("CLERK_SECRET_KEY");
const convexUrl = envValue("NEXT_PUBLIC_CONVEX_URL");
const convexDeployment = envValue("CONVEX_DEPLOYMENT");
const expectedIssuer = "live-tarpon-2666.clerk.accounts.dev";
const expectedConvexUrl = "https://dutiful-fly-37.convex.cloud";
const expectedBuildId = process.env.TRUECOST_ANALYTICS_EXPECTED_BUILD_ID || "";
const buildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim();
const port = Number(process.env.TRUECOST_ANALYTICS_BROWSER_PORT || 0);
assert.ok(port > 0, "TRUECOST_ANALYTICS_BROWSER_PORT must be an explicitly owned free port");
assert.ok(expectedBuildId, "TRUECOST_ANALYTICS_EXPECTED_BUILD_ID must be supplied by the reviewed build owner");
assert.equal(buildId, expectedBuildId, "built artifact is not the reviewed analytics target");
assert.match(publishableKey, /^pk_test_[A-Za-z0-9_-]+$/);
assert.match(secretKey, /^sk_test_[A-Za-z0-9_-]{16,256}$/);
assert.equal(convexUrl, expectedConvexUrl);
assert.equal(convexDeployment, "dev:dutiful-fly-37");
const decodeIssuer = (key) => {
  const encoded = key.replace(/^pk_test_/, "");
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - encoded.length % 4) % 4);
  const decoded = atob(padded);
  return decoded.endsWith("$") ? decoded.slice(0, -1) : null;
};
assert.equal(decodeIssuer(publishableKey), expectedIssuer);

const evidence = {
  checkedAt: new Date().toISOString(),
  status: "pending",
  buildId,
  sourceRevision: "unknown",
  deployment: { environment: "development", deployment: convexDeployment, convexUrl: expectedConvexUrl, clerkIssuer: expectedIssuer },
  browser: null,
  baseUrl: null,
  checks: [],
  errors: [],
  cleanupErrors: [],
  preservedIdentities: [],
  retainedSyntheticRows: [],
  limits: [
    "Convex has no reviewed public preference/profile deletion operation; cleanup withdraws consent, deletes only the disposable Clerk users, and records retained Convex owner references.",
    "No client token, secret, email, or raw provider error is written to evidence.",
  ],
};
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
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
const clerkUserFor = async (email) => {
  const users = rows(await clerkApi(`/users?email_address=${encodeURIComponent(email)}&limit=10`), "users");
  const matches = users.filter((user) => user?.email_addresses?.some((address) => address?.email_address === email));
  if (matches.length > 1) throw new Error("Clerk returned multiple exact synthetic email matches");
  return typeof matches[0]?.id === "string" ? matches[0].id : null;
};
const sessionIdsFor = async (email) => {
  const userId = await clerkUserFor(email);
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
  const userId = await clerkUserFor(email);
  if (!userId) return { deleted: false, reason: "signup did not create a user" };
  await clerkApi(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  return { deleted: true, userId };
};

const { setupClerkTestingToken } = await import("@clerk/testing/playwright");
const testingToken = process.env.CLERK_TESTING_TOKEN || (await (async () => {
  const response = await fetch("https://api.clerk.com/v1/testing_tokens", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json", "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`testing-token request returned HTTP ${response.status}`);
  const payload = await response.json().catch(() => null);
  if (typeof payload?.token !== "string" || payload.token.length < 10) throw new Error("testing-token response did not contain a token");
  return payload.token;
})());
process.env.CLERK_TESTING_TOKEN = testingToken;
check("approved development target and reviewed build matched");
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
    try {
      const templateToken = await session.getToken({ template: "convex" });
      return typeof templateToken === "string" ? templateToken : null;
    } catch {
      return null;
    }
  });
  if (typeof token !== "string" || token.length < 32) {
    const diagnostics = await page.evaluate(async () => {
      const session = globalThis.Clerk?.session;
      const result = { hasSession: Boolean(session), defaultLength: 0, defaultAudience: null, templateLength: 0, templateError: null };
      if (!session) return result;
      try {
        const defaultToken = await session.getToken();
        result.defaultLength = typeof defaultToken === "string" ? defaultToken.length : 0;
        if (typeof defaultToken === "string") {
          const payload = defaultToken.split(".")[1];
          const decoded = payload ? atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")) : "";
          result.defaultAudience = JSON.parse(decoded)?.aud || null;
        }
      } catch (error) { result.templateError = `default:${String(error).slice(0, 120)}`; }
      try {
        const templateToken = await session.getToken({ template: "convex" });
        result.templateLength = typeof templateToken === "string" ? templateToken.length : 0;
      } catch (error) { result.templateError = `${result.templateError || ""} template:${String(error).slice(0, 120)}`.trim(); }
      return result;
    }).catch(() => ({ hasSession: false, defaultLength: 0, defaultAudience: null, templateLength: 0, templateError: "diagnostic-evaluation-failed" }));
    throw new Error(`verified Convex token was unavailable: ${JSON.stringify(diagnostics)}`);
  }
  return new ConvexHttpClient(expectedConvexUrl, { auth: token, logger: false });
};
const signInMember = async (context, email, label) => {
  const page = await context.newPage();
  await page.goto(`${evidence.baseUrl}/signin`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded), undefined, { timeout: 45_000 });
  await page.locator("#signin-email").fill(email);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 20_000 });
  await page.locator("#signin-code").fill("424242");
  await page.waitForURL(/\/home(?:\?|$)/, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded && globalThis.Clerk?.session), undefined, { timeout: 30_000 });
  check(`${label} disposable member reached the authenticated route`);
  return page;
};
const ownedAccount = async (account) => {
  const page = await signInMember(account.context, account.email, account.label);
  account.page = page;
  account.client = await convexClientForPage(page);
  const clerkUserId = await clerkUserFor(account.email);
  if (!clerkUserId) throw new Error(`${account.label} Clerk user was not visible after sign-in`);
  account.clerkUserId = clerkUserId;
  const profile = await account.client.mutation(api.users.ensureCurrentUser, {});
  account.ownerId = profile._id;
  account.safeToDelete = true;
  return account;
};

let nextProcess;
let browser;
const contexts = [];
const accounts = [];
try {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => { probe.once("error", reject); probe.listen(port, "localhost", resolvePromise); });
  await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
  nextProcess = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", "-H", "localhost", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "ignore",
  });
  evidence.baseUrl = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${evidence.baseUrl}/signin`, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) break;
    } catch { /* Starting. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = { name: "Chrome", playwright: playwrightPackage.version, engine: browser.version() };
  for (const label of ["a", "b"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
    await setupClerkTestingToken({ context, options: { frontendApiUrl: expectedIssuer } });
    contexts.push(context);
    const email = `tc-analytics-${randomUUID()}+clerk_test@example.com`;
    assert.ok(email.split("@", 1)[0].length <= 64, "analytics email local-part exceeds RFC 5321 limit");
    const baseline = await sessionIdsFor(email);
    assert.equal(baseline.userId, null, "generated disposable address unexpectedly exists");
    // Register the account before awaiting sign-in so a partial signup remains
    // cleanup-visible if navigation or provisioning fails.
    accounts.push({ label, email, baseline, context, page: null, client: null, ownerId: null, analyticsAccountId: null, safeToDelete: false });
    const account = accounts.at(-1);
    await ownedAccount(account);
  }

  const accountA = accounts[0];
  const accountB = accounts[1];
  const unknownA = await accountA.client.query(api.analytics.getPreference, {});
  assert.deepEqual(unknownA, { consent: "unknown", policyVersion: "v1", revision: 0, analyticsAccountId: null, sendPermission: false });
  check("account A default preference is unknown with no identifier or send permission");
  const declinedA = await accountA.client.mutation(api.analytics.setPreference, { consent: "declined", policyVersion: "v1", expectedRevision: 0 });
  assert.deepEqual(declinedA, { consent: "declined", policyVersion: "v1", revision: 1, analyticsAccountId: null, sendPermission: false });
  check("account A explicit decline stores no identifier and grants no send permission");

  const acceptedA = await accountA.client.mutation(api.analytics.setPreference, { consent: "accepted", policyVersion: "v1", expectedRevision: declinedA.revision });
  assert.match(acceptedA.analyticsAccountId || "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(acceptedA.sendPermission, true);
  accountA.analyticsAccountId = acceptedA.analyticsAccountId;
  check("account A affirmative mutation created a server UUID and send permission");
  const repeatA = await accountA.client.mutation(api.analytics.setPreference, { consent: "accepted", policyVersion: "v1", expectedRevision: acceptedA.revision });
  assert.equal(repeatA.analyticsAccountId, acceptedA.analyticsAccountId);
  check("repeated affirmative consent kept the same server UUID");

  const acceptedB = await accountB.client.mutation(api.analytics.setPreference, { consent: "accepted", policyVersion: "v1", expectedRevision: 0 });
  assert.match(acceptedB.analyticsAccountId || "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(acceptedA.analyticsAccountId, acceptedB.analyticsAccountId);
  accountB.analyticsAccountId = acceptedB.analyticsAccountId;
  check("two disposable accounts received distinct server UUIDs");

  const forged = await accountA.client.query(api.analytics.getPreference, { ownerId: accountB.ownerId, analyticsAccountId: accountB.analyticsAccountId }).then(() => false).catch(() => true);
  assert.equal(forged, true);
  check("forged owner or identifier arguments were rejected by the public validator");

  const beforeConcurrent = await accountA.client.query(api.analytics.getPreference, {});
  const secondClient = await convexClientForPage(accountA.page);
  const concurrent = await Promise.allSettled([
    accountA.client.mutation(api.analytics.setPreference, { consent: "accepted", policyVersion: "v1", expectedRevision: beforeConcurrent.revision }),
    secondClient.mutation(api.analytics.setPreference, { consent: "declined", policyVersion: "v1", expectedRevision: beforeConcurrent.revision }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const afterConcurrent = await accountA.client.query(api.analytics.getPreference, {});
  assert.equal(afterConcurrent.revision, beforeConcurrent.revision + 1);
  check("concurrent same-revision writes committed one result and rejected the stale writer");

  const withdrawnA = await accountA.client.mutation(api.analytics.setPreference, { consent: "declined", policyVersion: "v1", expectedRevision: afterConcurrent.revision });
  assert.equal(withdrawnA.analyticsAccountId, null);
  assert.equal(withdrawnA.sendPermission, false);
  const hiddenA = await accountA.client.query(api.analytics.getPreference, {});
  assert.equal(hiddenA.analyticsAccountId, null);
  assert.equal(hiddenA.sendPermission, false);
  check("withdrawal hid the retained server ID and removed send permission");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(scrub(error instanceof Error ? error.message : String(error)));
} finally {
  for (const account of accounts) {
    try {
      if (account.client && account.ownerId) {
        const current = await account.client.query(api.analytics.getPreference, {});
        if (current.consent === "accepted") {
          await account.client.mutation(api.analytics.setPreference, { consent: "declined", policyVersion: "v1", expectedRevision: current.revision });
        }
        evidence.retainedSyntheticRows.push({ account: account.label, convexOwnerId: account.ownerId, analyticsAccountId: account.analyticsAccountId, reason: "preference retained; no supported public Convex deletion operation" });
      }
      if (account.baseline && account.email && account.safeToDelete) {
        const revoked = await revokeNewSessions(account.email, account.baseline);
        const removed = await deleteDisposableUser(account.email, account.baseline);
        check(`${account.label} cleanup revoked sessions and deleted its disposable Clerk identity`, { revoked, deleted: removed.deleted });
      } else if (account.email && account.clerkUserId) {
        evidence.preservedIdentities.push({ account: account.label, userId: account.clerkUserId, convexOwnerId: account.ownerId, analyticsAccountId: account.analyticsAccountId, reason: "cleanup safety condition was not met" });
      }
    } catch (error) {
      evidence.cleanupErrors.push(`${account.label}: ${scrub(error instanceof Error ? error.message : String(error))}`);
      evidence.preservedIdentities.push({ account: account.label, userId: account.clerkUserId || null, convexOwnerId: account.ownerId, analyticsAccountId: account.analyticsAccountId, reason: "cleanup failed; identity retained" });
    }
  }
  await Promise.all(contexts.map((context) => context.close().catch(() => {})));
  await browser?.close().catch(() => {});
  if (nextProcess && nextProcess.exitCode === null) nextProcess.kill("SIGTERM");
  evidence.sourceHashes = {};
  for (const path of ["convex/analytics.ts", "convex/schema.ts", "convex/_generated/api.d.ts", ".next/BUILD_ID"]) evidence.sourceHashes[path] = await sha256File(resolve(root, path));
  evidence.scriptSha256 = await sha256File(fileURLToPath(import.meta.url));
  if (evidence.cleanupErrors.length > 0 || evidence.preservedIdentities.length > 0) { evidence.status = "failed"; process.exitCode = 1; }
  await writeFile(resolve(evidenceDir, "analytics-preference-dev.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(JSON.stringify(evidence, null, 2));
