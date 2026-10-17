import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = {
  "./users.ts": async () => import("../convex/users"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};

function testBackend() {
  return convexTest({ schema, modules });
}

function identity(issuer: string, subject: string) {
  return {
    issuer,
    subject,
    tokenIdentifier: `${issuer}|${subject}`,
  };
}

describe("Convex identity foundation", () => {
  it("denies anonymous profile reads and provisioning", async () => {
    const t = testBackend();
    await expect(t.query(api.users.currentUser, { expectedSubject: "user-1", sessionMarker: "session-a" })).rejects.toThrow(/authenticated/i);
    await expect(t.mutation(api.users.ensureCurrentUser, {})).rejects.toThrow(/authenticated/i);
  });

  it("provisions idempotently and returns only the caller's safe profile", async () => {
    const t = testBackend();
    const account = t.withIdentity(identity("https://issuer.example/a", "user-1"));
    const first = await account.mutation(api.users.ensureCurrentUser, {});
    const second = await account.mutation(api.users.ensureCurrentUser, {});
    expect(second._id).toBe(first._id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(first.updatedAt);
    const current = await account.query(api.users.currentUser, { expectedSubject: "user-1", sessionMarker: "session-a" });
    expect(current).toEqual(first);
    expect(current).not.toHaveProperty("authKey");
    expect(current).not.toHaveProperty("clerkSubject");
    expect(current).not.toHaveProperty("email");
  });

  it("isolates two accounts and treats issuers as part of identity", async () => {
    const t = testBackend();
    const accountA = t.withIdentity(identity("https://issuer.example/a", "same-subject"));
    const accountB = t.withIdentity(identity("https://issuer.example/b", "same-subject"));
    const profileA = await accountA.mutation(api.users.ensureCurrentUser, {});
    const profileB = await accountB.mutation(api.users.ensureCurrentUser, {});
    expect(profileB._id).not.toBe(profileA._id);
    expect((await accountA.query(api.users.currentUser, { expectedSubject: "same-subject", sessionMarker: "session-a" }))?._id).toBe(profileA._id);
    expect((await accountB.query(api.users.currentUser, { expectedSubject: "same-subject", sessionMarker: "session-b" }))?._id).toBe(profileB._id);
  });

  it("rejects a stale client identity guard", async () => {
    const t = testBackend();
    const account = t.withIdentity(identity("https://issuer.example/a", "user-1"));
    await account.mutation(api.users.ensureCurrentUser, {});
    await expect(account.query(api.users.currentUser, { expectedSubject: "user-2", sessionMarker: "session-a" })).rejects.toThrow(/authenticated/i);
    await expect(account.query(api.users.currentUser, { expectedSubject: "user-1", sessionMarker: "" })).rejects.toThrow(/authenticated/i);
  });

  it("does not resurrect deleting or deleted profiles", async () => {
    const t = testBackend();
    const deleting = t.withIdentity(identity("https://issuer.example", "deleting"));
    const deleted = t.withIdentity(identity("https://issuer.example", "deleted"));
    const deletingProfile = await deleting.mutation(api.users.ensureCurrentUser, {});
    const deletedProfile = await deleted.mutation(api.users.ensureCurrentUser, {});
    await t.run(async (ctx) => {
      await ctx.db.patch(deletingProfile._id, { status: "deleting" });
      await ctx.db.patch(deletedProfile._id, { status: "deleted" });
    });
    await expect(deleting.mutation(api.users.ensureCurrentUser, {})).rejects.toThrow(/profile unavailable/i);
    await expect(deleted.mutation(api.users.ensureCurrentUser, {})).rejects.toThrow(/profile unavailable/i);
    await expect(deleting.query(api.users.currentUser, { expectedSubject: "deleting", sessionMarker: "session-a" })).rejects.toThrow(/profile unavailable/i);
    await expect(deleted.query(api.users.currentUser, { expectedSubject: "deleted", sessionMarker: "session-b" })).rejects.toThrow(/profile unavailable/i);
  });

  it("rejects client owner arguments instead of trusting them", async () => {
    const t = testBackend();
    const account = t.withIdentity(identity("https://issuer.example", "user-1"));
    await expect(
      account.mutation(api.users.ensureCurrentUser, { ownerId: "forged" } as never),
    ).rejects.toThrow();
    await expect(
      account.query(api.users.currentUser, { ownerId: "forged", expectedSubject: "user-1", sessionMarker: "session-a" } as never),
    ).rejects.toThrow();
  });
});
