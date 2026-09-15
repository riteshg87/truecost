import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, demoIdFor, issueCode, pendingCode, readSession, verifyCode } from "../demo";

/** Minimal storage stand-ins; the module only uses get/set/remove. */
function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", {
    sessionStorage: makeStorage(),
    localStorage: makeStorage(),
  });
});

describe("demo sign-in", () => {
  it("issues a six-digit code and can read it back", () => {
    const code = issueCode("a@b.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(pendingCode("a@b.com")).toBe(code);
  });

  it("does not hand one person's code to another address", () => {
    issueCode("a@b.com");
    expect(pendingCode("someone@else.com")).toBeNull();
  });

  it("accepts the right code and starts a session", () => {
    const code = issueCode("a@b.com");
    const result = verifyCode("a@b.com", code);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.email).toBe("a@b.com");
    expect(readSession()?.email).toBe("a@b.com");
  });

  it("rejects a wrong code without signing anyone in", () => {
    issueCode("a@b.com");
    const result = verifyCode("a@b.com", "000000");
    expect(result.ok).toBe(false);
    expect(readSession()).toBeNull();
  });

  it("burns the code once used, so it cannot be replayed", () => {
    const code = issueCode("a@b.com");
    expect(verifyCode("a@b.com", code).ok).toBe(true);
    clearSession();
    expect(verifyCode("a@b.com", code).ok).toBe(false);
  });

  it("refuses a code that was never issued", () => {
    expect(verifyCode("a@b.com", "123456").ok).toBe(false);
  });

  it("keys the same address to the same id, so the loan record follows it", () => {
    expect(demoIdFor("a@b.com")).toBe(demoIdFor("a@b.com"));
    expect(demoIdFor("a@b.com")).not.toBe(demoIdFor("c@d.com"));
  });

  it("clears the session on sign out", () => {
    const code = issueCode("a@b.com");
    verifyCode("a@b.com", code);
    clearSession();
    expect(readSession()).toBeNull();
  });
});
