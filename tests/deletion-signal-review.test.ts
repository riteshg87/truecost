// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import { DELETION_SIGNAL_KEY, getAccountDeletionCleanupScope, getAccountDeletionCleanupSnapshot, registerAccountDeletionCleanup, retryAccountDeletionCleanup, subscribeToAccountDeletionSignal } from "../lib/privacy/deletion-signal";

it("retains retry capability when revocation unregisters before the cleanup microtask", async () => {
  let current = true;
  const access: PrivateSessionAccess = {
    identity: { profileId: "review-unmount-a", subject: "review-user-a", sessionId: "review-session-a", authEpoch: 1, verifiedOnline: true },
    getToken: vi.fn(async () => null),
    isCurrent: () => current,
  };
  const scope = getAccountDeletionCleanupScope(access)!;
  const run = vi.fn().mockResolvedValueOnce({ kind: "retry", reasons: ["storage-failure"] }).mockResolvedValueOnce({ kind: "cleared" });
  const registration = registerAccountDeletionCleanup(access, { run });
  const subscription = subscribeToAccountDeletionSignal({ access, onRevoke: () => {
    current = false;
    registration?.stop();
  } });
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: DELETION_SIGNAL_KEY, newValue: JSON.stringify({ type: "account-deletion", profileId: access.identity.profileId }) }));
    expect(current).toBe(false);
    expect(run).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(getAccountDeletionCleanupSnapshot(scope).status).toBe("retry"));
    await expect(retryAccountDeletionCleanup(scope)).resolves.toMatchObject({ status: "cleared" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(access.getToken).not.toHaveBeenCalled();
  } finally {
    subscription.stop();
    registration?.stop();
  }
});

it("waits for a late comparison cleanup registered during loan cleanup", async () => {
  const access: PrivateSessionAccess = {
    identity: { profileId: "review-late-a", subject: "review-late-user", sessionId: "review-late-session", authEpoch: 2, verifiedOnline: true },
    getToken: vi.fn(async () => null), isCurrent: () => true,
  };
  let finishLoan!: () => void;
  let finishComparison!: () => void;
  const loan = vi.fn(() => new Promise<{ kind: "cleared" }>((resolve) => { finishLoan = () => resolve({ kind: "cleared" }); }));
  const comparison = vi.fn(() => new Promise<{ kind: "cleared" }>((resolve) => { finishComparison = () => resolve({ kind: "cleared" }); }));
  const loanRegistration = registerAccountDeletionCleanup(access, { run: loan }, "loan");
  const subscription = subscribeToAccountDeletionSignal({ access, onRevoke: () => undefined });
  let comparisonRegistration: ReturnType<typeof registerAccountDeletionCleanup> = null;
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: DELETION_SIGNAL_KEY, newValue: JSON.stringify({ type: "account-deletion", profileId: access.identity.profileId }) }));
    await vi.waitFor(() => expect(loan).toHaveBeenCalledTimes(1));
    comparisonRegistration = registerAccountDeletionCleanup(access, { run: comparison }, "comparison");
    await Promise.resolve();
    expect(comparison).not.toHaveBeenCalled();
    finishLoan();
    await vi.waitFor(() => expect(comparison).toHaveBeenCalledTimes(1));
    expect(getAccountDeletionCleanupSnapshot(access).status).toBe("pending");
    finishComparison();
    await vi.waitFor(() => expect(getAccountDeletionCleanupSnapshot(access).status).toBe("cleared"));
    expect(loan).toHaveBeenCalledTimes(1);
  } finally {
    subscription.stop(); loanRegistration?.stop(); comparisonRegistration?.stop();
  }
});
