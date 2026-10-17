/**
 * A small sessionStorage journal for recovering an account-deletion request
 * after a page reload. It is a recovery hint only: Convex still authorizes the
 * original Clerk session and grant on every replay. This journal cannot
 * reconstruct captured IndexedDB/browser cleanup, which remains an in-memory
 * capability owned by the deletion coordinator.
 */

export const DELETION_JOURNAL_KEY = "truecost.account-deletion.v1";
export const DELETION_JOURNAL_VERSION = 1 as const;
export const DELETION_JOURNAL_MAX_SERIALIZED_LENGTH = 2048;

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_LIMIT = 200;
const GRANT_ID_LIMIT = 200;
const IDENTITY_LIMIT = 256;
const JOURNAL_KEYS = ["version", "requestId", "grantId", "subject", "sessionId", "createdAt", "phase"] as const;

export type DeletionJournalPhase = "submitting" | "accepted";

export type DeletionJournalRecord = Readonly<{
  version: typeof DELETION_JOURNAL_VERSION;
  requestId: string;
  grantId: string;
  subject: string;
  sessionId: string;
  createdAt: number;
  phase: DeletionJournalPhase;
}>;

export type DeletionJournalSession = Readonly<Pick<DeletionJournalRecord, "subject" | "sessionId">>;
export type DeletionJournalBinding = Readonly<Pick<DeletionJournalRecord, "requestId" | "grantId" | "subject" | "sessionId" | "createdAt">>;

export interface DeletionJournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DeletionJournalOptions {
  /** Injected storage keeps this module testable and makes the browser boundary explicit. */
  storage?: DeletionJournalStorage | null;
  now?: () => number;
}

export type DeletionJournalReadResult =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "ok"; record: DeletionJournalRecord }>
  | Readonly<{ kind: "invalid"; reason: "stored_record" | "binding" }>
  | Readonly<{ kind: "foreign-session" }>
  | Readonly<{ kind: "unavailable"; operation: "read" | "write" | "clear"; reason: "storage_unavailable" | "verification_failed" }>;

export type DeletionJournalWriteResult =
  | Readonly<{ kind: "written"; record: DeletionJournalRecord }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid"; reason: "record" | "stored_record" }>
  | Readonly<{ kind: "foreign-session" }>
  | Readonly<{ kind: "conflict" }>
  | Readonly<{ kind: "unavailable"; operation: "read" | "write"; reason: "storage_unavailable" | "verification_failed" }>;

export type DeletionJournalUpdateResult =
  | Readonly<{ kind: "updated"; record: DeletionJournalRecord }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid"; reason: "binding" | "phase" | "stored_record" }>
  | Readonly<{ kind: "foreign-session" }>
  | Readonly<{ kind: "conflict" }>
  | Readonly<{ kind: "unavailable"; operation: "read" | "write"; reason: "storage_unavailable" | "verification_failed" }>;

export type DeletionJournalClearResult =
  | Readonly<{ kind: "cleared" }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "invalid"; reason: "binding" | "stored_record" }>
  | Readonly<{ kind: "foreign-session" }>
  | Readonly<{ kind: "conflict" }>
  | Readonly<{ kind: "unavailable"; operation: "read" | "clear"; reason: "storage_unavailable" | "verification_failed" }>;

type RawRead =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "value"; raw: string }>
  | Readonly<{ kind: "unavailable" }>;

function defaultStorage(): DeletionJournalStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function hasExactKeys(value: object): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...JOURNAL_KEYS].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedString(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}

function validSession(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<DeletionJournalSession>;
  return boundedString(session.subject, IDENTITY_LIMIT) && boundedString(session.sessionId, IDENTITY_LIMIT);
}

function validBinding(value: unknown, now: number): boolean {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<DeletionJournalBinding>;
  return REQUEST_ID_PATTERN.test(typeof binding.requestId === "string" ? binding.requestId : "") &&
    boundedString(binding.grantId, GRANT_ID_LIMIT) && validSession(binding) &&
    typeof binding.createdAt === "number" && Number.isFinite(binding.createdAt) && binding.createdAt >= 0 && binding.createdAt <= now;
}

