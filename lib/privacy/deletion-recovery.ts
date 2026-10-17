import type { CurrentClerkSession } from "./deletion-request";
import {
  createDeletionJournal,
  type DeletionJournal,
  type DeletionJournalBinding,
  type DeletionJournalRecord,
  type DeletionJournalUpdateResult,
} from "./deletion-journal";

export type RecoveryPair = Readonly<Pick<DeletionJournalRecord, "requestId" | "grantId">>;
type RecoveryBinding = Readonly<Pick<DeletionJournalRecord, "requestId" | "grantId" | "subject" | "sessionId">>;

export type RecoveryReceipt = Readonly<{
  requestId: string;
  ownerId: string;
  status: "app_pending" | "providers_pending" | "completed";
}>;

export type DeletionRecoveryResult =
  | Readonly<{ kind: "signed-out" }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "foreign-session" }>
  | Readonly<{ kind: "invalid"; reason: "stored_record" | "binding" }>
  | Readonly<{ kind: "unavailable"; reason: "storage" | "receipt" }>
  | Readonly<{ kind: "account_changed" }>
  | Readonly<{ kind: "retryable"; record: DeletionJournalRecord; reason: "receipt_missing" | "receipt_invalid" | "receipt_unavailable" | "submit_unknown" }>
  | Readonly<{ kind: "accepted"; record: DeletionJournalRecord; receipt: RecoveryReceipt | null; journal: DeletionJournalUpdateResult }>
  | Readonly<{ kind: "rejected"; record: DeletionJournalRecord }>;

export interface DeletionRecoveryOptions {
  journal?: DeletionJournal;
  getCurrentClerkSession: () => CurrentClerkSession | null;
  queryReceipt: (pair: RecoveryPair) => Promise<unknown>;
  replay: (pair: RecoveryBinding) => Promise<"accepted" | "replayed" | "unknown" | "rejected">;
}

export interface DeletionRecovery {
  reconcile(): Promise<DeletionRecoveryResult>;
  retry(): Promise<DeletionRecoveryResult>;
}

function sameSession(left: CurrentClerkSession | null, right: DeletionJournalRecord): boolean {
  return Boolean(left && left.subject === right.subject && left.sessionId === right.sessionId);
}

function validReceipt(value: unknown, requestId: string): value is RecoveryReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RecoveryReceipt>;
  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys.join(",") !== "ownerId,requestId,status") return false;
  return candidate.requestId === requestId && typeof candidate.ownerId === "string" && candidate.ownerId.length > 0 && candidate.ownerId.length <= 256 &&
    (candidate.status === "app_pending" || candidate.status === "providers_pending" || candidate.status === "completed");
}

function bindingFor(record: DeletionJournalRecord): DeletionJournalBinding {
  return {
    requestId: record.requestId,
    grantId: record.grantId,
    subject: record.subject,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
  };
}

class DeletionRecoveryImpl implements DeletionRecovery {
  private readonly journal: DeletionJournal;
  private active: Promise<DeletionRecoveryResult> | null = null;
  private record: DeletionJournalRecord | null = null;

  constructor(private readonly options: DeletionRecoveryOptions) {
    this.journal = options.journal ?? createDeletionJournal();
  }

  reconcile(): Promise<DeletionRecoveryResult> {
    return this.coalesce(() => this.reconcileNow());
  }

  retry(): Promise<DeletionRecoveryResult> {
    return this.coalesce(() => this.retryNow());
  }

  private coalesce(run: () => Promise<DeletionRecoveryResult>): Promise<DeletionRecoveryResult> {
    if (this.active) return this.active;
    const promise = run();
    this.active = promise;
    void promise.finally(() => {
      if (this.active === promise) this.active = null;
    });
    return promise;
  }

  private current(): CurrentClerkSession | null {
    try {
      return this.options.getCurrentClerkSession();
    } catch {
      return null;
    }
  }

  private readCurrent(): DeletionRecoveryResult | DeletionJournalRecord {
    const current = this.current();
    if (!current) return { kind: "signed-out" };
    const result = this.journal.read(current);
    if (result.kind === "ok") return result.record;
    if (result.kind === "missing") return result;
    if (result.kind === "foreign-session") return result;
    if (result.kind === "invalid") return result;
    return { kind: "unavailable", reason: "storage" };
  }

  private async receiptFor(record: DeletionJournalRecord): Promise<DeletionRecoveryResult> {
    if (!sameSession(this.current(), record)) return { kind: "account_changed" };
    let result: unknown;
    try {
      result = await this.options.queryReceipt({ requestId: record.requestId, grantId: record.grantId });
    } catch {
      return sameSession(this.current(), record)
        ? { kind: "retryable", record, reason: "receipt_unavailable" }
        : { kind: "account_changed" };
    }
    if (!sameSession(this.current(), record)) return { kind: "account_changed" };
    if (result === null || result === undefined) return { kind: "retryable", record, reason: "receipt_missing" };
    if (!validReceipt(result, record.requestId)) return { kind: "retryable", record, reason: "receipt_invalid" };
    const journal = this.journal.updatePhase(bindingFor(record), "accepted");
    return { kind: "accepted", record: { ...record, phase: "accepted" }, receipt: result, journal };
  }

  private async reconcileNow(): Promise<DeletionRecoveryResult> {
    const found = this.readCurrent();
    if ("kind" in found) return found;
    this.record = found;
    return this.receiptFor(found);
  }

  private async retryNow(): Promise<DeletionRecoveryResult> {
    const found = this.readCurrent();
    if ("kind" in found) return found;
    const record = found;
    this.record = record;
    if (!sameSession(this.current(), record)) return { kind: "account_changed" };
    if (record.phase === "accepted") {
      return this.receiptFor(record);
    }
    const receipt = await this.receiptFor(record);
    if (receipt.kind === "accepted" || receipt.kind === "account_changed") return receipt;
    if (receipt.kind !== "retryable" || receipt.reason !== "receipt_missing") return receipt;
    if (!sameSession(this.current(), record)) return { kind: "account_changed" };
    let outcome: "accepted" | "replayed" | "unknown" | "rejected";
    try {
      outcome = await this.options.replay({ requestId: record.requestId, grantId: record.grantId, subject: record.subject, sessionId: record.sessionId });
    } catch {
      outcome = "unknown";
    }
    if (!sameSession(this.current(), record)) return { kind: "account_changed" };
    if (outcome === "accepted" || outcome === "replayed") {
      const journal = this.journal.updatePhase(bindingFor(record), "accepted");
      return { kind: "accepted", record: { ...record, phase: "accepted" }, receipt: null, journal };
    }
    if (outcome === "rejected") return { kind: "rejected", record };
    return { kind: "retryable", record, reason: "submit_unknown" };
  }
}

export function createDeletionRecovery(options: DeletionRecoveryOptions): DeletionRecovery {
  return new DeletionRecoveryImpl(options);
}
