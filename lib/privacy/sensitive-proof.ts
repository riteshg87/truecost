/** Server-to-server proof, issued only after Clerk's server recency check.
 * Verification does not consume a nonce: the receiving mutation must do that
 * atomically with granting the action. Never accept expected identity from UI.
 */
export type SensitivePurpose = "account_export" | "account_delete";
export interface SensitiveProofClaims {
  v: 1;
  kid: string;
  audience: string;
  subject: string;
  sessionId: string;
  purpose: SensitivePurpose;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}
export const SENSITIVE_PROOF_LIFETIME_SECONDS = 120;
const identifier = /^[A-Za-z0-9_-]{1,200}$/;
const noncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("Noncanonical encoding");
  return bytes;
}
function validClaims(value: unknown): value is SensitiveProofClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = ["v", "kid", "audience", "subject", "sessionId", "purpose", "nonce", "issuedAt", "expiresAt"];
  return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)) && row.v === 1 &&
    [row.kid, row.audience, row.subject, row.sessionId].every((part) => typeof part === "string" && identifier.test(part)) &&
    (row.purpose === "account_export" || row.purpose === "account_delete") && typeof row.nonce === "string" && noncePattern.test(row.nonce) &&
    Number.isSafeInteger(row.issuedAt) && Number.isSafeInteger(row.expiresAt) && (row.issuedAt as number) >= 0 &&
    (row.expiresAt as number) > (row.issuedAt as number) && (row.expiresAt as number) - (row.issuedAt as number) <= SENSITIVE_PROOF_LIFETIME_SECONDS;
}
async function importKey(bytes: Uint8Array): Promise<CryptoKey> {
  if (bytes.length < 32 || bytes.length > 64) throw new Error("Invalid signing key");
  return crypto.subtle.importKey("raw", new Uint8Array(bytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSensitiveProof(claims: SensitiveProofClaims, key: Uint8Array): Promise<string> {
  if (!validClaims(claims)) throw new Error("Invalid proof claims");
  const payload = encode(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("HMAC", await importKey(key), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

export async function verifySensitiveProof(
  proof: unknown,
  options: {
    keys: Readonly<Record<string, Uint8Array>>;
    expected: Pick<SensitiveProofClaims, "audience" | "subject" | "sessionId" | "purpose">;
    nowSeconds: number;
  },
): Promise<Readonly<SensitiveProofClaims> | null> {
  try {
    if (typeof proof !== "string" || proof.length > 4096 || !Number.isSafeInteger(options.nowSeconds)) return null;
    const parts = proof.split(".");
    if (parts.length !== 2) return null;
    const claims: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[0])));
    if (!validClaims(claims) || !Object.hasOwn(options.keys, claims.kid)) return null;
    const { expected, nowSeconds } = options;
    if (claims.subject !== expected.subject || claims.sessionId !== expected.sessionId || claims.purpose !== expected.purpose || claims.audience !== expected.audience ||
        claims.issuedAt > nowSeconds || claims.expiresAt <= nowSeconds) return null;
    const signature = decode(parts[1]);
    if (signature.length !== 32 || !await crypto.subtle.verify("HMAC", await importKey(options.keys[claims.kid]), new Uint8Array(signature), encoder.encode(parts[0]))) return null;
    return Object.freeze(claims);
  } catch { return null; }
}
