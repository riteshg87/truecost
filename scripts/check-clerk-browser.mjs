import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// This is an isolated development check. It uses fresh Playwright contexts and
// never writes storageState or prints a Clerk key, testing token, or response.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "docs/evidence");
await mkdir(evidenceDir, { recursive: true });
const require = createRequire(import.meta.url);
const playwrightModulePath =
  process.env.TRUECOST_PLAYWRIGHT_MODULE ||
  "C:/Users/RajeshShinde/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(playwrightModulePath);
const playwrightPackage = JSON.parse(await readFile(resolve(playwrightModulePath, "package.json"), "utf8"));
const evidence = {
  checkedAt: new Date().toISOString(),
  sourceRevision: "unknown",
  browser: null,
  baseUrl: null,
  checks: [],
  errors: [],
  cleanupErrors: [],
  diagnostics: [],
  suppressedWarnings: 0,
  cleanup: "pending",
};
const mvpDemoEnabled = process.env.TRUECOST_MVP_DEMO_CHECK === "1";
const mvpRecordVideoEnabled = process.env.TRUECOST_MVP_RECORD_VIDEO === "1";
const loanCheckEnabled = process.env.TRUECOST_BROWSER_LOAN_CHECK === "1";
const comparisonCheckEnabled = process.env.TRUECOST_BROWSER_COMPARISON_CHECK === "1" || mvpDemoEnabled;
const legacyAdoptionCheckEnabled = process.env.TRUECOST_BROWSER_LEGACY_ADOPTION_CHECK === "1";
const hostedReviewEnabled = process.env.TRUECOST_CLERK_BROWSER_HOSTED === "1";
const shortComparisonCheck = mvpDemoEnabled || hostedReviewEnabled;
const hostedBaseUrl = "https://truecost-ebon.vercel.app";
const hostedDeploymentId = process.env.TRUECOST_CLERK_BROWSER_DEPLOYMENT_ID?.trim() || "";
const recordingHoldMs = 8_000;
if (hostedReviewEnabled && !/^dpl_[A-Za-z0-9_-]+$/.test(hostedDeploymentId)) {
  throw new Error("hosted review requires TRUECOST_CLERK_BROWSER_DEPLOYMENT_ID in Vercel deployment ID format");
}
if (hostedReviewEnabled && mvpDemoEnabled) {
  throw new Error("hosted review cannot use the local MVP demo build check");
}
evidence.options = { loanCheckEnabled, comparisonCheckEnabled, legacyAdoptionCheckEnabled, mvpDemoEnabled, mvpRecordVideoEnabled, hostedReviewEnabled };
if (hostedReviewEnabled) {
  evidence.hosted = { origin: hostedBaseUrl, deploymentId: hostedDeploymentId };
  evidence.baseUrl = hostedBaseUrl;
}
if (mvpRecordVideoEnabled && !mvpDemoEnabled && !hostedReviewEnabled) {
  throw new Error("TRUECOST_MVP_RECORD_VIDEO requires TRUECOST_MVP_DEMO_CHECK=1 or hosted review mode");
}

// Keep the previous smoke artifact reviewable before an opt-in comparison run
// writes the stable filename again. Existing dated archives are untouched.
const archivePreviousSmokeEvidence = async () => {
  if (!comparisonCheckEnabled || hostedReviewEnabled) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const names = await readdir(evidenceDir).catch(() => []);
  for (const name of names.filter((entry) =>
    (entry === "clerk-browser-smoke.json" || entry === "clerk-browser-mvp-demo.json" || /^clerk-browser-.*\.png$/.test(entry)) && !entry.includes("-pre-comparison-"))) {
    await copyFile(resolve(evidenceDir, name), resolve(evidenceDir, name.replace(/(\.[^.]+)$/, `-pre-comparison-${stamp}$1`))).catch(() => {});
  }
};
await archivePreviousSmokeEvidence();

const scrub = (value) =>
  String(value)
    .replace(/__clerk_testing_token=[^&\s]+/gi, "__clerk_testing_token=[redacted]")
    .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+/g, "[redacted-key]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-email]");
const check = (name, details = {}) => evidence.checks.push({ name, passed: true, details });
const installRecordingMask = async (page) => {
  if (!mvpRecordVideoEnabled) return false;
  await page.addInitScript(() => {
    const install = () => {
      if (document.getElementById("truecost-recording-mask")) return;
      const style = document.createElement("style");
      style.id = "truecost-recording-mask";
      style.textContent = `
        #signin-email,
        #signin-code {
          -webkit-text-security: disc !important;
          text-security: disc !important;
        }
      `;
      const parent = document.head || document.documentElement;
      if (!parent) return;
      parent.appendChild(style);
    };
    install();
    if (document.documentElement) {
      new MutationObserver(install).observe(document.documentElement, { childList: true });
    } else {
      document.addEventListener("DOMContentLoaded", install, { once: true });
    }
  });
  return true;
};
const sha256File = async (path) => {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
};
const localEnv = await readFile(resolve(root, ".env.local"), "utf8").catch(() => "");
const readLocalEnv = (name) => {
  const line = localEnv.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || "";
};
if (mvpDemoEnabled) {
  const expectedMvpBuildId = process.env.TRUECOST_MVP_DEMO_BUILD_ID?.trim() || "";
  const actualMvpBuildId = (await readFile(resolve(root, ".next/BUILD_ID"), "utf8")).trim();
  if (!expectedMvpBuildId || actualMvpBuildId !== expectedMvpBuildId) {
    throw new Error("MVP demo requires TRUECOST_MVP_DEMO_BUILD_ID to match the built artifact exactly");
  }
  evidence.buildId = actualMvpBuildId;
  check("MVP demo build ID matches the explicitly approved artifact", { buildId: actualMvpBuildId });
}

const publishableKey = readLocalEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
const secretKey = readLocalEnv("CLERK_SECRET_KEY");
const convexUrl = readLocalEnv("NEXT_PUBLIC_CONVEX_URL");
const expectedIssuer = "live-tarpon-2666.clerk.accounts.dev";
const expectedConvexUrl = "https://dutiful-fly-37.convex.cloud";
const decodeClerkIssuer = (key) => {
  const encoded = key.replace(/^pk_test_/, "");
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encoded.length % 4)) % 4);
  const decoded = atob(padded);
  return decoded.endsWith("$") && decoded.indexOf("$") === decoded.length - 1 ? decoded.slice(0, -1) : null;
};
const issuer = /^pk_test_[A-Za-z0-9_-]+$/.test(publishableKey) ? decodeClerkIssuer(publishableKey) : null;
if (!/^pk_test_[A-Za-z0-9_-]+$/.test(publishableKey) || !/^sk_test_[A-Za-z0-9_-]{16,256}$/.test(secretKey)) {
  throw new Error("development Clerk test key configuration is missing or malformed");
}
if (issuer !== expectedIssuer || convexUrl !== expectedConvexUrl) {
  throw new Error("development Clerk issuer or Convex target is not the approved local instance");
}
check("development Clerk key configuration is present and environment-matched", {
  environment: "test",
  issuer: expectedIssuer,
  convexTarget: expectedConvexUrl,
});

try {
  evidence.sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
} catch {
  evidence.sourceRevision = "unavailable";
}
const sourcePaths = [
  "lib/auth/provider.tsx",
  "lib/auth/config.ts",
  "lib/auth/server-config.ts",
  "lib/auth/requests.ts",
  "app/signin/page.tsx",
  "app/verify/page.tsx",
  "lib/store.tsx",
  "lib/guest/handoff.ts",
  "lib/contracts/auth-intent.ts",
  "lib/contracts/snapshot.ts",
  "lib/loanStore.tsx",
  "lib/legacy-device-loan.ts",
  "components/LegacyDeviceLoanAdoption.tsx",
  "components/ComparisonStatus.tsx",
  "components/OfferGrid.tsx",
  "app/compare/page.tsx",
  "app/compare/results/page.tsx",
  "convex/comparisons.ts",
];
if (!hostedReviewEnabled) {
  sourcePaths.push(".next/BUILD_ID");
  const builtChunkNames = await readdir(resolve(root, ".next/static/chunks")).catch(() => []);
  for (const name of builtChunkNames.filter((entry) => entry.endsWith(".js"))) {
    const path = resolve(root, ".next/static/chunks", name);
    const content = await readFile(path, "utf8").catch(() => "");
    if (content.includes("dutiful-fly-37.convex.cloud")) sourcePaths.push(`.next/static/chunks/${name}`);
  }
}
evidence.sourceHashes = Object.fromEntries(
  await Promise.all(sourcePaths.map(async (path) => [path, await sha256File(resolve(root, path))])),
);

