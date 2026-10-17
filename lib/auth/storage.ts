import { safeNext } from "./access";
import { parseIdentifier } from "./identifier";

export const PENDING_TTL_MS = 15 * 60 * 1000;

export function storageGet(getStorage: () => Storage, key: string): string | null {
  try { return getStorage().getItem(key); } catch { return null; }
}

export function storageSet(getStorage: () => Storage, key: string, value: string): boolean {
  try { getStorage().setItem(key, value); return true; } catch { return false; }
}

export function storageRemove(getStorage: () => Storage, key: string): void {
  try { getStorage().removeItem(key); } catch { /* unavailable storage is non-fatal */ }
}

export function parsePendingRecord(raw: string | null, now = Date.now()): { email: string; next: string } | null {
  try {
    const value = JSON.parse(raw ?? "null") as { email?: unknown; next?: unknown; expiresAt?: unknown } | null;
    const emailResult = typeof value?.email === "string" ? parseIdentifier(value.email) : null;
    if (!value || Object.keys(value).some((key) => !["email", "next", "expiresAt"].includes(key)) || !emailResult?.ok || typeof value.next !== "string" || safeNext(value.next) !== value.next || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) || value.expiresAt < now || value.expiresAt > now + PENDING_TTL_MS) return null;
    return { email: emailResult.id.value, next: value.next };
  } catch {
    return null;
  }
}
