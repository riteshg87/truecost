import type { ComparisonSnapshot } from "../contracts/snapshot";

export const GUEST_STATE_VERSION = 1 as const;

export interface GuestStoredRecord {
  version: typeof GUEST_STATE_VERSION;
  snapshotJson: string;
  committedAt: string;
  allowanceSpent: true;
}

export interface GuestSnapshotState {
  kind: "empty" | "saved" | "invalid";
  snapshot: Readonly<ComparisonSnapshot> | null;
  persisted: boolean;
  reason?: "storage-unavailable" | "invalid-record";
}

export type GuestCommitResult =
  | { kind: "saved"; snapshot: Readonly<ComparisonSnapshot>; persisted: boolean }
  | { kind: "requires-auth"; snapshot: Readonly<ComparisonSnapshot> | null; persisted: boolean }
  | { kind: "storage-unavailable"; snapshot: Readonly<ComparisonSnapshot>; persisted: false };

export interface GuestStateBackend {
  read(): Promise<GuestStoredRecord | null>;
  create(record: GuestStoredRecord): Promise<boolean>;
}
