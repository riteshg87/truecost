import { describe, expect, it, vi } from "vitest";
import {
  createSessionBoundComparisonHistoryTransport,
} from "../lib/comparison/history-transport";
import { createComparisonSnapshot, serializeComparisonSnapshot } from "../lib/contracts/snapshot";
import { compareOffers } from "../lib/finance/comparison";

const now = Date.parse("2026-09-16T12:00:00.000Z");
const identity = { profileId: "profile-a", subject: "user-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true as const };
const comparisonId = "j57d3xq1p9m2h4k6v8w0";
const requestId = "00000000-0000-4000-8000-000000000011";
const createdAt = new Date(now).toISOString();
const offers = [1, 2].map((n) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  lender: `Lender ${n}`,
  loanType: "home" as const,
  amount: 5_000_000,
  ratePct: 8 + n / 10,
  rateType: "reducing" as const,
  rateStructure: "floating" as const,
  tenureValue: 20,
  tenureUnit: "years" as const,
  processingFee: { mode: "percent" as const, value: 0.35 },
  gstPct: 18,
  insurancePremium: 0,
  insuranceFunding: "financed" as const,
  otherFees: [],
}));
const snapshot = createComparisonSnapshot(offers, compareOffers(offers), { createdAt });
const resultId = snapshot.resultId;
const snapshotJson = serializeComparisonSnapshot(snapshot);

function token(overrides: Record<string, unknown> = {}) {
  const claims = { sub: "user-a", sid: "session-a", aud: "convex", exp: now / 1000 + 60, ...overrides };
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
}

function response(value: unknown) {
  return new Response(JSON.stringify({ status: "success", value, logLines: [] }), { status: 200 });
}

async function deleteHash() {
  const operation = JSON.stringify(["comparison", "delete", "", resultId, null, null, createdAt]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operation));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function row(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    _id: comparisonId,
    _creationTime: now + 0.5,
    resultId,
    snapshot: snapshotJson,
    title: null,
    source: "member",
    createdAt,
    calculationVersion: snapshot.calculationVersion,
    ...overrides,
  };
}

function transport(fetcher: typeof globalThis.fetch, isCurrent: () => boolean = () => true) {
  return createSessionBoundComparisonHistoryTransport({
    url: "https://test.convex.cloud",
    identity,
    getToken: async () => token(),
    isCurrent,
    fetch: fetcher,
    now: () => now,
  });
}

