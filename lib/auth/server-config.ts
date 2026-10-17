import { readPublicKey } from "./config";

// This module is imported only by proxy.ts. The secret is never exported and
// is therefore never part of the browser bundle.
const secret = process.env.CLERK_SECRET_KEY?.trim() ?? "";
export function isValidServerSecret(value: unknown): value is string {
  return typeof value === "string" && /^sk_(test|live)_[A-Za-z0-9_-]{16,256}$/.test(value.trim());
}
export function areClerkKeysCompatible(publicKey: unknown, secretKey: unknown): boolean {
  if (!isValidServerSecret(secretKey) || typeof publicKey !== "string") return false;
  const publicMode = /^pk_(test|live)_/.exec(publicKey.trim())?.[1];
  const secretMode = /^sk_(test|live)_/.exec(secretKey.trim())?.[1];
  return publicMode !== undefined && publicMode === secretMode;
}
export const serverClerkConfigured = Boolean(
  readPublicKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    areClerkKeysCompatible(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secret),
);
