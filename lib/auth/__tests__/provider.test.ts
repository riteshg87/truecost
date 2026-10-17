import { describe, expect, it } from "vitest";
import { readConvexUrl, readPublicKey } from "../config";
import { readableProviderError } from "../errors";
import { areClerkKeysCompatible, isValidServerSecret } from "../server-config";

describe("public auth configuration", () => {
  it("accepts only Clerk public keys and Convex origins", () => {
    const validKey = `pk_test_${btoa("dutiful-fly-37.clerk.accounts.dev$")
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
    expect(readPublicKey(validKey)).toBe(validKey);
    expect(readPublicKey(`pk_test_${btoa("dutiful-fly-37.clerk.accounts.dev").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`)).toBeNull();
    expect(readPublicKey(`pk_test_${"x".repeat(40)}`)).toBeNull();
    expect(readPublicKey("sk_test_secret_value")).toBeNull();
    expect(readPublicKey("pk_test_bad value")).toBeNull();
    expect(readConvexUrl("https://dutiful-fly-37.convex.cloud")).toBe("https://dutiful-fly-37.convex.cloud");
    expect(readConvexUrl("https://evil.example/convex")).toBeNull();
    expect(readConvexUrl("https://user:pass@dutiful-fly-37.convex.cloud")).toBeNull();
  });
});

describe("provider error boundary", () => {
  it("maps known and unknown provider errors without exposing raw details", () => {
    expect(readableProviderError({ code: "form_code_incorrect" })).toContain("code did not work");
    expect(readableProviderError({ code: "too_many_requests_rate_limit" })).toContain("Too many attempts");
    expect(readableProviderError({ message: "someone@example.com internal trace" })).not.toContain("someone@example.com");
    expect(isValidServerSecret(undefined)).toBe(false);
    expect(isValidServerSecret(42)).toBe(false);
    expect(isValidServerSecret("sk_test_too-short")).toBe(false);
    expect(isValidServerSecret(`sk_test_${"1234567890abcdef".repeat(2)}`)).toBe(true);
    const publicKey = `pk_test_${btoa("dutiful-fly-37.clerk.accounts.dev$").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
    expect(areClerkKeysCompatible(publicKey, `sk_test_${"1234567890abcdef".repeat(2)}`)).toBe(true);
    expect(areClerkKeysCompatible(publicKey, `sk_live_${"1234567890abcdef".repeat(2)}`)).toBe(false);
    expect(areClerkKeysCompatible(publicKey, 42)).toBe(false);
  });

  it("maps Clerk API delivery failures from nested errors without exposing provider text", () => {
    const email = "rajesh@example.com";
    expect(
      readableProviderError({
        clerkError: true,
        status: 429,
        message: `delivery failed for ${email}`,
        errors: [
          {
            code: "dev_monthly_email_limit_exceeded",
            message: `email ${email} exceeded the development limit`,
          },
        ],
      }),
    ).toContain("email sending limit");
    expect(readableProviderError({ errors: [{ code: "verification_not_sent", message: email }] })).toContain(
      "verification code",
    );
    expect(readableProviderError({ errors: [{ code: "dev_monthly_email_limit_exceeded", message: email }] })).not.toContain(email);
  });

  it("keeps invalid-code, rate-limit, and missing-identity responses generic through wrappers", () => {
    const privateEmail = "private@example.com";
    expect(
      readableProviderError({ cause: { errors: [{ code: "form_code_incorrect", message: privateEmail }] } }),
    ).toContain("code did not work");
    expect(readableProviderError({ errors: [{ code: "too_many_requests_rate_limit", message: privateEmail }] })).toContain(
      "Too many attempts",
    );
    expect(readableProviderError({ errors: [{ code: "form_identifier_not_found", message: privateEmail }] })).toContain(
      "could not start sign-in",
    );
    expect(readableProviderError({ errors: [{ code: "form_identifier_not_found", message: privateEmail }] })).not.toContain(
      privateEmail,
    );
  });

  it("falls back safely for malformed and cyclic provider payloads", () => {
    const cyclic: { errors: unknown[] } = { errors: [] };
    cyclic.errors.push(cyclic, null, 42, { code: 42, message: "private provider detail" });
    expect(readableProviderError(cyclic)).toContain("could not complete");
    expect(readableProviderError({ errors: [null, 42, { code: 42 }] })).toContain("could not complete");
    expect(readableProviderError("private provider detail")).toContain("could not complete");
  });

  it("bounds traversal before a deeply nested provider payload can exhaust the boundary", () => {
    const nestedChain = (code: string) => ({
      errors: [{ errors: [{ errors: [{ code }] }] }],
    });
    const oversized = {
      errors: [
        ...Array.from({ length: 7 }, () => nestedChain("unknown_provider_code")),
        nestedChain("dev_monthly_email_limit_exceeded"),
      ],
    };

    expect(readableProviderError(oversized)).toContain("could not complete");
  });
});
