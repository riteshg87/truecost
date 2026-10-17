import { describe, expect, it } from "vitest";
import {
  FEATURES,
  canOpen,
  canVisit,
  featureById,
  lockReason,
  redirectFor,
  safeNext,
  type Viewer,
} from "../access";
import { isCompleteOtp, maskedDestination, parseIdentifier } from "../identifier";

const viewers: Viewer[] = ["anonymous", "guest", "member"];

describe("feature access", () => {
  it("opens the comparison to guests and members, never to a stranger", () => {
    const compare = featureById("compare")!;
    expect(canOpen("anonymous", compare)).toBe(false);
    expect(canOpen("guest", compare)).toBe(true);
    expect(canOpen("member", compare)).toBe(true);
  });

  it("keeps loan health to members, because the record has to belong to someone", () => {
    const loan = featureById("loan")!;
    expect(canOpen("guest", loan)).toBe(false);
    expect(canOpen("member", loan)).toBe(true);
    expect(lockReason("guest", loan)).toBe("Sign in to use");
  });

  it("never opens a feature that is not built, whoever is asking", () => {
    const insurance = featureById("insurance")!;
    viewers.forEach((v) => expect(canOpen(v, insurance)).toBe(false));
    expect(lockReason("member", insurance)).toBe("Coming soon");
  });

  it("gives every feature somewhere to go and something to say", () => {
    FEATURES.forEach((f) => {
      expect(f.href.startsWith("/")).toBe(true);
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.tagline.length).toBeLessThan(60);
    });
  });
});

describe("missing provider configuration fails closed", () => {
  it("keeps comparison available while private features remain closed", () => {
    expect(canOpen("guest", featureById("compare")!, "open")).toBe(true);
    expect(canOpen("guest", featureById("loan")!, "open")).toBe(false);
    expect(lockReason("guest", featureById("loan")!, "open")).toBe("Sign in to use");
  });

  it("still refuses a feature that does not exist yet", () => {
    const insurance = featureById("insurance")!;
    expect(canOpen("member", insurance, "open")).toBe(false);
    expect(lockReason("member", insurance, "open")).toBe("Coming soon");
  });

  it("still keeps a stranger at the door — guest is a choice, not a default", () => {
    FEATURES.forEach((f) => expect(canOpen("anonymous", f, "open")).toBe(false));
    expect(canVisit("anonymous", "/loan", "open")).toBe(false);
    expect(redirectFor("anonymous", "/loan", "open")).toBe("/");
  });

  it("keeps a guest out of private loan screens even in fallback mode", () => {
    ["/loan", "/loan/setup", "/prepay"].forEach((p) => {
      expect(canVisit("guest", p, "open"), p).toBe(false);
      expect(redirectFor("guest", p, "open")).toBe("/signin?next=" + encodeURIComponent(p));
    });
  });

  it("puts the locks back the moment gating is enforced", () => {
    expect(canVisit("guest", "/loan", "enforced")).toBe(false);
    expect(canOpen("guest", featureById("loan")!, "enforced")).toBe(false);
  });
});

describe("route guards", () => {
  it("lets a guest into the comparison and its results", () => {
    expect(canVisit("guest", "/compare")).toBe(true);
    expect(canVisit("guest", "/compare/results")).toBe(true);
  });

  it("keeps comparison history member-only while allowing it as a safe return path", () => {
    expect(canVisit("guest", "/comparisons")).toBe(false);
    expect(redirectFor("guest", "/comparisons/record-id")).toBe("/signin?next=%2Fcomparisons%2Frecord-id");
    expect(canVisit("member", "/comparisons/record-id")).toBe(true);
    expect(safeNext("/comparisons/record-id")).toBe("/comparisons/record-id");
  });

  it("keeps a guest out of every loan screen", () => {
    ["/loan", "/loan/setup", "/loan/rate", "/loan/transfer", "/prepay"].forEach((p) =>
      expect(canVisit("guest", p)).toBe(false),
    );
  });

  it("lets a member anywhere", () => {
    ["/loan", "/prepay", "/compare", "/home"].forEach((p) =>
      expect(canVisit("member", p)).toBe(true),
    );
  });

  it("sends a guest to sign-in carrying where they were headed", () => {
    expect(redirectFor("guest", "/loan/setup")).toBe("/signin?next=%2Floan%2Fsetup");
    expect(redirectFor("anonymous", "/compare")).toBe("/");
    expect(redirectFor("member", "/loan")).toBeNull();
  });

  it("refuses to bounce anyone off-site via the next parameter", () => {
    expect(safeNext("https://evil.example/steal")).toBe("/home");
    expect(safeNext("//evil.example")).toBe("/home");
    expect(safeNext(null)).toBe("/home");
    expect(safeNext("/loan/setup")).toBe("/loan/setup");
  });

  it("rejects encoded escapes, auth loops, and unapproved query data", () => {
    for (const value of [
      "/%2F%2Fevil.example",
      "/loan\\setup",
      "/signin?next=%2Floan",
      "/settings",
      "/loan/setup?redirect=https://evil.example",
      "/loan/setup?action=unknown",
      "/loan/setup?action=save&requestId=short",
    ]) expect(safeNext(value), value).toBe("/home");
    expect(safeNext("/loan/setup?action=save&requestId=valid_request_123")).toBe(
      "/loan/setup?action=save&requestId=valid_request_123",
    );
  });
});

describe("identifier — email only", () => {
  it("reads an email, trimmed and lowercased", () => {
    const r = parseIdentifier("  Ritesh@Example.COM ");
    expect(r.ok && r.id.kind).toBe("email");
    expect(r.ok && r.id.value).toBe("ritesh@example.com");
  });

  it("tells someone typing a number that mobile is not available yet", () => {
    // A regex failure here reads as "you mistyped", which sends people back to
    // correct a number that was never going to work.
    for (const input of ["9876543210", "+91 98765 43210", "098-765-4321"]) {
      const r = parseIdentifier(input);
      expect(r.ok, input).toBe(false);
      if (!r.ok) expect(r.reason).toContain("Mobile sign-in isn't available");
    }
  });

  it("refuses what is not an address", () => {
    expect(parseIdentifier("").ok).toBe(false);
    expect(parseIdentifier("not@an").ok).toBe(false);
    expect(parseIdentifier("no-at-sign.com").ok).toBe(false);
  });

  it("masks the address it shows back", () => {
    const email = parseIdentifier("ritesh@example.com");
    expect(email.ok && maskedDestination(email.id)).toBe("ri●●●●@example.com");
  });

  it("knows a complete code from a partial one", () => {
    expect(isCompleteOtp("123456")).toBe(true);
    expect(isCompleteOtp("12345")).toBe(false);
    expect(isCompleteOtp("12345a")).toBe(false);
  });
});
