import { describe, expect, it, beforeEach } from "vitest";
import { indexedDB } from "fake-indexeddb";
import { compareOffers } from "../lib/finance/comparison";
import type { Offer } from "../lib/finance/types";
import { createComparisonSnapshot } from "../lib/contracts/snapshot";
import { decodeComparisonDraft } from "../lib/contracts/comparison-draft";
import {
  GUEST_HANDOFF_DB_NAME,
  GUEST_HANDOFF_MAX_RECORDS,
  GuestHandoffStorage,
} from "../lib/guest/handoff";

const NOW = "2026-09-16T00:00:00.000Z";
let clock = NOW;
const now = () => clock;

const offer = (id: string, changes: Partial<Offer> = {}): Offer => ({
  id,
  lender: `Lender ${id}`,
  loanType: "home",
  amount: 5_000_000,
  ratePct: 8.5,
  rateType: "reducing",
  rateStructure: "floating",
  tenureValue: 20,
  tenureUnit: "years",
  processingFee: { mode: "percent", value: 0.25 },
  gstPct: 18,
  insurancePremium: 0,
  insuranceFunding: "financed",
  otherFees: [],
  ...changes,
});

const snapshot = (count = 2) => {
  const offers = Array.from({ length: count }, (_, index) => offer(String.fromCharCode(97 + index), { amount: 5_000_000 + index * 100_000 }));
  return createComparisonSnapshot(offers, compareOffers(offers), { createdAt: NOW });
};

