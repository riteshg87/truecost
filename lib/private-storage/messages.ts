import type { PrivateResult } from "./types";

/** User-facing recovery copy only. Never display provider error contents. */
export function privateWriteError(result: PrivateResult<unknown>): string | null {
  switch (result.kind) {
    case "ok": return null;
    case "locked": return result.reason === "offline"
      ? "The account connection is unavailable. Reconnect and try again."
      : "Your private loan is locked. Connect and sign in again before saving.";
    case "storage-unavailable": return "This browser could not store your change. Keep this page open and try again.";
    case "invalid": return "This change could not be saved. Check the values and try again.";
    case "not-found": return "The loan is no longer available. Open Loan Health to check its current state.";
    case "paused": return "Saving is paused. Review the sync choices before making another change.";
    case "expired": return "This queued change has expired. Review it before submitting again.";
  }
}
