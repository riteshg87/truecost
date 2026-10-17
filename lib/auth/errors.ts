type ClerkErrorLike = {
  code?: unknown;
  errors?: unknown;
  cause?: unknown;
};

const MAX_ERROR_DEPTH = 5;
const MAX_ERROR_NODES = 32;
const MAX_NESTED_ERRORS = 8;

/**
 * Clerk's API response error puts machine-readable errors in `errors[]`, while
 * some SDK paths expose a single error or wrap it in `cause`. Walk those
 * shapes without reading message text. Messages are developer-facing and may
 * contain an email address or provider internals.
 */
function errorCodes(
  input: unknown,
  depth = 0,
  seen = new Set<object>(),
  state = { nodes: 0 },
): string[] {
  if (
    depth > MAX_ERROR_DEPTH ||
    state.nodes >= MAX_ERROR_NODES ||
    input === null ||
    typeof input !== "object"
  ) return [];
  if (seen.has(input)) return [];
  seen.add(input);
  state.nodes += 1;

  const error = input as ClerkErrorLike;
  const codes: string[] = [];
  if (typeof error.code === "string") codes.push(error.code);

  if (Array.isArray(error.errors)) {
    for (const nested of error.errors.slice(0, MAX_NESTED_ERRORS)) {
      codes.push(...errorCodes(nested, depth + 1, seen, state));
    }
  }
  if (error.cause !== undefined) {
    codes.push(...errorCodes(error.cause, depth + 1, seen, state));
  }
  return codes;
}

/** Provider errors are mapped to stable copy; raw error objects never reach the UI. */
export function readableProviderError(input: unknown): string {
  const codes = errorCodes(input);
  if (codes.some((code) => code === "dev_monthly_email_limit_exceeded")) {
    return "This test app has reached its email sending limit. Please contact the app owner.";
  }
  if (codes.some((code) => code === "verification_not_sent")) {
    return "We could not send a verification code. Request a new one and try again.";
  }
  if (codes.some((code) => code.includes("rate_limit"))) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (codes.some((code) => code.includes("form_code_incorrect") || code.includes("verification_failed"))) {
    return "That code did not work. Check the email and try again.";
  }
  if (codes.some((code) => code.includes("expired"))) return "That code has expired. Send a new one.";
  if (codes.some((code) => code.includes("captcha"))) return "Complete the security check, then try again.";
  if (codes.some((code) => code.includes("identifier"))) return "We could not start sign-in with that address.";
  return "We could not complete that request. Try again in a moment.";
}