const testingToken = process.env.CLERK_TESTING_TOKEN ||
  (await (async () => {
    const response = await fetch("https://api.clerk.com/v1/testing_tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) throw new Error(`testing-token request returned HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload.token !== "string" || payload.token.length < 10) {
      throw new Error("testing-token response did not contain a token");
    }
    return payload.token;
  })());
process.env.CLERK_TESTING_TOKEN = testingToken;
const { setupClerkTestingToken } = await import("@clerk/testing/playwright");
check("short-lived Clerk testing token obtained without recording its value");
const originalConsoleWarn = console.warn;
let suppressedWarnings = 0;
console.warn = () => {
  suppressedWarnings += 1;
};

const clerkApi = async (path, options = {}) => {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json", ...options.headers },
  });
  if (!response.ok) throw new Error(`Clerk API request returned HTTP ${response.status}`);
  return response.json().catch(() => null);
};
const { ConvexHttpClient } = await import("convex/browser");
const { api: convexApi } = await import("../convex/_generated/api.js");
const convexClientForPage = async (page) => {
  const token = await page.evaluate(async () => {
    const session = globalThis.Clerk?.session;
    if (!session) return null;
    const defaultToken = await session.getToken();
    if (typeof defaultToken === "string") {
      try {
        const payload = defaultToken.split(".")[1];
        const decoded = payload
          ? atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="))
          : "";
        if (JSON.parse(decoded)?.aud === "convex") return defaultToken;
      } catch { /* An unrecognised token is not accepted as a Convex token. */ }
    }
    return await session.getToken({ template: "convex" });
  });
  if (typeof token !== "string" || token.length < 32) throw new Error("verified Convex token was unavailable");
  return new ConvexHttpClient(expectedConvexUrl, { auth: token, logger: false });
};
const legacyDeviceLoanPayload = {
  loan: {
    lender: "Legacy browser bank",
    original: 1_000_000,
    outstanding: 900_000,
    ratePct: 8.5,
    basis: "repo",
    spreadPct: 0.5,
    cycle: "quarterly",
    lastReset: "2024-01-01",
    monthsLeft: 120,
  },
  quote: {
    newRatePct: 7.9,
    feePct: 0.25,
    legalCharges: 5_000,
    keepTenure: true,
    newTenureMonths: 240,
  },
  surplus: 0,
  bufferMonths: 0,
  rateResolvedAt: null,
};
const cleanupSavedLoanThroughConvex = async (page, label) => {
  const client = await convexClientForPage(page);
  const current = await client.query(convexApi.savedLoans.currentLoan, {});
  if (!current?.payload) {
    check(`${label} account loan cleanup found no saved record`);
    return;
  }
  const result = await client.mutation(convexApi.savedLoans.deleteLoan, {
    requestId: randomUUID(),
    expectedRevision: current.revision,
    createdAt: new Date().toISOString(),
  });
  assert.ok(result && (result.status === "deleted" || result.status === "replayed"), `${label} account loan cleanup was not acknowledged`);
  const after = await client.query(convexApi.savedLoans.currentLoan, {});
  assert.equal(after?.payload, null, `${label} account loan remained readable after cleanup`);
  check(`${label} cleanup deleted the imported account loan through Convex`, { revision: result.revision });
};
const listServerComparisons = async (page) => {
  const client = await convexClientForPage(page);
  const result = await client.query(convexApi.comparisons.listComparisons, {
    paginationOpts: { numItems: 50, cursor: null },
  });
  if (!result || result.status !== "ok" || !result.result || !Array.isArray(result.result.page)) {
    throw new Error("authenticated comparison list was not acknowledged");
  }
  return { client, page: result.result.page };
};
const deleteServerComparison = async (client, resultId, comparisonId) => {
  const result = await client.mutation(convexApi.comparisons.deleteComparison, {
    requestId: randomUUID(), resultId, createdAt: new Date().toISOString(),
  });
  if (!result || (result.status !== "deleted" && result.status !== "replayed")) {
    throw new Error("authenticated comparison deletion was not acknowledged");
  }
  const fetched = await client.query(convexApi.comparisons.getComparison, { comparisonId });
  if (fetched !== null) throw new Error("deleted comparison remained readable by its owner");
};
const rowsFromClerkList = (payload, resource) => {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) return payload.data;
  throw new Error(`Clerk ${resource} response shape was invalid`);
};
const sessionIdsFor = async (email) => {
  const userPayload = await clerkApi(`/users?email_address=${encodeURIComponent(email)}&limit=10`);
  const matches = rowsFromClerkList(userPayload, "users")
    .filter((user) => Array.isArray(user?.email_addresses) && user.email_addresses.some((address) => address?.email_address === email));
  if (matches.length > 1) throw new Error("Clerk returned multiple exact synthetic email matches");
  const user = matches[0];
  if (!user || typeof user.id !== "string") return { userId: null, ids: new Set() };
  const sessionPayload = await clerkApi(`/sessions?user_id=${encodeURIComponent(user.id)}&limit=100`);
  const sessions = rowsFromClerkList(sessionPayload, "sessions");
  const ids = new Set(
    sessions
      .filter((session) => session?.status === "active" && typeof session.id === "string")
      .map((session) => session.id),
  );
  return { userId: user.id, ids };
};
const revokeNewSessions = async (email, baseline) => {
  try {
    const current = await sessionIdsFor(email);
    const fresh = [...current.ids].filter((id) => !baseline.ids.has(id));
    for (const id of fresh) {
      await clerkApi(`/sessions/${encodeURIComponent(id)}/revoke`, { method: "POST" });
    }
    return fresh.length;
  } catch (error) {
    evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
    return null;
  }
};
const deleteDisposableUser = async (email, baseline) => {
  try {
    if (baseline.userId !== null) {
      return { deleted: false, reason: "pre-existing user was never eligible for deletion" };
    }
    const current = await sessionIdsFor(email);
    if (current.userId === null) {
      return { deleted: false, reason: "signup did not create a user" };
    }
    await clerkApi(`/users/${encodeURIComponent(current.userId)}`, { method: "DELETE" });
    return { deleted: true };
  } catch (error) {
    evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
    return { deleted: false, reason: "owned disposable-user deletion failed" };
  }
};

