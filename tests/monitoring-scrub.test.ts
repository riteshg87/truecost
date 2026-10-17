import { describe, expect, it } from "vitest";
import { scrubMonitoringEvent } from "../lib/monitoring/scrub";

describe("monitoring scrub boundary", () => {
  it("keeps only allowlisted operational fields and opaque UUIDs", () => {
    const event = scrubMonitoringEvent({
      release: "candidate_2026.10.02",
      environment: "production",
      source: "server",
      errorCode: "network",
      requestId: "9e6d25d6-80a5-48cb-a8d8-9707f91c3f3a",
      jobId: "38cf69eb-dc4c-42cc-b415-ce5222a77430",
      message: "loan amount 900000 for borrower@example.com",
      url: "https://example.test/private?token=secret",
      requestBody: { lender: "private lender" },
    }, { release: "fallback", environment: "development", source: "client" });

    expect(event).toEqual({
      release: "candidate_2026.10.02",
      environment: "production",
      source: "server",
      errorCode: "network",
      requestId: "9e6d25d6-80a5-48cb-a8d8-9707f91c3f3a",
      jobId: "38cf69eb-dc4c-42cc-b415-ce5222a77430",
    });
    expect(JSON.stringify(event)).not.toContain("borrower");
    expect(JSON.stringify(event)).not.toContain("secret");
  });

  it("falls back without exposing malformed values or Error messages", () => {
    const event = scrubMonitoringEvent(new Error("email=borrower@example.com amount=900000"), {
      release: "candidate/unsafe",
      environment: "test",
      source: "job",
    });

    expect(event).toEqual({
      release: "unknown",
      environment: "test",
      source: "job",
      errorCode: "unknown",
    });
  });
});
