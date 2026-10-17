import { describe, expect, it } from "vitest";
import {
  AUTH_INTENT_LEASE_MS,
  claimAuthIntent,
  completeAuthIntent,
  createAuthIntent,
  cancelAuthIntent,
  decodeAuthIntent,
  destinationForAuthIntent,
  type IntentContext,
} from "../auth-intent";
import { ContractValidationError } from "../errors";

const RESULT_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-09-15T20:00:00.000Z";
const context = (
  accountKeyHash = "account-a",
  authEpoch = 4,
  now = NOW,
  initiatingTabId = "tab-1",
  claimId?: string,
) => ({ initiatingTabId, accountKeyHash, authEpoch, now, claimId });
const guestContext = (now = NOW, initiatingTabId = "tab-1") => ({ initiatingTabId, now });

function intent() {
  return createAuthIntent({
    action: "save",
    resultId: RESULT_ID,
    initiatingTabId: "tab-1",
    now: NOW,
  });
}

describe("auth intents", () => {
  it("uses fixed safe destinations and validates action references", () => {
    expect(destinationForAuthIntent("save")).toBe("/compare/results");
    expect(destinationForAuthIntent("download")).toBe("/compare/results");
    expect(destinationForAuthIntent("new_comparison")).toBe("/compare");
    expect(destinationForAuthIntent("recalculate_existing_draft")).toBe("/compare");
    expect(() => createAuthIntent({ action: "save", initiatingTabId: "t", now: NOW })).toThrow(ContractValidationError);
    expect(() => createAuthIntent({ action: "recalculate_existing_draft", initiatingTabId: "t", now: NOW })).toThrow(ContractValidationError);
  });

  it("keeps pending intents unbound, then binds the first verified claim", () => {
    const pending = intent();
    expect(pending.accountKeyHash).toBeNull();
    expect(pending.authEpoch).toBeNull();
    const claimed = claimAuthIntent(pending, context("account-b", 9));
    expect(claimed.ok && claimed.status).toBe("claimed");
    if (!claimed.ok) return;
    expect(claimed.intent.accountKeyHash).toBe("account-b");
    expect(claimed.intent.authEpoch).toBe(9);
    expect(claimed.intent.claimId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });

  it("claims and completes only from the same account, epoch, and tab", () => {
    const claimed = claimAuthIntent(intent(), context());
    if (!claimed.ok) throw new Error("claim should succeed");
    expect(completeAuthIntent(claimed.intent, context()).ok).toBe(false);
    const completed = completeAuthIntent(claimed.intent, context("account-a", 4, NOW, "tab-1", claimed.intent.claimId!));
    expect(completed.ok && completed.status).toBe("completed");
    if (completed.ok) expect(completed.intent.state).toBe("completed");
    expect(completeAuthIntent(claimed.intent, context("account-b", 4, NOW, "tab-1", claimed.intent.claimId!)).ok).toBe(false);
    expect(completeAuthIntent(claimed.intent, context("account-a", 5, NOW, "tab-1", claimed.intent.claimId!)).ok).toBe(false);
    expect(completeAuthIntent(claimed.intent, context("account-a", 4, NOW, "tab-2", claimed.intent.claimId!)).ok).toBe(false);
  });

  it("rejects completion or cancellation before the current claim time", () => {
    const claimedAt = new Date(Date.parse(NOW) + 60_000).toISOString();
    const claimed = claimAuthIntent(intent(), context("account-a", 4, claimedAt));
    if (!claimed.ok) throw new Error("claim should succeed");
    const beforeClaim = context("account-a", 4, NOW, "tab-1", claimed.intent.claimId!);
    expect(completeAuthIntent(claimed.intent, beforeClaim).ok).toBe(false);
    expect(cancelAuthIntent(claimed.intent, beforeClaim).ok).toBe(false);
  });

  it("rejects another account after first claim and preserves the binding on recovery", () => {
    const pending = intent();
    const claimed = claimAuthIntent(pending, context("account-a", 4));
    if (!claimed.ok) throw new Error("claim should succeed");
    expect(claimAuthIntent(claimed.intent, context("account-b", 4)).ok).toBe(false);
    const afterLease = new Date(Date.parse(NOW) + AUTH_INTENT_LEASE_MS + 1).toISOString();
    const recovered = claimAuthIntent(claimed.intent, context("account-a", 4, afterLease));
    expect(recovered.ok && recovered.status).toBe("claimed");
    if (!recovered.ok) return;
    expect(recovered.intent.requestId).toBe(claimed.intent.requestId);
    expect(recovered.intent.claimId).not.toBe(claimed.intent.claimId);
    expect(recovered.intent.accountKeyHash).toBe("account-a");
    expect(recovered.intent.authEpoch).toBe(4);
    expect(completeAuthIntent(recovered.intent, context("account-a", 4, afterLease, "tab-1", claimed.intent.claimId!)).ok).toBe(false);
    expect(cancelAuthIntent(recovered.intent, context("account-a", 4, afterLease, "tab-1", claimed.intent.claimId!)).ok).toBe(false);
    expect(completeAuthIntent(recovered.intent, context("account-a", 4, afterLease, "tab-1", recovered.intent.claimId!)).ok).toBe(true);
  });

  it("requires the current claim for cancellation and binds tab checks", () => {
    const pending = intent();
    expect(cancelAuthIntent(pending, guestContext(NOW, "tab-2")).ok).toBe(false);
    const cancelled = cancelAuthIntent(pending, guestContext());
    expect(cancelled.ok && cancelled.status).toBe("cancelled");
    if (cancelled.ok) {
      expect(cancelled.intent.accountKeyHash).toBeNull();
      // Runtime hostile payload: the public completion API requires a verified context.
      expect(completeAuthIntent(cancelled.intent, guestContext() as unknown as IntentContext).ok).toBe(false);
    }
    const claimed = claimAuthIntent(intent(), context());
    if (!claimed.ok) throw new Error("claim should succeed");
    expect(cancelAuthIntent(claimed.intent, context("account-a", 4, NOW, "tab-2", claimed.intent.claimId!)).ok).toBe(false);
    expect(cancelAuthIntent(claimed.intent, guestContext(NOW)).ok).toBe(false);
    const done = cancelAuthIntent(claimed.intent, context("account-a", 4, NOW, "tab-1", claimed.intent.claimId!));
    expect(done.ok && done.status).toBe("cancelled");
  });

  it("rejects expired, pre-creation, overlong, and impossible persisted states", () => {
    const pending = intent();
    const expired = claimAuthIntent(pending, context("account-a", 4, "2026-09-15T20:11:00.000Z"));
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error.code).toBe("expired");
    expect(claimAuthIntent(pending, context("account-a", 4, "2026-09-15T19:59:59.999Z")).ok).toBe(false);
    expect(() => decodeAuthIntent({ ...pending, expiresAt: "2026-09-16T20:00:00.001Z" })).toThrowError(/TTL/);
    const impossible = {
      ...pending,
      state: "completed" as const,
      accountKeyHash: "account-a",
      authEpoch: 4,
      claimId: pending.nonce,
      claimedAt: NOW,
      completedAt: NOW,
      cancelledAt: NOW,
    };
    expect(() => decodeAuthIntent(impossible)).toThrow(ContractValidationError);
  });

  it("round-trips strict persisted state", () => {
    const saved = intent();
    expect(decodeAuthIntent(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(() => decodeAuthIntent({ ...saved, unknown: true })).toThrow(ContractValidationError);
    expect(() => decodeAuthIntent({ ...saved, schemaVersion: 2 })).toThrowError(/unsupported/);
  });
});