const nextScript = resolve(root, "node_modules/next/dist/bin/next");
let nextProcess;
let browser;
const waitForServer = async (baseUrl) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/signin`, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // Next is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("built Next server did not become ready within 60 seconds");
};
const closeNext = async () => {
  if (!nextProcess || nextProcess.exitCode !== null) return;
  nextProcess.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, 3_000);
    nextProcess.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
};

const waitForClerkReady = async (page, label, pageErrors, clerkResponses, clerkFailures) => {
  try {
    await page.waitForFunction(() => Boolean(globalThis.Clerk?.loaded), undefined, { timeout: 45_000 });
    check(`${label} Clerk SDK loaded before user interaction`);
  } catch (error) {
    await page.screenshot({ path: resolve(evidenceDir, `clerk-browser-${label}-readiness-failed.png`), fullPage: true });
    const runtime = await page.evaluate(() => ({
      pathname: globalThis.location?.pathname || null,
      clerkDefined: typeof globalThis.Clerk !== "undefined",
      loaded: Boolean(globalThis.Clerk?.loaded),
      hasClient: Boolean(globalThis.Clerk?.client),
    })).catch(() => ({ pathname: null, clerkDefined: false, loaded: false, hasClient: false }));
    const diagnostics = {
      label,
      ...runtime,
      pageErrors: pageErrors.slice(-10),
      responses: clerkResponses.slice(-20),
      requestFailures: clerkFailures.slice(-20),
      timeoutMs: 45_000,
    };
    evidence.diagnostics.push(diagnostics);
    throw new Error(`${label} Clerk readiness did not complete: ${JSON.stringify(diagnostics)}; ${scrub(error instanceof Error ? error.message : String(error))}`);
  }
};

const runAccount = async (context, email, label, expectedOtherEmail) => {
  const baseline = await sessionIdsFor(email);
  let page;
  let phase = "create-page";
  let pageErrors = [];
  let clerkResponses = [];
  let clerkFailures = [];
  try {
    page = await context.newPage();
    pageErrors = [];
    clerkResponses = [];
    clerkFailures = [];
    page.on("pageerror", (error) => pageErrors.push(scrub(error.message)));
    page.on("response", (response) => {
      try {
        const responseUrl = new URL(response.url());
        if (responseUrl.hostname === expectedIssuer && responseUrl.pathname.startsWith("/v1/")) {
          clerkResponses.push(`${response.request().method()} ${responseUrl.pathname} ${response.status()}`);
        }
      } catch {
        // Ignore malformed/non-HTTP diagnostic URLs.
      }
    });
    page.on("requestfailed", (request) => {
      try {
        const requestUrl = new URL(request.url());
        if (requestUrl.hostname === expectedIssuer && requestUrl.pathname.startsWith("/v1/")) {
          const code = request.failure()?.errorText?.match(/(?:net::)?ERR_[A-Z0-9_]+|net::[A-Z0-9_]+/i)?.[0] || "unknown";
          clerkFailures.push(`${request.method()} ${requestUrl.pathname} ${code}`);
        }
      } catch {
        // Ignore malformed/non-HTTP diagnostic URLs.
      }
    });
    phase = "load-signin";
    await page.goto(`${evidence.baseUrl}/signin`, { waitUntil: "domcontentloaded" });
    phase = "wait-clerk-ready";
    await waitForClerkReady(page, label, pageErrors, clerkResponses, clerkFailures);
    phase = "enter-email";
    await page.locator("#signin-email").fill(email);
    await page.screenshot({ path: resolve(evidenceDir, `clerk-browser-${label}-signin.png`), fullPage: true });
    phase = "send-code";
    await page.getByRole("button", { name: "Send code", exact: true }).click();
    // Use only Clerk's supported development Testing Token path. A remaining
    // human challenge is recorded as an uncompleted flow, never clicked here.
    try {
      await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 15_000 });
    } catch (error) {
      await page.screenshot({ path: resolve(evidenceDir, `clerk-browser-${label}-send-failed.png`), fullPage: true });
      const visible = scrub((await page.locator("body").innerText()).replace(/\s+/g, " ")).slice(-600);
      const sdkState = await page.evaluate(() => {
        const clerk = globalThis.Clerk;
        const signIn = clerk?.client?.signIn;
        const signal = clerk?.__internal_state?.signInSignal?.();
        const signalSignIn = signal?.signIn;
        return {
          loaded: Boolean(clerk?.loaded),
          hasClient: Boolean(clerk?.client),
          signInStatus: typeof signIn?.status === "string" ? signIn.status : null,
          firstFactors: Array.isArray(signIn?.supportedFirstFactors) ? signIn.supportedFirstFactors.map((factor) => factor?.strategy).filter((strategy) => typeof strategy === "string") : [],
          signalFetchStatus: signal?.fetchStatus === "idle" || signal?.fetchStatus === "fetching" ? signal.fetchStatus : null,
          signalHasSignIn: Boolean(signalSignIn),
          signalCreateType: typeof signalSignIn?.create,
          signalEmailCodeType: typeof signalSignIn?.emailCode?.sendCode,
        };
      });
      throw new Error(`${label} send-code did not reach verification: ${visible || scrub(error.message)}; Clerk statuses=${clerkResponses.slice(-8).join(",") || "none"}; SDK state=${JSON.stringify(sdkState)}`);
    }
    phase = "invalid-code-auto-submit";
    await page.locator("#signin-code").fill("111111");
    await page.getByText(/could not|incorrect|invalid|try again|failed/i).first().waitFor({ timeout: 8_000 });
    await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 2_000 });
    assert.equal(await page.locator("#signin-code").inputValue(), "", `${label} invalid code was not cleared`);
    check(`${label} invalid OTP stays on verification with a safe error`);
    await page.screenshot({ path: resolve(evidenceDir, `clerk-browser-${label}-invalid-code.png`), fullPage: true });

    phase = "valid-code-auto-submit";
    await page.locator("#signin-code").fill("424242");
    await page.waitForURL(/\/home(?:\?|$)/, { timeout: 20_000 });
    check(`${label} test OTP activates the development session and reaches home`);

    phase = "load-account";
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Account", exact: true }).waitFor();
    const accountText = await page.locator("body").innerText();
    assert.match(accountText, /Signed in as/);
    assert.match(accountText, new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(accountText, new RegExp(expectedOtherEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await page.screenshot({ path: resolve(evidenceDir, `clerk-browser-${label}-account.png`), fullPage: true });
    check(`${label} account page is bound to the current synthetic identity`);

    phase = "sign-out";
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("region", { name: "Confirm sign out", exact: true }).waitFor();
    check(`${label} sign out requires explicit confirmation`);
    await page.getByRole("button", { name: "Confirm sign out", exact: true }).click();
    await page.waitForURL(/\/$|\/signin(?:\?|$)/, { timeout: 12_000 });
    check(`${label} sign out returns to an unauthenticated route`);
    assert.deepEqual(pageErrors, [], `${label} had uncaught browser errors`);
  } catch (error) {
    const pathname = (() => {
      try { return new URL(page?.url() || "").pathname || null; } catch { return null; }
    })();
    await page?.screenshot({ path: resolve(evidenceDir, `clerk-browser-${label}-${phase}-failed.png`), fullPage: true }).catch(() => {});
    evidence.diagnostics.push({ label, phase, pathname, pageErrors: pageErrors.slice(-10), responses: clerkResponses.slice(-20), requestFailures: clerkFailures.slice(-20) });
    throw new Error(`${label} phase ${phase} failed at ${pathname || "unknown-path"}: ${scrub(error instanceof Error ? error.message : String(error))}`);
  } finally {
    await page?.close();
    const revoked = await revokeNewSessions(email, baseline);
    if (revoked !== null) check(`${label} cleanup revoked only newly-created sessions`, { count: revoked });
  }
};

const assertNoHorizontalOverflow = async (page, label, width) => {
  const sizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(Math.max(sizes.document, sizes.body) <= sizes.viewport + 1,
    `${label} overflows at ${width}px: viewport=${sizes.viewport}, document=${sizes.document}, body=${sizes.body}`);
  return sizes;
};

const waitForSavedAccountStatus = async (page, label) => {
  const status = page.getByRole("status").filter({ hasText: "Loan saved to your account." }).first();
  await status.waitFor({ timeout: 30_000 });
  check(`${label} confirms the loan is saved to the account`);
};

const captureResponsiveStatus = async (page, label, pathLabel, path, expectedEmail = null) => {
  await page.goto(`${evidence.baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await waitForSavedAccountStatus(page, `${label} ${pathLabel} before responsive capture`);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const sizes = await assertNoHorizontalOverflow(page, `${label} ${pathLabel}`, width);
    let emailVisibility = null;
    if (expectedEmail !== null) {
      const emailNode = page.getByText(expectedEmail, { exact: true }).last();
      await emailNode.waitFor();
      emailVisibility = await emailNode.evaluate((node, expected) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          visibleText: node.textContent?.trim() === expected,
          withinViewport: rect.left >= -1 && rect.right <= window.innerWidth + 1,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap,
        };
      }, expectedEmail);
      assert.equal(emailVisibility.visibleText, true, `${label} account email is truncated at ${width}px`);
      assert.equal(emailVisibility.withinViewport, true, `${label} account email is clipped at ${width}px`);
      assert.notEqual(emailVisibility.textOverflow, "ellipsis", `${label} account email uses ellipsis at ${width}px`);
      assert.notEqual(emailVisibility.whiteSpace, "nowrap", `${label} account email is forced onto one clipped line at ${width}px`);
      check(`${label} full account email remains readable at ${width}px`, { width, emailVisibility });
    }
    await page.screenshot({ path: resolve(evidenceDir, `clerk-browser-${label}-${pathLabel}-${width}.png`), fullPage: true });
    check(`${label} ${pathLabel} status fits a ${width}px viewport`, { width, sizes, emailVisibility });
  }
};

