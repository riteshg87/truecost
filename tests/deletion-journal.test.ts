import { describe, expect, it } from "vitest";
import {
  createDeletionJournal,
  DELETION_JOURNAL_KEY,
  type DeletionJournalBinding,
  type DeletionJournalRecord,
  type DeletionJournalStorage,
} from "../lib/privacy/deletion-journal";

const NOW = 1_700_000_000_000;
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const GRANT_ID = "grant-a";

class MemoryStorage implements DeletionJournalStorage {
  value: string | null = null;
  failRead = false;
  failWrite = false;
  failRemove = false;
  getItem(_key: string): string | null {
    if (this.failRead) throw new Error("storage denied");
    return this.value;
  }
  setItem(_key: string, value: string): void {
    if (this.failWrite) throw new Error("storage denied");
    this.value = value;
  }
  removeItem(_key: string): void {
    if (this.failRemove) throw new Error("storage denied");
    this.value = null;
  }
}

function record(overrides: Partial<DeletionJournalRecord> = {}): DeletionJournalRecord {
  return {
    version: 1,
    requestId: REQUEST_ID,
    grantId: GRANT_ID,
    subject: "user-a",
    sessionId: "session-a",
    createdAt: NOW,
    phase: "submitting",
    ...overrides,
  };
}

function binding(value = record()): DeletionJournalBinding {
  const { requestId, grantId, subject, sessionId, createdAt } = value;
  return { requestId, grantId, subject, sessionId, createdAt };
}

function makeJournal(storage = new MemoryStorage()) {
  return { storage, journal: createDeletionJournal({ storage, now: () => NOW }) };
}

