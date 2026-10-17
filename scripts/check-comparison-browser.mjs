import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const root = process.cwd();
const before = process.argv.includes("--before");
const label = before ? "before" : "after";
const port = 4374;
const url = `http://localhost:${port}`;
const out = resolve(root, "docs/evidence");
await mkdir(out, { recursive: true });
await new Promise((done, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(done));
});
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const server = spawn(process.execPath, [resolve(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], { cwd: root, windowsHide: true, stdio: "ignore" });
const report = { checkedAt: new Date().toISOString(), buildId: await readFile(".next/BUILD_ID", "utf8"), mode: label, checks: [], errors: [] };
const check = (name) => report.checks.push({ name, passed: true });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (await fetch(url).then(r => r.ok).catch(() => false)) break;
    await new Promise(done => setTimeout(done, 150));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(e.message.replace(/(?:pk|sk)_(?:test|live)_\S+/g, "[redacted]")));
  await page.goto(url);
  await page.getByRole("button", { name: "Compare two loans", exact: true }).click();
  await page.goto(url + "/compare");
  await page.getByLabel("Loan amount for offer 1").waitFor();
  check("guest comparison form opens");
  const canAdd = await page.getByRole("button", { name: "+ Add a third offer" }).count();
  assert.equal(canAdd, before ? 1 : 0);
  check(before ? "baseline permits a third guest offer" : "guest form offers exactly two loans");
  for (const [index, rate] of [[1, "8"], [2, "9"]]) {
    await page.getByLabel(`Lender name for offer ${index}`).fill(index === 1 ? "Synthetic A" : "Synthetic B");
    await page.getByLabel(`Loan amount for offer ${index}`).fill("1000000");
    await page.getByLabel(`Interest rate for offer ${index}`).fill(rate);
  }
  await page.getByRole("button", { name: "See the full breakdown" }).click();
  await page.waitForURL("**/compare/results");
  await page.getByRole("heading", { name: "Results", exact: true }).waitFor();
  await page.getByText("Synthetic A", { exact: true }).first().waitFor();
  check("first result shows the two entered lenders");
  await page.screenshot({ path: resolve(out, `comparison-${label}-390.png`) });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check("result fits 390px viewport");
  if (!before) {
    const readGuest = () => page.evaluate(() => new Promise((done, reject) => {
      const r = indexedDB.open("truecost-public-guest-v1", 1);
      r.onsuccess = () => {
        const db = r.result;
        const q = db.transaction("guestState", "readonly").objectStore("guestState").get("singleton");
        q.onsuccess = () => { db.close(); done(q.result?.snapshotJson); };
        q.onerror = reject;
      };
      r.onerror = reject;
    }));
    const original = await readGuest();
    assert.equal(typeof original, "string");
    await page.reload();
    await page.getByRole("button", { name: "Sign in to save comparison" }).waitFor();
    assert.equal(await readGuest(), original);
    check("refresh preserves the identical stored result");
    await page.getByRole("link", { name: /Edit offers/ }).click();
    await page.getByLabel("Interest rate for offer 1").fill("7");
    await page.getByRole("button", { name: "See the full breakdown" }).click();
    await page.waitForURL("**/signin?*");
    const next = new URL(page.url()).searchParams.get("next");
    assert.equal(new URL(next, url).searchParams.get("action"), "recalculate_existing_draft");
    assert.equal(await readGuest(), original);
    check("changed input requires sign-in without changing the first result");
    await page.reload();
    await page.getByLabel("Email address").waitFor();
    check("sign-in reload retains the bounded return reference");
    const requestId = new URL(next, url).searchParams.get("requestId");
    const draftRate = await page.evaluate((id) => new Promise((done, reject) => {
      const r = indexedDB.open("truecost-guest-handoff-v1");
      r.onsuccess = () => {
        const db = r.result;
        const q = db.transaction("handoffs", "readonly").objectStore("handoffs").get(id);
        q.onsuccess = () => { db.close(); done(JSON.parse(q.result.draftJson).offers[0].ratePct); };
        q.onerror = reject;
      }; r.onerror = reject;
    }), requestId);
    assert.equal(draftRate, 7);
    check("edited guest rate survives sign-in reload");
    await page.setViewportSize({ width: 320, height: 760 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(out, "comparison-signin-after-320.png") });
    check("sign-in return fits 320px viewport");
    await page.getByRole("button", { name: "Cancel and return to comparison", exact: true }).click();
    await page.waitForURL("**/compare");
    await page.getByLabel("Interest rate for offer 1").waitFor();
    assert.equal(await page.getByLabel("Interest rate for offer 1").inputValue(), "7");
    await page.reload();
    await page.getByLabel("Interest rate for offer 1").waitFor();
    assert.equal(await page.getByLabel("Interest rate for offer 1").inputValue(), "7");
    assert.equal(await readGuest(), original);
    check("cancelling and reloading restores the edited draft and preserves the first result");
  }
  assert.equal(report.errors.length, 0);
  check("no page errors");
  await context.close();
} catch (error) {
  report.errors.push(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  report.buildHash = createHash("sha256").update(report.buildId).digest("hex");
  await writeFile(resolve(out, `comparison-browser-${label}.json`), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ mode: label, passed: report.checks.length, errors: report.errors, buildId: report.buildId.trim() }));
