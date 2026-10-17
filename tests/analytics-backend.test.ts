import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = {
  "./users.ts": async () => import("../convex/users"),
  "./analytics.ts": async () => import("../convex/analytics"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};

function testBackend() {
  return convexTest({ schema, modules });
}

function identity(issuer: string, subject: string) {
  return { issuer, subject, tokenIdentifier: `${issuer}|${subject}` };
}

async function member(t: ReturnType<typeof testBackend>, subject: string) {
  const account = t.withIdentity(identity("https://issuer.example", subject));
  await account.mutation(api.users.ensureCurrentUser, {});
  return account;
}

describe("owner-derived analytics preference", () => {
  it("denies guests and never creates a preference or identifier", async () => {
    const t = testBackend();
    await expect(t.query(api.analytics.getPreference, {})).rejects.toThrow(/authenticated/i);
    await expect(t.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v1",
      expectedRevision: 0,
    })).rejects.toThrow(/authenticated/i);
    await expect(t.run(async (ctx) => ctx.db.query("analyticsPreferences").collect())).resolves.toEqual([]);
  });

  it("returns unknown by default without writing an ID, then records an explicit decline", async () => {
    const t = testBackend();
    const account = await member(t, "unknown");
    await expect(account.query(api.analytics.getPreference, {})).resolves.toEqual({
      consent: "unknown",
      policyVersion: "v1",
      revision: 0,
      analyticsAccountId: null,
      sendPermission: false,
    });
    await expect(t.run(async (ctx) => ctx.db.query("analyticsPreferences").collect())).resolves.toEqual([]);

    const declined = await account.mutation(api.analytics.setPreference, {
      consent: "declined",
      policyVersion: "v1",
      expectedRevision: 0,
    });
    expect(declined).toEqual({
      consent: "declined",
      policyVersion: "v1",
      revision: 1,
      analyticsAccountId: null,
      sendPermission: false,
    });
    await expect(t.run(async (ctx) => {
      const rows = await ctx.db.query("analyticsPreferences").collect();
      return rows.map(({ analyticsAccountId, consent, revision }) => ({ analyticsAccountId, consent, revision }));
    })).resolves.toEqual([{ analyticsAccountId: null, consent: "declined", revision: 1 }]);
  });

  it("issues an opaque UUID only on opt-in and keeps it stable for the owner", async () => {
    const t = testBackend();
    const account = await member(t, "accepted");
    const accepted = await account.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v1",
      expectedRevision: 0,
    });
    expect(accepted.consent).toBe("accepted");
    expect(accepted.sendPermission).toBe(true);
    expect(accepted.analyticsAccountId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    const repeated = await account.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v1",
      expectedRevision: accepted.revision,
    });
    expect(repeated.analyticsAccountId).toBe(accepted.analyticsAccountId);
    expect(repeated.revision).toBe(accepted.revision + 1);
    await expect(account.query(api.analytics.getPreference, {})).resolves.toMatchObject({
      consent: "accepted",
      analyticsAccountId: accepted.analyticsAccountId,
      sendPermission: true,
    });
  });

  it("isolates identities across accounts and ignores forged owner or identifier arguments", async () => {
    const t = testBackend();
    const accountA = await member(t, "account-a");
    const accountB = await member(t, "account-b");
    const acceptedA = await accountA.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v1",
      expectedRevision: 0,
    });
    const acceptedB = await accountB.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v1",
      expectedRevision: 0,
    });
    expect(acceptedB.analyticsAccountId).not.toBe(acceptedA.analyticsAccountId);
    await expect(accountB.query(api.analytics.getPreference, {})).resolves.toMatchObject({
      analyticsAccountId: acceptedB.analyticsAccountId,
    });
    await expect(accountA.query(api.analytics.getPreference, {
      ownerId: "forged",
      analyticsAccountId: acceptedB.analyticsAccountId,
    } as never)).rejects.toThrow();
    await expect(accountA.mutation(api.analytics.setPreference, {
      consent: "declined",
      policyVersion: "v1",
      expectedRevision: acceptedA.revision,
      ownerId: "forged",
      analyticsAccountId: acceptedB.analyticsAccountId,
    } as never)).rejects.toThrow();
    await expect(accountA.query(api.analytics.getPreference, {})).resolves.toMatchObject({
      analyticsAccountId: acceptedA.analyticsAccountId,
      consent: "accepted",
    });
  });

  it("rejects stale concurrent writes without changing the accepted preference", async () => {
    const t = testBackend();
    const account = await member(t, "stale");
    const accepted = await account.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v1",
      expectedRevision: 0,
    });
    await expect(account.mutation(api.analytics.setPreference, {
      consent: "declined",
      policyVersion: "v1",
      expectedRevision: 0,
    })).rejects.toThrow(/stale/i);
    await expect(account.query(api.analytics.getPreference, {})).resolves.toEqual(accepted);
  });

  it("withdraws send permission while retaining only the server ID, and rejects deleted profiles", async () => {
    const t = testBackend();
    const account = await member(t, "withdraw");
    const accepted = await account.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v1",
      expectedRevision: 0,
    });
    const withdrawn = await account.mutation(api.analytics.setPreference, {
      consent: "declined",
      policyVersion: "v1",
      expectedRevision: accepted.revision,
    });
    expect(withdrawn).toEqual({
      consent: "declined",
      policyVersion: "v1",
      revision: accepted.revision + 1,
      analyticsAccountId: null,
      sendPermission: false,
    });
    await expect(t.run(async (ctx) => {
      const rows = await ctx.db.query("analyticsPreferences").collect();
      return rows.map(({ analyticsAccountId, consent }) => ({ analyticsAccountId, consent }));
    })).resolves.toEqual([{ analyticsAccountId: accepted.analyticsAccountId, consent: "declined" }]);
    const profile = await account.query(api.users.currentUser, { expectedSubject: "withdraw", sessionMarker: "test" });
    if (!profile) throw new Error("profile missing in test setup");
    await t.run(async (ctx) => ctx.db.patch(profile._id, { status: "deleting" }));
    await expect(account.query(api.analytics.getPreference, {})).rejects.toThrow(/profile unavailable/i);
    await expect(account.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v1",
      expectedRevision: withdrawn.revision,
    })).rejects.toThrow(/profile unavailable/i);
    await t.run(async (ctx) => ctx.db.patch(profile._id, { status: "deleted" }));
    await expect(account.query(api.analytics.getPreference, {})).rejects.toThrow(/profile unavailable/i);
    await expect(account.mutation(api.analytics.setPreference, {
      consent: "declined",
      policyVersion: "v1",
      expectedRevision: withdrawn.revision,
    })).rejects.toThrow(/profile unavailable/i);
  });

  it("enforces the fixed policy and explicit consent/revision bounds", async () => {
    const t = testBackend();
    const account = await member(t, "bounds");
    await expect(account.mutation(api.analytics.setPreference, {
      consent: "maybe",
      policyVersion: "v1",
      expectedRevision: 0,
    } as never)).rejects.toThrow();
    await expect(account.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v2",
      expectedRevision: 0,
    } as never)).rejects.toThrow();
    await expect(account.mutation(api.analytics.setPreference, {
      consent: "accepted",
      policyVersion: "v1",
      expectedRevision: -1,
    })).rejects.toThrow();
  });

  it("fails closed for a preference written under a retired policy", async () => {
    const t = testBackend();
    const account = await member(t, "retired-policy");
    const profile = await account.query(api.users.currentUser, {
      expectedSubject: "retired-policy",
      sessionMarker: "test",
    });
    if (!profile) throw new Error("profile missing in test setup");
    await t.run(async (ctx) => {
      await ctx.db.insert("analyticsPreferences", {
        ownerId: profile._id,
        consent: "accepted",
        policyVersion: "v0",
        revision: 7,
        analyticsAccountId: "retired-server-id",
        updatedAt: 1,
      });
    });
    await expect(account.query(api.analytics.getPreference, {})).resolves.toEqual({
      consent: "unknown",
      policyVersion: "v1",
      revision: 7,
      analyticsAccountId: null,
      sendPermission: false,
    });
  });
});
