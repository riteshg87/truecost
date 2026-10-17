import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkMixpanelDeletion,
  createMixpanelDeletion,
  deleteClerkUser,
} from "../convex/lib/deletionProviders";

const mixpanel = {
  projectToken: "project-token",
  privacyApiToken: "privacy-token",
  distinctId: "analytics-user-1",
};
const clerk = { secretKey: "sk_test_private", userId: "user_123" };
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
const fetchResponse = (response: Response) => vi.fn(async () => response);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Mixpanel GDPR deletion transport", () => {
  it("returns pending with the provider tracking ID after create, never completed", async () => {
    const fetcher = fetchResponse(json({ status: "ok", results: [{ status: "PENDING", tracking_id: "task-123" }] }));
    await expect(createMixpanelDeletion({ ...mixpanel, fetcher })).resolves.toEqual({ provider: "mixpanel", status: "pending", trackingId: "task-123" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://mixpanel.com/api/app/data-deletions/v3.0/?token=project-token",
      expect.objectContaining({ method: "POST", redirect: "error", body: JSON.stringify({ compliance_type: "GDPR", distinct_ids: ["analytics-user-1"] }) }),
    );
  });

  it("keeps even a create response marked SUCCESS pending until a later status check", async () => {
    await expect(createMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(json({ status: "ok", results: [{ status: "SUCCESS", tracking_id: "task-123" }] })) })).resolves.toEqual({ provider: "mixpanel", status: "pending", trackingId: "task-123" });
  });

  it.each(["PENDING", "STAGING", "STARTED"] as const)("keeps %s status pending", async (status) => {
    await expect(checkMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(json({ status: "ok", results: { status, tracking_id: "task-123" } })) }, "task-123")).resolves.toMatchObject({ status: "pending", trackingId: "task-123" });
  });

  it("reports success only when the status endpoint says SUCCESS", async () => {
    await expect(checkMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(json({ status: "ok", results: { status: "SUCCESS", tracking_id: "task-123" } })) }, "task-123")).resolves.toEqual({ provider: "mixpanel", status: "success", trackingId: "task-123" });
  });

  it("binds a status response that omits tracking_id to the requested task", async () => {
    await expect(checkMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(json({ status: "ok", results: { status: "SUCCESS" } })) }, "task-123")).resolves.toEqual({ provider: "mixpanel", status: "success", trackingId: "task-123" });
  });

  it("rejects a status response for a different tracking ID", async () => {
    await expect(checkMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(json({ status: "ok", results: { status: "SUCCESS", tracking_id: "other-task" } })) }, "task-123")).resolves.toEqual({ provider: "mixpanel", status: "manual_review", code: "malformed_response" });
  });

  it("scrubs malformed, failure and unknown responses", async () => {
    await expect(createMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(new Response("{bad", { status: 200 })) })).resolves.toEqual({ provider: "mixpanel", status: "manual_review", code: "malformed_response" });
    await expect(createMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(new Response("x".repeat(64 * 1024 + 1), { status: 200 })) })).resolves.toEqual({ provider: "mixpanel", status: "manual_review", code: "malformed_response" });
    await expect(createMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(json({ status: "ok", results: [{ status: "FAILURE", tracking_id: "task-123" }] })) })).resolves.toEqual({ provider: "mixpanel", status: "manual_review", code: "provider_failure" });
    await expect(checkMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(json({ status: "ok", results: { status: "FAILURE", tracking_id: "task-123" } })) }, "task-123")).resolves.toEqual({ provider: "mixpanel", status: "manual_review", code: "provider_failure" });
    await expect(checkMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(json({ status: "ok", results: { status: "WHAT", tracking_id: "task-123" } })) }, "task-123")).resolves.toEqual({ provider: "mixpanel", status: "manual_review", code: "malformed_response" });
  });

  it.each([401, 403, 429, 500])("maps HTTP %i without returning provider details", async (status) => {
    const result = await checkMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(new Response("provider secret body", { status, headers: { "retry-after": "2" } })) }, "task-123");
    expect(result).not.toHaveProperty("message");
    expect(result).not.toHaveProperty("body");
    expect(result.status).toBe(status === 401 || status === 403 ? "manual_review" : "retry");
    if (result.status === "retry") expect(result.retryAfterMs).toBe(status === 429 ? 2_000 : 1_000);
  });

  it.each([408, 500])("marks a create %i as ambiguous while retaining automatic retry for status polling", async (status) => {
    await expect(createMixpanelDeletion({ ...mixpanel, fetcher: fetchResponse(new Response("provider failure", { status })) })).resolves.toEqual({ provider: "mixpanel", status: "manual_review", code: "ambiguous" });
  });

  it("uses fixed endpoints and blocks redirect responses", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toMatch(/^https:\/\/mixpanel\.com\/api\/app\/data-deletions\/v3\.0\//);
      expect(init?.redirect).toBe("error");
      return new Response("", { status: 302, headers: { location: "https://evil.example" } });
    });
    await expect(checkMixpanelDeletion({ ...mixpanel, fetcher }, "task-123")).resolves.toMatchObject({ status: "manual_review", code: "redirect_blocked" });
  });

  it("turns an abort timeout into an ambiguous retry", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const pending = checkMixpanelDeletion({ ...mixpanel, fetcher, timeoutMs: 25 }, "task-123");
    vi.advanceTimersByTime(25);
    await expect(pending).resolves.toEqual({ provider: "mixpanel", status: "retry", code: "timeout", retryAfterMs: 25 });
  });

  it("classifies an ordinary status network failure as retryable without exposing the error", async () => {
    const fetcher = vi.fn(async () => { throw new Error("provider bearer token leaked"); });
    const result = await checkMixpanelDeletion({ ...mixpanel, fetcher }, "task-123");
    expect(result).toEqual({ provider: "mixpanel", status: "retry", code: "network", retryAfterMs: 1_000 });
    expect(result).not.toHaveProperty("message");
  });

  it("bounds a response body that hangs after headers arrive", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 }));
    const pending = checkMixpanelDeletion({ ...mixpanel, fetcher, timeoutMs: 25 }, "task-123");
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toEqual({ provider: "mixpanel", status: "retry", code: "timeout", retryAfterMs: 25 });
  });

  it("marks a Mixpanel create timeout as ambiguous for reconciliation", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const pending = createMixpanelDeletion({ ...mixpanel, fetcher, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toEqual({ provider: "mixpanel", status: "manual_review", code: "ambiguous" });
  });
});

