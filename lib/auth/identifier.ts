/**
 * One field, two kinds of answer.
 *
 * Asking someone to pick "email or mobile" before typing is a tap that earns
 * nothing — the shape of what they type already says which it is. This works
 * out the kind, normalises it into the form the provider expects, and refuses
 * early enough that nobody waits on a network round trip to be told they
 * mistyped.
 */

export type ChannelKind = "email" | "phone";

export interface ParsedIdentifier {
  kind: ChannelKind;
  /** What gets sent: a lowercased address, or E.164 with the country code. */
  value: string;
  /** What gets shown back: the address, or a spaced national number. */
  display: string;
}

export type ParseResult =
  | { ok: true; id: ParsedIdentifier }
  | { ok: false; reason: string };

/** India only for now, which is who the product is for. */
export const DEFAULT_DIAL_CODE = "91";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function digitsOf(input: string): string {
  return input.replace(/\D/g, "");
}

export function looksLikeEmail(input: string): boolean {
  return input.includes("@");
}

export function parseIdentifier(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, reason: "Enter your mobile number or email" };

  if (looksLikeEmail(input)) {
    const value = input.toLowerCase();
    if (!EMAIL.test(value)) return { ok: false, reason: "That email doesn't look right" };
    return { ok: true, id: { kind: "email", value, display: value } };
  }

  let digits = digitsOf(input);
  // Tolerate 0-prefixed and +91-prefixed forms; people type both.
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith(DEFAULT_DIAL_CODE)) {
    digits = digits.slice(DEFAULT_DIAL_CODE.length);
  }

  if (digits.length !== 10) {
    return { ok: false, reason: "Enter a 10-digit mobile number" };
  }
  // Indian mobile numbers start 6-9. Catching it here saves an SMS that would
  // never arrive and a minute of someone staring at an empty inbox.
  if (!/^[6-9]/.test(digits)) {
    return { ok: false, reason: "That doesn't look like a mobile number" };
  }

  return {
    ok: true,
    id: {
      kind: "phone",
      value: `+${DEFAULT_DIAL_CODE}${digits}`,
      display: `${digits.slice(0, 5)} ${digits.slice(5)}`,
    },
  };
}

/** How the destination is described on the OTP screen. */
export function maskedDestination(id: ParsedIdentifier): string {
  if (id.kind === "phone") {
    const digits = digitsOf(id.value).slice(-10);
    return `●●●●● ${digits.slice(5)}`;
  }
  const [user, domain] = id.value.split("@");
  const head = user.slice(0, 2);
  return `${head}${"●".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/** OTPs are six digits. Anything else is not worth sending to the provider. */
export function isCompleteOtp(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}