describe("DeletionJournal", () => {
  it("round-trips only the allowlisted recovery fields", () => {
    const { storage, journal } = makeJournal();
    const result = journal.write({ ...record(), proof: "secret", token: "secret", email: "private@example.test" } as DeletionJournalRecord & Record<string, unknown>);
    expect(result).toEqual({ kind: "written", record: record() });
    expect(JSON.parse(storage.value!)).toEqual(record());
    expect(storage.value).not.toContain("proof");
    expect(storage.value).not.toContain("token");
    expect(storage.value).not.toContain("email");
    expect(journal.read({ subject: "user-a", sessionId: "session-a" })).toEqual({ kind: "ok", record: record() });
  });

  it("distinguishes missing storage from storage failures", () => {
    const missing = makeJournal(new MemoryStorage());
    expect(missing.journal.read({ subject: "user-a", sessionId: "session-a" })).toEqual({ kind: "missing" });

    const deniedRead = new MemoryStorage(); deniedRead.failRead = true;
    expect(makeJournal(deniedRead).journal.read({ subject: "user-a", sessionId: "session-a" })).toEqual({ kind: "unavailable", operation: "read", reason: "storage_unavailable" });

    const deniedWrite = new MemoryStorage(); deniedWrite.failWrite = true;
    expect(makeJournal(deniedWrite).journal.write(record())).toEqual({ kind: "unavailable", operation: "write", reason: "storage_unavailable" });
  });

  it("fails closed for corrupted, oversized, future and unexpected records", () => {
    const { storage, journal } = makeJournal();
    const cases = [
      "{not-json",
      JSON.stringify({ ...record(), unexpected: true }),
      JSON.stringify({ ...record(), createdAt: NOW + 1 }),
      JSON.stringify({ ...record(), grantId: "x".repeat(201) }),
      `${" ".repeat(2049)}`,
    ];
    for (const value of cases) {
      storage.value = value;
      expect(journal.read({ subject: "user-a", sessionId: "session-a" })).toEqual({ kind: "invalid", reason: "stored_record" });
    }
  });

  it("rejects invalid new records before touching storage", () => {
    const { storage, journal } = makeJournal();
    expect(journal.write(record({ requestId: "request-a" }))).toEqual({ kind: "invalid", reason: "record" });
    expect(journal.write(record({ createdAt: NOW + 1 }))).toEqual({ kind: "invalid", reason: "record" });
    expect(storage.value).toBeNull();
  });

  it("keeps a record belonging to another session intact", () => {
    const { storage, journal } = makeJournal();
    storage.value = JSON.stringify(record({ subject: "user-b", sessionId: "session-b" }));
    expect(journal.read({ subject: "user-a", sessionId: "session-a" })).toEqual({ kind: "foreign-session" });
    expect(storage.value).toContain("user-b");
    expect(journal.clear(binding(record()))).toEqual({ kind: "foreign-session" });
    expect(storage.value).toContain("user-b");
  });

  it("does not expire a legitimate unresolved request based on age", () => {
    const storage = new MemoryStorage();
    const old = createDeletionJournal({ storage, now: () => NOW });
    const oldRecord = record({ createdAt: 0 });
    expect(old.write(oldRecord)).toEqual({ kind: "written", record: oldRecord });
    expect(old.read({ subject: "user-a", sessionId: "session-a" })).toEqual({ kind: "ok", record: oldRecord });
  });

  it("writes before submit and verifies the readback", () => {
    const { storage, journal } = makeJournal();
    expect(journal.write(record())).toEqual({ kind: "written", record: record() });
    expect(journal.updatePhase(binding(), "accepted")).toEqual({ kind: "updated", record: record({ phase: "accepted" }) });
    expect(journal.clear(binding(record({ phase: "accepted" })))).toEqual({ kind: "cleared" });
    expect(storage.value).toBeNull();
  });

  it("rejects an invalid phase before changing the journal", () => {
    const { storage, journal } = makeJournal();
    expect(journal.write(record())).toEqual({ kind: "written", record: record() });
    expect(journal.updatePhase(binding(), "deleted" as "accepted")).toEqual({ kind: "invalid", reason: "phase" });
    expect(storage.value).toBe(JSON.stringify(record()));
  });

  it("does not claim a backwards phase transition", () => {
    const { storage, journal } = makeJournal();
    const accepted = record({ phase: "accepted" });
    expect(journal.write(accepted)).toEqual({ kind: "written", record: accepted });
    expect(journal.updatePhase(binding(accepted), "submitting")).toEqual({ kind: "conflict" });
    expect(storage.value).toBe(JSON.stringify(accepted));
  });

  it("reports readback failure instead of claiming a write or clear succeeded", () => {
    class MutatingStorage extends MemoryStorage {
      override getItem(key: string): string | null {
        const value = super.getItem(key);
        if (value) this.value = JSON.stringify(record({ grantId: "different-grant" }));
        return this.value;
      }
    }
    const storage = new MutatingStorage();
    const journal = createDeletionJournal({ storage, now: () => NOW });
    expect(journal.write(record())).toEqual({ kind: "unavailable", operation: "write", reason: "verification_failed" });
  });

  it("reports verification failure when storage silently ignores writes or clears", () => {
    class NoopSetStorage extends MemoryStorage {
      override setItem(_key: string, _value: string): void { /* simulate a broken storage adapter */ }
    }
    const noOpSet = new NoopSetStorage();
    expect(createDeletionJournal({ storage: noOpSet, now: () => NOW }).write(record())).toEqual({ kind: "unavailable", operation: "write", reason: "verification_failed" });

    class NoopRemoveStorage extends MemoryStorage {
      override removeItem(_key: string): void { /* simulate a broken storage adapter */ }
    }
    const noOpRemove = new NoopRemoveStorage();
    const noOpRemoveJournal = createDeletionJournal({ storage: noOpRemove, now: () => NOW });
    expect(noOpRemoveJournal.write(record())).toEqual({ kind: "written", record: record() });
    expect(noOpRemoveJournal.clear(binding())).toEqual({ kind: "unavailable", operation: "clear", reason: "verification_failed" });
  });

  it("refuses stale clear and phase updates without replacing the newer request", () => {
    const { storage, journal } = makeJournal();
    const first = record();
    const newer = record({ requestId: "00000000-0000-4000-8000-000000000002", grantId: "grant-b", phase: "accepted" });
    expect(journal.write(first)).toEqual({ kind: "written", record: first });
    storage.value = JSON.stringify(newer);
    expect(journal.clear(binding(first))).toEqual({ kind: "conflict" });
    expect(journal.updatePhase(binding(first), "accepted")).toEqual({ kind: "conflict" });
    expect(storage.value).toBe(JSON.stringify(newer));
  });

  it("returns an explicit clear failure when removal is denied", () => {
    const storage = new MemoryStorage();
    const { journal } = makeJournal(storage);
    expect(journal.write(record())).toEqual({ kind: "written", record: record() });
    storage.failRemove = true;
    expect(journal.clear(binding())).toEqual({ kind: "unavailable", operation: "clear", reason: "storage_unavailable" });
  });

  it("uses the fixed journal key", () => {
    const storage = new MemoryStorage();
    const seen: string[] = [];
    const wrapped: DeletionJournalStorage = {
      getItem: (key) => { seen.push(key); return storage.getItem(key); },
      setItem: (key, value) => { seen.push(key); storage.setItem(key, value); },
      removeItem: (key) => { seen.push(key); storage.removeItem(key); },
    };
    createDeletionJournal({ storage: wrapped, now: () => NOW }).write(record());
    expect(new Set(seen)).toEqual(new Set([DELETION_JOURNAL_KEY]));
  });
});