function parseStored(raw: string, now: number): DeletionJournalRecord | null {
  if (raw.length === 0 || raw.length > DELETION_JOURNAL_MAX_SERIALIZED_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasExactKeys(value)) return null;
  const record = value as Partial<DeletionJournalRecord>;
  if (record.version !== DELETION_JOURNAL_VERSION || !validBinding(record, now) ||
    (record.phase !== "submitting" && record.phase !== "accepted")) return null;
  return Object.freeze({
    version: DELETION_JOURNAL_VERSION,
    requestId: record.requestId!,
    grantId: record.grantId!,
    subject: record.subject!,
    sessionId: record.sessionId!,
    createdAt: record.createdAt!,
    phase: record.phase,
  });
}

function toRecord(value: unknown, now: number): DeletionJournalRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<DeletionJournalRecord>;
  if (candidate.version !== DELETION_JOURNAL_VERSION || !validBinding(candidate, now) ||
    (candidate.phase !== "submitting" && candidate.phase !== "accepted")) return null;
  return Object.freeze({
    version: DELETION_JOURNAL_VERSION,
    requestId: candidate.requestId!,
    grantId: candidate.grantId!,
    subject: candidate.subject!,
    sessionId: candidate.sessionId!,
    createdAt: candidate.createdAt!,
    phase: candidate.phase,
  });
}

function serialize(record: DeletionJournalRecord): string | null {
  try {
    // Construct the allowlisted shape explicitly. No proof, token, email,
    // profile or finance fields can travel through this boundary.
    const raw = JSON.stringify({
      version: record.version,
      requestId: record.requestId,
      grantId: record.grantId,
      subject: record.subject,
      sessionId: record.sessionId,
      createdAt: record.createdAt,
      phase: record.phase,
    });
    return raw.length <= DELETION_JOURNAL_MAX_SERIALIZED_LENGTH ? raw : null;
  } catch {
    return null;
  }
}

function sameSession(left: DeletionJournalSession, right: DeletionJournalSession): boolean {
  return left.subject === right.subject && left.sessionId === right.sessionId;
}

function sameBinding(left: DeletionJournalRecord | DeletionJournalBinding, right: DeletionJournalRecord | DeletionJournalBinding): boolean {
  return left.requestId === right.requestId && left.grantId === right.grantId && left.subject === right.subject &&
    left.sessionId === right.sessionId && left.createdAt === right.createdAt;
}

function relation(stored: DeletionJournalRecord, expected: DeletionJournalBinding): "same" | "foreign-session" | "conflict" {
  if (stored.subject !== expected.subject || stored.sessionId !== expected.sessionId) return "foreign-session";
  return sameBinding(stored, expected) ? "same" : "conflict";
}

export class DeletionJournal {
  private readonly storage: DeletionJournalStorage | null;
  private readonly now: () => number;

  constructor(options: DeletionJournalOptions = {}) {
    this.storage = "storage" in options ? options.storage ?? null : defaultStorage();
    this.now = options.now ?? Date.now;
  }

  read(session: DeletionJournalSession): DeletionJournalReadResult {
    if (!validSession(session)) return { kind: "invalid", reason: "binding" };
    const raw = this.readRaw();
    if (raw.kind === "missing") return raw;
    if (raw.kind === "unavailable") return { kind: "unavailable", operation: "read", reason: "storage_unavailable" };
    const record = parseStored(raw.raw, this.now());
    if (!record) return { kind: "invalid", reason: "stored_record" };
    if (!sameSession(record, session)) return { kind: "foreign-session" };
    return { kind: "ok", record };
  }

