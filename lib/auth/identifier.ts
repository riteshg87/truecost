/**
 * Email, and only email.
 *
 * Mobile OTP needs an SMS gateway with KYC and a per-message cost before an
 * Indian number will ever receive anything. Email works the day it is switched
 * on, so the product asks for the one that can actually deliver rather than
 * offering a choice where half of it silently fails.
 */

export type ChannelKind = "email";

export interface ParsedIdentifier {
  kind: ChannelKind;
  /** Lowercased, trimmed — what gets sent to the provider. */
  value: string;
  /** What gets shown back. */
  display: string;
}

export type ParseResult =
  | { ok: true; id: ParsedIdentifier }
  | { ok: false; reason: string };

// Deliberately loose. Anything stricter rejects addresses that are perfectly
// valid, and the code that never arrives is the real validation.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseIdentifier(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, reason: "Enter your email address" };

  // A number in this field means someone expected mobile. Say so plainly
  // rather than failing on a regex they will read as a typo.
  if (/^[\d+\s()-]+$/.test(input)) {
    return { ok: false, reason: "Mobile sign-in isn't available yet — use your email" };
  }

  const value = input.toLowerCase();
  if (!EMAIL.test(value)) return { ok: false, reason: "That email doesn't look right" };

  return { ok: true, id: { kind: "email", value, display: value } };
}

/** How the destination is described on the code screen. */
export function maskedDestination(id: ParsedIdentifier): string {
  const [user, domain] = id.value.split("@");
  const head = user.slice(0, 2);
  return `${head}${"●".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/** OTPs are six digits. Anything else is not worth sending to the provider. */
export function isCompleteOtp(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}
