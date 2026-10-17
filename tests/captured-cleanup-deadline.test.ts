import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { PrivateStorage } from "../lib/private-storage/storage";
import { ComparisonWorkspace } from "../lib/comparison/private-workspace";
import type { PrivateSessionAccess } from "../lib/auth/private-session";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(["loan", "comparison"] as const)("returns retry when %s cleanup's database open never completes", async (kind) => {
  const factory = new IDBFactory();
  const access: PrivateSessionAccess = {
    identity: { profileId: "deadline-a", subject: "deadline-user", sessionId: "deadline-session", authEpoch: 1, verifiedOnline: true },
    isCurrent: () => true, getToken: vi.fn(async () => null),
  };
  const loan = new PrivateStorage({ indexedDB: factory });
  const comparison = new ComparisonWorkspace({ access, tabId: "deadline-tab", indexedDB: factory });
  if (kind === "loan") await loan.unlock(access.identity);
  else await comparison.open();
  const captured = kind === "loan" ? loan.captureFormerAccountCleanup(access, true) : comparison.captureFormerAccountCleanup(access, true);
  expect(captured).not.toBeNull();
  vi.spyOn(factory, "open").mockReturnValue({} as IDBOpenDBRequest);
  vi.useFakeTimers();
  let outcome: unknown = "pending";
  void captured!.run().then((result) => { outcome = result; });
  await vi.advanceTimersByTimeAsync(5_001);
  expect(outcome).toMatchObject({ kind: "retry", reason: "storage-failure" });
  loan.lock(); comparison.close();
});

it.each(["loan", "comparison"] as const)("closes a late %s database success without starting a write", async (kind) => {
  const factory = new IDBFactory();
  const access: PrivateSessionAccess = {
    identity: { profileId: "late-a", subject: "late-user", sessionId: "late-session", authEpoch: 1, verifiedOnline: true },
    isCurrent: () => true, getToken: vi.fn(async () => null),
  };
  const loan = new PrivateStorage({ indexedDB: factory });
  const comparison = new ComparisonWorkspace({ access, tabId: "late-tab", indexedDB: factory });
  if (kind === "loan") await loan.unlock(access.identity);
  else await comparison.open();
  const captured = kind === "loan" ? loan.captureFormerAccountCleanup(access, true) : comparison.captureFormerAccountCleanup(access, true);
  expect(captured).not.toBeNull();
  const lateDatabase = { close: vi.fn(), transaction: vi.fn() } as unknown as IDBDatabase;
  const request = { result: lateDatabase } as unknown as IDBOpenDBRequest;
  vi.spyOn(factory, "open").mockReturnValue(request);
  vi.useFakeTimers();
  const running = captured!.run();
  await vi.advanceTimersByTimeAsync(5_001);
  await expect(running).resolves.toEqual({ kind: "retry", reason: "storage-failure" });
  request.onsuccess?.(new Event("success"));
  expect(lateDatabase.close).toHaveBeenCalledOnce();
  expect(lateDatabase.transaction).not.toHaveBeenCalled();
  loan.lock(); comparison.close();
});

it.each(["loan", "comparison"] as const)("aborts a late %s upgrade without changing the schema", async (kind) => {
  const factory = new IDBFactory();
  const access: PrivateSessionAccess = {
    identity: { profileId: "late-upgrade-a", subject: "late-upgrade-user", sessionId: "late-upgrade-session", authEpoch: 1, verifiedOnline: true },
    isCurrent: () => true, getToken: vi.fn(async () => null),
  };
  const loan = new PrivateStorage({ indexedDB: factory });
  const comparison = new ComparisonWorkspace({ access, tabId: "late-upgrade-tab", indexedDB: factory });
  if (kind === "loan") await loan.unlock(access.identity);
  else await comparison.open();
  const captured = kind === "loan" ? loan.captureFormerAccountCleanup(access, true) : comparison.captureFormerAccountCleanup(access, true);
  expect(captured).not.toBeNull();
  const createObjectStore = vi.fn();
  const abort = vi.fn();
  const request = {
    result: { objectStoreNames: { contains: () => false }, createObjectStore, close: vi.fn() },
    transaction: { abort },
  } as unknown as IDBOpenDBRequest;
  vi.spyOn(factory, "open").mockReturnValue(request);
  vi.useFakeTimers();
  const running = captured!.run();
  await vi.advanceTimersByTimeAsync(5_001);
  await expect(running).resolves.toEqual({ kind: "retry", reason: "storage-failure" });
  request.onupgradeneeded?.(new Event("upgradeneeded") as IDBVersionChangeEvent);
  expect(abort).toHaveBeenCalled();
  expect(createObjectStore).not.toHaveBeenCalled();
  loan.lock(); comparison.close();
});

it.each(["loan", "comparison"] as const)("returns a storage retry when %s database open is blocked", async (kind) => {
  const factory = new IDBFactory();
  const access: PrivateSessionAccess = {
    identity: { profileId: "blocked-a", subject: "blocked-user", sessionId: "blocked-session", authEpoch: 1, verifiedOnline: true },
    isCurrent: () => true, getToken: vi.fn(async () => null),
  };
  const loan = new PrivateStorage({ indexedDB: factory });
  const comparison = new ComparisonWorkspace({ access, tabId: "blocked-tab", indexedDB: factory });
  if (kind === "loan") await loan.unlock(access.identity);
  else await comparison.open();
  const captured = kind === "loan" ? loan.captureFormerAccountCleanup(access, true) : comparison.captureFormerAccountCleanup(access, true);
  const request = {} as IDBOpenDBRequest;
  vi.spyOn(factory, "open").mockReturnValue(request);
  const running = captured!.run();
  request.onblocked?.(new Event("blocked") as IDBVersionChangeEvent);
  await expect(running).resolves.toEqual({ kind: "retry", reason: "storage-failure" });
  loan.lock(); comparison.close();
});

it.each(["loan", "comparison"] as const)("can retry %s cleanup after an open timeout", async (kind) => {
  const factory = new IDBFactory();
  const access: PrivateSessionAccess = {
    identity: { profileId: "retry-open-a", subject: "retry-open-user", sessionId: "retry-open-session", authEpoch: 1, verifiedOnline: true },
    isCurrent: () => true, getToken: vi.fn(async () => null),
  };
  const loan = new PrivateStorage({ indexedDB: factory });
  const comparison = new ComparisonWorkspace({ access, tabId: "retry-open-tab", indexedDB: factory });
  if (kind === "loan") await loan.unlock(access.identity);
  else await comparison.open();
  const captured = kind === "loan" ? loan.captureFormerAccountCleanup(access, true) : comparison.captureFormerAccountCleanup(access, true);
  const openSpy = vi.spyOn(factory, "open").mockReturnValue({} as IDBOpenDBRequest);
  vi.useFakeTimers();
  const first = captured!.run();
  await vi.advanceTimersByTimeAsync(5_001);
  await expect(first).resolves.toEqual({ kind: "retry", reason: "storage-failure" });
  vi.useRealTimers();
  openSpy.mockRestore();
  await expect(captured!.run()).resolves.toMatchObject({ kind: "cleared" });
  loan.lock(); comparison.close();
});
