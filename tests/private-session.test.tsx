// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePrivateSession } from "../lib/auth/use-private-session";

function observation() {
  return { subject: "user-a", sessionId: "session-a", authEpoch: 1, identityLoaded: true,
    sessionActive: true, loadedUserId: "user-a", verifiedProfileId: "profile-a",
    profileRejected: false, suspended: false, getToken: vi.fn(async () => "synthetic-token") };
}
function network(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}
beforeEach(() => network(true));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("runtime private session", () => {
  it("requires an active online Convex profile and a matching loaded Clerk user", async () => {
    const state = observation();
    const hook = renderHook(usePrivateSession, { initialProps: { ...state, verifiedProfileId: null as string | null } });
    expect(hook.result.current).toBeNull();
    hook.rerender({ ...state, loadedUserId: "previous-user" });
    expect(hook.result.current).toBeNull();
    hook.rerender(state);
    await waitFor(() => expect(hook.result.current?.identity.profileId).toBe("profile-a"));
    expect(state.getToken).not.toHaveBeenCalled();
  });

  it("does not unlock a cold offline mount even with cached identity/profile observations", async () => {
    network(false);
    const state = observation();
    const hook = renderHook(usePrivateSession, { initialProps: state });
    await act(async () => {});
    expect(hook.result.current).toBeNull();
    expect(state.getToken).not.toHaveBeenCalled();
    act(() => network(true));
    await waitFor(() => expect(hook.result.current).not.toBeNull());
  });

  it("retains one warm verified grant offline, but obtains no new token while offline", async () => {
    const state = observation();
    const hook = renderHook(usePrivateSession, { initialProps: { ...state, verifiedProfileId: state.verifiedProfileId as string | null } });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const access = hook.result.current!;
    expect(await access.getToken()).toBe("synthetic-token");
    act(() => network(false));
    hook.rerender({ ...state, verifiedProfileId: null });
    expect(hook.result.current).toBe(access);
    expect(await access.getToken()).toBeNull();
    expect(state.getToken).toHaveBeenCalledTimes(1);
  });

  it("uses the live navigator state when reconnect happens before the online render", async () => {
    const state = observation();
    const hook = renderHook(usePrivateSession, { initialProps: state });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const access = hook.result.current!;

    act(() => network(false));
    expect(await access.getToken()).toBeNull();

    // Model LoanProvider's online listener running before this hook renders
    // the navigator.onLine update. The grant must be able to obtain a token
    // from the live browser state instead of trusting stale React state.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    expect(await access.getToken()).toBe("synthetic-token");
  });

  it("rejects a token when the network is lost while token acquisition is pending", async () => {
    let release!: (token: string) => void;
    const state = { ...observation(), getToken: vi.fn(() => new Promise<string>((resolve) => { release = resolve; })) };
    const hook = renderHook(usePrivateSession, { initialProps: state });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const access = hook.result.current!;
    const token = access.getToken();
    act(() => network(false));
    release("late-network-token");
    expect(await token).toBeNull();
  });

  it("keeps the same grant across ordinary rerenders and verified token refresh", async () => {
    const state = observation();
    const hook = renderHook(usePrivateSession, { initialProps: state });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const original = hook.result.current;
    hook.rerender({ ...state, getToken: vi.fn(async () => "refreshed-token") });
    expect(hook.result.current).toBe(original);
    expect(await original!.getToken()).toBe("refreshed-token");
  });

  it("hides A on the first B render and cannot revive A's old grant in an A/B/A switch", async () => {
    const state = observation();
    const renders: Array<string | null> = [];
    const hook = renderHook((input) => {
      const access = usePrivateSession(input);
      renders.push(access?.identity.subject ?? null);
      return access;
    }, { initialProps: state });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const oldA = hook.result.current!;
    const beforeSwitch = renders.length;
    hook.rerender({ ...state, subject: "user-b", sessionId: "session-b", loadedUserId: "user-b", verifiedProfileId: "profile-b" });
    expect(renders.slice(beforeSwitch)).not.toContain("user-a");
    expect(oldA.isCurrent()).toBe(false);
    hook.rerender(state);
    await waitFor(() => expect(hook.result.current?.identity.subject).toBe("user-a"));
    expect(oldA.isCurrent()).toBe(false);
    expect(await oldA.getToken()).toBeNull();
  });

  it("revokes a warm grant on profile rejection and requires fresh online verification", async () => {
    const state = observation();
    const hook = renderHook(usePrivateSession, { initialProps: { ...state, verifiedProfileId: state.verifiedProfileId as string | null } });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const old = hook.result.current!;
    act(() => network(false));
    hook.rerender({ ...state, profileRejected: true, verifiedProfileId: null });
    expect(hook.result.current).toBeNull();
    hook.rerender({ ...state, verifiedProfileId: null });
    expect(hook.result.current).toBeNull();
    expect(old.isCurrent()).toBe(false);
  });

  it("rejects a delayed token after an epoch change or sign-out suspension", async () => {
    let release!: (token: string) => void;
    const state = { ...observation(), getToken: vi.fn(() => new Promise<string>((resolve) => { release = resolve; })) };
    const hook = renderHook(usePrivateSession, { initialProps: state });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const old = hook.result.current!;
    const token = old.getToken();
    hook.rerender({ ...state, authEpoch: 2, suspended: true });
    release("late-token");
    expect(await token).toBeNull();
    expect(hook.result.current).toBeNull();
    expect(old.isCurrent()).toBe(false);
  });

  it("cannot revive a replaced profile grant when a later offline observation is incomplete", async () => {
    const state = observation();
    const hook = renderHook(usePrivateSession, { initialProps: { ...state, verifiedProfileId: state.verifiedProfileId as string | null } });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const old = hook.result.current!;
    act(() => network(false));
    hook.rerender({ ...state, verifiedProfileId: "replacement-profile" });
    hook.rerender({ ...state, verifiedProfileId: null });
    expect(hook.result.current).toBeNull();
    expect(old.isCurrent()).toBe(false);
    act(() => network(true));
    hook.rerender({ ...state, verifiedProfileId: "replacement-profile" });
    await waitFor(() => expect(hook.result.current?.identity.profileId).toBe("replacement-profile"));
  });

  it("survives StrictMode and permanently revokes callbacks on unmount", async () => {
    const hook = renderHook(usePrivateSession, { initialProps: observation(),
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    const old = hook.result.current!;
    expect(old.isCurrent()).toBe(true);
    hook.unmount();
    expect(old.isCurrent()).toBe(false);
    expect(await old.getToken()).toBeNull();
  });
});
