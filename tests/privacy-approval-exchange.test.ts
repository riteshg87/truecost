import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { signSensitiveProof } from "../lib/privacy/sensitive-proof";
import { consumeSensitiveGrant } from "../convex/privacyGrants";
const modules = {
  "./privacyApprovals.ts": async () => import("../convex/privacyApprovals"),
  "./privacyGrants.ts": async () => import("../convex/privacyGrants"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};
const exchange = makeFunctionReference<"action">("privacyApprovals:exchange");
const identity = { subject: "user_a", tokenIdentifier: "issuer|user_a", issuer: "https://issuer.example", sid: "session_a" };
beforeEach(() => {
  vi.stubEnv("TRUECOST_PRIVACY_AUDIENCE", "truecost_dev");
  vi.stubEnv("TRUECOST_PRIVACY_VERIFICATION_KEYS", JSON.stringify({ dev1: "ab".repeat(32) }));
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest({ schema, modules });
  await t.run(async ctx => { await ctx.db.insert("users", { authKey: identity.tokenIdentifier, clerkSubject: identity.subject, status: "active", createdAt: Date.now(), updatedAt: Date.now() }); });
  const now = Math.floor(Date.now() / 1000);
  const proof = await signSensitiveProof({ v: 1, kid: "dev1", audience: "truecost_dev", subject: identity.subject, sessionId: identity.sid, purpose: "account_export", nonce: crypto.randomUUID(), issuedAt: now, expiresAt: now + 120 }, new Uint8Array(32).fill(171));
  return { t, proof };
}
async function proofFor(nonce: string) {
  const now = Math.floor(Date.now() / 1000);
  return signSensitiveProof({ v: 1, kid: "dev1", audience: "truecost_dev", subject: identity.subject, sessionId: identity.sid, purpose: "account_export", nonce, issuedAt: now, expiresAt: now + 120 }, new Uint8Array(32).fill(171));
}
it("exchanges a verified proof once and returns the same grant for a lost-response retry", async () => {
  const { t, proof } = await setup();
  const account = t.withIdentity(identity);
  const first = await account.action(exchange, { proof, purpose: "account_export" });
  const again = await account.action(exchange, { proof, purpose: "account_export" });
  expect(again).toEqual(first);
  expect(Object.keys(first).sort()).toEqual(["expiresAt", "grantId"]);
  expect(await t.run(ctx => ctx.db.query("sensitiveGrants").collect())).toHaveLength(1);
});
it("rejects guest, missing signed session, wrong session, account and purpose", async () => {
  const { t, proof } = await setup();
  await expect(t.action(exchange, { proof, purpose: "account_export" })).rejects.toThrow();
  for (const other of [{ ...identity, sid: undefined }, { ...identity, sid: "session_b" }, { ...identity, subject: "user_b" }]) {
    await expect(t.withIdentity(other).action(exchange, { proof, purpose: "account_export" })).rejects.toThrow();
  }
  await expect(t.withIdentity(identity).action(exchange, { proof, purpose: "account_delete" })).rejects.toThrow();
  expect(await t.run(ctx => ctx.db.query("sensitiveGrants").collect())).toHaveLength(0);
});
it("fails closed when the configured verification key is missing or replaced", async () => {
  const { t, proof } = await setup();
  for (const value of ["", "{}", JSON.stringify({ dev1: "cd".repeat(32) })]) {
    vi.stubEnv("TRUECOST_PRIVACY_VERIFICATION_KEYS", value);
    await expect(t.withIdentity(identity).action(exchange, { proof, purpose: "account_export" })).rejects.toThrow();
  }
});
it("returns typed active-grant limits with millisecond retry metadata", async () => {
  const { t, proof } = await setup();
  const account = t.withIdentity(identity);
  await account.action(exchange, { proof, purpose: "account_export" });
  const secondProof = await proofFor("123e4567-e89b-42d3-a456-426614174099");
  await account.action(exchange, { proof: secondProof, purpose: "account_export" });
  const limited = await account.action(exchange, { proof: await proofFor("123e4567-e89b-42d3-a456-426614174098"), purpose: "account_export" });
  expect(limited).toMatchObject({ status: "limited", code: "active_grants" });
  if ("status" in limited) expect(limited.retryAfterMs).toBeGreaterThanOrEqual(60_000);
  expect(JSON.stringify(limited)).not.toMatch(/stack|Convex|issuer\.example/i);
});
it("returns a typed ten-minute rolling limit after consumed-grant churn", async () => {
  const { t, proof } = await setup();
  const account = t.withIdentity(identity);
  const ownerId = await t.run(async ctx => (await ctx.db.query("users").withIndex("by_authKey", q => q.eq("authKey", identity.tokenIdentifier)).unique())!._id);
  const first = await account.action(exchange, { proof, purpose: "account_export" });
  if (!("grantId" in first)) throw new Error("initial grant was unexpectedly limited");
  await t.run(ctx => consumeSensitiveGrant(ctx, first.grantId, { ownerId, subject: identity.subject, sessionId: identity.sid, audience: "truecost_dev", purpose: "account_export" }));
  for (let i = 1; i < 10; i++) {
    const next = await account.action(exchange, { proof: await proofFor(`123e4567-e89b-42d3-a456-4266141740${String(i + 40).padStart(2, "0")}`), purpose: "account_export" });
    await t.run(async ctx => {
      const owner = await ctx.db.query("users").withIndex("by_authKey", q => q.eq("authKey", identity.tokenIdentifier)).unique();
      if (!owner) throw new Error("missing owner");
      await consumeSensitiveGrant(ctx, next.grantId, { ownerId: owner._id, subject: identity.subject, sessionId: identity.sid, audience: "truecost_dev", purpose: "account_export" });
    });
  }
  const limited = await account.action(exchange, { proof: await proofFor("123e4567-e89b-42d3-a456-426614174099"), purpose: "account_export" });
  expect(limited).toMatchObject({ status: "limited", code: "rate_limited" });
  if ("status" in limited) expect(limited.retryAfterMs).toBeGreaterThanOrEqual(590_000);
  if ("status" in limited) expect(limited.retryAfterMs).toBeLessThanOrEqual(600_000);
  expect(JSON.stringify(limited)).not.toMatch(/stack|Convex|issuer\.example/i);
});
