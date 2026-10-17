import { isCurrentAuthFlow, type AuthFlowState } from "./flow";

export type CurrentRequestResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "stale" };

export type FinalizeDisposition = "ok" | "blocked" | "error";

export const AUTH_SEND_TIMEOUT_MS = 30_000;

/** A provider send that exceeded its local bound; callers can show retry copy. */
export class AuthRequestTimeoutError extends Error {
  constructor() {
    super("authentication request timed out");
    this.name = "AuthRequestTimeoutError";
  }
}

/**
 * The signUpIfMissing flow reports a missing account only after the email
 * code has been verified. Keep this narrow code check separate from generic
 * provider error rendering. The adapter receives this value from Clerk,
 * never from an email or code field.
 */
export function isSignUpIfMissingTransfer(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const errors = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((entry) => (
    entry !== null &&
    typeof entry === "object" &&
    (entry as { code?: unknown }).code === "sign_up_if_missing_transfer"
  ));
}

export function finalizeDisposition(result: { error?: unknown }, blockedByTask: boolean): FinalizeDisposition {
  if (result.error) return "error";
  if (blockedByTask) return "blocked";
  return "ok";
}

/**
 * Runs one provider request only while its flow generation is current. The
 * caller still decides how to render the error or transition the phase; this
 * helper makes late SDK callbacks observable and testable in one place.
 */
export async function runCurrentAuthRequest<T>(
  flow: { current: AuthFlowState },
  generation: number,
  request: () => Promise<T>,
): Promise<CurrentRequestResult<T>> {
  if (!isCurrentAuthFlow(flow.current, generation)) return { kind: "stale" };
  try {
    const value = await request();
    return isCurrentAuthFlow(flow.current, generation)
      ? { kind: "ok", value }
      : { kind: "stale" };
  } catch (error) {
    return isCurrentAuthFlow(flow.current, generation)
      ? { kind: "error", error }
      : { kind: "stale" };
  }
}

/**
 * Bounds only the initial code-send requests. The underlying SDK promise may
 * finish later, but its completion is fenced by the flow generation and can
 * never advance the caller after this result settles.
 */
export function runCurrentAuthRequestWithTimeout<T>(
  flow: { current: AuthFlowState },
  generation: number,
  request: () => Promise<T>,
  timeoutMs = AUTH_SEND_TIMEOUT_MS,
): Promise<CurrentRequestResult<T>> {
  if (!isCurrentAuthFlow(flow.current, generation)) return Promise.resolve({ kind: "stale" });
  return new Promise<CurrentRequestResult<T>>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: CurrentRequestResult<T>): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      finish(isCurrentAuthFlow(flow.current, generation)
        ? { kind: "error", error: new AuthRequestTimeoutError() }
        : { kind: "stale" });
    }, timeoutMs);
    // Invoke the existing runner directly. It checks the generation before
    // invoking the provider and fences both fulfillment and rejection after it
    // starts, without introducing a stale microtask dispatch window.
    void runCurrentAuthRequest(flow, generation, request).then(finish);
  });
}