  /** Persist a submitting record before the network request and prove the write by reading it back. */
  write(input: DeletionJournalRecord): DeletionJournalWriteResult {
    const record = toRecord(input, this.now());
    if (!record) return { kind: "invalid", reason: "record" };
    const encoded = serialize(record);
    if (!encoded) return { kind: "invalid", reason: "record" };
    const existing = this.readRaw();
    if (existing.kind === "unavailable") return { kind: "unavailable", operation: "read", reason: "storage_unavailable" };
    if (existing.kind === "value") {
      const stored = parseStored(existing.raw, this.now());
      if (!stored) return { kind: "invalid", reason: "stored_record" };
      const relationship = relation(stored, record);
      if (relationship === "foreign-session") return { kind: "foreign-session" };
      if (relationship === "conflict" || stored.phase === "accepted" && record.phase === "submitting") return { kind: "conflict" };
      if (stored.phase === record.phase) return { kind: "written", record: stored };
    }
    if (!this.setRaw(encoded)) return { kind: "unavailable", operation: "write", reason: "storage_unavailable" };
    const readback = this.readRaw();
    const verified = readback.kind === "value" ? parseStored(readback.raw, this.now()) : null;
    if (readback.kind !== "value" || readback.raw !== encoded || !verified ||
      !sameBinding(verified, record) || verified.phase !== record.phase) {
      return { kind: "unavailable", operation: "write", reason: "verification_failed" };
    }
    return { kind: "written", record };
  }

  updatePhase(binding: DeletionJournalBinding, phase: DeletionJournalPhase): DeletionJournalUpdateResult {
    if (phase !== "submitting" && phase !== "accepted") return { kind: "invalid", reason: "phase" };
    if (!validBinding(binding, this.now())) return { kind: "invalid", reason: "binding" };
    const current = this.readRaw();
    if (current.kind === "missing") return current;
    if (current.kind === "unavailable") return { kind: "unavailable", operation: "read", reason: "storage_unavailable" };
    const stored = parseStored(current.raw, this.now());
    if (!stored) return { kind: "invalid", reason: "stored_record" };
    const relationship = relation(stored, binding);
    if (relationship === "foreign-session") return { kind: "foreign-session" };
    if (relationship === "conflict") return { kind: "conflict" };
    if (stored.phase === "accepted" && phase === "submitting") return { kind: "conflict" };
    const next = Object.freeze({ ...stored, phase });
    const encoded = serialize(next);
    if (!encoded || !this.setRaw(encoded)) return { kind: "unavailable", operation: "write", reason: "storage_unavailable" };
    const readback = this.readRaw();
    const verified = readback.kind === "value" ? parseStored(readback.raw, this.now()) : null;
    if (readback.kind !== "value" || !verified || !sameBinding(verified, binding) || verified.phase !== phase) {
      return { kind: "unavailable", operation: "write", reason: "verification_failed" };
    }
    return { kind: "updated", record: verified };
  }

  clear(binding: DeletionJournalBinding): DeletionJournalClearResult {
    if (!validBinding(binding, this.now())) return { kind: "invalid", reason: "binding" };
    const current = this.readRaw();
    if (current.kind === "missing") return current;
    if (current.kind === "unavailable") return { kind: "unavailable", operation: "read", reason: "storage_unavailable" };
    const stored = parseStored(current.raw, this.now());
    if (!stored) return { kind: "invalid", reason: "stored_record" };
    const relationship = relation(stored, binding);
    if (relationship === "foreign-session") return { kind: "foreign-session" };
    if (relationship === "conflict") return { kind: "conflict" };
    try {
      if (!this.storage) return { kind: "unavailable", operation: "clear", reason: "storage_unavailable" };
      this.storage.removeItem(DELETION_JOURNAL_KEY);
    } catch {
      return { kind: "unavailable", operation: "clear", reason: "storage_unavailable" };
    }
    const readback = this.readRaw();
    if (readback.kind !== "missing") return { kind: "unavailable", operation: "clear", reason: "verification_failed" };
    return { kind: "cleared" };
  }

  private readRaw(): RawRead {
    if (!this.storage) return { kind: "unavailable" };
    try {
      const raw = this.storage.getItem(DELETION_JOURNAL_KEY);
      if (raw === null) return { kind: "missing" };
      if (typeof raw !== "string") return { kind: "unavailable" };
      return { kind: "value", raw };
    } catch {
      return { kind: "unavailable" };
    }
  }

  private setRaw(value: string): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(DELETION_JOURNAL_KEY, value);
      return true;
    } catch {
      return false;
    }
  }
}

export function createDeletionJournal(options: DeletionJournalOptions = {}): DeletionJournal {
  return new DeletionJournal(options);
}
