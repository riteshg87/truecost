import { describe, expect, it } from "vitest";
import { parsePendingRecord, storageGet, storageRemove, storageSet, PENDING_TTL_MS } from "../storage";

describe("auth storage boundary", () => {
  const now = 1_700_000_000_000;

  it("rejects corrupt, expired, future-unbounded, and unsafe pending records", () => {
    expect(parsePendingRecord("not json", now)).toBeNull();
    expect(parsePendingRecord(JSON.stringify({ email: "a@example.com", next: "/home", expiresAt: now - 1 }), now)).toBeNull();
    expect(parsePendingRecord(JSON.stringify({ email: "a@example.com", next: "/home", expiresAt: now + PENDING_TTL_MS + 1 }), now)).toBeNull();
    expect(parsePendingRecord(JSON.stringify({ email: "a@example.com", next: "https://evil.example", expiresAt: now + 1000 }), now)).toBeNull();
    expect(parsePendingRecord(JSON.stringify({ email: "a@example.com", next: "/home", expiresAt: now + 1000 }), now)).toEqual({ email: "a@example.com", next: "/home" });
  });

  it("contains throwing storage getters and quota failures", () => {
    const throwing = () => { throw new Error("storage unavailable"); };
    expect(storageGet(throwing, "pending")).toBeNull();
    expect(storageSet(throwing, "pending", "value")).toBe(false);
    expect(() => storageRemove(throwing, "pending")).not.toThrow();
  });

  it("does not accept unknown pending fields as a valid record", () => {
    expect(parsePendingRecord(JSON.stringify({ email: "a@example.com", next: "/home", expiresAt: now + 1000, account: "other" }), now)).toBeNull();
  });
});
