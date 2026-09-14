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

describe("gating is off until there is somewhere to sign in", () => {
  it("opens every built feature to a guest while sign-in is unconfigured", () => {
    FEATURES.filter((f) => f.available).forEach((f) => {
      expect(canOpen("guest", f, "open"), f.id).toBe(true);
      expect(lockReason("guest", f, "open")).toBeNull();
    });
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

  it("lets a guest reach the loan screens it would otherwise bounce them from", () => {
    ["/loan", "/loan/setup", "/prepay"].forEach((p) => {
      expect(canVisit("guest", p, "open"), p).toBe(true);
      expect(redirectFor("guest", p, "open")).toBeNull();
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
});

describe("identifier", () => {
  it("reads an email", () => {
    const r = parseIdentifier("  Ritesh@Example.COM ");
    expect(r.ok && r.id.kind).toBe("email");
    expect(r.ok && r.id.value).toBe("ritesh@example.com");
  });

  it("reads a mobile number however it is typed", () => {
    for (const input of ["9876543210", "+91 98765 43210", "09876543210", "919876543210"]) {
      const r = parseIdentifier(input);
      expect(r.ok, input).toBe(true);
      if (r.ok) {
        expect(r.id.kind).toBe("phone");
        expect(r.id.value).toBe("+919876543210");
      }
    }
  });

  it("refuses what cannot be an Indian mobile before spending an SMS on it", () => {
    expect(parseIdentifier("1234567890").ok).toBe(false);
    expect(parseIdentifier("98765").ok).toBe(false);
    expect(parseIdentifier("").ok).toBe(false);
    expect(parseIdentifier("not@an").ok).toBe(false);
  });

  it("masks the destination it shows back", () => {
    const phone = parseIdentifier("9876543210");
    const email = parseIdentifier("ritesh@example.com");
    expect(phone.ok && maskedDestination(phone.id)).toBe("●●●●● 43210");
    expect(email.ok && maskedDestination(email.id)).toBe("ri●●●●@example.com");
  });

  it("knows a complete code from a partial one", () => {
    expect(isCompleteOtp("123456")).toBe(true);
    expect(isCompleteOtp("12345")).toBe(false);
    expect(isCompleteOtp("12345a")).toBe(false);
  });
});
