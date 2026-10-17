import { describe, expect, it } from "vitest";
import { signSensitiveProof, verifySensitiveProof, type SensitiveProofClaims } from "../lib/privacy/sensitive-proof";

const key = new Uint8Array(32).fill(17);
const claims: SensitiveProofClaims = {
  v: 1, kid: "current", audience: "truecost_dev", subject: "user_a", sessionId: "sess_a",
  purpose: "account_export", nonce: "0e1f14b6-bd80-4ead-b5f2-785c8789ecaf", issuedAt: 1000, expiresAt: 1120,
};
const options = { keys: { current: key }, expected: { audience: claims.audience, subject: claims.subject, sessionId: claims.sessionId, purpose: claims.purpose }, nowSeconds: 1001 };

describe("sensitive-action server proof", () => {
  it("accepts only the signed claim set and freezes the returned claims", async () => {
    const result = await verifySensitiveProof(await signSensitiveProof(claims, key), options);
    expect(result).toEqual(claims);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each(["audience", "subject", "sessionId", "purpose"] as const)("rejects a different %s", async (field) => {
    const expected = { ...options.expected, [field]: field === "purpose" ? "account_delete" : "other" };
    expect(await verifySensitiveProof(await signSensitiveProof(claims, key), { ...options, expected })).toBeNull();
  });
  it("enforces exact expiry and rejects future issuance", async () => {
    const proof = await signSensitiveProof(claims, key);
    for (const nowSeconds of [999, 1120, 1121, NaN, 1000.5]) expect(await verifySensitiveProof(proof, { ...options, nowSeconds })).toBeNull();
    expect(await verifySensitiveProof(proof, { ...options, nowSeconds: 1000 })).not.toBeNull();
    expect(await verifySensitiveProof(proof, { ...options, nowSeconds: 1119 })).not.toBeNull();
  });
  it("rejects payload and signature tampering, malformed and oversized inputs", async () => {
    const proof = await signSensitiveProof(claims, key);
    const [payload, signature] = proof.split(".");
    const altered = Buffer.from(JSON.stringify({ ...claims, subject: "user_b" })).toString("base64url");
    for (const invalid of [null, "", "a.b.c", `${payload}=.${signature}`, `${payload}.${signature}=`, `${altered}.${signature}`, `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`, "x".repeat(4097)]) {
      expect(await verifySensitiveProof(invalid, options)).toBeNull();
    }
  });
  it("supports rotation only while the original key remains explicitly trusted", async () => {
    const proof = await signSensitiveProof(claims, key);
    expect(await verifySensitiveProof(proof, { ...options, keys: { current: key, next: new Uint8Array(32).fill(18) } })).not.toBeNull();
    for (const keys of [{}, { current: new Uint8Array(32).fill(18) }, Object.create({ current: key }), { current: new Uint8Array(4) }]) {
      expect(await verifySensitiveProof(proof, { ...options, keys })).toBeNull();
    }
  });
  it("refuses invalid or extended claim sets and weak signing keys", async () => {
    for (const invalid of [{ ...claims, expiresAt: 1121 }, { ...claims, expiresAt: 1000 }, { ...claims, nonce: "bad" }, { ...claims, extra: true }, { ...claims, issuedAt: -1 }]) {
      await expect(signSensitiveProof(invalid, key)).rejects.toThrow("Invalid proof claims");
    }
    await expect(signSensitiveProof(claims, new Uint8Array(16))).rejects.toThrow("Invalid signing key");
  });
});
