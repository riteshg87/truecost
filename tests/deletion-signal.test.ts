// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import {
  DELETION_SIGNAL_CHANNEL,
  DELETION_SIGNAL_KEY,
  getAccountDeletionCleanupScope,
  getAccountDeletionCleanupSnapshot,
  captureAccountDeletionSignal,
  isAccountDeletionSignal,
  publishAccountDeletionSignal,
  registerAccountDeletionCleanup,
  retryAccountDeletionCleanup,
  subscribeToAccountDeletionSignal,
} from "../lib/privacy/deletion-signal";

function access(profileId: string, sessionId: string, authEpoch: number, current: () => boolean = () => true): PrivateSessionAccess {
  return {
    identity: { profileId, subject: `subject-${profileId}`, sessionId, authEpoch, verifiedOnline: true },
    getToken: vi.fn(async () => "must-not-be-read"),
    isCurrent: current,
  };
}

class FakeBroadcastChannel {
  static channels = new Set<FakeBroadcastChannel>();
  readonly name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.channels.add(this);
  }

  postMessage(data: unknown): void {
    for (const peer of [...FakeBroadcastChannel.channels]) {
      if (peer !== this && peer.name === this.name) peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    FakeBroadcastChannel.channels.delete(this);
  }
}

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeBroadcastChannel.channels.clear();
});

