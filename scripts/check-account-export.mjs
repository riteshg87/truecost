import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Offline evidence check. It intentionally reads a supplied artifact only and
// never authenticates, contacts Convex, or mutates provider data.
const filename = process.argv[2] || process.env.TRUECOST_ACCOUNT_EXPORT_EVIDENCE_PATH;
if (!filename) throw new Error("Pass the reviewed truecost-export.json path");
const value = JSON.parse(await readFile(filename, "utf8"));
assert.equal(value.version, 1, "export JSON version must be 1");
assert.equal(typeof value.createdAt, "string", "export must carry a creation timestamp");
assert.ok(Array.isArray(value.dataScope), "export must declare its data scope");
for (const required of ["comparisons", "savedLoan", "feedback", "feedbackDismissals"]) assert.ok(value.dataScope.includes(required), `missing scope: ${required}`);
assert.ok(Array.isArray(value.comparisons), "comparisons must be an array");
assert.ok(Array.isArray(value.feedback), "feedback must be an array");
assert.ok(Array.isArray(value.feedbackDismissals), "feedback dismissals must be an array");
const forbidden = new Set(["payloadHash", "requestId", "reviewAfter", "analyticsAccountId", "authKey", "tokenIdentifier", "clerkSecretKey"]);
const walk = (entry) => {
  if (!entry || typeof entry !== "object") return;
  for (const [key, child] of Object.entries(entry)) {
    assert.ok(!forbidden.has(key), `internal field leaked: ${key}`);
    walk(child);
  }
};
walk(value);
console.log(JSON.stringify({ valid: true, version: value.version, dataScope: value.dataScope, comparisons: value.comparisons.length, feedback: value.feedback.length, feedbackDismissals: value.feedbackDismissals.length }));
