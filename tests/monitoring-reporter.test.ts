import { describe, expect, it, vi } from "vitest";
import { reportMonitoringError } from "../lib/monitoring/reporter";

describe("monitoring reporter", () => {
  it("sends only the scrubbed event to an optional sink", () => {
    const sink = vi.fn();
    const event = reportMonitoringError(new Error("private details"), {
      release: "candidate_2026.10.02",
      environment: "test",
      source: "client",
      errorCode: "provider",
      requestId: "9e6d25d6-80a5-48cb-a8d8-9707f91c3f3a",
    }, sink);

    expect(sink).toHaveBeenCalledWith(event);
    expect(event).toEqual({
      release: "candidate_2026.10.02",
      environment: "test",
      source: "client",
      errorCode: "provider",
      requestId: "9e6d25d6-80a5-48cb-a8d8-9707f91c3f3a",
    });
  });

  it("swallows sink failures so recovery can continue", () => {
    expect(() => reportMonitoringError(null, {
      release: "candidate",
      environment: "test",
      source: "job",
      errorCode: "timeout",
    }, () => { throw new Error("sink unavailable"); })).not.toThrow();
  });
});
