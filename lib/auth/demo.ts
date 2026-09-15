/**
 * Sign-in that works before there is a provider to sign in to.
 *
 * Flow 2 is gated on having an account, and a gate in front of a door that does
 * not open is worse than no gate at all — the person taps "Sign in to use",
 * reaches a screen saying sign-in is not configured, and has learned only that
 * the app is broken. This stands in until Supabase keys exist, so the whole
 * journey can be walked today.
 *
 * It is a stand-in, not a shortcut, and the screens say so in as many words.
 * The code is generated on the device and shown on the device. Nothing is sent
 * anywhere, no email arrives, and anyone holding the browser can sign in as
 * anyone — which is exactly why the banner calls it a demo and why the moment
 * NEXT_PUBLIC_SUPABASE_URL appears, none of this file runs.
 *
 * Claiming to have emailed someone when nothing was sent would be the one
 * genuinely dishonest thing this app could do, so the screen never claims it.
 */

const OTP_KEY = "truecost.demo.otp";
const SESSION_KEY = "truecost.demo.session";

/** Long enough to read the code off the screen, short enough to expire. */
const TTL_MS = 10 * 60 * 1000;

export interface DemoSession {
  id: string;
  email: string;
}

interface PendingCode {
  email: string;
  code: string;
  expiresAt: number;
}

/**
 * A stable id for an email, so the same address always keys the same loan
 * record across reloads. Not a security boundary and not trying to be.
 */
export function demoIdFor(email: string): string {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `demo-${h.toString(36)}`;
}

function sixDigits(): string {
  const n =
    typeof crypto !== "undefined" && "getRandomValues" in crypto
      ? crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 1e9);
  return String(100000 + (n % 900000));
}

/** Issue a code and hold it for the verify screen to check. */
export function issueCode(email: string): string {
  const code = sixDigits();
  const pending: PendingCode = { email, code, expiresAt: Date.now() + TTL_MS };
  try {
    window.sessionStorage.setItem(OTP_KEY, JSON.stringify(pending));
  } catch {
    // Blocked storage. The code below still shows, but verify will fail —
    // which is the honest outcome rather than letting anyone through.
  }
  return code;
}

/** The code currently outstanding, so the screen can show what it invented. */
export function pendingCode(email: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(OTP_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingCode;
    if (pending.email !== email || Date.now() > pending.expiresAt) return null;
    return pending.code;
  } catch {
    return null;
  }
}

export type DemoVerify =
  | { ok: true; session: DemoSession }
  | { ok: false; error: string };

export function verifyCode(email: string, code: string): DemoVerify {
  let pending: PendingCode | null = null;
  try {
    const raw = window.sessionStorage.getItem(OTP_KEY);
    pending = raw ? (JSON.parse(raw) as PendingCode) : null;
  } catch {
    pending = null;
  }

  if (!pending || pending.email !== email) {
    return { ok: false, error: "Ask for a new code." };
  }
  if (Date.now() > pending.expiresAt) {
    return { ok: false, error: "That code has expired. Ask for a new one." };
  }
  if (pending.code !== code.trim()) {
    return { ok: false, error: "That code is wrong. Check it and try again." };
  }

  const session: DemoSession = { id: demoIdFor(email), email };
  try {
    window.sessionStorage.removeItem(OTP_KEY);
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // The session lasts in memory for this page at least.
  }
  return { ok: true, session };
}

/** Restore a signed-in demo session across reloads. */
export function readSession(): DemoSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as DemoSession;
    return session.id && session.email ? session : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(OTP_KEY);
  } catch {
    // Nothing to clear.
  }
}
