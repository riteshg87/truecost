/** Public runtime configuration. Secret keys never belong in this module. */

const CONTROL = /[\u0000-\u001f\u007f\s]/;

export function readPublicKey(value: string | undefined): string | null {
  const key = value?.trim() ?? "";
  if (!key || CONTROL.test(key)) return null;
  const match = /^(pk_test_|pk_live_)([A-Za-z0-9_-]+)$/.exec(key);
  if (!match) return null;
  const encodedHost = match[2];
  if (encodedHost.length < 16 || encodedHost.length > 256) return null;
  try {
    const padded = encodedHost.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encodedHost.length % 4)) % 4);
    const decoded = atob(padded);
    if (!/^[\x20-\x7e]+$/.test(decoded)) return null;
    // Clerk's publishable key encoding appends exactly one literal `$` after
    // the decoded frontend API host. Requiring it prevents arbitrary base64
    // strings from reaching the SDK.
    if (!decoded.endsWith("$") || decoded.indexOf("$") !== decoded.length - 1) return null;
    const host = decoded.slice(0, -1).toLowerCase();
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
    return key;
  } catch {
    return null;
  }
}

export function readConvexUrl(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw || CONTROL.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol === "https:" && /^[a-z0-9-]+\.convex\.cloud$/.test(url.hostname) && (!url.port || url.port === "443")) {
      return url.toString().replace(/\/$/, "");
    }
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port) {
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return null;
  }
  return null;
}

export const AUTH_CONFIG = Object.freeze({
  clerkPublishableKey: readPublicKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
  convexUrl: readConvexUrl(process.env.NEXT_PUBLIC_CONVEX_URL),
});

export const authProviderConfigured = Boolean(
  AUTH_CONFIG.clerkPublishableKey && AUTH_CONFIG.convexUrl,
);

export const authUnavailableMessage =
  "Account sign-in is temporarily unavailable. You can still compare offers as a guest.";
