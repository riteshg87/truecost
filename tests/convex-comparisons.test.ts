import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { compareOffers } from "../lib/finance/comparison";
import { createComparisonSnapshot, decodeComparisonSnapshot, serializeComparisonSnapshot } from "../lib/contracts/snapshot";
import type { Offer } from "../lib/finance/types";

const modules = {
  "./users.ts": async () => import("../convex/users"),
  "./comparisons.ts": async () => import("../convex/comparisons"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};

function backend() {
  return convexTest({ schema, modules });
}

function identity(issuer: string, subject: string) {
  return { issuer, subject, tokenIdentifier: `${issuer}|${subject}` };
}

function requestId(seed: number): string {
  return `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`;
}

function createdAt(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function offer(id: string, ratePct = 8): Offer {
  return {
    id,
    lender: `Lender ${id}`,
    loanType: "home",
    amount: 1_000_000,
    ratePct,
    rateType: "reducing",
    rateStructure: "floating",
    tenureValue: 20,
    tenureUnit: "years",
    processingFee: { mode: "percent", value: 0.5 },
    gstPct: 18,
    insurancePremium: 0,
    insuranceFunding: "upfront",
    otherFees: [],
  };
}

function snapshot(at = createdAt(), ratePct = 8): { json: string; resultId: string; createdAt: string } {
  const offers = [offer("offer-a", ratePct), offer("offer-b", ratePct + 0.25)];
  const value = createComparisonSnapshot(offers, compareOffers(offers), { createdAt: at });
  return { json: serializeComparisonSnapshot(value), resultId: value.resultId, createdAt: at };
}

async function member(t: ReturnType<typeof backend>, subject: string) {
  const account = t.withIdentity(identity("https://issuer.example", subject));
  await account.mutation(api.users.ensureCurrentUser, {});
  return account;
}

function saveArgs(value: ReturnType<typeof snapshot>, id = 1, title: string | null = null) {
  return { requestId: requestId(id), snapshot: value.json, createdAt: value.createdAt, title, source: "member" as const };
}

describe("private immutable comparison backend", () => {
  it("denies anonymous access and accepts only bounded pages", async () => {
    const t = backend();
    const value = snapshot();
    await expect(t.mutation(api.comparisons.saveComparison, saveArgs(value))).rejects.toThrow(/unauthorized/i);
    await expect(t.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 1, cursor: null } })).rejects.toThrow(/unauthorized/i);
    await expect(t.mutation(api.comparisons.deleteComparison, {
      requestId: requestId(2), resultId: value.resultId, createdAt: value.createdAt,
    })).rejects.toThrow(/unauthorized/i);
  });

  it("denies a valid identity after its profile becomes inactive", async () => {
    const t = backend();
    const account = await member(t, "account-a");
    const profile = await account.mutation(api.users.ensureCurrentUser, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(profile._id, { status: "deleting" });
    });
    const value = snapshot();
    await expect(account.mutation(api.comparisons.saveComparison, saveArgs(value, 3))).rejects.toThrow(/unauthorized/i);
    await expect(account.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 1, cursor: null } })).rejects.toThrow(/unauthorized/i);
  });

  it("isolates owners and makes a foreign direct ID look unavailable", async () => {
    const t = backend();
    const accountA = await member(t, "account-a");
    const accountB = await member(t, "account-b");
    const value = snapshot();
    const saved = await accountA.mutation(api.comparisons.saveComparison, saveArgs(value));
    expect(saved).toMatchObject({ status: "saved", resultId: value.resultId });
    if (saved.status !== "saved") throw new Error("expected saved result");
    expect(await accountB.query(api.comparisons.getComparison, { comparisonId: saved.comparisonId })).toBeNull();
    expect((await accountA.query(api.comparisons.getComparison, { comparisonId: saved.comparisonId }))?.snapshot).toBe(value.json);
    expect(await accountB.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 5, cursor: null } })).toMatchObject({ status: "ok", result: { page: [] } });
  });

  it("stores the canonical immutable snapshot without recomputing or changing its values", async () => {
    const t = backend();
    const account = await member(t, "account-a");
    const value = snapshot();
    const stored = await account.mutation(api.comparisons.saveComparison, { ...saveArgs(value), title: "  Rate check  " });
    expect(stored.status).toBe("saved");
    if (stored.status !== "saved") throw new Error("expected saved result");
    const row = await account.query(api.comparisons.getComparison, { comparisonId: stored.comparisonId });
    expect(row).toMatchObject({ resultId: value.resultId, title: "Rate check", calculationVersion: "finance-engine-v1", source: "member", createdAt: value.createdAt });
    const decoded = decodeComparisonSnapshot(row?.snapshot ? JSON.parse(row.snapshot) : null);
    expect(serializeComparisonSnapshot(decoded)).toBe(value.json);
    expect(decoded.result.rows.map((item) => item.derived.emi)).toEqual(
      decodeComparisonSnapshot(JSON.parse(value.json)).result.rows.map((item) => item.derived.emi),
    );
  });

  it("returns safe validation errors for malformed, oversized, stale and mismatched payloads", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-09-16T12:00:00.000Z");
      vi.setSystemTime(now);
      const t = backend();
      const account = await member(t, "account-a");
      const value = snapshot(now.toISOString());
      const base = saveArgs(value, 10);
      const preserved = snapshot(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString());
      await expect(account.mutation(api.comparisons.saveComparison, { ...base, requestId: requestId(9), snapshot: preserved.json })).resolves.toMatchObject({ status: "saved", resultId: preserved.resultId });
      await expect(account.mutation(api.comparisons.saveComparison, { ...base, snapshot: "not json" })).resolves.toMatchObject({ status: "error", code: "invalid_shape" });
      await expect(account.mutation(api.comparisons.saveComparison, { ...base, requestId: requestId(11), snapshot: `${value.json.slice(0, -1)},\"extra\":true}` })).resolves.toMatchObject({ status: "error" });
      await expect(account.mutation(api.comparisons.saveComparison, { ...base, requestId: requestId(12), snapshot: `${value.json}${"x".repeat(256 * 1024)}` })).resolves.toMatchObject({ status: "error" });
      const unsupported = JSON.parse(value.json) as Record<string, unknown>;
      unsupported.schemaVersion = 99;
      await expect(account.mutation(api.comparisons.saveComparison, { ...base, requestId: requestId(16), snapshot: JSON.stringify(unsupported) })).resolves.toMatchObject({ status: "error", code: "unsupported_schema" });
      const tooFew = JSON.parse(value.json) as { offers: unknown[] };
      tooFew.offers = tooFew.offers.slice(0, 1);
      await expect(account.mutation(api.comparisons.saveComparison, { ...base, requestId: requestId(17), snapshot: JSON.stringify(tooFew) })).resolves.toMatchObject({ status: "error", code: "wrong_count" });
      await expect(account.mutation(api.comparisons.saveComparison, { ...base, requestId: requestId(13), createdAt: new Date(now.getTime() - 1).toISOString() })).resolves.toMatchObject({ status: "error", code: "invalid_timestamp" });
      await expect(account.mutation(api.comparisons.saveComparison, { ...base, requestId: requestId(14), createdAt: new Date(now.getTime() + 1).toISOString() })).resolves.toMatchObject({ status: "error", code: "invalid_timestamp" });
      await expect(account.mutation(api.comparisons.saveComparison, { ...base, requestId: requestId(15), createdAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString() })).resolves.toMatchObject({ status: "error", code: "expired" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("replays the same request, rejects changed reuse and prevents result conflicts", async () => {
    const t = backend();
    const account = await member(t, "account-a");
    const value = snapshot();
    const args = saveArgs(value, 20);
    expect(await account.mutation(api.comparisons.saveComparison, args)).toMatchObject({ status: "saved" });
    expect(await account.mutation(api.comparisons.saveComparison, args)).toMatchObject({ status: "replayed" });
    expect(await account.mutation(api.comparisons.saveComparison, { ...args, title: "changed" })).toMatchObject({ status: "error", code: "request_reuse" });
    expect(await account.mutation(api.comparisons.saveComparison, { ...args, requestId: requestId(21), title: "different result metadata" })).toMatchObject({ status: "error", code: "result_conflict" });
  });

  it("serializes duplicate result writes and handles concurrent same-request retries", async () => {
    const t = backend();
    const account = await member(t, "account-a");
    const value = snapshot();
    const same = saveArgs(value, 30);
    const sameResults = await Promise.all([
      account.mutation(api.comparisons.saveComparison, same),
      account.mutation(api.comparisons.saveComparison, same),
    ]);
    expect(sameResults.filter((result) => result.status === "saved")).toHaveLength(1);
    expect(sameResults.filter((result) => result.status === "replayed")).toHaveLength(1);
    const distinct = await Promise.all([
      account.mutation(api.comparisons.saveComparison, { ...same, requestId: requestId(31) }),
      account.mutation(api.comparisons.saveComparison, { ...same, requestId: requestId(32) }),
    ]);
    expect(distinct.every((result) => result.status === "replayed")).toBe(true);
    expect(await account.mutation(api.comparisons.saveComparison, { ...same, requestId: requestId(31), title: "changed after acknowledged duplicate" })).toMatchObject({ status: "error", code: "request_reuse" });
  });

  it("deletes before create, blocks delayed saves, and keeps deletion acknowledgements historical", async () => {
    const t = backend();
    const account = await member(t, "account-a");
    const value = snapshot();
    const deleted = await account.mutation(api.comparisons.deleteComparison, { requestId: requestId(40), resultId: value.resultId, createdAt: value.createdAt });
    expect(deleted).toMatchObject({ status: "deleted", comparisonId: null });
    expect(await account.mutation(api.comparisons.saveComparison, saveArgs(value, 41))).toMatchObject({ status: "blocked", code: "deleted" });
    expect(await account.mutation(api.comparisons.deleteComparison, { requestId: requestId(40), resultId: value.resultId, createdAt: value.createdAt })).toMatchObject({ status: "replayed" });
    expect(await account.mutation(api.comparisons.deleteComparison, { requestId: requestId(42), resultId: value.resultId, createdAt: value.createdAt })).toMatchObject({ status: "replayed", comparisonId: null });
    const page = await account.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 5, cursor: null } });
    expect(page).toMatchObject({ status: "ok", result: { page: [] } });
  });

  it("deletes an existing row by stable result ID and keeps accounts separate", async () => {
    const t = backend();
    const accountA = await member(t, "account-a");
    const accountB = await member(t, "account-b");
    const value = snapshot();
    const saved = await accountA.mutation(api.comparisons.saveComparison, saveArgs(value, 50));
    if (saved.status !== "saved") throw new Error("expected saved result");
    expect(await accountB.mutation(api.comparisons.deleteComparison, { requestId: requestId(51), resultId: value.resultId, createdAt: value.createdAt })).toMatchObject({ status: "deleted", comparisonId: null });
    expect(await accountA.query(api.comparisons.getComparison, { comparisonId: saved.comparisonId })).not.toBeNull();
    expect(await accountA.mutation(api.comparisons.deleteComparison, { requestId: requestId(52), resultId: value.resultId, createdAt: value.createdAt })).toMatchObject({ status: "deleted", comparisonId: saved.comparisonId });
    expect(await accountA.query(api.comparisons.getComparison, { comparisonId: saved.comparisonId })).toBeNull();
  });

  it("lists newest first with bounded pagination metadata and owner isolation", async () => {
    const t = backend();
    const account = await member(t, "account-a");
    const other = await member(t, "account-b");
    const values = [snapshot(createdAt(-2_000), 8), snapshot(createdAt(-1_000), 8.5), snapshot(createdAt(), 9)];
    for (let index = 0; index < values.length; index += 1) await account.mutation(api.comparisons.saveComparison, saveArgs(values[index], 60 + index));
    await other.mutation(api.comparisons.saveComparison, saveArgs(snapshot(), 70));
    const first = await account.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 2, cursor: null } });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") throw new Error("expected page");
    expect(first.result.page.map((row) => row.resultId)).toEqual([values[2].resultId, values[1].resultId]);
    expect(first.result.isDone).toBe(false);
    const second = await account.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 2, cursor: first.result.continueCursor } });
    expect(second).toMatchObject({ status: "ok", result: { page: [{ resultId: values[0].resultId }], isDone: true } });
    await expect(account.query(api.comparisons.listComparisons, { paginationOpts: { numItems: 0, cursor: null } })).resolves.toMatchObject({ status: "error", code: "invalid_number" });
  });

  it("enforces the per-owner rolling quota while allowing replay and rollover", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-09-16T12:00:00.000Z");
      vi.setSystemTime(now);
      const t = backend();
      const account = await member(t, "account-a");
      const values = Array.from({ length: 21 }, (_, index) => snapshot(now.toISOString(), 8 + index / 100));
      const results = [];
      for (let index = 0; index < 20; index += 1) results.push(await account.mutation(api.comparisons.saveComparison, saveArgs(values[index], 100 + index)));
      expect(results.every((result) => result.status === "saved")).toBe(true);
      expect(await account.mutation(api.comparisons.saveComparison, saveArgs(values[20], 120))).toMatchObject({ status: "limited", code: "rate_limited" });
      expect(await account.mutation(api.comparisons.saveComparison, saveArgs(values[0], 122))).toMatchObject({ status: "limited", code: "rate_limited" });
      expect(await account.mutation(api.comparisons.saveComparison, saveArgs(values[0], 100))).toMatchObject({ status: "replayed" });
      vi.advanceTimersByTime(QUOTA_WINDOW_MS + 1);
      const rolled = snapshot(new Date().toISOString(), 12);
      expect(await account.mutation(api.comparisons.saveComparison, saveArgs(rolled, 121))).toMatchObject({ status: "saved" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies quota to new delete acknowledgements on an existing tombstone", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-09-16T12:00:00.000Z");
      vi.setSystemTime(now);
      const t = backend();
      const account = await member(t, "account-a");
      const value = snapshot(now.toISOString());
      expect(await account.mutation(api.comparisons.deleteComparison, { requestId: requestId(200), resultId: value.resultId, createdAt: value.createdAt })).toMatchObject({ status: "deleted" });
      for (let index = 1; index < 20; index += 1) {
        expect(await account.mutation(api.comparisons.deleteComparison, { requestId: requestId(200 + index), resultId: value.resultId, createdAt: value.createdAt })).toMatchObject({ status: "replayed" });
      }
      expect(await account.mutation(api.comparisons.deleteComparison, { requestId: requestId(220), resultId: value.resultId, createdAt: value.createdAt })).toMatchObject({ status: "limited", code: "rate_limited" });
      expect(await account.mutation(api.comparisons.deleteComparison, { requestId: requestId(200), resultId: value.resultId, createdAt: value.createdAt })).toMatchObject({ status: "replayed" });
      vi.advanceTimersByTime(QUOTA_WINDOW_MS + 1);
      expect(await account.mutation(api.comparisons.deleteComparison, { requestId: requestId(220), resultId: value.resultId, createdAt: new Date().toISOString() })).toMatchObject({ status: "replayed" });
    } finally {
      vi.useRealTimers();
    }
  });
});

const QUOTA_WINDOW_MS = 60 * 1000;
