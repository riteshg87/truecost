import {
  decodeComparisonSnapshot,
  serializeComparisonSnapshot,
  type ComparisonSnapshot,
} from "../contracts/snapshot";
import {
  GUEST_STATE_VERSION,
  type GuestCommitResult,
  type GuestSnapshotState,
  type GuestStateBackend,
  type GuestStoredRecord,
} from "./types";

export const GUEST_DB_NAME = "truecost-public-guest-v1";
export const GUEST_STORE_NAME = "guestState";
const GUEST_KEY = "singleton";

function nowIso(): string {
  return new Date().toISOString();
}

export function snapshotJson(snapshot: ComparisonSnapshot): string {
  return serializeComparisonSnapshot(snapshot);
}

export function parseStoredSnapshot(record: GuestStoredRecord): Readonly<ComparisonSnapshot> {
  if (
    record.version !== GUEST_STATE_VERSION ||
    record.allowanceSpent !== true ||
    typeof record.snapshotJson !== "string"
  ) {
    throw new Error("invalid guest record");
  }
  return decodeComparisonSnapshot(JSON.parse(record.snapshotJson));
}

export async function readGuestState(backend: GuestStateBackend): Promise<GuestSnapshotState> {
  let record: GuestStoredRecord | null;
  try {
    record = await backend.read();
  } catch {
    return { kind: "empty", snapshot: null, persisted: false, reason: "storage-unavailable" };
  }
  if (!record) return { kind: "empty", snapshot: null, persisted: true };
  try {
    return { kind: "saved", snapshot: parseStoredSnapshot(record), persisted: true };
  } catch {
    return { kind: "invalid", snapshot: null, persisted: true, reason: "invalid-record" };
  }
}

/**
 * The backend's create operation is one atomic read/write transaction. Only
 * the first valid result can spend the guest allowance; subsequent calls keep
 * the existing snapshot intact and ask the caller to sign in.
 */
export async function commitFirstGuestSnapshot(
  backend: GuestStateBackend,
  snapshot: ComparisonSnapshot,
): Promise<GuestCommitResult> {
  const canonical = snapshotJson(snapshot);
  const candidate: GuestStoredRecord = {
    version: GUEST_STATE_VERSION,
    snapshotJson: canonical,
    committedAt: nowIso(),
    allowanceSpent: true,
  };
  try {
    const created = await backend.create(candidate);
    if (created) {
      return { kind: "saved", snapshot: decodeComparisonSnapshot(JSON.parse(canonical)), persisted: true };
    }
    const existing = await backend.read();
    let previous: Readonly<ComparisonSnapshot> | null = null;
    try {
      previous = existing ? parseStoredSnapshot(existing) : null;
    } catch {
      previous = null;
    }
    return { kind: "requires-auth", snapshot: previous, persisted: true };
  } catch {
    return { kind: "storage-unavailable", snapshot: decodeComparisonSnapshot(JSON.parse(canonical)), persisted: false };
  }
}

export function createIndexedDbBackend(
  indexedDb: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB,
): GuestStateBackend {
  if (!indexedDb) throw new Error("IndexedDB is unavailable");
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDb.open(GUEST_DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(GUEST_STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });

  return {
    read: async () => {
      const db = await open();
      try {
        return await new Promise<GuestStoredRecord | null>((resolve, reject) => {
          const request = db.transaction(GUEST_STORE_NAME, "readonly").objectStore(GUEST_STORE_NAME).get(GUEST_KEY);
          request.onsuccess = () => resolve((request.result as GuestStoredRecord | undefined) ?? null);
          request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
        });
      } finally {
        db.close();
      }
    },
    create: async (record) => {
      const db = await open();
      try {
        return await new Promise<boolean>((resolve, reject) => {
          const transaction = db.transaction(GUEST_STORE_NAME, "readwrite");
          const store = transaction.objectStore(GUEST_STORE_NAME);
          const get = store.get(GUEST_KEY);
          let created = false;
          get.onsuccess = () => {
            if (get.result !== undefined) return;
            store.add(record, GUEST_KEY);
            created = true;
          };
          get.onerror = () => transaction.abort();
          transaction.oncomplete = () => resolve(created);
          transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
          transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted"));
        });
      } finally {
        db.close();
      }
    },
  };
}

export async function loadGuestSnapshot(): Promise<GuestSnapshotState> {
  try {
    return await readGuestState(createIndexedDbBackend());
  } catch {
    return { kind: "empty", snapshot: null, persisted: false, reason: "storage-unavailable" };
  }
}

export async function commitGuestSnapshot(snapshot: ComparisonSnapshot): Promise<GuestCommitResult> {
  try {
    return await commitFirstGuestSnapshot(createIndexedDbBackend(), snapshot);
  } catch {
    return { kind: "storage-unavailable", snapshot: decodeComparisonSnapshot(snapshot), persisted: false };
  }
}
