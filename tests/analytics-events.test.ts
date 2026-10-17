import { describe, expect, it } from "vitest";
import { buildAnalyticsEvent, parseAnalyticsEvent, type AnalyticsEventName } from "../lib/analytics/events";

const id = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;
const common = { event_version: 1, environment: "development", release: "0.1.0", auth_state: "guest", feature: "comparison", route_name: "compare_results", event_id: id("1"), occurred_at: "2026-09-16T12:00:00.000Z" };

function event(event: AnalyticsEventName, extra: Record<string, unknown> = {}, authState = common.auth_state) {
  return { event, properties: { ...common, auth_state: authState, ...extra } };
}
function code(result: ReturnType<typeof parseAnalyticsEvent>) { return result.ok ? undefined : result.code; }

describe("closed analytics event contract", () => {
  it("accepts fixed history route names without exposing saved-record URLs", () => {
    for (const route_name of ["comparisons", "comparison_detail"]) {
      expect(parseAnalyticsEvent(event("report_generation_status", {
        route_name, request_id: id("7"), stage: "requested", source: "saved",
      }, "member")).ok).toBe(true);
    }
    for (const route_name of ["/comparisons/private-record-id", "https://truecost.example/comparisons/private-record-id"]) {
      expect(parseAnalyticsEvent(event("report_generation_status", {
        route_name, request_id: id("7"), stage: "requested", source: "saved",
      }, "member")).ok).toBe(false);
    }
  });

  it("accepts one valid fixture for every planned event", () => {
    const fixtures: unknown[] = [
      event("comparison_started", { draft_id: id("2") }),
      event("comparison_completed", { draft_id: id("2"), result_id: id("3"), offer_count: 2, calculation_version: "finance-engine-v1" }),
      event("auth_prompt_viewed", { session_id: id("4"), result_id: id("3"), action: "compare_again", mode: "new" }),
      event("auth_completed", { flow_id: id("5"), action: "direct", method: "email" }, "member"),
      event("auth_intent_resumed", { flow_id: id("5"), action: "save", status: "succeeded" }, "member"),
      event("comparison_save_status", { request_id: id("6"), stage: "queued" }, "member"),
      event("comparison_saved", { request_id: id("6"), path: "queued" }, "member"),
      event("report_generation_status", { request_id: id("7"), stage: "generated", source: "saved" }, "member"),
      event("report_download_initiated", { request_id: id("8") }, "member"),
      event("feedback_submitted", { result_id: id("3"), answer: "yes", context_version: "v1" }, "member"),
      event("web_vital", { metric_id: id("9"), metric: "LCP", unit: "milliseconds", value: 1200, device_class: "mobile" }),
    ];
    for (const fixture of fixtures) expect(parseAnalyticsEvent(fixture).ok).toBe(true);
  });

  it("clones and freezes the sanitized result", () => {
    const input = event("comparison_started", { draft_id: id("10") });
    const result = buildAnalyticsEvent(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBe(input);
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.properties)).toBe(true);
      (input.properties as Record<string, unknown>).draft_id = id("11");
      if (result.value.event === "comparison_started") expect(result.value.properties.draft_id).toBe(id("10"));
    }
  });

  it("rejects unknown events, properties and forbidden content markers", () => {
    expect(code(parseAnalyticsEvent(event("made_up" as AnalyticsEventName, { draft_id: id("2") })))).toBe("unknown_event");
    expect(code(parseAnalyticsEvent(event("comparison_started", { draft_id: id("2"), lender: "Bank" })))).toBe("unknown_property");
    expect(parseAnalyticsEvent(event("comparison_started", { draft_id: id("2"), email: "person@example.com" })).ok).toBe(false);
    expect(parseAnalyticsEvent(event("comparison_started", { draft_id: id("2"), principal: 100 })).ok).toBe(false);
    expect(parseAnalyticsEvent(event("comparison_started", { draft_id: id("2"), url: "https://example.com" })).ok).toBe(false);
    for (const name of ["otp", "phone", "comment", "hash", "record_id", "$device_id"]) {
      expect(parseAnalyticsEvent(event("comparison_started", { draft_id: id("2"), [name]: "secret" })).ok).toBe(false);
    }
  });

  it("rejects malformed IDs, timestamps, numbers, enums and auth mismatches", () => {
    expect(code(parseAnalyticsEvent(event("comparison_started", { draft_id: "user_123" })))).toBe("invalid_id");
    expect(code(parseAnalyticsEvent(event("comparison_started", { draft_id: id("2") , occurred_at: "2026-09-16" })))).toBe("invalid_timestamp");
    expect(code(parseAnalyticsEvent(event("comparison_completed", { draft_id: id("2"), result_id: id("3"), offer_count: 4, calculation_version: "finance-engine-v1" })))).toBe("invalid_number");
    expect(code(parseAnalyticsEvent(event("comparison_completed", { draft_id: id("2"), result_id: id("3"), offer_count: 2, calculation_version: "free_text" })))).toBe("invalid_enum");
    expect(code(parseAnalyticsEvent(event("comparison_saved", { request_id: id("6"), path: "queued" })))).toBe("auth_mismatch");
    expect(code(parseAnalyticsEvent(event("web_vital", { metric_id: id("9"), metric: "CLS", unit: "milliseconds", value: Number.NaN, device_class: "mobile" })))).toBe("invalid_number");
    expect(code(parseAnalyticsEvent(event("web_vital", { metric_id: id("9"), metric: "CLS", unit: "milliseconds", value: 0.1, device_class: "mobile" })))).toBe("invalid_enum");
    expect(code(parseAnalyticsEvent(event("web_vital", { metric_id: id("9"), metric: "LCP", unit: "milliseconds", value: Number.POSITIVE_INFINITY, device_class: "mobile" })))).toBe("invalid_number");
  });

  it("enforces event meaning across auth, feature and error fields", () => {
    const memberEvents = [
      event("auth_completed", { flow_id: id("5"), action: "direct", method: "email" }),
      event("auth_intent_resumed", { flow_id: id("5"), action: "save", status: "succeeded" }),
      event("comparison_save_status", { request_id: id("6"), stage: "queued" }),
      event("comparison_saved", { request_id: id("6"), path: "queued" }),
      event("report_generation_status", { request_id: id("7"), stage: "generated", source: "saved" }),
      event("report_download_initiated", { request_id: id("8") }),
      event("feedback_submitted", { result_id: id("3"), answer: "no", context_version: "v1" }),
    ];
    for (const fixture of memberEvents) expect(code(parseAnalyticsEvent(fixture))).toBe("auth_mismatch");
    expect(parseAnalyticsEvent(event("auth_prompt_viewed", { session_id: id("4"), result_id: id("3"), action: "save" }, "member")).ok).toBe(false);
    expect(parseAnalyticsEvent(event("comparison_completed", { draft_id: id("2"), result_id: id("3"), offer_count: 3, calculation_version: "finance-engine-v1" })).ok).toBe(false);
    expect(parseAnalyticsEvent(event("comparison_completed", { draft_id: id("2"), result_id: id("3"), offer_count: 3, calculation_version: "finance-engine-v1" }, "member")).ok).toBe(true);
    expect(parseAnalyticsEvent(event("comparison_started", { draft_id: id("2") }, "guest")).ok).toBe(true);
    expect(parseAnalyticsEvent({ event: "comparison_started", properties: { ...common, draft_id: id("2"), feature: "loan_health" } }).ok).toBe(false);
    expect(parseAnalyticsEvent(event("auth_intent_resumed", { flow_id: id("5"), action: "save", status: "succeeded", error_code: "unknown" }, "member")).ok).toBe(false);
    expect(parseAnalyticsEvent(event("comparison_save_status", { request_id: id("6"), stage: "queued", error_code: "network" }, "member")).ok).toBe(false);
    expect(parseAnalyticsEvent(event("report_generation_status", { request_id: id("7"), stage: "requested", source: "current", error_code: "network" }, "member")).ok).toBe(false);
  });

  it("requires compare-again modes and accepts only trusted configured releases", () => {
    expect(parseAnalyticsEvent(event("auth_prompt_viewed", { session_id: id("4"), result_id: id("3"), action: "compare_again" })).ok).toBe(false);
    expect(parseAnalyticsEvent(event("comparison_completed", { draft_id: id("2"), result_id: id("3"), offer_count: 2, calculation_version: "finance-engine-v1" }), { releases: ["build-42"], calculationVersions: ["finance-engine-v1"], contextVersions: ["v1"] }).ok).toBe(false);
    expect(parseAnalyticsEvent(event("comparison_completed", { release: "build-42", draft_id: id("2"), result_id: id("3"), offer_count: 2, calculation_version: "calc-2" }), { releases: ["build-42"], calculationVersions: ["calc-2"], contextVersions: ["v1"] }).ok).toBe(true);
    expect(parseAnalyticsEvent(event("comparison_completed", { draft_id: id("2"), result_id: id("3"), offer_count: 2, calculation_version: "calc-2" })).ok).toBe(false);
  });
});
