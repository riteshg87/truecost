// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyDeviceLoanAdoption } from "../components/LegacyDeviceLoanAdoption";

const mocks = vi.hoisted(() => ({
  adopt: vi.fn(async () => ({ kind: "ok", value: { requestId: "request" } })),
  keep: vi.fn(),
  remove: vi.fn(),
  state: "available" as "available" | "adopted-pending" | "adopted" | "kept",
}));

vi.mock("../lib/loanStore", () => ({ useLoan: () => ({ legacyDeviceLoanAvailable: mocks.state === "available", legacyDeviceLoanState: mocks.state, adoptLegacyDeviceLoan: mocks.adopt, keepLegacyDeviceLoan: mocks.keep, removeLegacyDeviceLoan: mocks.remove }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.state = "available"; });

describe("LegacyDeviceLoanAdoption", () => {
  it("calls the explicit import and keep choices", async () => {
    render(<LegacyDeviceLoanAdoption />);
    fireEvent.click(screen.getByRole("button", { name: "Import to this account" }));
    await waitFor(() => expect(mocks.adopt).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Keep on this device" }));
    expect(mocks.keep).toHaveBeenCalledOnce();
  });

  it("requires a second click before removing the device copy", () => {
    render(<LegacyDeviceLoanAdoption />);
    fireEvent.click(screen.getByRole("button", { name: "Remove from this device" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove device copy" }));
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("offers removal after an acknowledged import", () => {
    mocks.state = "adopted";
    render(<LegacyDeviceLoanAdoption />);
    fireEvent.click(screen.getByRole("button", { name: "Remove from this device" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove device copy" }));
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
