import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("Next runtime header policy", () => {
  it("applies conservative browser protections to every route", async () => {
    const rules = await nextConfig.headers?.();
    const globalRule = rules?.find((rule) => rule.source === "/(.*)");
    expect(globalRule?.headers).toEqual(expect.arrayContaining([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    ]));
  });

  it("keeps the offline shell cache policy explicit", async () => {
    const rules = await nextConfig.headers?.();
    const offlineRule = rules?.find((rule) => rule.source === "/offline/index.html");
    expect(offlineRule?.headers).toEqual([
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
    ]);
  });
});
