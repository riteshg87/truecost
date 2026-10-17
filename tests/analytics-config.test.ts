import { describe, expect, it } from "vitest";
import { resolveAnalyticsConfig } from "../lib/analytics/config";

const token = "0123456789abcdef0123456789abcdef";

describe("analytics deployment configuration", () => {
  it("fails closed when disabled, incomplete or malformed", () => {
    for (const settings of [
      {},
      { token, environment: "development" },
      { enabled: "false", token, environment: "development" },
      { enabled: "true", token, environment: "unknown" },
      { enabled: "true", token: "not-a-project-token", environment: "production" },
      { enabled: "true", environment: "development" },
    ]) {
      expect(resolveAnalyticsConfig(settings)).toEqual({ enabled: false, token: null, environment: null });
    }
  });

  it("requires an explicit environment without deriving it from a production build", () => {
    expect(resolveAnalyticsConfig({ enabled: "true", token, environment: "development" }))
      .toEqual({ enabled: true, token, environment: "development" });
    expect(resolveAnalyticsConfig({ enabled: "true", token, environment: "production" }))
      .toEqual({ enabled: true, token, environment: "production" });
  });
});