const cleanupLoanThroughAccount = async (page, label) => {
  await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
  await page.getByRole("status").filter({ hasText: /Loan saved to your account\.|No saved loan is shown in this browser\./ }).first().waitFor({ timeout: 30_000 });
  const deleteButton = page.getByRole("button", { name: "Delete my loan record", exact: true });
  if (await deleteButton.count() > 0) {
    await deleteButton.first().click();
    await page.getByRole("region", { name: "Confirm loan deletion", exact: true }).waitFor();
    await page.getByRole("button", { name: "Confirm loan deletion", exact: true }).click();
  }
  await page.getByRole("status").filter({ hasText: "No saved loan is shown in this browser." }).first().waitFor({ timeout: 30_000 });
  check(`${label} cleanup deleted the synthetic loan through the account UI`);
};

const runLoanCheck = async (page, label) => {
  let loanMayExist = false;
  let phase = "loan-setup";
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${evidence.baseUrl}/loan/setup`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Your loan", exact: true }).first().waitFor();
    await page.getByRole("radio", { name: "Fixed", exact: true }).click();
    await page.locator("#lender").fill("Browser proof lender");
    await page.locator("#outstanding").fill("1800000");
    await page.locator("#original").fill("2000000");
    await page.locator("#rate").fill("8.5");
    await page.locator("#months").fill("120");
    await page.locator("#surplus").fill("100000");
    await page.locator("#buffer").fill("8");
    phase = "loan-save";
    loanMayExist = true;
    await page.getByRole("button", { name: "Save loan", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/loan", { timeout: 20_000 });
    await waitForSavedAccountStatus(page, label);
    check(`${label} saved the fixed-basis synthetic loan inputs`);

    phase = "loan-reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForSavedAccountStatus(page, `${label} after loan reload`);
    const loanText = await page.locator("body").innerText();
    assert.match(loanText, /Browser proof lender/);
    assert.match(loanText, /₹18\.00\s*L|18,00,000|1800000/);
    check(`${label} reload preserves the saved loan record`);

    phase = "transfer-save";
    await page.goto(`${evidence.baseUrl}/loan/transfer`, { waitUntil: "domcontentloaded" });
    await page.locator("#newrate").fill("7.9");
    const saveQuote = page.getByRole("button", { name: "Save quote", exact: true });
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Save quote");
      return button instanceof HTMLButtonElement && !button.disabled;
    }, undefined, { timeout: 8_000 });
    await saveQuote.click();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Save quote");
      const dirty = [...document.querySelectorAll("p")].some((candidate) => candidate.textContent?.includes("transfer quote has unsaved edits"));
      return button instanceof HTMLButtonElement && button.disabled && !dirty;
    }, undefined, { timeout: 30_000 });
    await waitForSavedAccountStatus(page, `${label} after quote save`);
    phase = "transfer-reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#newrate").waitFor();
    assert.equal(await page.locator("#newrate").inputValue(), "7.9");
    await waitForSavedAccountStatus(page, `${label} after quote reload`);
    check(`${label} explicit transfer quote save survives reload`);

    phase = "warm-offline-queue";
    await page.context().setOffline(true);
    await page.locator("#newrate").fill("7.8");
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Save quote");
      return button instanceof HTMLButtonElement && !button.disabled;
    }, undefined, { timeout: 8_000 });
    await saveQuote.click();
    await page.getByRole("status").filter({ hasText: /waiting to sync/i }).first().waitFor({ timeout: 15_000 });
    assert.equal(await page.getByRole("status").filter({ hasText: "Loan saved to your account." }).count(), 0);
    check(`${label} offline quote edit queues without claiming an account acknowledgement`);

    phase = "warm-offline-reconnect";
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await waitForSavedAccountStatus(page, `${label} after offline reconnect`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#newrate").waitFor();
    assert.equal(await page.locator("#newrate").inputValue(), "7.8");
    await waitForSavedAccountStatus(page, `${label} after offline quote reload`);
    check(`${label} reconnect acknowledges and preserves the queued quote after reload`);

    phase = "cold-offline-reload";
    await page.context().setOffline(true);
    let coldReloadError = null;
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch (error) {
      coldReloadError = error;
    }
    const coldOfflineText = await page.locator("body").innerText().catch(() => "");
    assert.doesNotMatch(coldOfflineText, /Browser proof lender/, "cold offline reload exposed the private lender record");
    check(`${label} cold offline reload keeps the private lender out of the public fallback`, {
      publicFallback: /offline|without an account|start/i.test(coldOfflineText),
      navigationError: coldReloadError !== null,
    });

    phase = "cold-offline-reconnect";
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    await waitForSavedAccountStatus(page, `${label} after cold reconnect`);
    assert.match(await page.locator("body").innerText(), /Browser proof lender/);
    check(`${label} reconnect restores the saved record after cold offline reload`);

    phase = "responsive-screenshots";
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    await waitForSavedAccountStatus(page, `${label} before account responsive capture`);
    const accountEmail = await page.locator("body").innerText().then((text) => {
      const match = text.match(/Signed in as\s+([^\s]+@[^\s]+)/);
      return match?.[1] || null;
    });
    assert.ok(accountEmail, `${label} account email was not present for responsive check`);
    await captureResponsiveStatus(page, label, "account-status", "/account", accountEmail);
    await captureResponsiveStatus(page, label, "loan-status", "/loan");

    phase = "keyboard-signout-focus";
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    await waitForSavedAccountStatus(page, `${label} before keyboard focus check`);
    let signoutFocused = false;
    for (let index = 0; index < 40; index += 1) {
      await page.keyboard.press("Tab");
      signoutFocused = await page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLButtonElement && active.textContent?.trim() === "Sign out";
      });
      if (signoutFocused) break;
    }
    assert.equal(signoutFocused, true, `${label} keyboard navigation did not reach Sign out`);
    check(`${label} keyboard Tab reaches Account sign out`, { focused: true });

    phase = "signout-warning";
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    await waitForSavedAccountStatus(page, `${label} before signout warning`);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const warning = page.getByRole("region", { name: "Confirm sign out", exact: true });
    await warning.waitFor();
    await warning.getByText(/clears this browser/).waitFor();
    await page.getByRole("button", { name: "Stay signed in", exact: true }).click();
    assert.equal(await page.getByRole("region", { name: "Confirm sign out", exact: true }).count(), 0);
    assert.match(await page.locator("body").innerText(), /Browser proof lender/);
    check(`${label} signout warning can be cancelled while the loan remains visible`);

    phase = "loan-cleanup";
    await cleanupLoanThroughAccount(page, label);
    loanMayExist = false;
    check(`${label} account projection shows no loan after UI deletion`);
  } catch (error) {
    const pathname = (() => {
      try { return new URL(page.url()).pathname || null; } catch { return null; }
    })();
    const statusText = await page.locator('[role="status"]').allTextContents().catch(() => []);
    await page.screenshot({ path: resolve(evidenceDir, `clerk-browser-${label}-${phase}-failed.png`), fullPage: true }).catch(() => {});
    evidence.diagnostics.push({
      label,
      phase,
      pathname,
      status: scrub(statusText.join(" ").replace(/\s+/g, " ")).slice(-400),
    });
    throw new Error(`${label} phase ${phase} failed: ${scrub(error instanceof Error ? error.message : String(error))}`);
  } finally {
    if (loanMayExist) {
      try {
        await cleanupLoanThroughAccount(page, `${label} recovery`);
      } catch (error) {
        evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
      }
    }
  }
};

const comparisonTableText = async (page) => {
  const table = page.locator("main .overflow-x-auto").first();
  await table.waitFor({ timeout: 30_000 });
  return (await table.innerText()).replace(/\s+/g, " ").trim();
};

const attachAuthDiagnostics = (page, pageErrors, clerkResponses, clerkFailures) => {
  page.on("pageerror", (error) => pageErrors.push(scrub(error.message)));
  page.on("response", (response) => {
    try {
      const responseUrl = new URL(response.url());
      if (responseUrl.hostname === expectedIssuer && responseUrl.pathname.startsWith("/v1/")) {
        clerkResponses.push(`${response.request().method()} ${responseUrl.pathname} ${response.status()}`);
      }
    } catch { /* Ignore malformed/non-HTTP diagnostic URLs. */ }
  });
  page.on("requestfailed", (request) => {
    try {
      const requestUrl = new URL(request.url());
      if (requestUrl.hostname === expectedIssuer && requestUrl.pathname.startsWith("/v1/")) {
        const code = request.failure()?.errorText?.match(/(?:net::)?ERR_[A-Z0-9_]+|net::[A-Z0-9_]+/i)?.[0] || "unknown";
        clerkFailures.push(`${request.method()} ${requestUrl.pathname} ${code}`);
      }
    } catch { /* Ignore malformed/non-HTTP diagnostic URLs. */ }
  });
};

const sendComparisonCode = async (page, email, next, label) => {
  await page.locator("#signin-email").fill(email);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  try {
    await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 15_000 });
  } catch (error) {
    const visible = scrub((await page.locator("body").innerText()).replace(/\s+/g, " ")).slice(-600);
    throw new Error(`${label} comparison send-code did not reach verification: ${visible || scrub(error instanceof Error ? error.message : String(error))}`);
  }
};

const runComparisonAuth = async (context, email, label) => {
  const baseline = await sessionIdsFor(email);
  assert.equal(baseline.userId, null, "comparison signup address must be absent before UI flow");
  let page;
  let phase = "create-page";
  const recordingStartedAt = mvpRecordVideoEnabled ? Date.now() : null;
  const recordingMarkers = [];
  const holdRecordingMarker = async (marker, details = {}) => {
    if (!mvpRecordVideoEnabled || recordingStartedAt === null || !page) return;
    recordingMarkers.push({ marker, atMs: Date.now() - recordingStartedAt, phase, ...details });
    await page.waitForTimeout(recordingHoldMs);
  };
  const pageErrors = [];
  const clerkResponses = [];
  const clerkFailures = [];
  const createdComparisons = new Map();
  const evidencePrefix = hostedReviewEnabled ? "hosted-review" : mvpDemoEnabled ? "mvp-demo" : "comparison-auth";
  let serverCleanupDone = false;
  let comparisonServerWriteMayHaveStarted = false;
  try {
    page = await context.newPage();
    const recordingMaskInstalled = await installRecordingMask(page);
    if (recordingMaskInstalled) {
      check(`${label} recording masks synthetic auth inputs before entry`, {
        css: "-webkit-text-security: disc",
        fields: ["#signin-email", "#signin-code"],
      });
    }
    attachAuthDiagnostics(page, pageErrors, clerkResponses, clerkFailures);
    phase = "guest-entry";
    await page.goto(`${evidence.baseUrl}/signin`, { waitUntil: "domcontentloaded" });
    await waitForClerkReady(page, `${label} guest`, pageErrors, clerkResponses, clerkFailures);
    await page.getByRole("link", { name: /carry on as a guest/i }).click();
    await page.waitForURL(/\/home(?:\?|$)/, { timeout: 12_000 });
    phase = "guest-inputs";
    await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Loan amount for offer 1", { exact: true }).waitFor({ timeout: 30_000 });
    const fillOffer = async (index, lender, amount, rate, tenure) => {
      await page.getByLabel(`Lender name for offer ${index}`, { exact: true }).fill(lender);
      await page.getByLabel(`Loan amount for offer ${index}`, { exact: true }).fill(String(amount));
      await page.getByLabel(`Interest rate for offer ${index}`, { exact: true }).fill(String(rate));
      await page.getByLabel(`Tenure for offer ${index}`, { exact: true }).fill(String(tenure));
    };
    await fillOffer(1, "Guest bank A", 1000000, 8.5, 10);
    await fillOffer(2, "Guest bank B", 1000000, 8.9, 10);
    await holdRecordingMarker("compare-inputs", { description: "two guest offers entered" });
    phase = "guest-calculate";
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
    const guestTable = await comparisonTableText(page);
    assert.match(guestTable, /Guest bank A/);
    assert.match(guestTable, /Guest bank B/);
    assert.match(guestTable, /Effective APR/);
    const guestScreenshot = resolve(evidenceDir, `${evidencePrefix}-${label}-guest-result.png`);
    await page.screenshot({ path: guestScreenshot, fullPage: true });
    check(`${label} guest calculation produced the two-offer result before authentication`, { screenshot: guestScreenshot });
    await holdRecordingMarker("guest-result", { description: "two-offer result and sign-in save action visible" });

    phase = "preserve-save-intent";
    await page.getByRole("button", { name: "Sign in to save comparison", exact: true }).click();
    await page.waitForURL(/\/signin\?/, { timeout: 12_000 });
    const signInUrl = new URL(page.url());
    const next = signInUrl.searchParams.get("next");
    const requestId = next ? new URL(next, evidence.baseUrl).searchParams.get("requestId") : null;
    assert.match(requestId || "", /^[0-9a-f-]{36}$/i, `${label} did not preserve a valid comparison request ID`);
    check(`${label} save action preserved a bounded auth request and return destination`);
    await holdRecordingMarker("preserve-auth", { description: "sign-in page shows preserved comparison return" });

    phase = "signup-send-code";
    await sendComparisonCode(page, email, next || "/compare/results", label);
    const codeInput = page.locator("#signin-code");
    if (!shortComparisonCheck) {
      phase = "verify-reload-restart";
      await page.reload({ waitUntil: "domcontentloaded" });
      const restartHeading = page.getByRole("heading", { name: "Verification needs a restart", exact: true });
      await Promise.race([
        restartHeading.waitFor({ state: "visible", timeout: 15_000 }),
        codeInput.waitFor({ state: "visible", timeout: 15_000 }),
      ]);
      if (await restartHeading.isVisible().catch(() => false)) {
        await page.getByRole("button", { name: "Start again", exact: true }).click();
        await page.waitForURL(/\/signin\?/, { timeout: 12_000 });
        await sendComparisonCode(page, email, next || "/compare/results", `${label} restart`);
      }
      await codeInput.waitFor({ state: "visible", timeout: 15_000 });
      phase = "verify-invalid-code";
      await page.locator("#signin-code").fill("111111");
      await page.getByText(/could not|incorrect|invalid|try again|failed/i).first().waitFor({ timeout: 8_000 });
      assert.equal(await page.locator("#signin-code").inputValue(), "", `${label} invalid comparison OTP was not cleared`);
      check(`${label} invalid OTP stayed on verification with a safe error`);
    } else {
      await codeInput.waitFor({ state: "visible", timeout: 15_000 });
    }
    await holdRecordingMarker("otp-screen", { description: "verification screen ready for synthetic code" });
    phase = "verify-valid-code";
    await page.locator("#signin-code").fill("424242");
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 30_000 });
    comparisonServerWriteMayHaveStarted = true;
    await page.getByRole("status").filter({ hasText: "Saved to your account." }).waitFor({ timeout: 30_000 });
    const restoredTable = await comparisonTableText(page);
    assert.equal(restoredTable, guestTable, `${label} restored comparison values changed across auth handoff`);
    const restoredScreenshot = resolve(evidenceDir, `${evidencePrefix}-${label}-member-result.png`);
    await page.screenshot({ path: restoredScreenshot, fullPage: true });
    check(`${label} OTP restored the same immutable comparison and received a save acknowledgement`, { screenshot: restoredScreenshot });
    await holdRecordingMarker("saved-result", { description: "authenticated saved result with acknowledgement" });

    phase = "server-read";
    let server = await listServerComparisons(page);
    assert.ok(server.page.length >= 1, `${label} authenticated server list was empty after save acknowledgement`);
    for (const row of server.page) {
      assert.equal(typeof row._id, "string");
      assert.equal(typeof row.resultId, "string");
      assert.equal(typeof row.snapshot, "string");
      const parsed = JSON.parse(row.snapshot);
      assert.equal(parsed.resultId, row.resultId);
      assert.deepEqual(parsed.offers?.map((offer) => offer?.lender), ["Guest bank A", "Guest bank B"],
        `${label} server snapshot did not retain the original guest offer inputs`);
      createdComparisons.set(row.resultId, { comparisonId: row._id, snapshot: row.snapshot });
      const fetched = await server.client.query(convexApi.comparisons.getComparison, { comparisonId: row._id });
      assert.ok(fetched && fetched.resultId === row.resultId, `${label} direct comparison read did not return the saved row`);
    }
    check(`${label} authenticated Convex list/get returned the saved comparison without recalculation`, { count: createdComparisons.size });

    if (shortComparisonCheck) {
      phase = "history-detail-report";
      const [savedResultId, savedRow] = [...createdComparisons.entries()][0] || [];
      assert.ok(savedRow, `${label} did not retain an owned saved comparison for the short history check`);
      const savedSnapshot = JSON.parse(savedRow.snapshot);
      await page.goto(`${evidence.baseUrl}/comparisons`, { waitUntil: "domcontentloaded" });
      const historyLink = page.getByRole("link", { name: /Guest bank A/ }).first();
      await historyLink.waitFor({ timeout: 30_000 });
      await holdRecordingMarker("history-list", { description: "saved comparison visible in history" });
      await historyLink.click();
      await page.waitForURL(/\/comparisons\/[^/]+$/);
      const detailId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop() || "");
      assert.equal(detailId, savedRow.comparisonId, `${label} history opened an unexpected saved comparison`);
      await page.getByText("Recorded comparison", { exact: false }).first().waitFor({ timeout: 30_000 });
      const historyText = await page.locator("main").innerText();
      assert.match(historyText, /Guest bank A/);
      assert.match(historyText, /Guest bank B/);
      assert.equal(savedSnapshot.resultId, savedResultId);
      check(`${label} history UI opened the matching saved snapshot`, { resultId: savedResultId, comparisonId: savedRow.comparisonId });
      await holdRecordingMarker("history-detail", { description: "matching saved comparison detail visible" });
      const { checkReportDownload } = await import("./check-report-download.mjs");
      await checkReportDownload({ page, snapshot: savedSnapshot, evidenceDir, check, scenario: hostedReviewEnabled ? "hosted-review" : "mvp-demo" });
      await holdRecordingMarker("pdf-downloaded", { description: "report download completed from detail view" });

      phase = "server-delete-cleanup";
      server = await listServerComparisons(page);
      for (const [resultId, row] of createdComparisons) {
        await deleteServerComparison(server.client, resultId, row.comparisonId);
      }
      server = await listServerComparisons(page);
      assert.equal(server.page.filter((row) => createdComparisons.has(row.resultId)).length, 0);
      serverCleanupDone = true;
      check(`${label} authenticated Convex cleanup removed only this run's comparisons`, { count: createdComparisons.size });
    }

    if (!shortComparisonCheck) {
      phase = "member-reload";
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 15_000 });
      await page.getByRole("status").filter({ hasText: /Saved to your account\.|This result is kept/ }).first().waitFor({ timeout: 30_000 });
      assert.equal(await comparisonTableText(page), guestTable, `${label} member reload changed the preserved result`);
      check(`${label} member reload retained the exact comparison result`);
    }

    if (!shortComparisonCheck) {
    phase = "member-three-offer-capacity";
    await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Lender name for offer 1", { exact: true }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "+ Add a third offer", exact: true }).click();
    assert.equal(await page.locator('input[aria-label^="Lender name for offer"]').count(), 3);
    await fillOffer(3, "Member bank C", 1000000, 8.7, 10);
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
    const threeOfferTable = await comparisonTableText(page);
    assert.match(threeOfferTable, /Member bank C/);
    assert.equal((threeOfferTable.match(/Member bank C/g) || []).length, 1);
    check(`${label} verified member comparison capacity for a third offer`);

    phase = "offline-save-queue";
    await page.goto(`${evidence.baseUrl}/compare`, { waitUntil: "domcontentloaded" });
    // The capacity assertion above intentionally edits the member draft. Reset
    // it before staging a valid two-offer offline save so the queued payload is
    // a complete, independently checkable comparison.
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await page.waitForFunction(() => {
      const reset = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Reset");
      const amount = document.querySelector('[aria-label="Loan amount for offer 1"]');
      const lenders = document.querySelectorAll('input[aria-label^="Lender name for offer"]');
      return reset instanceof HTMLButtonElement && !reset.disabled && amount instanceof HTMLInputElement && amount.value === "" && lenders.length === 2;
    }, undefined, { timeout: 30_000 });
    await fillOffer(1, "Reconnect bank A", 1000000, 8.4, 10);
    await fillOffer(2, "Reconnect bank B", 1000000, 8.8, 10);
    await page.getByLabel("Interest rate for offer 1", { exact: true }).fill("8.4");
    await page.getByRole("button", { name: "See the full breakdown", exact: true }).click();
    await page.waitForURL(/\/compare\/results(?:\?|$)/, { timeout: 20_000 });
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Save comparison", exact: true }).click();
    await page.getByRole("status").filter({ hasText: /Queued in this browser|Saving is paused/i }).first().waitFor({ timeout: 20_000 });
    check(`${label} offline member save queued without claiming server acknowledgement`);
    phase = "offline-save-reconnect";
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByRole("status").filter({ hasText: "Saved to your account." }).waitFor({ timeout: 30_000 });
    server = await listServerComparisons(page);
    assert.ok(server.page.length >= createdComparisons.size + 1, `${label} reconnect did not produce a second server comparison`);
    for (const row of server.page) {
      if (!createdComparisons.has(row.resultId)) createdComparisons.set(row.resultId, { comparisonId: row._id, snapshot: row.snapshot });
    }
    check(`${label} reconnect acknowledged the staged offline comparison save`, { count: createdComparisons.size });

    phase = "server-delete-cleanup";
    server = await listServerComparisons(page);
    for (const [resultId, row] of createdComparisons) {
      await deleteServerComparison(server.client, resultId, row.comparisonId);
    }
    server = await listServerComparisons(page);
    assert.equal(server.page.filter((row) => createdComparisons.has(row.resultId)).length, 0);
    serverCleanupDone = true;
    check(`${label} authenticated Convex delete removed only this run's comparisons`, { count: createdComparisons.size });

    if (loanCheckEnabled) {
      await runLoanCheck(page, label);
    }
    }

    phase = "signout-privacy";
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Account", exact: true }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("region", { name: "Confirm sign out", exact: true }).waitFor();
    await page.getByRole("button", { name: "Confirm sign out", exact: true }).click();
    await page.waitForURL(/\/($|home|signin)(?:\?|$)/, { timeout: 20_000 });
    await page.goto(`${evidence.baseUrl}/compare/results`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => ["/", "/home", "/signin"].includes(url.pathname), { timeout: 20_000 });
    assert.doesNotMatch(await page.locator("body").innerText(), /Saved to your account\.|Guest bank A|Guest bank B/);
    check(`${label} confirmed signout removed private comparison UI access`);
    await holdRecordingMarker("signed-out", { description: "private comparison UI no longer accessible" });
    assert.deepEqual(pageErrors, [], `${label} had uncaught browser errors`);
  } catch (error) {
    const pathname = (() => { try { return new URL(page?.url() || "").pathname || null; } catch { return null; } })();
    await page?.screenshot({ path: resolve(evidenceDir, `${evidencePrefix}-${label}-${phase}-failed.png`), fullPage: true }).catch(() => {});
    evidence.diagnostics.push({ label, phase, pathname, pageErrors: pageErrors.slice(-10), responses: clerkResponses.slice(-20), requestFailures: clerkFailures.slice(-20), comparisonIds: [...createdComparisons.keys()] });
    throw new Error(`${label} phase ${phase} failed at ${pathname || "unknown-path"}: ${scrub(error instanceof Error ? error.message : String(error))}`);
  } finally {
    if (!serverCleanupDone && page && comparisonServerWriteMayHaveStarted) {
      try {
        await page.context().setOffline(false);
        const cleanupServer = await listServerComparisons(page);
        for (const row of cleanupServer.page) {
          await deleteServerComparison(cleanupServer.client, row.resultId, row._id);
        }
        serverCleanupDone = true;
      } catch (error) {
        evidence.cleanupErrors.push(scrub(error instanceof Error ? error.message : String(error)));
      }
    } else if (!comparisonServerWriteMayHaveStarted) {
      check(`${label} comparison cleanup was not needed before authenticated save`);
    }
    const pageVideo = page?.video();
    await page?.close();
    if (mvpRecordVideoEnabled) {
      recordingMarkers.push({ marker: "recording-closed", atMs: Date.now() - (recordingStartedAt || Date.now()), phase });
      const videoPath = await pageVideo?.path().catch(() => null);
      if (videoPath) {
        evidence.rawVideo = {
          ...evidence.rawVideo,
          path: videoPath,
          closedPage: true,
          durationEstimateMs: recordingStartedAt === null ? null : Date.now() - recordingStartedAt,
          markers: recordingMarkers,
        };
        check(`${label} raw browser recording closed with a concrete video path`, {
          path: videoPath,
          raw: true,
          shareable: false,
          note: "Raw capture is unshareable until reviewed; auth inputs were masked before entry.",
        });
      } else {
        evidence.rawVideo = {
          ...evidence.rawVideo,
          closedPage: true,
          durationEstimateMs: recordingStartedAt === null ? null : Date.now() - recordingStartedAt,
          markers: recordingMarkers,
          error: "Playwright did not expose a video path after page close",
        };
      }
    }
    const revoked = await revokeNewSessions(email, baseline);
    if (revoked !== null) check(`${label} cleanup revoked only newly-created sessions`, { count: revoked });
    const removed = await deleteDisposableUser(email, baseline);
    check(`${label} cleanup handled only the disposable signup identity`, {
      deleted: removed.deleted,
      reason: removed.reason,
      convexProfile: "may remain; Clerk deletion does not remove Convex profiles, and this harness has no Convex deletion or tombstone operation",
    });
  }
};

