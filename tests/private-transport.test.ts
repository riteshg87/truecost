import { describe, expect, it, vi } from "vitest";
import { createSessionBoundSavedLoanTransport } from "../lib/private-storage/transport";
import type { SavedLoanPayload } from "../lib/contracts/saved-loan";

const now = Date.parse("2026-09-16T12:00:00Z");
const identity = { profileId: "profile-a", subject: "user-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true as const };
const requestId = "00000000-0000-4000-8000-000000000001";
const payload: SavedLoanPayload = {
  loan: { lender: "Example Bank", original: 1_000_000, outstanding: 900_000, ratePct: 8,
    basis: "fixed", spreadPct: 0, cycle: "quarterly", lastReset: "", monthsLeft: 120 },
  quote: { newRatePct: 7, feePct: 0.25, legalCharges: 5_000, keepTenure: true, newTenureMonths: 120 },
  surplus: 0, bufferMonths: 6, rateResolvedAt: null,
};
const save = () => ({ requestId, expectedRevision: 0, createdAt: new Date(now).toISOString(), payload: structuredClone(payload) });
function token(overrides: Record<string, unknown> = {}) {
  const claims = { sub: "user-a", sid: "session-a", aud: "convex", exp: now / 1000 + 60, ...overrides };
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
}
function response(value: unknown) { return new Response(JSON.stringify({ status: "success", value, logLines: [] }), { status: 200 }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("session-bound saved-loan transport", () => {
  it("uses one captured bearer token and suppresses cookies, caches and server logs", async () => {
    const fetcher = vi.fn(async () => response({ revision: 1, updatedAt: now, payload }));
    const transport = createSessionBoundSavedLoanTransport({ url: "https://test.convex.cloud", identity,
      getToken: async () => token(), isCurrent: () => true, fetch: fetcher, now: () => now });
    expect((await transport.currentLoan()).payload?.loan.lender).toBe("Example Bank");
    const [, init] = fetcher.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token()}`);
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([{ sub: "user-b" }, { sid: "session-b" }, { aud: "other" }, { exp: now / 1000 }, { exp: "tomorrow" }])(
    "rejects mismatched or expired claims before network access: %j", async (claims) => {
      const fetcher = vi.fn();
      const transport = createSessionBoundSavedLoanTransport({ url: "https://test.convex.cloud", identity,
        getToken: async () => token(claims), isCurrent: () => true, fetch: fetcher, now: () => now });
      await expect(transport.saveLoan(save())).rejects.toMatchObject({ code: "unauthorized" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("rejects a changed session while token acquisition is in progress", async () => {
    const pending = deferred<string>();
    const fetcher = vi.fn();
    let current = true;
    const transport = createSessionBoundSavedLoanTransport({ url: "https://test.convex.cloud", identity,
      getToken: () => pending.promise, isCurrent: () => current, fetch: fetcher, now: () => now });
    const attempt = transport.saveLoan(save());
    current = false;
    pending.resolve(token());
    await expect(attempt).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ignores a late acknowledgement after the session changes", async () => {
    const pending = deferred<Response>();
    const started = deferred<void>();
    let current = true;
    const transport = createSessionBoundSavedLoanTransport({ url: "https://test.convex.cloud", identity,
      getToken: async () => token(), isCurrent: () => current, now: () => now,
      fetch: async () => { started.resolve(); return pending.promise; } });
    const attempt = transport.saveLoan(save());
    await started.promise;
    current = false;
    pending.resolve(response({ status: "saved", requestId, revision: 1 }));
    await expect(attempt).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("captures the payload and identity before token acquisition yields", async () => {
    const pending = deferred<string>();
    const originalIdentity = { ...identity };
    const input = save();
    const fetcher = vi.fn(async () => response({ status: "saved", requestId, revision: 1 }));
    const transport = createSessionBoundSavedLoanTransport({ url: "https://test.convex.cloud", identity: originalIdentity,
      getToken: () => pending.promise, isCurrent: (bound) => bound.subject === "user-a", fetch: fetcher, now: () => now });
    const attempt = transport.saveLoan(input);
    originalIdentity.subject = "user-b";
    input.payload.loan.lender = "Changed after request";
    input.expectedRevision = 6;
    pending.resolve(token());
    await expect(attempt).resolves.toEqual({ requestId, revision: 1, kind: "saveLoan" });
    const [, init] = fetcher.mock.calls[0] as unknown as [unknown, RequestInit];
    const wire = JSON.parse(String(init.body));
    expect(wire.args[0].payload.loan.lender).toBe("Example Bank");
    expect(wire.args[0].expectedRevision).toBe(0);
  });

  it.each([
    [{ status: "conflict", code: "revision_conflict", currentRevision: 2 }, "conflict"],
    [{ status: "error", code: "not_found", message: "Not found" }, "conflict"],
    [{ status: "error", code: "request_reuse", message: "Invalid request" }, "invalid_shape"],
    [{ status: "saved", requestId, revision: 9 }, "invalid_shape"],
    [{ status: "deleted", requestId, revision: 1 }, "invalid_shape"],
  ])("does not turn a backend rejection or mismatched receipt into a successful save", async (value, code) => {
    const transport = createSessionBoundSavedLoanTransport({ url: "https://test.convex.cloud", identity,
      getToken: async () => token(), isCurrent: () => true, fetch: async () => response(value), now: () => now });
    await expect(transport.saveLoan(save())).rejects.toMatchObject({ code });
  });

  it("returns a deletion acknowledgement and accepts an exact replay", async () => {
    const transport = createSessionBoundSavedLoanTransport({ url: "https://test.convex.cloud", identity,
      getToken: async () => token(), isCurrent: () => true, now: () => now,
      fetch: async () => response({ status: "replayed", requestId, revision: 1 }) });
    await expect(transport.deleteLoan({ requestId, expectedRevision: 0, createdAt: new Date(now).toISOString() }))
      .resolves.toEqual({ requestId, revision: 1, kind: "deleteLoan" });
  });

  it("discards provider exception text instead of exposing it to the UI", async () => {
    const transport = createSessionBoundSavedLoanTransport({ url: "https://test.convex.cloud", identity,
      getToken: async () => token(), isCurrent: () => true, now: () => now,
      fetch: async () => { throw new Error("network failed with private payload"); } });
    await expect(transport.currentLoan()).rejects.toMatchObject({ code: "network", message: "network" });
  });
});