describe("Clerk user deletion transport", () => {
  it("deletes through the fixed US Backend API endpoint", async () => {
    const fetcher = fetchResponse(json({ id: "user_123", deleted: true }));
    await expect(deleteClerkUser({ ...clerk, fetcher })).resolves.toEqual({ provider: "clerk", status: "success", alreadyRemoved: false });
    expect(fetcher).toHaveBeenCalledWith("https://api.clerk.com/v1/users/user_123", expect.objectContaining({ method: "DELETE", redirect: "error", headers: { Authorization: "Bearer sk_test_private", Accept: "application/json" } }));
  });

  it("treats only an exact user-not-found body as already removed", async () => {
    await expect(deleteClerkUser({ ...clerk, fetcher: fetchResponse(json({ errors: [{ code: "resource_not_found", message: "not found", long_message: "No user was found with id user_123" }] }, 404)) })).resolves.toEqual({ provider: "clerk", status: "success", alreadyRemoved: true });
    await expect(deleteClerkUser({ ...clerk, fetcher: fetchResponse(json({ errors: [{ code: "resource_not_found", message: "not found", long_message: "Organization not found" }] }, 404)) })).resolves.toEqual({ provider: "clerk", status: "manual_review", code: "unexpected_status" });
    await expect(deleteClerkUser({ ...clerk, fetcher: fetchResponse(json({ code: "resource_not_found", shortMessage: "not found", longMessage: "No user was found with id user_123" }, 404)) })).resolves.toEqual({ provider: "clerk", status: "manual_review", code: "unexpected_status" });
  });

  it("keeps auth failures, malformed successes and provider errors scrubbed", async () => {
    await expect(deleteClerkUser({ ...clerk, fetcher: fetchResponse(new Response("bad credentials", { status: 401 })) })).resolves.toEqual({ provider: "clerk", status: "manual_review", code: "configuration" });
    await expect(deleteClerkUser({ ...clerk, fetcher: fetchResponse(new Response("{bad", { status: 200 })) })).resolves.toEqual({ provider: "clerk", status: "manual_review", code: "malformed_response" });
    await expect(deleteClerkUser({ ...clerk, fetcher: fetchResponse(new Response("temporary provider failure", { status: 503 })) })).resolves.toEqual({ provider: "clerk", status: "retry", code: "server_error", retryAfterMs: 1_000 });
  });

  it("requires a deleted response with the matching user ID", async () => {
    await expect(deleteClerkUser({ ...clerk, fetcher: fetchResponse(new Response(null, { status: 204 })) })).resolves.toEqual({ provider: "clerk", status: "manual_review", code: "malformed_response" });
    await expect(deleteClerkUser({ ...clerk, fetcher: fetchResponse(json({ id: "user_123", deleted: false })) })).resolves.toEqual({ provider: "clerk", status: "manual_review", code: "malformed_response" });
    await expect(deleteClerkUser({ ...clerk, fetcher: fetchResponse(json({ id: "other-user", deleted: true })) })).resolves.toEqual({ provider: "clerk", status: "manual_review", code: "malformed_response" });
  });

  it("retries Clerk transport uncertainty against the same fixed subject", async () => {
    const fetcher = vi.fn(async () => { throw new Error("temporary network failure"); });
    await expect(deleteClerkUser({ ...clerk, fetcher })).resolves.toEqual({ provider: "clerk", status: "retry", code: "network", retryAfterMs: 1_000 });
  });

  it("retries a Clerk timeout without claiming deletion", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Promise<Response>(() => undefined));
    const pending = deleteClerkUser({ ...clerk, fetcher, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toEqual({ provider: "clerk", status: "retry", code: "timeout", retryAfterMs: 25 });
  });

  it("does not follow malicious redirects and returns a retry/manual result", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("redirect disallowed");
    });
    await expect(deleteClerkUser({ ...clerk, fetcher })).resolves.toMatchObject({ provider: "clerk", status: "manual_review", code: "redirect_blocked" });
  });
});
