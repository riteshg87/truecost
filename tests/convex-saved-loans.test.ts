import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { canonicalSavedLoanPayload, parseSavedLoanPayload, type SavedLoanPayload } from "../lib/contracts/saved-loan";
import type { LoanRecord, TransferQuote } from "../lib/health/types";

const modules = {
  "./users.ts": async () => import("../convex/users"),
  "./savedLoans.ts": async () => import("../convex/savedLoans"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};

function testBackend() {
  return convexTest({ schema, modules });
}

function identity(issuer: string, subject: string) {
  return { issuer, subject, tokenIdentifier: `${issuer}|${subject}` };
}

function requestId(seed: string): string {
  return `00000000-0000-4000-8000-${seed.padStart(12, "0")}`;
}

function createdAt(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const basePayload: SavedLoanPayload = {
  loan: {
    lender: "Example Bank",
    original: 2_000_000,
    outstanding: 1_650_000,
    ratePct: 8.5,
    basis: "repo",
    spreadPct: 2.75,
    cycle: "quarterly",
    lastReset: "2026-07-01",
    monthsLeft: 214,
  },
  quote: {
    newRatePct: 8,
    feePct: 0.25,
    legalCharges: 5_000,
    keepTenure: true,
    newTenureMonths: 214,
  },
  surplus: 100_000,
  bufferMonths: 6,
  rateResolvedAt: null,
};

const legacyPayloadJsonWithDate = '{"loan":{"lender":"Example Bank","original":2000000,"outstanding":1650000,"ratePct":8.5,"basis":"repo","spreadPct":2.75,"cycle":"quarterly","lastReset":"2026-07-01","monthsLeft":214},"quote":{"newRatePct":8,"feePct":0.25,"legalCharges":5000,"keepTenure":true,"newTenureMonths":214},"surplus":100000,"bufferMonths":6,"rateResolvedAt":null}';
const legacyPayloadJsonWithBlankReset = '{"loan":{"lender":"Example Bank","original":2000000,"outstanding":1650000,"ratePct":8.5,"basis":"repo","spreadPct":2.75,"cycle":"quarterly","lastReset":"","monthsLeft":214},"quote":{"newRatePct":8,"feePct":0.25,"legalCharges":5000,"keepTenure":true,"newTenureMonths":214},"surplus":100000,"bufferMonths":6,"rateResolvedAt":null}';

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function payload(overrides: {
  loan?: Partial<LoanRecord>;
  quote?: Partial<TransferQuote>;
  surplus?: number;
  bufferMonths?: number;
  rateResolvedAt?: string | null;
} = {}): SavedLoanPayload {
  const { loan, quote, ...scalarOverrides } = overrides;
  return {
    ...basePayload,
    loan: { ...basePayload.loan, ...loan },
    quote: { ...basePayload.quote, ...quote },
    ...scalarOverrides,
  };
}

async function member(t: ReturnType<typeof testBackend>, subject: string) {
  const account = t.withIdentity(identity("https://issuer.example", subject));
  await account.mutation(api.users.ensureCurrentUser, {});
  return account;
}

async function rowCounts(t: ReturnType<typeof testBackend>) {
  return t.run(async (ctx) => ({
    savedLoans: (await ctx.db.query("savedLoans").collect()).length,
    receipts: (await ctx.db.query("operationReceipts").collect()).length,
    tombstones: (await ctx.db.query("recordTombstones").collect()).length,
  }));
}

describe("saved loan contract", () => {
  it("loads old records as legacy without upgrading their provenance", () => {
    const parsed = parseSavedLoanPayload(basePayload);
    expect(parsed.loan.spreadPct).toBe(2.75);
    expect(parsed.loan.spreadProvenance).toBe("legacy");
    expect(parsed.loan.lastResetProvenance).toBe("legacy");
    expect(canonicalSavedLoanPayload(parsed)).toBe(canonicalSavedLoanPayload(basePayload));
  });

  it("round-trips unknown and explicitly confirmed zero inputs", () => {
    const unknown = parseSavedLoanPayload({
      ...basePayload,
      loan: { ...basePayload.loan, spreadPct: null, spreadProvenance: "unknown", lastReset: "", lastResetProvenance: "unknown" },
    });
    expect(unknown.loan).toMatchObject({ spreadPct: null, spreadProvenance: "unknown", lastReset: "", lastResetProvenance: "unknown" });
    const zero = parseSavedLoanPayload({
      ...basePayload,
      loan: { ...basePayload.loan, spreadPct: 0, spreadProvenance: "confirmed", lastResetProvenance: "confirmed" },
    });
    expect(zero.loan).toMatchObject({ spreadPct: 0, spreadProvenance: "confirmed", lastResetProvenance: "confirmed" });
    expect(canonicalSavedLoanPayload(zero)).not.toBe(canonicalSavedLoanPayload(basePayload));
    expect(() => parseSavedLoanPayload({
      ...basePayload,
      loan: { ...basePayload.loan, spreadPct: null, spreadProvenance: "confirmed" },
    })).toThrow(/cannot be confirmed/);
  });

  it("accepts the additive provenance fields through the server validator", async () => {
    const t = testBackend();
    const account = await member(t, "provenance-account");
    const result = await account.mutation(api.savedLoans.saveLoan, {
      requestId: requestId("16"),
      expectedRevision: 0,
      payload: payload({ loan: { spreadPct: null, spreadProvenance: "unknown", lastReset: "", lastResetProvenance: "unknown" } }),
      createdAt: createdAt(),
    });
    expect(result).toMatchObject({ status: "saved", revision: 1 });
    const current = await account.query(api.savedLoans.currentLoan, {});
    expect(current.payload?.loan).toMatchObject({ spreadPct: null, spreadProvenance: "unknown", lastReset: "", lastResetProvenance: "unknown" });
  });

  it("replays a receipt written with the pre-provenance canonical bytes", async () => {
    const t = testBackend();
    const account = await member(t, "legacy-receipt");
    const request = requestId("28");
    const created = new Date(Date.now() - 60_000).toISOString();
    const ownerId = await t.run(async (ctx) => {
      const row = await ctx.db.query("users").withIndex("by_authKey", (q) => q.eq("authKey", "https://issuer.example|legacy-receipt")).unique();
      if (!row) throw new Error("owner missing");
      return row._id;
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("operationReceipts", {
        ownerId,
        requestId: request,
        kind: "save",
        resourceKey: "savedLoan",
        payloadHash: await sha256(legacyPayloadJsonWithBlankReset),
        expectedRevision: 0,
        revision: 1,
        status: "saved",
        createdAt: Date.parse(created),
        reviewAfter: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
    });
    const result = await account.mutation(api.savedLoans.saveLoan, {
      requestId: request,
      expectedRevision: 0,
      payload: JSON.parse(legacyPayloadJsonWithBlankReset) as SavedLoanPayload,
      createdAt: created,
    });
    expect(result).toMatchObject({ status: "replayed", requestId: request, revision: 1 });
    expect(await account.query(api.savedLoans.currentLoan, {})).toMatchObject({ revision: 0, payload: null });
    expect(canonicalSavedLoanPayload(JSON.parse(legacyPayloadJsonWithDate))).toBe(legacyPayloadJsonWithDate);
  });

  it("rejects malformed payloads, timestamps and bounds", () => {
    const base = payload();
    expect(parseSavedLoanPayload({
      ...base,
      loan: { ...base.loan, lender: "", lastReset: "" },
    }).loan).toMatchObject({ lender: "", lastReset: "" });
    expect(() => parseSavedLoanPayload({ ...base, extra: true })).toThrow(/not supported/);
    expect(() => parseSavedLoanPayload({ ...base, surplus: Number.NaN })).toThrow(/finite/);
    expect(() => parseSavedLoanPayload({ ...base, surplus: Number.POSITIVE_INFINITY })).toThrow(/finite/);
    expect(() => parseSavedLoanPayload({ ...base, loan: { ...base.loan, lastReset: "2026-02-30" } })).toThrow(/calendar date/);
    expect(() => parseSavedLoanPayload({ ...base, loan: { ...base.loan, lender: "x".repeat(121) } })).toThrow(/too long/);
    expect(() => parseSavedLoanPayload({ ...base, bufferMonths: 121 })).toThrow(/bounded/);
  });

  it("denies anonymous reads and rejects forged owner arguments", async () => {
    const t = testBackend();
    await expect(t.query(api.savedLoans.currentLoan, {})).rejects.toThrow(/unauthorized/i);
    await expect(t.mutation(api.savedLoans.saveLoan, {
      requestId: requestId("14"),
      expectedRevision: 0,
      payload: payload(),
      createdAt: createdAt(),
    })).rejects.toThrow(/unauthorized/i);
    await expect(t.mutation(api.savedLoans.deleteLoan, {
      requestId: requestId("15"),
      expectedRevision: 0,
      createdAt: createdAt(),
    })).rejects.toThrow(/unauthorized/i);
    await expect(
      t.query(api.savedLoans.currentLoan, { ownerId: "forged" } as never),
    ).rejects.toThrow();
    const account = await member(t, "account-a");
    await expect(account.mutation(api.savedLoans.saveLoan, {
      requestId: requestId("owner"),
      expectedRevision: 0,
      payload: payload(),
      createdAt: createdAt(),
      ownerId: "forged",
    } as never)).rejects.toThrow();
  });

  it("denies inactive and deleted owners even with a valid identity", async () => {
    for (const status of ["deleting", "deleted"] as const) {
      const t = testBackend();
      const account = t.withIdentity(identity("https://issuer.example", status));
      const profile = await account.mutation(api.users.ensureCurrentUser, {});
      await t.run(async (ctx) => {
        await ctx.db.patch(profile._id, { status });
      });
      await expect(account.query(api.savedLoans.currentLoan, {})).rejects.toThrow(/unauthorized/i);
      await expect(account.mutation(api.savedLoans.saveLoan, {
        requestId: requestId(status === "deleting" ? "12" : "13"),
        expectedRevision: 0,
        payload: payload(),
        createdAt: createdAt(),
      })).rejects.toThrow(/unauthorized/i);
      await expect(account.mutation(api.savedLoans.deleteLoan, {
        requestId: requestId(status === "deleting" ? "16" : "17"),
        expectedRevision: 0,
        createdAt: createdAt(),
      })).rejects.toThrow(/unauthorized/i);
    }
  });

  it("isolates two active owners and never returns provider identity", async () => {
    const t = testBackend();
    const accountA = await member(t, "account-a");
    const accountB = await member(t, "account-b");
    const saved = await accountA.mutation(api.savedLoans.saveLoan, {
      requestId: requestId("1"),
      expectedRevision: 0,
      payload: payload(),
      createdAt: createdAt(),
    });
    expect(saved).toMatchObject({ status: "saved", revision: 1 });
    expect(await accountB.query(api.savedLoans.currentLoan, {})).toMatchObject({
      revision: 0,
      updatedAt: null,
      payload: null,
    });
    const visible = await accountA.query(api.savedLoans.currentLoan, {});
    expect(visible).toMatchObject({ revision: 1, payload: payload() });
    expect(visible).not.toHaveProperty("ownerId");
    expect(visible).not.toHaveProperty("authKey");
    expect(visible).not.toHaveProperty("clerkSubject");
  });

  it("scopes receipts to the owner when both accounts reuse the same request IDs", async () => {
    const t = testBackend();
    const accountA = await member(t, "account-a");
    const accountB = await member(t, "account-b");
    const sharedSaveId = requestId("18");
    const sharedDeleteId = requestId("19");
    await expect(accountA.mutation(api.savedLoans.saveLoan, {
      requestId: sharedSaveId, expectedRevision: 0, payload: payload(), createdAt: createdAt(),
    })).resolves.toMatchObject({ status: "saved", revision: 1 });
    await expect(accountB.mutation(api.savedLoans.saveLoan, {
      requestId: sharedSaveId, expectedRevision: 0, payload: payload({ surplus: 250_000 }), createdAt: createdAt(),
    })).resolves.toMatchObject({ status: "saved", revision: 1 });
    await expect(accountA.mutation(api.savedLoans.deleteLoan, {
      requestId: sharedDeleteId, expectedRevision: 1, createdAt: createdAt(),
    })).resolves.toMatchObject({ status: "deleted", revision: 2 });
    await expect(accountB.mutation(api.savedLoans.deleteLoan, {
      requestId: sharedDeleteId, expectedRevision: 1, createdAt: createdAt(),
    })).resolves.toMatchObject({ status: "deleted", revision: 2 });
    expect((await accountA.query(api.savedLoans.currentLoan, {})).payload).toBeNull();
    expect((await accountB.query(api.savedLoans.currentLoan, {})).payload).toBeNull();
  });

  it("replays the same request once and rejects changed reuse", async () => {
    const t = testBackend();
    const account = await member(t, "account-a");
    const args = {
      requestId: requestId("2"),
      expectedRevision: 0,
      payload: payload(),
      createdAt: createdAt(),
    };
    expect(await account.mutation(api.savedLoans.saveLoan, args)).toMatchObject({ status: "saved", revision: 1 });
    expect(await account.mutation(api.savedLoans.saveLoan, args)).toMatchObject({ status: "replayed", revision: 1 });
    expect(await account.mutation(api.savedLoans.saveLoan, {
      ...args,
      payload: payload({ surplus: 200_000 }),
    })).toMatchObject({ status: "error", code: "request_reuse" });
    expect(await account.mutation(api.savedLoans.deleteLoan, {
      requestId: args.requestId,
      expectedRevision: 0,
      createdAt: args.createdAt,
    })).toMatchObject({ status: "error", code: "request_reuse" });
    const parallelArgs = {
      requestId: requestId("10"),
      expectedRevision: 1,
      payload: payload({ surplus: 250_000 }),
      createdAt: createdAt(),
    };
    const parallel = await Promise.all([
      account.mutation(api.savedLoans.saveLoan, parallelArgs),
      account.mutation(api.savedLoans.saveLoan, parallelArgs),
    ]);
    expect(parallel.filter((result) => result.status === "saved")).toHaveLength(1);
    expect(parallel.filter((result) => result.status === "replayed")).toHaveLength(1);
  });

  it("rejects changed revision or timestamp reuse without adding rows", async () => {
    const t = testBackend();
    const account = await member(t, "account-a");
    const first = {
      requestId: requestId("20"),
      expectedRevision: 0,
      payload: payload(),
      createdAt: createdAt(),
    };
    await account.mutation(api.savedLoans.saveLoan, first);
    const before = await rowCounts(t);
    expect(await account.mutation(api.savedLoans.saveLoan, {
      ...first,
      expectedRevision: 1,
    })).toMatchObject({ status: "error", code: "request_reuse" });
    expect(await account.mutation(api.savedLoans.saveLoan, {
      ...first,
      createdAt: createdAt(-1_000),
    })).toMatchObject({ status: "error", code: "request_reuse" });
    expect(await rowCounts(t)).toEqual(before);
    expect((await account.query(api.savedLoans.currentLoan, {})).revision).toBe(1);
  });

  it("allows one concurrent revision and reports a typed conflict for the other", async () => {
    const t = testBackend();
    const account = await member(t, "account-a");
    const results = await Promise.all([
      account.mutation(api.savedLoans.saveLoan, {
        requestId: requestId("3"), expectedRevision: 0, payload: payload(), createdAt: createdAt(),
      }),
      account.mutation(api.savedLoans.saveLoan, {
        requestId: requestId("4"), expectedRevision: 0, payload: payload({ surplus: 200_000 }), createdAt: createdAt(),
      }),
    ]);
    expect(results.filter((result) => result.status === "saved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "conflict")).toHaveLength(1);
    expect(results.find((result) => result.status === "conflict")).toMatchObject({ currentRevision: 1 });
  });

  it("accepts the exact seven-day boundary and rejects one millisecond older", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-09-15T12:00:00.000Z");
      vi.setSystemTime(now);
      const t = testBackend();
      const account = await member(t, "account-a");
      const boundary = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      expect(await account.mutation(api.savedLoans.saveLoan, {
        requestId: requestId("21"), expectedRevision: 0, payload: payload(), createdAt: boundary,
      })).toMatchObject({ status: "saved", revision: 1 });
      const justOld = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 - 1).toISOString();
      expect(await account.mutation(api.savedLoans.saveLoan, {
        requestId: requestId("22"), expectedRevision: 1, payload: payload({ surplus: 200_000 }), createdAt: justOld,
      })).toMatchObject({ status: "error", code: "expired" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns typed errors for malformed UUID, revision, enum and finite values", async () => {
    const t = testBackend();
    const account = await member(t, "account-a");
    const base = { expectedRevision: 0, payload: payload(), createdAt: createdAt() };
    expect(await account.mutation(api.savedLoans.saveLoan, {
      ...base, requestId: "not-a-uuid",
    } as never)).toMatchObject({ status: "error", code: "invalid_id" });
    expect(await account.mutation(api.savedLoans.saveLoan, {
      ...base, requestId: requestId("23"), expectedRevision: -1,
    } as never)).toMatchObject({ status: "error", code: "invalid_number" });
    await expect(account.mutation(api.savedLoans.saveLoan, {
      ...base, requestId: requestId("24"), payload: payload({ loan: { basis: "other" as never } }),
    } as never)).rejects.toThrow();
    expect(await account.mutation(api.savedLoans.saveLoan, {
      ...base, requestId: requestId("25"), payload: payload({ surplus: -1 }),
    })).toMatchObject({ status: "error", code: "invalid_number" });
    expect(await account.mutation(api.savedLoans.saveLoan, {
      ...base, requestId: requestId("26"), payload: payload({ surplus: Number.POSITIVE_INFINITY }),
    } as never)).toMatchObject({ status: "error", code: "invalid_number" });
    expect(await account.mutation(api.savedLoans.saveLoan, {
      ...base, requestId: requestId("27"), payload: payload({ bufferMonths: 121 }),
    })).toMatchObject({ status: "error", code: "invalid_number" });
  });

  it("guards deletion, stale work and deliberate recreation with the tombstone revision", async () => {
    const t = testBackend();
    const account = await member(t, "account-a");
    const firstArgs = { requestId: requestId("5"), expectedRevision: 0, payload: payload(), createdAt: createdAt() };
    await account.mutation(api.savedLoans.saveLoan, firstArgs);
    const deleteCreatedAt = createdAt();
    const deleted = await account.mutation(api.savedLoans.deleteLoan, {
      requestId: requestId("6"), expectedRevision: 1, createdAt: deleteCreatedAt,
    });
    expect(deleted).toMatchObject({ status: "deleted", revision: 2 });
    expect(await account.query(api.savedLoans.currentLoan, {})).toMatchObject({
      revision: 2,
      payload: null,
    });
    expect(await account.mutation(api.savedLoans.saveLoan, firstArgs)).toMatchObject({
      status: "replayed",
      revision: 1,
    });
    expect((await account.query(api.savedLoans.currentLoan, {})).payload).toBeNull();
    expect(await account.mutation(api.savedLoans.saveLoan, {
      requestId: requestId("7"), expectedRevision: 1, payload: payload(), createdAt: createdAt(),
    })).toMatchObject({ status: "conflict", currentRevision: 2 });
    expect(await account.mutation(api.savedLoans.saveLoan, {
      requestId: requestId("8"), expectedRevision: 0, payload: payload(), createdAt: createdAt(),
    })).toMatchObject({ status: "conflict", currentRevision: 2 });
    expect(await account.mutation(api.savedLoans.deleteLoan, {
      requestId: requestId("11"), expectedRevision: 2, createdAt: createdAt(),
    })).toMatchObject({ status: "error", code: "not_found" });
    const recreated = await account.mutation(api.savedLoans.saveLoan, {
      requestId: requestId("9"), expectedRevision: 2, payload: payload({ surplus: 300_000 }), createdAt: createdAt(),
    });
    expect(recreated).toMatchObject({ status: "saved", revision: 3 });
    expect(await account.mutation(api.savedLoans.deleteLoan, {
      requestId: requestId("6"), expectedRevision: 1, createdAt: deleteCreatedAt,
    })).toMatchObject({ status: "replayed", revision: 2 });
    expect(await account.mutation(api.savedLoans.saveLoan, {
      requestId: requestId("a"), expectedRevision: 3, payload: payload(), createdAt: createdAt(-8 * 24 * 60 * 60 * 1000),
    })).toMatchObject({ status: "error", code: "expired" });
    expect(await account.mutation(api.savedLoans.saveLoan, {
      requestId: requestId("b"), expectedRevision: 3, payload: payload(), createdAt: createdAt(60_000),
    })).toMatchObject({ status: "error", code: "expired" });
  });
});