const runSignup = async (context, email, label) => {
  const baseline = await sessionIdsFor(email);
  assert.equal(baseline.userId, null, "signup address must be absent before UI flow");
  let page;
  let phase = "create-page";
  let pageErrors = [];
  let clerkResponses = [];
  let clerkFailures = [];
  try {
    page = await context.newPage();
    pageErrors = [];
    clerkResponses = [];
    clerkFailures = [];
    page.on("pageerror", (error) => pageErrors.push(scrub(error.message)));
    page.on("response", (response) => {
      try {
        const responseUrl = new URL(response.url());
        if (responseUrl.hostname === expectedIssuer && responseUrl.pathname.startsWith("/v1/")) {
          clerkResponses.push(`${response.request().method()} ${responseUrl.pathname} ${response.status()}`);
        }
      } catch {
        // Ignore malformed/non-HTTP diagnostic URLs.
      }
    });
    page.on("requestfailed", (request) => {
      try {
        const requestUrl = new URL(request.url());
        if (requestUrl.hostname === expectedIssuer && requestUrl.pathname.startsWith("/v1/")) {
          const code = request.failure()?.errorText?.match(/(?:net::)?ERR_[A-Z0-9_]+|net::[A-Z0-9_]+/i)?.[0] || "unknown";
          clerkFailures.push(`${request.method()} ${requestUrl.pathname} ${code}`);
        }
      } catch {
        // Ignore malformed/non-HTTP diagnostic URLs.
      }
    });
    phase = "load-signin";
    await page.goto(`${evidence.baseUrl}/signin`, { waitUntil: "domcontentloaded" });
    phase = "wait-clerk-ready";
    await waitForClerkReady(page, `${label} signup`, pageErrors, clerkResponses, clerkFailures);
    phase = "enter-email";
    await page.locator("#signin-email").fill(email);
    phase = "send-code";
    await page.getByRole("button", { name: "Send code", exact: true }).click();
    try {
      await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 15_000 });
    } catch (error) {
      const visible = scrub((await page.locator("body").innerText()).replace(/\s+/g, " ")).slice(-600);
      throw new Error(`${label} signup send-code did not reach verification: ${visible || scrub(error.message)}`);
    }
    phase = "invalid-code-auto-submit";
    await page.locator("#signin-code").fill("111111");
    await page.getByText(/could not|incorrect|invalid|try again|failed/i).first().waitFor({ timeout: 8_000 });
    await page.waitForURL(/\/verify(?:\?|$)/, { timeout: 2_000 });
    assert.equal(await page.locator("#signin-code").inputValue(), "", `${label} invalid code was not cleared`);
    check(`${label} invalid signup OTP stays on verification with a safe error`);
    phase = "valid-code-auto-submit";
    await page.locator("#signin-code").fill("424242");
    await page.waitForURL(/\/home(?:\?|$)/, { timeout: 20_000 });
    check(`${label} signUpIfMissing transfer and test OTP reach home`);
    phase = "load-account";
    if (legacyAdoptionCheckEnabled) {
      await page.evaluate((payload) => {
        localStorage.setItem("truecost.loan.v1", JSON.stringify(payload));
      }, legacyDeviceLoanPayload);
      check(`${label} seeded a valid legacy loan only in the disposable browser context`);
    }
    await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Account", exact: true }).waitFor();
    const accountText = await page.locator("body").innerText();
    assert.match(accountText, /Signed in as/);
    assert.match(accountText, new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    check(`${label} newly created account is visible after backend provisioning`);
    if (legacyAdoptionCheckEnabled) {
      phase = "legacy-adoption-available";
      const adoption = page.getByRole("region", { name: "Device loan adoption", exact: true });
      await adoption.waitFor({ timeout: 30_000 });
      await adoption.getByRole("button", { name: "Import to this account", exact: true }).click();
      await adoption.getByRole("status").filter({ hasText: "acknowledged on this account" }).waitFor({ timeout: 30_000 });
      const current = await (await convexClientForPage(page)).query(convexApi.savedLoans.currentLoan, {});
      assert.equal(current?.payload?.loan?.lender, legacyDeviceLoanPayload.loan.lender);
      check(`${label} explicit import acknowledged the legacy loan on the account`, { lender: legacyDeviceLoanPayload.loan.lender });

      phase = "legacy-adoption-remove-device-copy";
      await adoption.getByRole("button", { name: "Remove from this device", exact: true }).click();
      await adoption.getByRole("button", { name: "Remove device copy", exact: true }).click();
      await page.waitForFunction(() => localStorage.getItem("truecost.loan.v1") === null);
      await page.getByRole("region", { name: "Device loan adoption", exact: true }).waitFor({ state: "detached", timeout: 15_000 });
      const adoptionKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("truecost.loan.adoption.v1:")));
      assert.deepEqual(adoptionKeys, []);
      check(`${label} confirmed removal clears the device copy and adoption metadata`, { legacyKey: "truecost.loan.v1" });
      await cleanupSavedLoanThroughConvex(page, label);
    }
    if (loanCheckEnabled) {
      phase = "loan-check";
      await runLoanCheck(page, label);
    }
    phase = "sign-out";
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("region", { name: "Confirm sign out", exact: true }).waitFor();
    check(`${label} sign out requires explicit confirmation`);
    await page.getByRole("button", { name: "Confirm sign out", exact: true }).click();
    await page.waitForURL(/\/$|\/signin(?:\?|$)/, { timeout: 12_000 });
    check(`${label} signup sign out returns to an unauthenticated route`);
    if (loanCheckEnabled) {
      phase = "private-data-disappears";
      await page.goto(`${evidence.baseUrl}/account`, { waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => ["/", "/home", "/signin"].includes(url.pathname), { timeout: 12_000 });
      assert.doesNotMatch(await page.locator("body").innerText(), /Browser proof lender/);
      check(`${label} private loan data is absent after confirmed sign out`);
    }
    assert.deepEqual(pageErrors, [], `${label} had uncaught browser errors`);
  } catch (error) {
    const pathname = (() => {
      try { return new URL(page?.url() || "").pathname || null; } catch { return null; }
    })();
    await page?.screenshot({ path: resolve(evidenceDir, `clerk-browser-${label}-${phase}-failed.png`), fullPage: true }).catch(() => {});
    evidence.diagnostics.push({ label, phase, pathname, pageErrors: pageErrors.slice(-10), responses: clerkResponses.slice(-20), requestFailures: clerkFailures.slice(-20) });
    throw new Error(`${label} phase ${phase} failed at ${pathname || "unknown-path"}: ${scrub(error instanceof Error ? error.message : String(error))}`);
  } finally {
    await page?.close();
    const revoked = await revokeNewSessions(email, baseline);
    if (revoked !== null) check(`${label} cleanup revoked only newly-created sessions`, { count: revoked });
    const removed = await deleteDisposableUser(email, baseline);
    check(`${label} cleanup handled only the disposable signup identity`, {
      deleted: removed.deleted,
      reason: removed.reason,
      convexProfile: "may remain; Clerk deletion does not remove Convex profiles, and this harness has no Convex deletion or tombstone operation",
    });
  }
};

