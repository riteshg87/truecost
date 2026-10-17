import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { Webhook } from "standardwebhooks";
import schema from "../convex/schema";

const modules = {
  "./http.ts": async () => import("../convex/http"),
  "./accountDeletionWebhook.ts": async () => import("../convex/accountDeletionWebhook"),
  "./accountDeletion.ts": async () => import("../convex/accountDeletion"),
  "./_generated/server.js": async () => import("../convex/_generated/server"),
};
const secret = "whsec_dGVzdF9zZWNyZXQ=";
const body = JSON.stringify({ type: "user.deleted", data: { id: "synthetic-deleted-subject", deleted: true } });

afterEach(() => vi.unstubAllEnvs());

function signedHeaders() {
  const timestamp = new Date();
  return {
    "svix-id": "msg_route_test",
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign("msg_route_test", timestamp, body),
  };
}

async function counts(t: ReturnType<typeof convexTest>) {
  return t.run(async ctx => ({
    receipts: (await ctx.db.query("clerkWebhookReceipts").collect()).length,
    tombstones: (await ctx.db.query("clerkDeletionTombstones").collect()).length,
    jobs: (await ctx.db.query("accountDeletionJobs").collect()).length,
  }));
}

describe("Clerk webhook HTTP route", () => {
  it("fails closed without its signing secret and performs no writes", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "");
    const t = convexTest({ schema, modules });
    const response = await t.fetch("/clerk-webhook", { method: "POST", body, headers: signedHeaders() });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
    expect(await counts(t)).toEqual({ receipts: 0, tombstones: 0, jobs: 0 });
  });

  it("rejects an invalid signature without invoking deletion ingestion", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", secret);
    const t = convexTest({ schema, modules });
    const response = await t.fetch("/clerk-webhook", {
      method: "POST", body, headers: { ...signedHeaders(), "svix-signature": "v1,invalid" },
    });
    expect(response.status).toBe(400);
    expect(await counts(t)).toEqual({ receipts: 0, tombstones: 0, jobs: 0 });
  });

  it("routes valid signed delivery into ingestion and deduplicates redelivery", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", secret);
    const t = convexTest({ schema, modules });
    const headers = signedHeaders();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await t.fetch("/clerk-webhook", { method: "POST", body, headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
    expect(await counts(t)).toEqual({ receipts: 1, tombstones: 1, jobs: 0 });
  });
});
