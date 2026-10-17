// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { viewer: "member", configured: true, privateSession: { identity: { profileId: "profile-a", subject: "user-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true }, isCurrent: () => true } },
  deletion: { state: { kind: "idle" } as any, serverStatus: null, visibleForCurrent: true, start: vi.fn(), retry: vi.fn() },
  analytics: { withdraw: vi.fn(async () => undefined) },
  loanCleanup: { run: vi.fn(async () => ({ kind: "cleared" })) },
  comparisonCleanup: { run: vi.fn(async () => ({ kind: "cleared" })) },
}));

vi.mock("@/lib/auth/provider", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/privacy/account-deletion-provider", () => ({ useAccountDeletion: () => state.deletion }));
vi.mock("@/lib/analytics/provider", () => ({ useAnalytics: () => state.analytics }));
vi.mock("@/lib/loanStore", () => ({ useLoan: () => ({ captureAccountDeletionCleanup: vi.fn(() => state.loanCleanup) }) }));
vi.mock("@/lib/store", () => ({ useCompare: () => ({ captureAccountDeletionCleanup: vi.fn(() => state.comparisonCleanup) }) }));

import { AccountDeletionPanel } from "../components/AccountDeletionPanel";

afterEach(() => {
  cleanup();
  state.deletion.state = { kind: "idle" };
  state.deletion.start.mockReset();
  state.deletion.retry.mockReset();
});

describe("mounted account deletion panel", () => {
  it("cancels without invoking the deletion runtime", () => {
    render(<AccountDeletionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.deletion.start).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("passes account-bound cleanup, signal and analytics callbacks only after confirmation", async () => {
    state.deletion.start.mockImplementation(async (_confirmed: boolean, options: any) => {
      expect(options.captureCleanup()).not.toBeNull();
      expect(options.captureSignal()).not.toBeNull();
      await options.stopAnalytics();
      return { kind: "accepted", requestId: "request-a", grantId: "grant-a", cleanup: "cleared" };
    });
    render(<AccountDeletionPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm account deletion" })); });
    expect(state.deletion.start).toHaveBeenCalledWith(true, expect.any(Object));
    expect(state.analytics.withdraw).toHaveBeenCalledTimes(1);
  });

  it("keeps uncertain server acknowledgement explicit and offers retry", () => {
    state.deletion.state = { kind: "unknown", requestId: "request-a", grantId: "grant-a" };
    state.deletion.retry.mockResolvedValue(state.deletion.state);
    render(<AccountDeletionPanel />);
    expect(screen.getByText(/could not confirm whether deletion started/i)).toBeTruthy();
  });
});
