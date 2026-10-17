import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareOffers } from "../lib/finance/comparison";
import { createComparisonSnapshot, type ComparisonSnapshot } from "../lib/contracts/snapshot";
import type { CompareDraft } from "../lib/contracts/comparison-draft";
import {
  ComparisonWorkspace,
  COMPARISON_LEASE_MS,
  COMPARISON_MAX_ATTEMPTS,
  COMPARISON_MAX_DELETIONS,
  COMPARISON_MAX_SAVES,
  COMPARISON_PRIVATE_DB,
  COMPARISON_REPLAY_WINDOW_MS,
} from "../lib/comparison/private-workspace";
import type { ComparisonSaveAcknowledgement, ComparisonTransport } from "../lib/comparison/transport";
import { ComparisonTransportError } from "../lib/comparison/transport";
import type { ComparisonHistoryDeleteAcknowledgement, ComparisonHistoryDeleteInput, ComparisonHistoryTransport } from "../lib/comparison/history-transport";
import type { PrivateSessionAccess } from "../lib/auth/private-session";

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const identity = (profileId: string) => ({ profileId, subject: `subject-${profileId}`, sessionId: `session-${profileId}`, authEpoch: 1, verifiedOnline: true as const });

function makeOffer(id: string, ratePct: number) {
  return { id, lender: `Lender ${id}`, loanType: "home" as const, amount: 5_000_000, ratePct, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.35 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "financed" as const, otherFees: [] };
}

function fixture(rate = 8.5): { draft: CompareDraft; snapshot: ComparisonSnapshot } {
  const offers = [makeOffer("offer-a", rate), makeOffer("offer-b", rate + 0.1)];
  return { draft: { loanType: "home", offers }, snapshot: createComparisonSnapshot(offers, compareOffers(offers), { createdAt: new Date(NOW).toISOString() }) };
}

function access(profileId: string, current = () => true): PrivateSessionAccess {
  return { identity: identity(profileId), getToken: vi.fn(async () => "token"), isCurrent: current };
}

function transport(overrides: Partial<ComparisonTransport> = {}): ComparisonTransport {
  return {
    saveComparison: vi.fn(async (input) => ({ status: "saved" as const, requestId: input.requestId, resultId: JSON.parse(input.snapshot).resultId, serverHash: "server-hash" })),
    ...overrides,
  };
}

