import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const clerk = vi.hoisted(() => ({ auth: vi.fn(), has: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: clerk.auth, reverificationErrorResponse: () => Response.json({ clerk_error: "reverification_required" }, { status: 403 }) }));
import { POST } from "../app/api/privacy/approval/route";
import { verifySensitiveProof } from "../lib/privacy/sensitive-proof";
const origin = "http://localhost:3000";
function request(body: unknown = { purpose: "account_export" }, extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/privacy/approval`, { method: "POST", headers: { origin, "content-type": "application/json", ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
beforeEach(() => {
  vi.stubEnv("TRUECOST_APP_ORIGIN", origin);
  vi.stubEnv("TRUECOST_PRIVACY_AUDIENCE", "truecost_dev");
  vi.stubEnv("TRUECOST_PRIVACY_KEY_ID", "dev1");
  vi.stubEnv("TRUECOST_PRIVACY_SIGNING_KEY", "ab".repeat(32));
  clerk.has.mockReturnValue(true);
  clerk.auth.mockResolvedValue({ userId: "user_a", sessionId: "sess_a", has: clerk.has });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("privacy approval route", () => {
  it("signs only the authenticated server identity with a short lifetime", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { proof } = await response.json();
    const claims = await verifySensitiveProof(proof, { keys: { dev1: new Uint8Array(32).fill(171) }, expected: { audience: "truecost_dev", subject: "user_a", sessionId: "sess_a", purpose: "account_export" }, nowSeconds: Math.floor(Date.now() / 1000) });
    expect(claims).not.toBeNull();
    expect(claims!.expiresAt - claims!.issuedAt).toBe(120);
    expect(clerk.has).toHaveBeenCalledWith({ reverification: "strict" });
  });
  it("requires recent Clerk verification and does not issue a proof otherwise", async () => {
    clerk.has.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("proof");
  });
  it("rejects unauthenticated callers", async () => {
    clerk.auth.mockResolvedValue({ userId: null, sessionId: null });
    expect((await POST(request())).status).toBe(401);
  });
  it("rejects cross-origin requests before consulting Clerk", async () => {
    expect((await POST(request(undefined, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(request(undefined, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect(clerk.auth).not.toHaveBeenCalled();
  });
  it("bounds and validates input, rejecting client identity assertions", async () => {
    for (const body of [null, [], {}, { purpose: "other" }, { purpose: "account_delete", userId: "user_b" }, "{"]) expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request("x".repeat(1025)))).status).toBe(413);
    expect((await POST(request(undefined, { "content-type": "text/plain" }))).status).toBe(415);
    expect(clerk.auth).not.toHaveBeenCalled();
  });
  it("fails closed without a valid server signing configuration", async () => {
    vi.stubEnv("TRUECOST_PRIVACY_SIGNING_KEY", "invalid");
    expect((await POST(request())).status).toBe(503);
    expect(clerk.auth).not.toHaveBeenCalled();
  });
});
