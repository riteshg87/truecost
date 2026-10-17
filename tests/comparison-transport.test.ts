import { describe, expect, it, vi } from "vitest";
import { createSessionBoundComparisonTransport } from "../lib/comparison/transport";
import { compareOffers } from "../lib/finance/comparison";
import { createComparisonSnapshot, serializeComparisonSnapshot } from "../lib/contracts/snapshot";

const now = Date.parse("2026-09-16T12:00:00.000Z");
const identity = { profileId: "profile-a", subject: "user-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true as const };
const requestId = "00000000-0000-4000-8000-000000000001";
const offers = [1, 2].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, lender: `Lender ${n}`, loanType: "home" as const, amount: 5_000_000, ratePct: 8 + n / 10, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.35 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "financed" as const, otherFees: [] }));
const snapshot = createComparisonSnapshot(offers, compareOffers(offers), { createdAt: new Date(now).toISOString() });
const resultId = snapshot.resultId;
const input = { requestId, snapshot: JSON.stringify(snapshot), createdAt: new Date(now).toISOString(), title: null, source: "member" as const };

async function expectedHash() {
  const operation = JSON.stringify(["comparison", "save", serializeComparisonSnapshot(snapshot), resultId, null, "member", input.createdAt]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operation));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function token(overrides: Record<string, unknown> = {}) {
  const claims = { sub: "user-a", sid: "session-a", aud: "convex", exp: now / 1000 + 60, ...overrides };
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
}
function response(value: unknown) { return new Response(JSON.stringify({ status: "success", value, logLines: [] }), { status: 200 }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("session-bound comparison transport", () => {
  it("sends a receipt request with a captured token and no credentials or cache", async () => {
    const fetcher = vi.fn(async () => response({ status: "saved", requestId, resultId, serverHash: await expectedHash() }));
    const transport = createSessionBoundComparisonTransport({ url: "https://test.convex.cloud", identity, getToken: async () => token(), isCurrent: () => true, fetch: fetcher, now: () => now });
    await expect(transport.saveComparison(input)).resolves.toMatchObject({ status: "saved", requestId, resultId });
    const [, init] = fetcher.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([{ sub: "user-b" }, { sid: "session-b" }, { aud: "other" }, { exp: now / 1000 }])("rejects mismatched tokens before network access: %j", async (claims) => {
    const fetcher = vi.fn();
    const transport = createSessionBoundComparisonTransport({ url: "https://test.convex.cloud", identity, getToken: async () => token(claims), isCurrent: () => true, fetch: fetcher, now: () => now });
    await expect(transport.saveComparison(input)).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a late receipt after the account lifetime changes", async () => {
    const pending = deferred<Response>();
    const started = deferred<void>();
    let current = true;
    const transport = createSessionBoundComparisonTransport({ url: "https://test.convex.cloud", identity, getToken: async () => token(), isCurrent: () => current, now: () => now, fetch: async () => { started.resolve(); return pending.promise; } });
    const attempt = transport.saveComparison(input);
    await started.promise;
    current = false;
    pending.resolve(response({ status: "saved", requestId, resultId, serverHash: await expectedHash() }));
    await expect(attempt).rejects.toMatchObject({ code: "unauthorized" });
  });

  it.each([
    [{ status: "blocked", code: "deleted" }, "deleted"],
    [{ status: "error", code: "request_reuse" }, "request_reuse"],
    [{ status: "error", code: "result_conflict" }, "result_conflict"],
    [{ status: "error", code: "rate_limited" }, "rate_limited"],
    [{ status: "limited", code: "rate_limited", retryAfterMs: 12_000 }, "rate_limited"],
    [{ status: "saved", requestId, resultId: "wrong", serverHash: "hash" }, "invalid_shape"],
  ])("maps backend outcome %j to a safe error", async (value, code) => {
    const transport = createSessionBoundComparisonTransport({ url: "https://test.convex.cloud", identity, getToken: async () => token(), isCurrent: () => true, fetch: async () => response(value), now: () => now });
    await expect(transport.saveComparison(input)).rejects.toMatchObject({ code });
  });

  it("does not expose provider exception text", async () => {
    const transport = createSessionBoundComparisonTransport({ url: "https://test.convex.cloud", identity, getToken: async () => token(), isCurrent: () => true, fetch: async () => { throw new Error("private finance payload"); }, now: () => now });
    await expect(transport.saveComparison(input)).rejects.toMatchObject({ code: "network", message: "network" });
  });

  it("rejects a receipt whose server hash is not for this canonical operation", async () => {
    const transport = createSessionBoundComparisonTransport({
      url: "https://test.convex.cloud",
      identity,
      getToken: async () => token(),
      isCurrent: () => true,
      fetch: async () => response({ status: "saved", requestId, resultId, serverHash: "0".repeat(64) }),
      now: () => now,
    });
    await expect(transport.saveComparison(input)).rejects.toMatchObject({ code: "invalid_shape" });
  });

  it.each([
    ["malformed JSON", "{"],
    ["oversized JSON", "x".repeat(256 * 1024 + 1)],
  ])("rejects %s before token or network access", async (_label, snapshotValue) => {
    const getToken = vi.fn(async () => token());
    const fetcher = vi.fn();
    const transport = createSessionBoundComparisonTransport({
      url: "https://test.convex.cloud",
      identity,
      getToken,
      isCurrent: () => true,
      fetch: fetcher,
      now: () => now,
    });
    await expect(transport.saveComparison({ ...input, snapshot: snapshotValue })).rejects.toMatchObject({ code: "invalid_shape" });
    expect(getToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
