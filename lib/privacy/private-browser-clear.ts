import {
  COMPARISON_BROWSER_EPOCH_KEY,
  COMPARISON_META_STORE,
  COMPARISON_PRIVATE_STORE,
  openComparisonDatabase,
} from "../comparison/private-workspace";
import {
  PRIVATE_BROWSER_EPOCH_KEY,
  PRIVATE_META_STORE_NAME,
  PRIVATE_STORE_NAME,
  openPrivateDatabase,
} from "../private-storage/storage";

export type PrivateBrowserClearRole = "loan" | "comparison";

export type PrivateBrowserClearResult =
  | { kind: "cancelled" }
  | { kind: "cleared"; loanEpoch: number; comparisonEpoch: number }
  | { kind: "retry"; reason: "storage-unavailable" | "runtime-changed"; completed: readonly PrivateBrowserClearRole[] };

export interface PrivateBrowserClearOptions {
  /** Confirmation is intentionally explicit. No database is opened when false. */
  confirmed: boolean;
  /** The caller's verified session guard. Identity is never read from storage. */
  isCurrent: () => boolean;
  privateIndexedDB?: IDBFactory;
  comparisonIndexedDB?: IDBFactory;
}

type DatabaseClearResult =
  | { kind: "cleared"; epoch: number }
  | { kind: "retry"; reason: "storage-unavailable" | "runtime-changed" };

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("indexeddb request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb transaction aborted"));
  });
}

function safeCurrent(isCurrent: () => boolean): boolean {
  try { return isCurrent() === true; } catch { return false; }
}

async function clearDatabase(
  role: PrivateBrowserClearRole,
  factory: IDBFactory | undefined,
  isCurrent: () => boolean,
): Promise<DatabaseClearResult> {
  if (!factory) return { kind: "retry", reason: "storage-unavailable" };
  let db: IDBDatabase | null = null;
  let transaction: IDBTransaction | null = null;
  try {
    db = role === "loan" ? await openPrivateDatabase(factory) : await openComparisonDatabase(factory);
    if (!safeCurrent(isCurrent)) return { kind: "retry", reason: "runtime-changed" };
    const stores = role === "loan"
      ? [PRIVATE_STORE_NAME, PRIVATE_META_STORE_NAME]
      : [COMPARISON_PRIVATE_STORE, COMPARISON_META_STORE];
    const epochKey = role === "loan" ? PRIVATE_BROWSER_EPOCH_KEY : COMPARISON_BROWSER_EPOCH_KEY;
    transaction = db.transaction(stores, "readwrite");
    const completion = transactionDone(transaction);
    completion.catch(() => undefined);
    const meta = transaction.objectStore(stores[1]);
    const raw = await request(meta.get(epochKey));
    const currentEpoch = raw === undefined ? 0 : (raw as { epoch?: unknown }).epoch;
    if (!Number.isSafeInteger(currentEpoch) || (currentEpoch as number) < 0) throw new Error("invalid browser epoch");
    if (!safeCurrent(isCurrent)) {
      try { transaction.abort(); } catch { /* already aborted */ }
      await completion.catch(() => undefined);
      return { kind: "retry", reason: "runtime-changed" };
    }
    transaction.objectStore(stores[0]).clear();
    if ((currentEpoch as number) >= Number.MAX_SAFE_INTEGER) throw new Error("browser epoch exhausted");
    const nextEpoch = (currentEpoch as number) + 1;
    meta.put({ key: epochKey, epoch: nextEpoch });
    if (!safeCurrent(isCurrent)) {
      try { transaction.abort(); } catch { /* already aborted */ }
      await completion.catch(() => undefined);
      return { kind: "retry", reason: "runtime-changed" };
    }
    await completion;
    return { kind: "cleared", epoch: nextEpoch };
  } catch {
    try { transaction?.abort(); } catch { /* already completed */ }
    return { kind: "retry", reason: safeCurrent(isCurrent) ? "storage-unavailable" : "runtime-changed" };
  } finally {
    try { db?.close(); } catch { /* closing a completed connection is best effort */ }
  }
}

export async function clearAllMemberPrivateBrowserData(
  options: PrivateBrowserClearOptions,
): Promise<PrivateBrowserClearResult> {
  if (!options.confirmed) return { kind: "cancelled" };
  const isCurrent = options.isCurrent;
  if (!safeCurrent(isCurrent)) return { kind: "retry", reason: "runtime-changed", completed: [] };

  const completed: PrivateBrowserClearRole[] = [];
  const loan = await clearDatabase("loan", options.privateIndexedDB ?? (typeof indexedDB === "undefined" ? undefined : indexedDB), isCurrent);
  if (loan.kind !== "cleared") return { ...loan, completed };
  completed.push("loan");
  if (!safeCurrent(isCurrent)) return { kind: "retry", reason: "runtime-changed", completed };

  const comparison = await clearDatabase("comparison", options.comparisonIndexedDB ?? (typeof indexedDB === "undefined" ? undefined : indexedDB), isCurrent);
  if (comparison.kind !== "cleared") return { ...comparison, completed };
  completed.push("comparison");
  if (!safeCurrent(isCurrent)) return { kind: "retry", reason: "runtime-changed", completed };
  return { kind: "cleared", loanEpoch: loan.epoch, comparisonEpoch: comparison.epoch };
}