describe("session-bound comparison history transport", () => {
  it("lists validated rows, preserves pages and sends no-store requests", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok", result: { page: [row()], isDone: false, continueCursor: "next" } }))
      .mockResolvedValueOnce(response({ status: "ok", result: { page: [], isDone: true, continueCursor: "done" } }));
    const history = transport(fetcher as typeof globalThis.fetch);

    const first = await history.listComparisons({ cursor: null, numItems: 1 });
    const second = await history.listComparisons({ cursor: first.continueCursor, numItems: 1 });

    expect(first.page[0]).toMatchObject({ comparisonId, resultId, createdAt, calculationVersion: snapshot.calculationVersion, creationTime: now + 0.5 });
    expect(first.page[0].snapshot.resultId).toBe(resultId);
    expect(second).toMatchObject({ page: [], isDone: true, continueCursor: "done" });
    const [, init] = fetcher.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["malformed snapshot", row({ snapshot: "{" })],
    ["result ID mismatch", row({ resultId: "00000000-0000-4000-8000-000000000099" })],
    ["calculation version mismatch", row({ calculationVersion: "old-engine" })],
    ["duplicate page IDs", { page: [row(), row()], isDone: true, continueCursor: "done" }],
    ["page exceeds requested bound", { page: [row(), row({ _id: "j57d3xq1p9m2h4k6v8w1" })], isDone: true, continueCursor: "done" }],
  ])("rejects %s without exposing provider data", async (label, value) => {
    const payload = label === "duplicate page IDs" || label === "page exceeds requested bound"
      ? { status: "ok", result: value }
      : { status: "ok", result: { page: [value], isDone: true, continueCursor: "done" } };
    const history = transport(async () => response(payload));
    await expect(history.listComparisons({ cursor: null, numItems: 1 })).rejects.toMatchObject({ code: "invalid_shape", message: "invalid_shape" });
  });

  it("returns a missing or foreign record as the same safe null shape", async () => {
    const history = transport(async () => response(null));
    await expect(history.getComparison(comparisonId)).resolves.toBeNull();
  });

  it("rejects a record whose returned database ID differs from the requested ID", async () => {
    const history = transport(async () => response(row({ _id: "j57d3xq1p9m2h4k6v8w1" })));
    await expect(history.getComparison(comparisonId)).rejects.toMatchObject({ code: "invalid_shape" });
  });

  it.each([{ sub: "user-b" }, { sid: "session-b" }, { aud: "other" }, { exp: now / 1000 }])("rejects a token that is not bound to the current session: %j", async (claims) => {
    const fetcher = vi.fn(async () => response(null));
    const history = createSessionBoundComparisonHistoryTransport({ url: "https://test.convex.cloud", identity, getToken: async () => token(claims), isCurrent: () => true, fetch: fetcher, now: () => now });
    await expect(history.getComparison(comparisonId)).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drops work when the account becomes stale before or after the request", async () => {
    let current = false;
    const getToken = vi.fn(async () => token());
    const fetcher = vi.fn(async () => response(null));
    const before = createSessionBoundComparisonHistoryTransport({ url: "https://test.convex.cloud", identity, getToken, isCurrent: () => current, fetch: fetcher, now: () => now });
    await expect(before.getComparison(comparisonId)).rejects.toMatchObject({ code: "unauthorized" });
    expect(getToken).not.toHaveBeenCalled();

    current = true;
    let resolveResponse!: (response: Response) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const pending = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    const lateFetcher = vi.fn(async () => { signalStarted(); return pending; });
    const late = transport(lateFetcher, () => current);
    const attempt = late.getComparison(comparisonId);
    await started;
    current = false;
    resolveResponse(response(row()));
    await expect(attempt).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("accepts a delete receipt only when its stable identity matches", async () => {
    const fetcher = vi.fn(async () => response({
      status: "deleted",
      requestId,
      resultId,
      comparisonId,
      serverHash: await deleteHash(),
    }));
    const history = transport(fetcher);
    await expect(history.deleteComparison({ requestId, resultId, createdAt, comparisonId })).resolves.toMatchObject({ status: "deleted", requestId, resultId, comparisonId });

    const mismatch = transport(async () => response({ status: "replayed", requestId, resultId, comparisonId: null, serverHash: await deleteHash() }));
    await expect(mismatch.deleteComparison({ requestId, resultId, createdAt, comparisonId })).resolves.toMatchObject({ status: "replayed", comparisonId: null });

    const wrong = transport(async () => response({ status: "replayed", requestId, resultId, comparisonId: "j57d3xq1p9m2h4k6v8w1", serverHash: await deleteHash() }));
    await expect(wrong.deleteComparison({ requestId, resultId, createdAt, comparisonId })).rejects.toMatchObject({ code: "invalid_shape" });

    const wrongHash = transport(async () => response({ status: "deleted", requestId, resultId, comparisonId, serverHash: "0".repeat(64) }));
    await expect(wrongHash.deleteComparison({ requestId, resultId, createdAt, comparisonId })).rejects.toMatchObject({ code: "invalid_shape" });
  });

  it("maps bounded delete rate limits and expiry validation to stable errors", async () => {
    const limited = transport(async () => response({
      status: "limited",
      code: "rate_limited",
      retryAfterMs: 1_250,
      message: "retry later",
    }));
    await expect(limited.deleteComparison({ requestId, resultId, createdAt, comparisonId }))
      .rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 1_250 });

    const unbounded = transport(async () => response({
      status: "limited",
      code: "rate_limited",
      retryAfterMs: 24 * 60 * 60 * 1000 + 1,
      message: "retry later",
    }));
    await expect(unbounded.deleteComparison({ requestId, resultId, createdAt, comparisonId }))
      .rejects.toMatchObject({ code: "invalid_shape" });

    const expired = transport(async () => response({ status: "error", code: "expired", message: "request is too old" }));
    await expect(expired.deleteComparison({ requestId, resultId, createdAt, comparisonId }))
      .rejects.toMatchObject({ code: "expired" });
  });

  it("rejects future and stale delete timestamps before token or network access", async () => {
    const fetcher = vi.fn(async () => response(null));
    const getToken = vi.fn(async () => token());
    const history = createSessionBoundComparisonHistoryTransport({
      url: "https://test.convex.cloud",
      identity,
      getToken,
      isCurrent: () => true,
      fetch: fetcher,
      now: () => now,
    });
    await expect(history.deleteComparison({ requestId, resultId, createdAt: new Date(now + 1).toISOString(), comparisonId }))
      .rejects.toMatchObject({ code: "invalid_timestamp" });
    await expect(history.deleteComparison({ requestId, resultId, createdAt: new Date(now - 7 * 24 * 60 * 60 * 1000 - 1).toISOString(), comparisonId }))
      .rejects.toMatchObject({ code: "expired" });
    expect(getToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("scrubs provider failures and converts timeout aborts to stable errors", async () => {
    const failed = transport(async () => { throw new Error("private snapshot and provider token"); });
    await expect(failed.getComparison(comparisonId)).rejects.toMatchObject({ code: "network", message: "network" });

    vi.useFakeTimers();
    try {
      const timedOut = transport(async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
      const attempt = timedOut.getComparison(comparisonId);
      const assertion = expect(attempt).rejects.toMatchObject({ code: "timeout", message: "timeout" });
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
