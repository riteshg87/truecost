import { describe, expect, it, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { consumeSensitiveGrant } from "../convex/privacyGrants";
import type { Id } from "../convex/_generated/dataModel";

const modules = {
  "./privacyGrants.ts": async () => import("../convex/privacyGrants"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};

const issue = makeFunctionReference<"mutation">("privacyGrants:issueVerifiedGrant");

function testBackend() {
  return convexTest({ schema, modules });
}

const claims = (overrides: Partial<{
  subject: string;
  sessionId: string;
  audience: string;
  purpose: "account_export" | "account_delete";
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return {
    subject: "clerk-user",
    sessionId: "session-a",
    audience: "truecost-account",
    purpose: "account_export" as const,
    nonce: "123e4567-e89b-42d3-a456-426614174000",
    issuedAt: now - 1,
    expiresAt: now + 60,
    ...overrides,
  };
};

async function owner(t: ReturnType<typeof testBackend>, subject = "clerk-user", issuer = "https://issuer.example") {
  const account = t.withIdentity({ issuer, subject, tokenIdentifier: `${issuer}|${subject}` });
  const ownerId = await t.run(async (ctx) => ctx.db.insert("users", {
    authKey: `${issuer}|${subject}`,
    clerkSubject: subject,
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
  return { account, ownerId };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("internal sensitive grant ledger", () => {
  it("binds issuance to an active auth profile and returns the same row for exact nonce replay", async () => {
    const t = testBackend();
    const { account, ownerId } = await owner(t);
    const input = claims();
    const first = await account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...input });
    const replay = await account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...input });
    expect(first._id).toBe(replay._id);
    expect(first.ownerId).toBe(ownerId);
    expect(first.consumedAt).toBeNull();
    await expect(t.run(async (ctx) => ctx.db.query("sensitiveGrants").collect())).resolves.toHaveLength(1);
  });

  it("rejects mismatched nonce replay, forged subject, expired claims, and non-active owners", async () => {
    const t = testBackend();
    const { account } = await owner(t);
    const input = claims();
    await account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...input });

    await expect(account.mutation(issue, {
      authKey: "https://issuer.example|clerk-user",
      ...claims({ nonce: input.nonce, audience: "other-audience" }),
    })).rejects.toThrow(/replay conflict/i);
    await expect(account.mutation(issue, {
      authKey: "https://issuer.example|clerk-user",
      ...claims({ nonce: "123e4567-e89b-42d3-a456-426614174001", subject: "other-subject" }),
    })).rejects.toThrow(/owner/i);
    await expect(account.mutation(issue, {
      authKey: "https://issuer.example|clerk-user",
      ...claims({ nonce: "123e4567-e89b-42d3-a456-426614174002", expiresAt: Math.floor(Date.now() / 1000) - 1 }),
    })).rejects.toThrow(/expired/i);

    await t.run(async (ctx) => {
      const row = await ctx.db.query("users").withIndex("by_authKey", (q) => q.eq("authKey", "https://issuer.example|clerk-user")).unique();
      if (!row) throw new Error("missing test owner");
      await ctx.db.patch(row._id, { status: "deleting" });
    });
    await expect(account.mutation(issue, {
      authKey: "https://issuer.example|clerk-user",
      ...claims({ nonce: "123e4567-e89b-42d3-a456-426614174003" }),
    })).rejects.toThrow(/owner/i);
  });

  it("survives concurrent exact replay with one persisted record", async () => {
    const t = testBackend();
    const { account } = await owner(t);
    const input = claims({ nonce: "123e4567-e89b-42d3-a456-426614174004" });
    const results = await Promise.all([
      account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...input }),
      account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...input }),
    ]);
    expect(new Set(results.map((result) => result._id)).size).toBe(1);
    await expect(t.run(async (ctx) => ctx.db.query("sensitiveGrants").collect())).resolves.toHaveLength(1);
  });

  it("consumes once, enforces every binding, and rolls back consumption with the transaction", async () => {
    const t = testBackend();
    const { account, ownerId } = await owner(t);
    const input = claims({ nonce: "123e4567-e89b-42d3-a456-426614174005" });
    const grant = await account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...input });
    const expected = { ownerId, subject: input.subject, sessionId: input.sessionId, audience: input.audience, purpose: input.purpose };

    await expect(t.run(async (ctx) => consumeSensitiveGrant(ctx, grant._id, expected))).resolves.toMatchObject({
      _id: grant._id,
      consumedAt: expect.any(Number),
    });
    await expect(t.run(async (ctx) => consumeSensitiveGrant(ctx, grant._id, expected))).rejects.toThrow(/already consumed/i);

    const secondInput = claims({ nonce: "123e4567-e89b-42d3-a456-426614174006", purpose: "account_delete" });
    const second = await account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...secondInput });
    const secondExpected = { ownerId, subject: secondInput.subject, sessionId: secondInput.sessionId, audience: secondInput.audience, purpose: secondInput.purpose };
    const checks = [
      { ...secondExpected, subject: "other-subject" },
      { ...secondExpected, sessionId: "other-session" },
      { ...secondExpected, audience: "other-audience" },
      { ...secondExpected, purpose: "account_export" as const },
      { ...secondExpected, ownerId: "invalid-owner" as Id<"users"> },
    ];
    for (const mismatch of checks) {
      await expect(t.run(async (ctx) => consumeSensitiveGrant(ctx, second._id, mismatch))).rejects.toThrow(/binding mismatch/i);
    }
    await expect(t.run(async (ctx) => {
      await consumeSensitiveGrant(ctx, second._id, secondExpected);
      throw new Error("force rollback");
    })).rejects.toThrow("force rollback");
    await expect(t.run(async (ctx) => ctx.db.get(second._id))).resolves.toMatchObject({ consumedAt: null });
  });

  it("allows only one concurrent consumer to mark a grant", async () => {
    const t = testBackend();
    const { account, ownerId } = await owner(t);
    const input = claims({ nonce: "123e4567-e89b-42d3-a456-426614174009" });
    const grant = await account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...input });
    const expected = { ownerId, subject: input.subject, sessionId: input.sessionId, audience: input.audience, purpose: input.purpose };
    const outcomes = await Promise.allSettled([
      t.run(async (ctx) => consumeSensitiveGrant(ctx, grant._id, expected)),
      t.run(async (ctx) => consumeSensitiveGrant(ctx, grant._id, expected)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    await expect(t.run(async (ctx) => ctx.db.get(grant._id))).resolves.toMatchObject({ consumedAt: expect.any(Number) });
  });

  it("rejects consumption after expiry and when the owner is no longer active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    const t = testBackend();
    const { account, ownerId } = await owner(t);
    const now = Math.floor(Date.now() / 1000);
    const input = claims({ nonce: "123e4567-e89b-42d3-a456-426614174007", issuedAt: now - 1, expiresAt: now + 2 });
    const grant = await account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...input });
    vi.setSystemTime(new Date("2026-09-16T12:00:04Z"));
    await expect(t.run(async (ctx) => consumeSensitiveGrant(ctx, grant._id, {
      ownerId, subject: input.subject, sessionId: input.sessionId, audience: input.audience, purpose: input.purpose,
    }))).rejects.toThrow(/expired/i);
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    const activeInput = claims({ nonce: "123e4567-e89b-42d3-a456-426614174008", issuedAt: Math.floor(Date.now() / 1000) - 1, expiresAt: Math.floor(Date.now() / 1000) + 60 });
    const activeGrant = await account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...activeInput });
    await t.run(async (ctx) => ctx.db.patch(ownerId, { status: "deleting" }));
    await expect(t.run(async (ctx) => consumeSensitiveGrant(ctx, activeGrant._id, {
      ownerId, subject: activeInput.subject, sessionId: activeInput.sessionId, audience: activeInput.audience, purpose: activeInput.purpose,
    }))).rejects.toThrow(/active/i);
  });

  it("caps ten new grant issuances in a ten minute window even after consumption", async () => {
    const t = testBackend();
    const { account, ownerId } = await owner(t);
    for (let i = 0; i < 10; i++) {
      const input = claims({ nonce: `123e4567-e89b-42d3-a456-4266141740${10 + i}` });
      const grant = await account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...input });
      await t.run((ctx) => consumeSensitiveGrant(ctx, grant._id, { ownerId, subject: input.subject, sessionId: input.sessionId, audience: input.audience, purpose: input.purpose }));
    }
    const blocked = claims({ nonce: "123e4567-e89b-42d3-a456-426614174099" });
    await expect(account.mutation(issue, { authKey: "https://issuer.example|clerk-user", ...blocked })).rejects.toMatchObject({ data: { code: "rate_limited", retryAfterMs: expect.any(Number) } });
  });
});