describe("account deletion signal", () => {
  const settleCleanup = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("revokes a local subscriber even when its channel failed to open", () => {
    const current = access("profile-a", "session-a", 1);
    const revoke = vi.fn();
    const subscription = subscribeToAccountDeletionSignal({
      access: current, onRevoke: revoke,
      channelFactory: () => { throw new Error("channel unavailable"); },
    });
    expect(publishAccountDeletionSignal(current)).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(1);
    subscription.stop();
  });

  it("accepts only the small account-scoped wire shape", () => {
    expect(isAccountDeletionSignal({ type: "account-deletion", profileId: "profile-a" })).toBe(true);
    expect(isAccountDeletionSignal({ type: "account-deletion", profileId: " profile-a " })).toBe(true);
    expect(isAccountDeletionSignal({ type: "account-deletion", profileId: "profile-a", sessionId: "secret" })).toBe(false);
    expect(isAccountDeletionSignal({ type: "account-deletion", profileId: "profile-a", authEpoch: 2 })).toBe(false);
    expect(isAccountDeletionSignal({ type: "account-deletion", profileId: "   " })).toBe(false);
    expect(isAccountDeletionSignal({ type: "other", profileId: "profile-a" })).toBe(false);
    expect(isAccountDeletionSignal({ type: "account-deletion", profileId: "profile-a", token: "secret" })).toBe(false);
    expect(isAccountDeletionSignal(null)).toBe(false);
  });

  it("notifies the sender and every current lifetime for that account via BroadcastChannel", () => {
    const sender = access("profile-a", "session-a", 1);
    const sameAccount = access("profile-a", "session-b", 9);
    const foreign = access("profile-b", "session-b", 1);
    const senderRevoke = vi.fn();
    const sameRevoke = vi.fn();
    const foreignRevoke = vi.fn();
    const subscriptions = [
      subscribeToAccountDeletionSignal({ access: sender, onRevoke: senderRevoke }),
      subscribeToAccountDeletionSignal({ access: sameAccount, onRevoke: sameRevoke }),
      subscribeToAccountDeletionSignal({ access: foreign, onRevoke: foreignRevoke }),
    ];

    expect(publishAccountDeletionSignal(sender)).toBe(true);
    expect(senderRevoke).toHaveBeenCalledTimes(1);
    expect(sameRevoke).toHaveBeenCalledTimes(1);
    expect(foreignRevoke).not.toHaveBeenCalled();
    expect(sender.getToken).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DELETION_SIGNAL_KEY)).toBeNull();
    subscriptions.forEach((subscription) => subscription.stop());
  });

  it("publishes a captured account scope after the sender lifetime is revoked", () => {
    let senderCurrent = true;
    const sender = access("profile-a", "session-a", 1, () => senderCurrent);
    const otherLifetime = access("profile-a", "session-b", 2);
    const foreign = access("profile-b", "session-b", 1);
    const senderRevoke = vi.fn();
    const otherRevoke = vi.fn();
    const foreignRevoke = vi.fn();
    const subscriptions = [
      subscribeToAccountDeletionSignal({ access: sender, onRevoke: senderRevoke }),
      subscribeToAccountDeletionSignal({ access: otherLifetime, onRevoke: otherRevoke }),
      subscribeToAccountDeletionSignal({ access: foreign, onRevoke: foreignRevoke }),
    ];
    const captured = captureAccountDeletionSignal(sender, true);
    expect(captured).not.toBeNull();
    senderCurrent = false;

    expect(captured!.publish()).toBe(true);
    expect(senderRevoke).not.toHaveBeenCalled();
    expect(otherRevoke).toHaveBeenCalledTimes(1);
    expect(foreignRevoke).not.toHaveBeenCalled();
    subscriptions.forEach((subscription) => subscription.stop());
  });

  it("uses storage events when BroadcastChannel is unavailable and ignores malformed or foreign data", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const current = access("profile-a", "session-a", 1);
    const foreign = access("profile-b", "session-b", 1);
    const revoke = vi.fn();
    const foreignRevoke = vi.fn();
    const currentSubscription = subscribeToAccountDeletionSignal({ access: current, onRevoke: revoke });
    const foreignSubscription = subscribeToAccountDeletionSignal({ access: foreign, onRevoke: foreignRevoke });

    const sendStorage = (value: unknown) => window.dispatchEvent(new StorageEvent("storage", {
      key: DELETION_SIGNAL_KEY,
      newValue: JSON.stringify(value),
    }));
    sendStorage({ type: "account-deletion", profileId: "profile-b" });
    expect(foreignRevoke).toHaveBeenCalledTimes(1);
    sendStorage({ type: "account-deletion", profileId: "profile-a", token: "secret" });
    sendStorage({ type: "account-deletion", profileId: "profile-a" });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(foreignRevoke).toHaveBeenCalledTimes(1);

    currentSubscription.stop();
    foreignSubscription.stop();
  });

  it("stops old callbacks and fences a lifetime that is no longer current", () => {
    let current = true;
    const former = access("profile-a", "session-a", 1, () => current);
    const revoke = vi.fn();
    const subscription = subscribeToAccountDeletionSignal({ access: former, onRevoke: revoke });
    subscription.stop();
    window.dispatchEvent(new StorageEvent("storage", {
      key: DELETION_SIGNAL_KEY,
      newValue: JSON.stringify({ type: "account-deletion", profileId: "profile-a" }),
    }));
    expect(revoke).not.toHaveBeenCalled();

    const second = subscribeToAccountDeletionSignal({ access: former, onRevoke: revoke });
    current = false;
    expect(publishAccountDeletionSignal(former)).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    second.stop();
  });

  it("does not retain a channel or callback after teardown", () => {
    const current = access("profile-a", "session-a", 1);
    const revoke = vi.fn();
    const subscription = subscribeToAccountDeletionSignal({ access: current, onRevoke: revoke });
    expect(FakeBroadcastChannel.channels.size).toBe(1);
    subscription.stop();
    subscription.stop();
    expect(FakeBroadcastChannel.channels.size).toBe(0);
    expect(publishAccountDeletionSignal(current)).toBe(true);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("keeps the protocol channel and storage key separate from payload data", () => {
    expect(DELETION_SIGNAL_CHANNEL).toBe("truecost.private.deletion.v1");
    expect(DELETION_SIGNAL_KEY).toBe("truecost.private.deletion.v1");
  });

  it("snapshots registered cleanup before auth revoke and coalesces duplicate signals", async () => {
    const current = access("profile-registry-a", "session-a", 3);
    const cleanup = vi.fn(async () => ({ kind: "cleared" as const }));
    const revoke = vi.fn();
    const registration = registerAccountDeletionCleanup(current, { run: cleanup });
    const signalSubscription = subscribeToAccountDeletionSignal({ access: current, onRevoke: revoke });
    expect(registration).not.toBeNull();

    expect(publishAccountDeletionSignal(current)).toBe(true);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    // A second delivery in the same event loop must share the first cleanup.
    expect(publishAccountDeletionSignal(current)).toBe(true);
    await settleCleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);
    const state = getAccountDeletionCleanupSnapshot(current);
    expect(state.status).toBe("cleared");
    signalSubscription.stop();
    registration?.stop();
  });

  it("keeps a storage failure retryable after the provider unregisters", async () => {
    const current = access("profile-registry-retry", "session-a", 4);
    const scope = getAccountDeletionCleanupScope(current);
    if (!scope) throw new Error("scope was not captured");
    const cleanup = vi.fn()
      .mockResolvedValueOnce({ kind: "retry" as const, reasons: ["storage-failure" as const] })
      .mockResolvedValueOnce({ kind: "cleared" as const });
    const registration = registerAccountDeletionCleanup(current, { run: cleanup });
    const subscription = subscribeToAccountDeletionSignal({ access: current, onRevoke: vi.fn() });
    publishAccountDeletionSignal(current);
    await settleCleanup();
    expect(getAccountDeletionCleanupSnapshot(scope)).toMatchObject({ status: "retry", reasons: ["storage-failure"] });

    registration?.stop();
    await expect(retryAccountDeletionCleanup(scope)).resolves.toMatchObject({ status: "cleared" });
    expect(cleanup).toHaveBeenCalledTimes(2);
    subscription.stop();
  });

  it("does not create a false-cleared state for an empty or foreign registration", async () => {
    const current = access("profile-registry-empty", "session-a", 1);
    const foreign = access("profile-registry-foreign", "session-b", 1);
    const emptyScope = getAccountDeletionCleanupScope(current);
    if (!emptyScope) throw new Error("scope was not captured");
    const foreignCleanup = vi.fn(async () => ({ kind: "cleared" as const }));
    const foreignRegistration = registerAccountDeletionCleanup(foreign, { run: foreignCleanup });
    const subscription = subscribeToAccountDeletionSignal({ access: current, onRevoke: vi.fn() });
    publishAccountDeletionSignal(current);
    await settleCleanup();
    expect(foreignCleanup).not.toHaveBeenCalled();
    expect(getAccountDeletionCleanupSnapshot(emptyScope).status).toBe("idle");
    subscription.stop();
    foreignRegistration?.stop();
  });

  it("keeps a partial store registration pending until both partitions clear", async () => {
    const current = access("profile-registry-partial", "session-a", 1);
    const loanCleanup = vi.fn(async () => ({ kind: "cleared" as const }));
    const comparisonCleanup = vi.fn(async () => ({ kind: "cleared" as const }));
    const loanRegistration = registerAccountDeletionCleanup(current, { run: loanCleanup }, "loan");
    const subscription = subscribeToAccountDeletionSignal({ access: current, onRevoke: vi.fn() });
    publishAccountDeletionSignal(current);
    await settleCleanup();
    expect(loanCleanup).toHaveBeenCalledTimes(1);
    expect(getAccountDeletionCleanupSnapshot(current).status).toBe("pending");

    const comparisonRegistration = registerAccountDeletionCleanup(current, { run: comparisonCleanup }, "comparison");
    await settleCleanup();
    expect(comparisonCleanup).toHaveBeenCalledTimes(1);
    expect(getAccountDeletionCleanupSnapshot(current).status).toBe("cleared");
    subscription.stop();
    loanRegistration?.stop();
    comparisonRegistration?.stop();
  });
});
