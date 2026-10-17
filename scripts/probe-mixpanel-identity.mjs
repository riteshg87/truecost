import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit, development-only provider diagnostic. This script is intentionally
// direct HTTP, sends at most two synthetic events, and never prints a payload,
// token, or raw identifier. Do not run until the parent task has reviewed it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = resolve(root, "docs/evidence");
const endpoint = "https://api-js.mixpanel.com/track?ip=0&verbose=1&strict=1";
const projectId = "4064154";
const approvedTokenSha256 = "3563aba5fa027db27e293f807c44004a8292dbc2c61ed12c3f409fa396ccfb65";
const timeoutMs = 10_000;

if (process.env.TRUECOST_IDENTITY_PROBE_ALLOW_LIVE !== "1") {
  throw new Error("identity probe requires TRUECOST_IDENTITY_PROBE_ALLOW_LIVE=1");
}

const envText = await readFile(resolve(root, ".env.local"), "utf8").catch(() => "");
const localEnvValue = (name) => envText.split(/\r?\n/)
  .find((line) => line.startsWith(`${name}=`))
  ?.slice(name.length + 1)
  .trim()
  .replace(/^['"]|['"]$/g, "") || "";
const token = localEnvValue("NEXT_PUBLIC_MIXPANEL_TOKEN");
if (!/^[a-f0-9]{32}$/i.test(token) || createHash("sha256").update(token).digest("hex") !== approvedTokenSha256) {
  throw new Error("ignored development Mixpanel token did not match the approved SHA256");
}

// Bundle the production parser in memory. The probe does not copy or reimplement
// the application event allowlist and validation rules.
const eventBundle = await build({
  entryPoints: [resolve(root, "lib/analytics/events.ts")],
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const eventModule = await import(`data:text/javascript;base64,${Buffer.from(eventBundle.outputFiles[0].text).toString("base64")}`);
const { DEFAULT_ANALYTICS_CONFIG: defaultConfig, parseAnalyticsEvent } = eventModule;
const contractConfig = { ...defaultConfig, releases: ["identity-probe-equal", "identity-probe-distinct"] };

const checkedAt = new Date().toISOString();
const evidence = {
  checkedAt,
  status: "pending",
  projectId,
  region: "US",
  endpoint: "https://api-js.mixpanel.com/track",
  query: { ip: 0, verbose: 1, strict: 1 },
  token: "matched-approved-sha256",
  timeoutMs,
  maxRequests: 2,
  cases: [],
  errors: [],
};

const idSha256 = (value) => createHash("sha256").update(value).digest("hex");
const safeError = (error) => {
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "request timed out";
  if (error instanceof TypeError) return "request failed";
  return "request failed";
};
const responseAcknowledged = (body) => {
  try {
    const parsed = JSON.parse(body);
    return parsed === 1 || parsed?.status === 1;
  } catch {
    return body.trim() === "1";
  }
};

function makeCase(label, release, idsEqual) {
  const deviceId = randomUUID();
  const userId = idsEqual ? deviceId : randomUUID();
  const eventId = randomUUID();
  const draftId = randomUUID();
  const occurredAt = new Date().toISOString();
  const event = {
    event: "comparison_started",
    properties: {
      event_version: 1,
      environment: "development",
      release,
      auth_state: "member",
      feature: "comparison",
      route_name: "compare",
      event_id: eventId,
      occurred_at: occurredAt,
      draft_id: draftId,
    },
  };
  const parsed = parseAnalyticsEvent(event, contractConfig);
  if (!parsed?.ok) throw new Error(`event contract rejected ${label}: ${parsed?.code || "invalid event"}`);
  const properties = {
    ...parsed.value.properties,
    "$insert_id": eventId,
    distinct_id: userId,
    "$device_id": deviceId,
    "$user_id": userId,
    time: Math.floor(Date.parse(occurredAt) / 1000),
    token,
  };
  delete properties.event_id;
  return {
    label,
    release,
    idRelationship: idsEqual ? "equal" : "distinct",
    occurredAt,
    event: { event: parsed.value.event, properties },
    identityHashes: {
      distinctIdSha256: idSha256(userId),
      deviceIdSha256: idSha256(deviceId),
      userIdSha256: idSha256(userId),
    },
  };
}

const cases = [
  makeCase("equal_ids", "identity-probe-equal", true),
  makeCase("distinct_ids", "identity-probe-distinct", false),
];
assert.equal(cases.length, 2);

for (const probeCase of cases) {
  const record = {
    label: probeCase.label,
    release: probeCase.release,
    idRelationship: probeCase.idRelationship,
    occurredAt: probeCase.occurredAt,
    identityHashes: probeCase.identityHashes,
    propertyKeys: Object.keys(probeCase.event.properties).sort(),
    status: "pending",
    responseCode: null,
    error: null,
  };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(JSON.stringify(probeCase.event))}`,
      signal: AbortSignal.timeout(timeoutMs),
    });
    record.responseCode = response.status;
    const responseBody = await response.text();
    if (response.status === 200 && responseAcknowledged(responseBody)) {
      record.status = "accepted";
    } else {
      record.status = "rejected";
      record.error = response.status === 200 ? "provider acknowledgement missing" : "provider returned non-200 status";
    }
  } catch (error) {
    record.status = "failed";
    record.error = safeError(error);
  }
  evidence.cases.push(record);
}

const allAccepted = evidence.cases.length === 2 && evidence.cases.every((record) => record.status === "accepted");
evidence.status = allAccepted ? "passed" : "failed";
if (!allAccepted) evidence.errors.push("one or more identity cases were not acknowledged");

await mkdir(evidenceDir, { recursive: true });
const evidenceStamp = checkedAt.replace(/[:.]/g, "-");
const output = resolve(evidenceDir, `mixpanel-identity-probe-${evidenceStamp}.json`);
await writeFile(output, `${JSON.stringify({ ...evidence, output }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  status: evidence.status,
  projectId,
  cases: evidence.cases.map(({ label, status, responseCode, error }) => ({ label, status, responseCode, error })),
  output,
}, null, 2));
if (!allAccepted) process.exitCode = 1;
