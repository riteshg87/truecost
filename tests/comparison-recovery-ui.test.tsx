// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  comparison: null as any,
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("../lib/use-view-lifetime", () => ({ useViewLifetime: () => () => true }));
vi.mock("../lib/store", () => ({ useCompare: () => mocks.comparison }));

import { ComparisonStatus } from "../components/ComparisonStatus";

function state(pauseReason: string | null) {
  return {
    member: true,
    hydrated: true,
    busy: false,
    snapshot: { resultId: "result-1" },
    message: null,
    saveStatus: pauseReason ? "paused" : "idle",
    savePauseReason: pauseReason,
    saveRequestId: "00000000-0000-4000-8000-000000000001",
    save: vi.fn(async () => ({ kind: "ok" })),
    retrySave: vi.fn(async () => undefined),
    reset: vi.fn(async () => ({ kind: "ok", href: "/compare" })),
    resumeIntent: vi.fn(async () => ({ kind: "ok" })),
  };
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.comparison = state("retry-exhausted");
});
afterEach(() => cleanup());

describe("comparison paused-save recovery", () => {
  it("offers an explicit same-request retry after bounded attempts", () => {
    render(<ComparisonStatus actions resume={false} />);
    expect(screen.getByRole("status").textContent).toContain("eight attempts");
    fireEvent.click(screen.getByRole("button", { name: "Try saving again" }));
    expect(mocks.comparison.retrySave).toHaveBeenCalledOnce();
  });

  it("does not offer blind replay for an expired save", () => {
    mocks.comparison = state("expired");
    render(<ComparisonStatus actions resume={false} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("too old to retry");
    expect(status.textContent).toContain("could not confirm whether it was saved");
    expect(screen.queryByRole("button", { name: "Try saving again" })).toBeNull();
    expect(screen.getByRole("button", { name: "New comparison" })).toBeTruthy();
  });
});