try {
  if (hostedReviewEnabled) {
    const hostedResponse = await fetch(`${hostedBaseUrl}/signin`, { redirect: "manual" });
    if (hostedResponse.status < 200 || hostedResponse.status >= 500) {
      throw new Error(`hosted review target returned unexpected HTTP ${hostedResponse.status}`);
    }
    const resolvedOrigin = new URL(evidence.baseUrl).origin;
    if (resolvedOrigin !== hostedBaseUrl) {
      throw new Error("hosted review base URL did not resolve to the approved origin");
    }
    check("hosted review uses the exact approved Vercel origin and supplied deployment ID", {
      origin: resolvedOrigin,
      deploymentId: hostedDeploymentId,
      httpStatus: hostedResponse.status,
    });
  } else {
    const port = Number(process.env.TRUECOST_CLERK_BROWSER_PORT || 0);
    if (port === 0) {
      throw new Error("TRUECOST_CLERK_BROWSER_PORT must be an explicitly owned free port");
    }
    const probe = createServer();
    await new Promise((resolvePromise, reject) => {
      probe.once("error", reject);
      probe.listen(port, "localhost", resolvePromise);
    });
    await new Promise((resolvePromise, reject) => probe.close((error) => error ? reject(error) : resolvePromise()));
    nextProcess = spawn(process.execPath, [nextScript, "start", "-H", "localhost", "-p", String(port)], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "ignore",
    });
    evidence.baseUrl = `http://localhost:${port}`;
    await waitForServer(evidence.baseUrl);
  }
  browser = await chromium.launch({ headless: true, channel: process.env.TRUECOST_BROWSER_CHANNEL || "chrome" });
  evidence.browser = { name: "Chrome", playwright: playwrightPackage.version, engine: browser.version() };
  if (!shortComparisonCheck && !legacyAdoptionCheckEnabled) {
    const userA = "truecost-isolation-a+clerk_test@example.com";
    const userB = "truecost-isolation-b+clerk_test@example.com";
    const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
    await setupClerkTestingToken({ context: contextA, options: { frontendApiUrl: expectedIssuer } });
    await runAccount(contextA, userA, "a", userB);
    await contextA.close();
    const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" });
    await setupClerkTestingToken({ context: contextB, options: { frontendApiUrl: expectedIssuer } });
    await runAccount(contextB, userB, "b", userA);
    await contextB.close();
    check("A and B use fresh browser contexts with isolated account pages");
  }
  const signupPrefix = `truecost-browser-${randomUUID()}`;
  const signupEmail = `${signupPrefix}+clerk_test@example.com`;
  const signupBaseline = await sessionIdsFor(signupEmail);
  assert.equal(signupBaseline.userId, null, "generated signup address unexpectedly exists");
  const signupContextOptions = { viewport: { width: 1280, height: 900 }, serviceWorkers: "allow" };
  if (mvpRecordVideoEnabled) {
    const videoStamp = evidence.checkedAt.replace(/[:.]/g, "-");
    const videoDirectory = resolve(evidenceDir, hostedReviewEnabled ? "hosted-raw" : "demo-raw", videoStamp);
    await mkdir(videoDirectory, { recursive: true });
    signupContextOptions.recordVideo = { dir: videoDirectory, size: { width: 1280, height: 900 } };
    evidence.rawVideo = {
      directory: videoDirectory,
      path: null,
      raw: true,
      shareable: false,
      redactionRequired: true,
      note: "Raw browser capture is unshareable until reviewed; synthetic auth inputs are masked before entry.",
    };
  }
  const contextSignup = await browser.newContext(signupContextOptions);
  await setupClerkTestingToken({ context: contextSignup, options: { frontendApiUrl: expectedIssuer } });
  try {
    if (comparisonCheckEnabled) {
      await runComparisonAuth(contextSignup, signupEmail, "comparison-auth");
    } else {
      await runSignup(contextSignup, signupEmail, "new-signup");
    }
  } finally {
    await contextSignup.close();
  }
  check(comparisonCheckEnabled
    ? "comparison auth used a unique reserved test address and UI-only creation path"
    : "new signup used a unique reserved test address and UI-only creation path");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.errors.push(scrub(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await closeNext();
  evidence.cleanup = hostedReviewEnabled
    ? "browser contexts closed; hosted target was not started or stopped by this check"
    : "browser contexts closed and only the owned Next process was stopped";
  evidence.suppressedWarnings = suppressedWarnings;
  console.warn = originalConsoleWarn;
  if (evidence.cleanupErrors.length > 0) {
    evidence.status = "failed";
    evidence.errors.push(`cleanup failed for ${evidence.cleanupErrors.length} owned item(s)`);
    process.exitCode = 1;
  }
  if (mvpRecordVideoEnabled && !evidence.rawVideo?.path) {
    evidence.status = "failed";
    evidence.errors.push(evidence.rawVideo?.error || "MVP recording was requested but no closed-page video path was captured");
    process.exitCode = 1;
  }
  evidence.scriptSha256 = createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex");
  await mkdir(evidenceDir, { recursive: true });
  const evidenceFilename = hostedReviewEnabled
    ? "clerk-browser-hosted.json"
    : mvpDemoEnabled ? "clerk-browser-mvp-demo.json" : legacyAdoptionCheckEnabled ? "legacy-device-adoption-browser.json" : "clerk-browser-smoke.json";
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(resolve(evidenceDir, evidenceFilename), `${JSON.stringify(evidence, null, 2)}\n`),
  );
  if (comparisonCheckEnabled && !mvpDemoEnabled) {
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(resolve(evidenceDir, hostedReviewEnabled ? "comparison-auth-browser-hosted.json" : "comparison-auth-browser.json"), `${JSON.stringify(evidence, null, 2)}\n`),
    );
  }
}
console.log(JSON.stringify(evidence, null, 2));
