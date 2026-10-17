// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  comparisonFeedbackContext,
  createLoanHealthFeedbackContext,
  forgetRememberedFeedbackContext,
  loanHealthContextSlot,
  loanHealthFeedbackContext,
  readRememberedFeedbackContext,
  rememberFeedbackContext,
} from "../lib/feedback/context";

afterEach(() => sessionStorage.clear());

describe("Loan Health feedback identity", () => {
  it("accepts opaque caller UUIDs and keeps methodology separate from comparison", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(loanHealthFeedbackContext(id)).toEqual({ feature: "loan_health", contextId: id, contextVersion: "v1" });
    expect(comparisonFeedbackContext(id).feature).toBe("comparison");
    expect(createLoanHealthFeedbackContext().contextId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("retains only an account scoped opaque ID for revisions and pending requests", () => {
    const context = loanHealthFeedbackContext("22222222-2222-4222-8222-222222222222");
    const revisionSlot = loanHealthContextSlot("revision", 7);
    const pendingSlot = loanHealthContextSlot("pending", "33333333-3333-4333-8333-333333333333");
    rememberFeedbackContext("profile-a", revisionSlot, context);
    rememberFeedbackContext("profile-a", pendingSlot, context);
    expect(readRememberedFeedbackContext("profile-a", revisionSlot)).toEqual(context);
    expect(readRememberedFeedbackContext("profile-a", pendingSlot)).toEqual(context);
    expect(readRememberedFeedbackContext("profile-b", revisionSlot)).toBeNull();
    const stored = sessionStorage.getItem(`truecost.feedback.context.v1.profile-a.${revisionSlot}`);
    expect(stored).not.toContain("outstanding");
    expect(stored).not.toContain("comment");
    forgetRememberedFeedbackContext("profile-a", revisionSlot);
    expect(readRememberedFeedbackContext("profile-a", revisionSlot)).toBeNull();
    expect(readRememberedFeedbackContext("profile-a", pendingSlot)).toEqual(context);
  });

  it("rejects unsafe slot values instead of widening storage scope", () => {
    expect(() => loanHealthContextSlot("revision", -1)).toThrow();
    expect(() => loanHealthContextSlot("pending", "../../other-account")).toThrow();
  });
});