function historyTransport(overrides: Partial<ComparisonHistoryTransport> = {}): ComparisonHistoryTransport {
  return {
    listComparisons: vi.fn(async () => ({ page: [], isDone: true, continueCursor: "" })),
    getComparison: vi.fn(async () => null),
    deleteComparison: vi.fn(async (input: ComparisonHistoryDeleteInput): Promise<ComparisonHistoryDeleteAcknowledgement> => ({
      status: "deleted",
      requestId: input.requestId,
      resultId: input.resultId,
      comparisonId: input.comparisonId ?? null,
      serverHash: "server-hash",
    })),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function deleteDb() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(COMPARISON_PRIVATE_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

beforeEach(() => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(async () => { await deleteDb(); });

describe("account-bound comparison workspace", () => {
  it("starts locked, then persists a tab draft and immutable snapshot across reload", async () => {
    const first = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    expect(first.current()).toMatchObject({ status: "locked", draft: null, snapshot: null });
    await expect(first.open()).resolves.toEqual({ kind: "ok", value: undefined });
    const value = fixture();
    await expect(first.setWorking(value)).resolves.toEqual({ kind: "ok", value: undefined });
    first.close();

    const second = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await second.open();
    expect(second.current().draft?.offers[0]?.ratePct).toBe(8.5);
    expect(second.current().snapshot?.resultId).toBe(value.snapshot.resultId);
  });

  it("keeps account partitions isolated and allows the same request ID independently", async () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    const aTransport = transport();
    const bTransport = transport();
    const a = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, transport: aTransport });
    const b = new ComparisonWorkspace({ access: access("profile-b"), tabId: "tab-b", now: () => NOW, transport: bTransport });
    await Promise.all([a.open(), b.open()]);
    const value = fixture();
    await expect(a.queueSave({ snapshot: value.snapshot, requestId, source: "member" })).resolves.toMatchObject({ kind: "ok" });
    await expect(b.queueSave({ snapshot: value.snapshot, requestId, source: "member" })).resolves.toMatchObject({ kind: "ok" });
    expect(a.current().saves).toHaveLength(1);
    expect(b.current().saves).toHaveLength(1);
    await Promise.all([a.pump(), b.pump()]);
    expect(a.current().saves[0]?.status).toBe("saved");
    expect(b.current().saves[0]?.status).toBe("saved");
  });

  it("queues offline, then marks a save only after a matching receipt", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const t = transport();
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, transport: t });
    await workspace.open();
    const value = fixture();
    const queued = await workspace.queueSave({ snapshot: value.snapshot, source: "member" });
    expect(queued).toMatchObject({ kind: "ok" });
    await workspace.pump();
    expect(t.saveComparison).not.toHaveBeenCalled();
    expect(workspace.current().saves[0]?.status).toBe("queued");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await workspace.pump();
    expect(t.saveComparison).toHaveBeenCalledTimes(1);
    expect(workspace.current().saves[0]?.status).toBe("saved");
  });

  it("rejects changed request reuse and preserves the original queued job", async () => {
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await workspace.open();
    const requestId = "00000000-0000-4000-8000-000000000002";
    const first = fixture();
    const second = fixture(9);
    await expect(workspace.queueSave({ snapshot: first.snapshot, requestId, source: "member" })).resolves.toMatchObject({ kind: "ok" });
    await expect(workspace.queueSave({ snapshot: second.snapshot, requestId, source: "member" })).resolves.toEqual({ kind: "error", code: "request_reuse" });
    expect(workspace.current().saves).toHaveLength(1);
    expect(workspace.current().saves[0]?.resultId).toBe(first.snapshot.resultId);
  });

  it("deduplicates an omitted request ID for the same immutable result", async () => {
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await workspace.open();
    const value = fixture();
    const first = await workspace.queueSave({ snapshot: value.snapshot, source: "member" });
    const second = await workspace.queueSave({ snapshot: value.snapshot, source: "member" });
    expect(first.kind).toBe("ok");
    expect(second).toEqual(first);
    expect(workspace.current().saves).toHaveLength(1);
  });

  it("cannot apply a late receipt after confirmed discard and clears another tab on reopen", async () => {
    let resolve!: (ack: ComparisonSaveAcknowledgement) => void;
    const pending = new Promise<ComparisonSaveAcknowledgement>((done) => { resolve = done; });
    const t = transport({ saveComparison: vi.fn(async () => pending) });
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, transport: t });
    await workspace.open();
    const value = fixture();
    const queued = await workspace.queueSave({ snapshot: value.snapshot, source: "member" });
    if (queued.kind !== "ok") throw new Error(`queue setup failed: ${queued.code}`);
    const pumping = workspace.pump();
    await vi.waitFor(() => expect(t.saveComparison).toHaveBeenCalled());
    await expect(workspace.discard(true)).resolves.toMatchObject({ kind: "ok" });
    resolve({ status: "saved", requestId: queued.value.requestId, resultId: value.snapshot.resultId, serverHash: "server-hash" });
    await pumping;
    expect(workspace.current()).toMatchObject({ status: "locked", draft: null, snapshot: null, saves: [] });
    const reopened = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-b", now: () => NOW });
    await reopened.open();
    expect(reopened.current()).toMatchObject({ status: "ready", draft: null, snapshot: null, saves: [] });
  });

  it("pauses a mismatched receipt instead of claiming the save succeeded", async () => {
    const value = fixture();
    const t = transport({ saveComparison: vi.fn(async (input) => ({ status: "saved" as const, requestId: input.requestId, resultId: "00000000-0000-4000-8000-000000000099", serverHash: "server-hash" })) });
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, transport: t });
    await workspace.open();
    await workspace.queueSave({ snapshot: value.snapshot, source: "member" });
    await workspace.pump();
    expect(workspace.current().saves[0]).toMatchObject({ status: "paused", pauseReason: "invalid" });
  });

  it("clears the runtime view on unauthorized transport while retaining a paused durable job", async () => {
    const value = fixture();
    const t = transport({ saveComparison: vi.fn(async () => { throw new ComparisonTransportError("unauthorized"); }) });
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, transport: t });
    await workspace.open();
    await workspace.setWorking(value);
    await workspace.queueSave({ snapshot: value.snapshot, source: "member" });
    await workspace.pump();
    expect(workspace.current()).toMatchObject({ status: "locked", draft: null, snapshot: null, saves: [] });

    const reopened = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await reopened.open();
    expect(reopened.current()).toMatchObject({ status: "ready", saves: [{ status: "paused", pauseReason: "unauthorized" }] });
  });

  it("refreshes durable state during a pump without a transport and hides stale access", async () => {
    let current = true;
    const aAccess = access("profile-a", () => current);
    const a = new ComparisonWorkspace({ access: aAccess, tabId: "tab-a", now: () => NOW });
    const b = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-b", now: () => NOW });
    await Promise.all([a.open(), b.open()]);
    const value = fixture();
    await a.setWorking(value);
    await b.discard(true);
    await a.pump();
    expect(a.current()).toMatchObject({ status: "locked", draft: null, snapshot: null, saves: [] });
    current = false;
    expect(a.current()).toMatchObject({ status: "locked", draft: null, snapshot: null, saves: [] });
  });

  it("makes a successful discard idempotent for the same runtime", async () => {
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await workspace.open();
    await expect(workspace.discard(true)).resolves.toEqual({ kind: "ok", value: undefined });
    await expect(workspace.discard(true)).resolves.toEqual({ kind: "ok", value: undefined });
    expect(workspace.current().status).toBe("locked");
  });

  it("fences a stale discard against a newer generation without BroadcastChannel", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    try {
      const a = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
      const b = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-b", now: () => NOW });
      await Promise.all([a.open(), b.open()]);
      await b.discard(true);

      const value = fixture();
      const c = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-c", now: () => NOW });
      await c.open();
      await c.setWorking(value);

      await expect(a.discard(true)).resolves.toEqual({ kind: "error", code: "stale-callback" });
      const fresh = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-c", now: () => NOW });
      await fresh.open();
      expect(fresh.current().draft?.offers[0]?.id).toBe(value.draft.offers[0]?.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("allows only one network send when two tabs claim the same queued job", async () => {
    const t = transport();
    const a = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, transport: t });
    const b = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-b", now: () => NOW, transport: t });
    await Promise.all([a.open(), b.open()]);
    const value = fixture();
    const queued = await a.queueSave({ snapshot: value.snapshot, requestId: "00000000-0000-4000-8000-000000000051", source: "member" });
    expect(queued.kind).toBe("ok");
    await Promise.all([a.pump(), b.pump()]);
    expect(t.saveComparison).toHaveBeenCalledTimes(1);
    expect(a.current().saves[0]?.status).toBe("saved");
  });

  it("recovers an abandoned sending lease with the original request ID", async () => {
    let currentNow = NOW;
    const first = deferred<ComparisonSaveAcknowledgement>();
    let calls = 0;
    const t = transport({
      saveComparison: vi.fn(async (input) => {
        calls += 1;
        if (calls === 1) return first.promise;
        return { status: "saved" as const, requestId: input.requestId, resultId: JSON.parse(input.snapshot).resultId, serverHash: "server-hash" };
      }),
    });
    const a = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => currentNow, transport: t });
    const b = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-b", now: () => currentNow, transport: t });
    await Promise.all([a.open(), b.open()]);
    const value = fixture();
    const queued = await a.queueSave({ snapshot: value.snapshot, requestId: "00000000-0000-4000-8000-000000000052", source: "member" });
    if (queued.kind !== "ok") throw new Error("queue setup failed");
    const firstPump = a.pump();
    await vi.waitFor(() => expect(t.saveComparison).toHaveBeenCalledTimes(1));
    currentNow += COMPARISON_LEASE_MS + 1;
    await b.pump();
    first.resolve({ status: "saved", requestId: queued.value.requestId, resultId: value.snapshot.resultId, serverHash: "server-hash" });
    await firstPump;
    expect(t.saveComparison).toHaveBeenCalledTimes(2);
    expect(b.current().saves[0]).toMatchObject({ requestId: queued.value.requestId, status: "saved", attempts: 2 });
  });

  it("pauses expired jobs and caps transient retries without dropping them", async () => {
    let currentNow = NOW;
    const retryTransport = transport({ saveComparison: vi.fn(async () => { throw new ComparisonTransportError("network"); }) });
    const retryWorkspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => currentNow, transport: retryTransport });
    await retryWorkspace.open();
    const retryValue = fixture(8.7);
    await retryWorkspace.queueSave({ snapshot: retryValue.snapshot, requestId: "00000000-0000-4000-8000-000000000053", source: "member" });
    for (let attempt = 0; attempt < COMPARISON_MAX_ATTEMPTS; attempt += 1) {
      await retryWorkspace.pump();
      currentNow += 60_000;
    }
    expect(retryTransport.saveComparison).toHaveBeenCalledTimes(COMPARISON_MAX_ATTEMPTS);
    expect(retryWorkspace.current().saves[0]).toMatchObject({ status: "paused", pauseReason: "retry-exhausted", attempts: COMPARISON_MAX_ATTEMPTS });

    currentNow = NOW;
    const expiryTransport = transport();
    const expiryWorkspace = new ComparisonWorkspace({ access: access("profile-b"), tabId: "tab-a", now: () => currentNow, transport: expiryTransport });
    await expiryWorkspace.open();
    const expiryValue = fixture(8.8);
    await expiryWorkspace.queueSave({ snapshot: expiryValue.snapshot, createdAt: new Date(NOW).toISOString(), requestId: "00000000-0000-4000-8000-000000000054", source: "member" });
    currentNow = NOW + COMPARISON_REPLAY_WINDOW_MS + 1;
    await expiryWorkspace.pump();
    expect(expiryTransport.saveComparison).not.toHaveBeenCalled();
    expect(expiryWorkspace.current().saves[0]).toMatchObject({ status: "paused", pauseReason: "expired" });
  });

  it("recovers a still-valid terminal save only by explicit same-request retry", async () => {
    let currentNow = NOW;
    let fail = true;
    const send = vi.fn(async (input: Parameters<NonNullable<ComparisonTransport["saveComparison"]>>[0]) => {
      if (fail) throw new ComparisonTransportError("network");
      return { status: "saved" as const, requestId: input.requestId, resultId: JSON.parse(input.snapshot).resultId, serverHash: "server-hash" };
    });
    const retryTransport = transport({ saveComparison: send });
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => currentNow, transport: retryTransport });
    await workspace.open();
    const value = fixture(8.9);
    const requestId = "00000000-0000-4000-8000-000000000055";
    await workspace.queueSave({ snapshot: value.snapshot, requestId, source: "member" });
    for (let attempt = 0; attempt < COMPARISON_MAX_ATTEMPTS; attempt += 1) {
      await workspace.pump();
      currentNow += 60_000;
    }
    expect(workspace.current().saves[0]).toMatchObject({ status: "paused", pauseReason: "retry-exhausted", attempts: COMPARISON_MAX_ATTEMPTS });

    const callsBeforeRetry = send.mock.calls.length;
    const retried = await workspace.retryPausedSave(requestId);
    expect(retried).toEqual({ kind: "ok", value: { requestId } });
    expect(workspace.current().saves[0]).toMatchObject({ status: "queued", pauseReason: null, attempts: 0, requestId });
    fail = false;
    await workspace.pump();
    expect(send).toHaveBeenCalledTimes(callsBeforeRetry + 1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ requestId, snapshot: expect.any(String), createdAt: value.snapshot.createdAt }));
    expect(workspace.current().saves[0]).toMatchObject({ status: "saved", requestId });
  });

  it("refuses to replay an expired paused save and retains its snapshot", async () => {
    let currentNow = NOW;
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => currentNow, transport: transport() });
    await workspace.open();
    const value = fixture(9.1);
    const requestId = "00000000-0000-4000-8000-000000000056";
    await workspace.queueSave({ snapshot: value.snapshot, requestId, source: "member" });
    currentNow = NOW + COMPARISON_REPLAY_WINDOW_MS + 1;
    await workspace.pump();
    const before = workspace.current().saves[0];
    const retried = await workspace.retryPausedSave(requestId);
    expect(retried).toEqual({ kind: "error", code: "expired" });
    expect(workspace.current().saves[0]).toEqual(before);
    expect(workspace.current().saves[0]?.snapshot).toEqual(value.snapshot);
  });

  it("serializes explicit retries across tabs and fences them after account invalidation", async () => {
    let currentNow = NOW;
    let fail = true;
    const send = vi.fn(async (input: Parameters<NonNullable<ComparisonTransport["saveComparison"]>>[0]) => {
      if (fail) throw new ComparisonTransportError("network");
      return { status: "saved" as const, requestId: input.requestId, resultId: JSON.parse(input.snapshot).resultId, serverHash: "server-hash" };
    });
    const t = transport({ saveComparison: send });
    const current = { value: true };
    const a = new ComparisonWorkspace({ access: access("profile-a", () => current.value), tabId: "tab-a", now: () => currentNow, transport: t });
    const b = new ComparisonWorkspace({ access: access("profile-a", () => current.value), tabId: "tab-b", now: () => currentNow, transport: t });
    await Promise.all([a.open(), b.open()]);
    const value = fixture(9.2);
    const requestId = "00000000-0000-4000-8000-000000000057";
    await a.queueSave({ snapshot: value.snapshot, requestId, source: "member" });
    for (let attempt = 0; attempt < COMPARISON_MAX_ATTEMPTS; attempt += 1) {
      await a.pump();
      currentNow += 60_000;
    }
    expect(a.current().saves[0]).toMatchObject({ status: "paused", pauseReason: "retry-exhausted" });
    const callsBeforeRetry = send.mock.calls.length;
    const originalSnapshot = send.mock.calls[0][0].snapshot;
    fail = false;
    const retries = await Promise.all([a.retryPausedSave(requestId), b.retryPausedSave(requestId)]);
    expect(retries.filter((result) => result.kind === "ok")).toHaveLength(1);
    expect(retries.filter((result) => result.kind === "error")).toHaveLength(1);
    await Promise.all([a.pump(), b.pump()]);
    expect(send).toHaveBeenCalledTimes(callsBeforeRetry + 1);
    expect(send.mock.calls.at(-1)?.[0].requestId).toBe(requestId);
    expect(send.mock.calls.at(-1)?.[0].snapshot).toBe(originalSnapshot);

    current.value = false;
    await expect(a.retryPausedSave(requestId)).resolves.toEqual({ kind: "error", code: "locked" });
  });

  it("rejects only the 51st pending job and preserves the existing queue", async () => {
    const seedWorkspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await seedWorkspace.open();
    const seed = fixture();
    const seeded = await seedWorkspace.queueSave({ snapshot: seed.snapshot, requestId: "00000000-0000-4000-8000-000000000100", source: "member" });
    expect(seeded.kind).toBe("ok");
    seedWorkspace.close();

    // Seed the persisted boundary in one transaction. Each record still goes
    // through the workspace's real IndexedDB parser when the bounded workspace opens.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(COMPARISON_PRIVATE_DB);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("partitions", "readwrite");
    const store = tx.objectStore("partitions");
    const account = await new Promise<any>((resolve, reject) => {
      const request = store.get("account:profile-a");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const template = account.saves[0];
    const requestIdFor = (index: number) => `00000000-0000-4000-8000-${(index + 100).toString(16).padStart(12, "0")}`;
    account.saves = Array.from({ length: COMPARISON_MAX_SAVES - 1 }, (_, index) => ({
      ...template,
      requestId: requestIdFor(index),
    }));
    store.put(account);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-b", now: () => NOW });
    await workspace.open();
    const persistedSaves = workspace.current().saves;
    expect(persistedSaves).toHaveLength(COMPARISON_MAX_SAVES - 1);
    for (let index = 0; index < COMPARISON_MAX_SAVES - 1; index += 1) {
      expect(persistedSaves[index]).toMatchObject({
        status: "queued",
        requestId: requestIdFor(index),
      });
    }

    const fiftieth = await workspace.queueSave({ snapshot: seed.snapshot, requestId: requestIdFor(COMPARISON_MAX_SAVES - 1), source: "member" });
    expect(fiftieth).toEqual({ kind: "ok", value: { requestId: requestIdFor(COMPARISON_MAX_SAVES - 1) } });
    const beforeOverflow = workspace.current().saves;
    expect(beforeOverflow).toHaveLength(COMPARISON_MAX_SAVES);
    const overflow = await workspace.queueSave({ snapshot: fixture(15).snapshot, requestId: "00000000-0000-4000-8000-000000000155", source: "member" });
    expect(overflow).toEqual({ kind: "error", code: "queue_full" });
    expect(workspace.current().saves).toEqual(beforeOverflow);
  });

  it("loads an old account record without deletions as an empty deletion queue", async () => {
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await workspace.open();
    const value = fixture();
    await workspace.queueSave({ snapshot: value.snapshot, source: "member" });
    workspace.close();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(COMPARISON_PRIVATE_DB);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("partitions", "readwrite");
    const store = tx.objectStore("partitions");
    const account = await new Promise<any>((resolve, reject) => {
      const request = store.get("account:profile-a");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    delete account.deletions;
    store.put(account);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const reopened = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await reopened.open();
    expect(reopened.current().deletions).toEqual([]);
  });

  it("queues an offline deletion durably and completes it after reload", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const history = historyTransport();
    const first = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, historyTransport: history });
    await first.open();
    const value = fixture();
    const saved = await first.queueSave({ snapshot: value.snapshot, source: "member" });
    if (saved.kind !== "ok") throw new Error("save setup failed");
    const deletion = await first.queueDelete({ resultId: value.snapshot.resultId, comparisonId: "comparison-a" });
    expect(deletion).toMatchObject({ kind: "ok" });
    expect(first.current().deletions[0]).toMatchObject({ resultId: value.snapshot.resultId, comparisonId: "comparison-a", status: "queued", attempts: 0 });
    expect(first.current().saves).toEqual([]);
    first.close();
    const second = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, historyTransport: history });
    await second.open();
    expect(second.current().deletions[0]).toMatchObject({ resultId: value.snapshot.resultId, status: "queued" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await second.pump();
    expect(history.deleteComparison).toHaveBeenCalledTimes(1);
    expect(second.current().deletions[0]).toMatchObject({ status: "deleted", resultId: value.snapshot.resultId, comparisonId: "comparison-a" });
  });

  it("deduplicates a deletion and prevents a later save from resurrecting its result", async () => {
    const history = historyTransport();
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, historyTransport: history });
    await workspace.open();
    const value = fixture();
    const first = await workspace.queueDelete({ resultId: value.snapshot.resultId, comparisonId: "comparison-a", requestId: "00000000-0000-4000-8000-000000000201", createdAt: new Date(NOW).toISOString() });
    const second = await workspace.queueDelete({ resultId: value.snapshot.resultId, comparisonId: "comparison-a", requestId: "00000000-0000-4000-8000-000000000202", createdAt: new Date(NOW).toISOString() });
    expect(second).toEqual(first);
    expect(workspace.current().deletions).toHaveLength(1);
    expect(await workspace.queueSave({ snapshot: value.snapshot, source: "member" })).toEqual({ kind: "error", code: "deleted" });
  });

  it("keeps deletion tombstones isolated by account", async () => {
    const a = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    const b = new ComparisonWorkspace({ access: access("profile-b"), tabId: "tab-b", now: () => NOW });
    await Promise.all([a.open(), b.open()]);
    const value = fixture(8.7);
    await expect(a.queueDelete({ resultId: value.snapshot.resultId, comparisonId: "comparison-a", requestId: "00000000-0000-4000-8000-000000000205" })).resolves.toMatchObject({ kind: "ok" });
    expect(a.current().deletions).toHaveLength(1);
    expect(b.current().deletions).toEqual([]);
    await expect(b.queueDelete({ resultId: value.snapshot.resultId, comparisonId: "comparison-b", requestId: "00000000-0000-4000-8000-000000000205" })).resolves.toMatchObject({ kind: "ok" });
    expect(b.current().deletions[0]).toMatchObject({ comparisonId: "comparison-b", requestId: "00000000-0000-4000-8000-000000000205" });
  });

  it("removes a competing save before deletion and ignores a late save receipt", async () => {
    let resolveSave!: (value: ComparisonSaveAcknowledgement) => void;
    const pendingSave = new Promise<ComparisonSaveAcknowledgement>((resolve) => { resolveSave = resolve; });
    const saves = transport({ saveComparison: vi.fn(async () => pendingSave) });
    const history = historyTransport();
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW, transport: saves, historyTransport: history });
    await workspace.open();
    const value = fixture(8.8);
    const queued = await workspace.queueSave({ snapshot: value.snapshot, source: "member" });
    if (queued.kind !== "ok") throw new Error("save setup failed");
    const pumping = workspace.pump();
    await vi.waitFor(() => expect(saves.saveComparison).toHaveBeenCalledTimes(1));
    await expect(workspace.queueDelete({ resultId: value.snapshot.resultId, comparisonId: "comparison-a" })).resolves.toMatchObject({ kind: "ok" });
    expect(workspace.current().saves).toEqual([]);
    resolveSave({ status: "saved", requestId: queued.value.requestId, resultId: value.snapshot.resultId, serverHash: "server-hash" });
    await pumping;
    expect(workspace.current().deletions[0]?.status).toBe("deleted");
    await workspace.pump();
    expect(history.deleteComparison).toHaveBeenCalledTimes(1);
  });

  it("reclaims an expired deletion lease and ignores the first late receipt", async () => {
    let currentNow = NOW;
    let resolveFirst!: (value: ComparisonHistoryDeleteAcknowledgement) => void;
    const first = new Promise<ComparisonHistoryDeleteAcknowledgement>((resolve) => { resolveFirst = resolve; });
    let calls = 0;
    const history = historyTransport({ deleteComparison: vi.fn(async (input) => {
      calls += 1;
      if (calls === 1) return first;
      return { status: "deleted" as const, requestId: input.requestId, resultId: input.resultId, comparisonId: input.comparisonId ?? null, serverHash: "server-hash" };
    }) });
    const a = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => currentNow, historyTransport: history });
    const b = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-b", now: () => currentNow, historyTransport: history });
    await Promise.all([a.open(), b.open()]);
    const value = fixture(8.9);
    const queued = await a.queueDelete({ resultId: value.snapshot.resultId, comparisonId: "comparison-a", requestId: "00000000-0000-4000-8000-000000000203" });
    if (queued.kind !== "ok") throw new Error("delete setup failed");
    const firstPump = a.pump();
    await vi.waitFor(() => expect(history.deleteComparison).toHaveBeenCalledTimes(1));
    currentNow += COMPARISON_LEASE_MS + 1;
    await b.pump();
    resolveFirst({ status: "deleted", requestId: queued.value.requestId, resultId: value.snapshot.resultId, comparisonId: "comparison-a", serverHash: "server-hash" });
    await firstPump;
    expect(history.deleteComparison).toHaveBeenCalledTimes(2);
    expect(b.current().deletions[0]).toMatchObject({ status: "deleted", requestId: queued.value.requestId, resultId: value.snapshot.resultId });
  });

  it("keeps an expired paused deletion blocked and retains its tombstone", async () => {
    let currentNow = NOW;
    const history = historyTransport({ deleteComparison: vi.fn(async () => { throw new ComparisonTransportError("network"); }) });
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => currentNow, historyTransport: history });
    await workspace.open();
    const value = fixture(9.1);
    const requestId = "00000000-0000-4000-8000-000000000204";
    await workspace.queueDelete({ resultId: value.snapshot.resultId, comparisonId: "comparison-a", requestId });
    for (let attempt = 0; attempt < COMPARISON_MAX_ATTEMPTS; attempt += 1) {
      await workspace.pump();
      currentNow += 60_000;
    }
    expect(workspace.current().deletions[0]).toMatchObject({ status: "paused", pauseReason: "retry-exhausted" });
    currentNow = NOW + COMPARISON_REPLAY_WINDOW_MS + 1;
    await expect(workspace.retryPausedDelete(requestId)).resolves.toEqual({ kind: "error", code: "expired" });
    expect(workspace.current().deletions[0]).toMatchObject({ status: "paused", pauseReason: "expired", requestId });
  });

  it("continues past an expired first job to process a later valid save", async () => {
    let currentNow = NOW;
    const t = transport();
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => currentNow, transport: t });
    await workspace.open();
    const expired = fixture(8.5);
    await workspace.queueSave({ snapshot: expired.snapshot, source: "member" });
    currentNow = NOW + COMPARISON_REPLAY_WINDOW_MS + 1;
    const current = fixture(8.6);
    await workspace.queueSave({ snapshot: current.snapshot, source: "member", createdAt: new Date(currentNow).toISOString() });
    await workspace.pump();
    expect(t.saveComparison).toHaveBeenCalledTimes(1);
    expect(workspace.current().saves).toEqual(expect.arrayContaining([
      expect.objectContaining({ resultId: expired.snapshot.resultId, status: "paused", pauseReason: "expired" }),
      expect.objectContaining({ resultId: current.snapshot.resultId, status: "saved" }),
    ]));
  });

  it("broadcasts queue and deletion updates without closing same-tab workspace instances", async () => {
    class FakeChannel {
      static channels: FakeChannel[] = [];
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() { FakeChannel.channels.push(this); }
      postMessage(data: unknown) { for (const channel of FakeChannel.channels) if (channel !== this) channel.onmessage?.({ data } as MessageEvent); }
      close() { const index = FakeChannel.channels.indexOf(this); if (index >= 0) FakeChannel.channels.splice(index, 1); }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return false; }
    }
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    try {
      const a = new ComparisonWorkspace({ access: access("profile-a"), tabId: "same-tab", now: () => NOW, historyTransport: historyTransport() });
      const b = new ComparisonWorkspace({ access: access("profile-a"), tabId: "same-tab", now: () => NOW, historyTransport: historyTransport() });
      await Promise.all([a.open(), b.open()]);
      const value = fixture(8.7);
      await a.queueDelete({ resultId: value.snapshot.resultId, comparisonId: "comparison-a" });
      await vi.waitFor(() => expect(b.current().deletions).toHaveLength(1));
      expect(b.current().status).toBe("ready");
      await a.pump();
      await vi.waitFor(() => expect(b.current().deletions[0]?.status).toBe("deleted"));
      expect(a.current().status).toBe("ready");
      expect(b.current().status).toBe("ready");
      a.close();
      b.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("bounds completed deletion tombstones while retaining pending work", async () => {
    const seed = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await seed.open();
    seed.close();
    const completedIds: string[] = [];
    for (let index = 0; index < COMPARISON_MAX_DELETIONS - 1; index += 1) {
      const resultId = `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;
      completedIds.push(resultId);
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(COMPARISON_PRIVATE_DB);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("partitions", "readwrite");
    const store = tx.objectStore("partitions");
    const account = await new Promise<any>((resolve, reject) => {
      const request = store.get("account:profile-a");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    account.deletions = completedIds.map((resultId, index) => ({ requestId: `00000000-0000-4000-8000-${(index + 100).toString(16).padStart(12, "0")}`, resultId, comparisonId: `comparison-${index}`, createdAt: new Date(NOW).toISOString(), status: "deleted", attempts: 1, nextAttemptAt: NOW, leaseId: null, leaseUntil: null, pauseReason: null }));
    store.put(account);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
    const workspace = new ComparisonWorkspace({ access: access("profile-a"), tabId: "tab-a", now: () => NOW });
    await workspace.open();
    const pendingResultId = "00000000-0000-4000-8000-000000000050";
    await workspace.queueDelete({ resultId: pendingResultId, comparisonId: "comparison-pending" });
    const newestResultId = "00000000-0000-4000-8000-000000000051";
    await workspace.queueDelete({ resultId: newestResultId, comparisonId: "comparison-newest" });
    expect(workspace.current().deletions).toHaveLength(COMPARISON_MAX_DELETIONS);
    expect(workspace.current().deletions.some((job) => job.resultId === completedIds[0])).toBe(false);
    expect(workspace.current().deletions.find((job) => job.resultId === pendingResultId)?.status).toBe("queued");
  }, 30_000);
});
