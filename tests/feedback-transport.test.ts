import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import { comparisonFeedbackContext } from "../lib/feedback/context";
import {
  createSessionBoundFeedbackTransport,
  FeedbackTransportError,
} from "../lib/feedback/transport";

const url = "https://synthetic-test.convex.cloud";
const resultId = "11111111-1111-4111-8111-111111111111";
const context = comparisonFeedbackContext(resultId);

function token(overrides: Record<string, unknown> = {}) {
  const claims = { sub: "subject-a", sid: "session-a", aud: "convex", exp: Math.floor(Date.now() / 1000) + 300, ...overrides };
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
}

function access(getToken: () => Promise<string | null> = async () => token(), isCurrent = () => true): PrivateSessionAccess {
  return { identity: { profileId: "profile-a", subject: "subject-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true }, getToken, isCurrent };
}

function response(value: unknown) {
  return new Response(JSON.stringify({ status: "success", value }), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

describe("feedback transport", () => {
  it.each([{ sub: "subject-b" }, { sid: "session-b" }, { aud: "other" }, { exp: 1 }])("rejects a token outside the captured grant: %j", async (claims) => {
    const fetch = vi.fn();
    const transport = createSessionBoundFeedbackTransport({ url, session: access(async () => token(claims)), fetch });
    await expect(transport.getStatus(context)).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a response after sign-out and never publishes the stale result", async () => {
    let current = true;
    const fetch = vi.fn(async () => { current = false; return response({ status: "available", ...context }); });
    const transport = createSessionBoundFeedbackTransport({ url, session: access(async () => token(), () => current), fetch });
    await expect(transport.getStatus(context)).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("sends only the feedback contract without account or finance fields", async () => {
    const fetch = vi.fn(async () => response({ status: "submitted", requestId: "22222222-2222-4222-8222-222222222222", ...context }));
    const transport = createSessionBoundFeedbackTransport({ url, session: access(), fetch });
    const requestId = "22222222-2222-4222-8222-222222222222";
    await expect(transport.submit({ requestId, context, answer: "no", comment: "The explanation was clear" })).resolves.toMatchObject({ status: "submitted", requestId });
    const init = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0][1];
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    const body = String(init.body);
    expect(body).toContain("feedback:submitFeedback");
    expect(body).toContain("The explanation was clear");
    expect(body).not.toContain("profile-a");
    expect(body).not.toContain("subject-a");
    expect(body).not.toContain("snapshot");
  });

  it("allows the caller to retry a possible lost acknowledgement with the same request ID", async () => {
    const requestId = "33333333-3333-4333-8333-333333333333";
    let attempt = 0;
    const fetch = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("connection reset after the server accepted the write");
      return response({ status: "replayed", requestId, ...context });
    });
    const transport = createSessionBoundFeedbackTransport({ url, session: access(), fetch });
    const input = { requestId, context, answer: "yes" as const, comment: null };
    await expect(transport.submit(input)).rejects.toMatchObject({ code: "network" });
    await expect(transport.submit(input)).resolves.toMatchObject({ status: "replayed", requestId });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String((fetch.mock.calls[0] as unknown as [unknown, RequestInit])[1].body)).toBe(String((fetch.mock.calls[1] as unknown as [unknown, RequestInit])[1].body));
  });

  it("maps terminal server status and bounded rate limits to safe client errors", async () => {
    const fetch = vi.fn(async () => response({ status: "error", code: "already_resolved", message: "provider detail" }));
    const transport = createSessionBoundFeedbackTransport({ url, session: access(), fetch });
    await expect(transport.dismiss(context, "44444444-4444-4444-8444-444444444444")).rejects.toEqual(expect.objectContaining({ code: "already_resolved" }));
    fetch.mockImplementationOnce(async () => response({ status: "limited", code: "rate_limited", retryAfterMs: 123, message: "later" }));
    await expect(transport.dismiss(context, "55555555-5555-4555-8555-555555555555")).rejects.toEqual(expect.objectContaining({ code: "rate_limited", retryAfterMs: 123 }));
  });

  it("rejects malformed provider data before exposing it to the caller", async () => {
    const fetch = vi.fn(async () => response({ status: "available", feature: "loan_health", contextId: context.contextId, contextVersion: "v1" }));
    const transport = createSessionBoundFeedbackTransport({ url, session: access(), fetch });
    await expect(transport.getStatus(context)).rejects.toBeInstanceOf(FeedbackTransportError);
  });
});
