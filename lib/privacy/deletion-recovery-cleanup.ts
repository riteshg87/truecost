import type { DeletionJournalRecord } from "./deletion-journal";
import { removeComparisonPartitionForRecovery } from "../comparison/private-workspace";
import { removePrivatePartitionForRecovery } from "../private-storage/storage";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RecoveryClerkSession = Readonly<{ subject: string; sessionId: string }>;
export type RecoveryReceipt = Readonly<{ requestId: string; ownerId: string; status: "app_pending" | "providers_pending" | "completed" }>;

export type DeletionRecoveryCleanupResult =
  | Readonly<{ kind: "cleared"; loanGeneration: number; comparisonGeneration: number }>
  | Readonly<{ kind: "retry"; reason: "storage-failure" | "runtime-changed" | "server-failure" }>
  | Readonly<{ kind: "skipped"; reason: "missing-receipt" | "invalid-receipt" | "foreign-session" }>;

export interface DeletionRecoveryCleanupOptions {
  journal: DeletionJournalRecord;
  /** Must return the currently authenticated Clerk subject/session synchronously. */
  getCurrentClerkSession: () => RecoveryClerkSession | null;
  queryReceipt: (binding: Readonly<{ requestId: string; grantId: string }>) => Promise<unknown>;
  privateIndexedDB?: IDBFactory;
  comparisonIndexedDB?: IDBFactory;
}

function validJournal(record: DeletionJournalRecord): boolean {
  try {
    return Boolean(record && record.version === 1 && REQUEST_ID.test(record.requestId) &&
    typeof record.grantId === "string" && record.grantId.length > 0 && record.grantId.length <= 200 &&
    typeof record.subject === "string" && record.subject.length > 0 && record.subject.length <= 256 &&
    typeof record.sessionId === "string" && record.sessionId.length > 0 && record.sessionId.length <= 256 &&
    Number.isFinite(record.createdAt) && record.createdAt >= 0 &&
    (record.phase === "submitting" || record.phase === "accepted"));
  } catch {
    return false;
  }
}

function sameSession(left: RecoveryClerkSession | null, right: RecoveryClerkSession): boolean {
  return Boolean(left && left.subject === right.subject && left.sessionId === right.sessionId);
}

function validReceipt(value: unknown, requestId: string): value is RecoveryReceipt {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    if (keys.join("|") !== "ownerId|requestId|status") return false;
    const candidate = value as Partial<RecoveryReceipt>;
    return REQUEST_ID.test(typeof candidate.requestId === "string" ? candidate.requestId : "") && candidate.requestId === requestId &&
      typeof candidate.ownerId === "string" && candidate.ownerId.length > 0 && candidate.ownerId.length <= 256 &&
      (candidate.status === "app_pending" || candidate.status === "providers_pending" || candidate.status === "completed");
  } catch {
    return false;
  }
}

function readSession(getCurrentClerkSession: () => RecoveryClerkSession | null): RecoveryClerkSession | null {
  try {
    const session = getCurrentClerkSession();
    if (!session || typeof session.subject !== "string" || session.subject.length === 0 || session.subject.length > 256 ||
      typeof session.sessionId !== "string" || session.sessionId.length === 0 || session.sessionId.length > 256) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Clears only the two local account partitions after a verified recovery
 * receipt. The receipt's ownerId is used as a partition key, never as an
 * authorization decision. This operation cannot unlock a session, recreate
 * browser cleanup capabilities, or return private data.
 */
export async function runDeletionRecoveryCleanup(options: DeletionRecoveryCleanupOptions): Promise<DeletionRecoveryCleanupResult> {
  const binding = options.journal;
  if (!validJournal(binding)) return { kind: "skipped", reason: "invalid-receipt" };
  const initial = readSession(options.getCurrentClerkSession);
  if (!sameSession(initial, binding)) return { kind: "skipped", reason: "foreign-session" };
  let receipt: unknown;
  try {
    receipt = await options.queryReceipt({ requestId: binding.requestId, grantId: binding.grantId });
  } catch {
    return { kind: "retry", reason: "server-failure" };
  }
  if (!receipt) return { kind: "skipped", reason: "missing-receipt" };
  if (!validReceipt(receipt, binding.requestId)) return { kind: "skipped", reason: "invalid-receipt" };
  if (!sameSession(readSession(options.getCurrentClerkSession), binding)) return { kind: "retry", reason: "runtime-changed" };

  const isCurrent = () => sameSession(readSession(options.getCurrentClerkSession), binding);
  const privateResult = await removePrivatePartitionForRecovery(receipt.ownerId, options.privateIndexedDB, isCurrent);
  if (privateResult.kind === "retry") return privateResult;
  if (!isCurrent()) return { kind: "retry", reason: "runtime-changed" };
  const comparisonResult = await removeComparisonPartitionForRecovery(receipt.ownerId, options.comparisonIndexedDB, isCurrent);
  if (comparisonResult.kind === "retry") return comparisonResult;
  return { kind: "cleared", loanGeneration: privateResult.generation, comparisonGeneration: comparisonResult.generation };
}