const incompleteDraft = (count = 2) => ({
  loanType: "home" as const,
  offers: Array.from({ length: count }, (_, index) => offer(String.fromCharCode(97 + index), { amount: 0, ratePct: 0, tenureValue: 0 })),
});

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(GUEST_HANDOFF_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function readRaw(requestId: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(GUEST_HANDOFF_DB_NAME);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("handoffs", "readonly").objectStore("handoffs").get(requestId);
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

async function putRaw(record: Record<string, any>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(GUEST_HANDOFF_DB_NAME);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("handoffs", "readwrite");
      tx.objectStore("handoffs").put(record);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

describe("durable guest comparison handoff", () => {
  beforeEach(async () => {
    clock = NOW;
    await deleteDatabase();
  });

  it("persists an edited incomplete draft across instances and locks claimed reads", async () => {
    const first = new GuestHandoffStorage({ indexedDB, now });
    const prepared = await first.prepare({ action: "recalculate_existing_draft", initiatingTabId: "tab-a", snapshot: snapshot(), draft: incompleteDraft() });
    expect(prepared.kind).toBe("ok");
    if (prepared.kind !== "ok") return;
    const second = new GuestHandoffStorage({ indexedDB, now });
    const pending = await second.read(prepared.value.intent.requestId, "tab-a");
    expect(pending.kind).toBe("ok");
    if (pending.kind !== "ok") return;
    expect(pending.value.draft?.offers[0]?.amount).toBe(0);
    const recoveredBeforeClaim = await second.recover(prepared.value.intent.requestId, "tab-a");
    expect(recoveredBeforeClaim.kind).toBe("ok");
    const claimed = await second.claim(prepared.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 4 });
    expect(claimed.kind).toBe("ok");
    expect((await second.recover(prepared.value.intent.requestId, "tab-a")).kind).toBe("not-found");
    const wrongTab = await first.read(prepared.value.intent.requestId, { initiatingTabId: "tab-b", accountKeyHash: "profile-a", authEpoch: 4 });
    expect(wrongTab.kind).toBe("locked");
    const wrongAccount = await first.read(prepared.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-b", authEpoch: 4 });
    expect(wrongAccount.kind).toBe("locked");
    const member = await first.read(prepared.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 4 });
    expect(member.kind).toBe("ok");
  });

  it("serializes concurrent claims, keeps the request ID, and rotates an expired lease", async () => {
    const storage = new GuestHandoffStorage({ indexedDB, now });
    const prepared = await storage.prepare({ action: "save", initiatingTabId: "tab-a", snapshot: snapshot(), draft: null });
    expect(prepared.kind).toBe("ok");
    if (prepared.kind !== "ok") return;
    const context = { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 1 };
    const [first, second] = await Promise.all([storage.claim(prepared.value.intent.requestId, context), storage.claim(prepared.value.intent.requestId, context)]);
    expect([first.kind, second.kind].sort()).toEqual(["ok", "ok"]);
    const claims = [first, second].filter((result): result is Extract<typeof result, { kind: "ok" }> => result.kind === "ok");
    expect(claims.map((result) => result.value.status).sort()).toEqual(["already_claimed", "claimed"]);
    const claimId = claims.find((result) => result.value.status === "claimed")?.value.intent.claimId;
    expect(claimId).toBeTruthy();
    clock = "2026-09-16T00:03:00.000Z";
    const recovered = await storage.claim(prepared.value.intent.requestId, { ...context, now: clock });
    expect(recovered.kind).toBe("ok");
    if (recovered.kind !== "ok") return;
    expect(recovered.value.status).toBe("claimed");
    expect(recovered.value.intent.claimId).not.toBe(claimId);
    expect(recovered.value.intent.requestId).toBe(prepared.value.intent.requestId);
  });

  it("allows guest cancellation, purges payload at terminal state, and accepts a later prepare", async () => {
    const storage = new GuestHandoffStorage({ indexedDB, now });
    const prepared = await storage.prepare({ action: "save", initiatingTabId: "tab-a", snapshot: snapshot(), draft: null });
    expect(prepared.kind).toBe("ok");
    if (prepared.kind !== "ok") return;
    const cancelled = await storage.cancel(prepared.value.intent.requestId, { initiatingTabId: "tab-a" });
    expect(cancelled).toMatchObject({ kind: "ok", value: { status: "cancelled" } });
    const raw = await readRaw(prepared.value.intent.requestId);
    expect(raw.snapshotJson).toBeNull();
    expect(raw.draftJson).toBeNull();
    expect((await storage.read(prepared.value.intent.requestId, "tab-a")).kind).toBe("terminal");
    const recovered = await storage.recover(prepared.value.intent.requestId, "tab-a");
    expect(recovered).toMatchObject({ kind: "ok", value: { snapshot: expect.any(Object) } });
    const later = await storage.prepare({ action: "new_comparison", initiatingTabId: "tab-a", snapshot: null, draft: null });
    expect(later.kind).toBe("ok");
    if (later.kind !== "ok") return;
    const claimed = await storage.claim(later.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 1 });
    expect(claimed.kind).toBe("ok");
    if (claimed.kind !== "ok") return;
    const completed = await storage.complete(later.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 1, claimId: claimed.value.intent.claimId! });
    expect(completed).toMatchObject({ kind: "ok", value: { status: "completed" } });
    const completedRaw = await readRaw(later.value.intent.requestId);
    expect(completedRaw.snapshotJson).toBeNull();
    expect((await storage.recover(later.value.intent.requestId, "tab-a")).kind).toBe("not-found");
  });

  it("rejects wrong tab/account/epoch and old claim completion after recovery", async () => {
    const storage = new GuestHandoffStorage({ indexedDB, now });
    const prepared = await storage.prepare({ action: "save", initiatingTabId: "tab-a", snapshot: snapshot(), draft: null });
    expect(prepared.kind).toBe("ok");
    if (prepared.kind !== "ok") return;
    expect((await storage.claim(prepared.value.intent.requestId, { initiatingTabId: "tab-b", accountKeyHash: "profile-a", authEpoch: 1 })).kind).toBe("locked");
    const first = await storage.claim(prepared.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 1 });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect((await storage.claim(prepared.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-b", authEpoch: 1 })).kind).toBe("locked");
    expect((await storage.claim(prepared.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 2 })).kind).toBe("locked");
    expect((await storage.cancel(prepared.value.intent.requestId, { initiatingTabId: "tab-a" })).kind).toBe("invalid");
    clock = "2026-09-16T00:03:00.000Z";
    const recovered = await storage.claim(prepared.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 1, now: clock });
    expect(recovered.kind).toBe("ok");
    if (recovered.kind !== "ok") return;
    expect((await storage.complete(prepared.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 1, claimId: first.value.intent.claimId!, now: clock })).kind).toBe("locked");
    expect((await storage.complete(prepared.value.intent.requestId, { initiatingTabId: "tab-a", accountKeyHash: "profile-a", authEpoch: 1, claimId: recovered.value.intent.claimId!, now: clock })).kind).toBe("ok");
  });

  it("prunes expired pending records before enforcing the bounded record count", async () => {
    const storage = new GuestHandoffStorage({ indexedDB, now });
    const first = await storage.prepare({ action: "recalculate_existing_draft", initiatingTabId: "expiring-tab", snapshot: null, draft: incompleteDraft() });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    clock = "2026-09-16T00:11:00.000Z";
    expect((await storage.recover(first.value.intent.requestId, "expiring-tab")).kind).toBe("ok");
    await deleteDatabase();
    clock = NOW;
    for (let index = 0; index < GUEST_HANDOFF_MAX_RECORDS; index += 1) {
      expect((await storage.prepare({ action: "new_comparison", initiatingTabId: `tab-${index}`, snapshot: null, draft: null })).kind).toBe("ok");
    }
    clock = "2026-09-16T00:11:00.000Z";
    expect((await storage.prepare({ action: "new_comparison", initiatingTabId: "fresh-tab", snapshot: null, draft: null })).kind).toBe("ok");
  });

  it("rejects malformed drafts, oversized/corrupt records, and unavailable persistence", async () => {
    expect(() => decodeComparisonDraft({ loanType: "home", offers: [incompleteDraft().offers[0], incompleteDraft().offers[1], incompleteDraft().offers[0]] }, 2)).toThrow();
    const storage = new GuestHandoffStorage({ indexedDB, now });
    const prepared = await storage.prepare({ action: "save", initiatingTabId: "tab-a", snapshot: snapshot(), draft: null });
    expect(prepared.kind).toBe("ok");
    if (prepared.kind !== "ok") return;
    const raw = await readRaw(prepared.value.intent.requestId);
    const mismatched = JSON.parse(raw.snapshotJson) as Record<string, unknown>;
    mismatched.resultId = "00000000-0000-4000-8000-000000000009";
    await putRaw({ ...raw, snapshotJson: JSON.stringify(mismatched) });
    expect((await storage.read(prepared.value.intent.requestId, "tab-a")).kind).toBe("storage-unavailable");
    await putRaw({ ...raw, snapshotJson: "x".repeat(300_000) });
    expect((await storage.read(prepared.value.intent.requestId, "tab-a")).kind).toBe("storage-unavailable");
    const unavailable = new GuestHandoffStorage({ indexedDB: { open: () => { throw new Error("blocked"); } } as unknown as IDBFactory, now });
    expect((await unavailable.prepare({ action: "new_comparison", initiatingTabId: "tab-a", snapshot: null, draft: null })).kind).toBe("storage-unavailable");
  });

  it("keeps guest recovery through intent expiry but expires it at the seven-day bound", async () => {
    const storage = new GuestHandoffStorage({ indexedDB, now });
    const prepared = await storage.prepare({ action: "recalculate_existing_draft", initiatingTabId: "tab-a", snapshot: null, draft: incompleteDraft() });
    expect(prepared.kind).toBe("ok");
    if (prepared.kind !== "ok") return;
    clock = "2026-09-16T00:10:00.000Z";
    expect((await storage.recover(prepared.value.intent.requestId, "tab-a")).kind).toBe("ok");
    clock = "2026-09-23T00:00:01.000Z";
    expect((await storage.recover(prepared.value.intent.requestId, "tab-a")).kind).toBe("expired");
  });
});
