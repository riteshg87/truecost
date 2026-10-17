import { describe, expect, it, vi } from "vitest";
import { createDeletionJournal, type DeletionJournalStorage } from "../lib/privacy/deletion-journal";
import { createDeletionRecovery } from "../lib/privacy/deletion-recovery";

const NOW = 1_700_000_000_000;
const REQUEST_ID = "00000000-0000-4000-8000-000000000010";

function storage(): DeletionJournalStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function seed(subject = "user-a", sessionId = "session-a") {
  const journal = createDeletionJournal({ storage: storage(), now: () => NOW });
  const record = { version: 1 as const, requestId: REQUEST_ID, grantId: "grant-a", subject, sessionId, createdAt: NOW, phase: "submitting" as const };
  journal.write(record);
  return { journal, record };
}

describe("deletion reload recovery", () => {
  it("treats an authenticated matching receipt as accepted and advances the journal", async () => {
    const { journal, record } = seed();
    const recovery = createDeletionRecovery({
      journal,
      getCurrentClerkSession: () => ({ subject: "user-a", sessionId: "session-a" }),
      queryReceipt: vi.fn(async () => ({ requestId: REQUEST_ID, ownerId: "owner-a", status: "app_pending" })),
      replay: vi.fn(),
    });
    await expect(recovery.reconcile()).resolves.toMatchObject({ kind: "accepted", record: { requestId: REQUEST_ID, phase: "accepted" } });
    expect(journal.read(record)).toMatchObject({ kind: "ok", record: { phase: "accepted" } });
  });

  it("keeps a missing receipt retryable and replays the exact pair only on retry", async () => {
    const { journal } = seed();
    const replay = vi.fn(async () => "replayed" as const);
    const queryReceipt = vi.fn(async () => null);
    const recovery = createDeletionRecovery({ journal, getCurrentClerkSession: () => ({ subject: "user-a", sessionId: "session-a" }), queryReceipt, replay });
    await expect(recovery.reconcile()).resolves.toMatchObject({ kind: "retryable", reason: "receipt_missing" });
    expect(replay).not.toHaveBeenCalled();
    await expect(recovery.retry()).resolves.toMatchObject({ kind: "accepted", record: { requestId: REQUEST_ID, grantId: "grant-a" } });
    expect(replay).toHaveBeenCalledWith({ requestId: REQUEST_ID, grantId: "grant-a", subject: "user-a", sessionId: "session-a" });
    expect(queryReceipt).toHaveBeenCalledTimes(2);
  });

  it("does not read, query, or replay a foreign-session journal", async () => {
    const { journal } = seed("user-a", "session-a");
    const queryReceipt = vi.fn(async () => null);
    const replay = vi.fn(async () => "replayed" as const);
    const recovery = createDeletionRecovery({ journal, getCurrentClerkSession: () => ({ subject: "user-b", sessionId: "session-b" }), queryReceipt, replay });
    await expect(recovery.reconcile()).resolves.toEqual({ kind: "foreign-session" });
    await expect(recovery.retry()).resolves.toEqual({ kind: "foreign-session" });
    expect(queryReceipt).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it("coalesces concurrent receipt checks and fences a late identity change", async () => {
    const { journal } = seed();
    let resolveReceipt!: (value: unknown) => void;
    const queryReceipt = vi.fn(() => new Promise((resolve) => { resolveReceipt = resolve; }));
    let current = { subject: "user-a", sessionId: "session-a" };
    const recovery = createDeletionRecovery({ journal, getCurrentClerkSession: () => current, queryReceipt, replay: vi.fn() });
    const first = recovery.reconcile();
    const second = recovery.reconcile();
    expect(first).toBe(second);
    current = { subject: "user-b", sessionId: "session-b" };
    resolveReceipt({ requestId: REQUEST_ID, ownerId: "owner-a", status: "app_pending" });
    await expect(first).resolves.toEqual({ kind: "account_changed" });
  });

  it("reports storage failure without attempting a receipt or replay", async () => {
    const journal = createDeletionJournal({ storage: null, now: () => NOW });
    const queryReceipt = vi.fn(async () => null);
    const replay = vi.fn(async () => "replayed" as const);
    const recovery = createDeletionRecovery({ journal, getCurrentClerkSession: () => ({ subject: "user-a", sessionId: "session-a" }), queryReceipt, replay });
    await expect(recovery.reconcile()).resolves.toEqual({ kind: "unavailable", reason: "storage" });
    expect(queryReceipt).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });
});
