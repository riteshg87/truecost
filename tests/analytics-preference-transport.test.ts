import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionBoundAnalyticsPreferenceTransport } from "../lib/analytics/preference-transport";
import type { PrivateSessionAccess } from "../lib/auth/private-session";

const url = "https://synthetic-test.convex.cloud";
const preference = { consent: "declined", policyVersion: "v1", revision: 1, analyticsAccountId: null, sendPermission: false };
function token(overrides: Record<string, unknown> = {}) {
  const claims = { sub: "subject-a", sid: "session-a", aud: "convex", exp: Math.floor(Date.now() / 1000) + 300, ...overrides };
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
}
function access(getToken: () => Promise<string | null> = async () => token(), isCurrent = () => true): PrivateSessionAccess {
  return { identity: { profileId: "profile-a", subject: "subject-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true }, getToken, isCurrent };
}
function response(value: unknown = preference) {
  return new Response(JSON.stringify({ status: "success", value }), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("analytics preference session transport", () => {
  it.each([
    { sub: "subject-b" }, { sid: "session-b" }, { aud: "other" }, { exp: 1 },
  ])("rejects mismatched or expired token before any request: %j", async (claims) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const transport = createSessionBoundAnalyticsPreferenceTransport({ url, session: access(async () => token(claims)) });
    await expect(transport.read()).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a grant lost while obtaining the token", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    let current = true;
    const session = access(async () => { current = false; return token(); }, () => current);
    await expect(createSessionBoundAnalyticsPreferenceTransport({ url, session }).read()).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("discards a successful response after the originating grant ends", async () => {
    let current = true;
    vi.stubGlobal("fetch", vi.fn(async () => { current = false; return response(); }));
    const session = access(async () => token(), () => current);
    await expect(createSessionBoundAnalyticsPreferenceTransport({ url, session }).read()).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("sends only the consent contract with fixed credentials and no browser cookies", async () => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal("fetch", fetch);
    const transport = createSessionBoundAnalyticsPreferenceTransport({ url, session: access() });
    await expect(transport.write("declined", 0)).resolves.toEqual(preference);
    expect(fetch).toHaveBeenCalledOnce();
    const init = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0][1];
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body.path).toBe("analytics:setPreference");
    expect(body.args).toEqual([{ consent: "declined", policyVersion: "v1", expectedRevision: 0 }]);
    expect(String(init.body)).not.toContain("profile-a");
    expect(String(init.body)).not.toContain("subject-a");
  });

  it("rejects invalid revision locally and inconsistent server send permission", async () => {
    const fetch = vi.fn(async () => response({ ...preference, sendPermission: true })); vi.stubGlobal("fetch", fetch);
    const transport = createSessionBoundAnalyticsPreferenceTransport({ url, session: access() });
    await expect(transport.write("declined", -1)).rejects.toMatchObject({ code: "invalid_shape" });
    expect(fetch).not.toHaveBeenCalled();
    await expect(transport.read()).rejects.toMatchObject({ code: "invalid_shape" });
  });
});
