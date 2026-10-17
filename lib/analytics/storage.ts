const KEY = "truecost.analytics.preference.v1";
const CONFIRMED_LOGOUT_KEY = "truecost.analytics.confirmed-logout.v1";
let inMemoryConfirmedLogout = false;

export type LocalAnalyticsPreference = { readonly consent: "unknown" | "declined" | "accepted"; readonly policyVersion: "v1" };
export type PendingAnalyticsDecline = { readonly revision: number; readonly nonce: string };
export type PendingAnalyticsDeclineRead = PendingAnalyticsDecline | { readonly invalid: true };

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function readLocalAnalyticsPreference(): LocalAnalyticsPreference {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return { consent: "unknown", policyVersion: "v1" };
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!["unknown", "declined", "accepted"].includes(value.consent as string) || value.policyVersion !== "v1") throw new Error();
    return Object.freeze({ consent: value.consent as LocalAnalyticsPreference["consent"], policyVersion: "v1" });
  } catch { return { consent: "unknown", policyVersion: "v1" }; }
}

export function writeLocalAnalyticsPreference(consent: LocalAnalyticsPreference["consent"]): boolean {
  try { const target = store(); if (!target) return false; target.setItem(KEY, JSON.stringify({ consent, policyVersion: "v1" })); return true; } catch { return false; }
}

export function clearLocalAnalyticsPreference(): void { try { store()?.removeItem(KEY); } catch { /* unavailable storage is safe */ } }

/** Mark only a provider-confirmed auth sign-out, not a transient session loss. */
export function markConfirmedAnalyticsLogout(): boolean {
  try {
    const target = store();
    if (!target) throw new Error("storage unavailable");
    target.setItem(CONFIRMED_LOGOUT_KEY, String(Date.now()));
    if (target.getItem(CONFIRMED_LOGOUT_KEY) === null) throw new Error("storage write failed");
    inMemoryConfirmedLogout = false;
    return true;
  } catch {
    // Keep same-runtime consumers fail-closed even when quota blocks the
    // durable marker. The auth boundary also performs a synchronous fallback.
    inMemoryConfirmedLogout = true;
    return false;
  }
}

/** Revoke only an accepted local grant when durable logout signalling fails. */
export function revokeAcceptedLocalAnalyticsPreference(): boolean {
  try {
    const target = store();
    if (!target) return false;
    const raw = target.getItem(KEY);
    if (!raw) return true;
    const value = JSON.parse(raw) as { consent?: unknown; policyVersion?: unknown };
    if (value.policyVersion !== "v1" || value.consent !== "accepted") return true;
    target.removeItem(KEY);
    return target.getItem(KEY) === null;
  } catch { return false; }
}

/** Consume the marker from guest scope before local consent can hydrate. */
export type ConfirmedLogoutConsumption = "none" | "cleared" | "retry";

export function consumeConfirmedAnalyticsLogout(): ConfirmedLogoutConsumption {
  try {
    const target = store();
    if (!target) return inMemoryConfirmedLogout ? "retry" : "none";
    if (!inMemoryConfirmedLogout && !target.getItem(CONFIRMED_LOGOUT_KEY)) return "none";
    // A declined choice is already opted out and must survive ordinary
    // logout. Accepted is the only local grant that needs revocation.
    const rawPreference = target.getItem(KEY);
    let consent: LocalAnalyticsPreference["consent"] = "unknown";
    if (rawPreference) {
      try {
        const parsed = JSON.parse(rawPreference) as { consent?: unknown; policyVersion?: unknown };
        if (parsed.policyVersion === "v1" && ["unknown", "declined", "accepted"].includes(parsed.consent as string)) consent = parsed.consent as LocalAnalyticsPreference["consent"];
      } catch { consent = "unknown"; }
    }
    if (consent === "accepted") {
      target.removeItem(KEY);
      if (target.getItem(KEY) !== null) return "retry";
    }
    target.removeItem(CONFIRMED_LOGOUT_KEY);
    if (target.getItem(CONFIRMED_LOGOUT_KEY) !== null) return "retry";
    inMemoryConfirmedLogout = false;
    return "cleared";
  } catch { return "retry"; }
}

export const CONFIRMED_LOGOUT_STORAGE_KEY = CONFIRMED_LOGOUT_KEY;

export function notifyAnalyticsPreference(): void {
  try { if (typeof window !== "undefined" && "BroadcastChannel" in window) { const channel = new BroadcastChannel("truecost.analytics.preference.v1"); channel.postMessage({ changed: true }); channel.close(); } } catch { /* optional */ }
}

function pendingKey(scope: string): string { return `truecost.analytics.pending-decline.v1.${scope}`; }
export function readPendingAnalyticsDecline(scope: string): PendingAnalyticsDeclineRead | null {
  try {
    const target = store();
    if (typeof window !== "undefined" && !target) return { invalid: true };
    const raw = target?.getItem(pendingKey(scope));
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    return typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
      typeof value.nonce === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.nonce)
      ? { revision: value.revision, nonce: value.nonce } : { invalid: true };
  } catch { return { invalid: true }; }
}
export function writePendingAnalyticsDecline(scope: string, revision: number, nonce: string): boolean {
  try { const target = store(); if (!target) return false; target.setItem(pendingKey(scope), JSON.stringify({ revision, nonce })); return true; } catch { return false; }
}
export function clearPendingAnalyticsDecline(scope: string, expected?: PendingAnalyticsDecline): void {
  try {
    const target = store();
    if (!target) return;
    if (expected) {
      const current = readPendingAnalyticsDecline(scope);
      if (!current || "invalid" in current || current.nonce !== expected.nonce || current.revision !== expected.revision) return;
    }
    target.removeItem(pendingKey(scope));
  } catch { /* unavailable storage is safe */ }
}
