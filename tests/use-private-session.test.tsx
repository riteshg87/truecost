// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrivateSession } from "../lib/auth/use-private-session";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import { publishPrivateBrowserClearSignal } from "../lib/privacy/private-browser-clear-signal";

interface Observation {
  subject: string | null;
  sessionId: string | null;
  authEpoch: number;
  identityLoaded: boolean;
  sessionActive: boolean;
  loadedUserId: string | null;
  verifiedProfileId: string | null;
  profileRejected: boolean;
  suspended: boolean;
  getToken: () => Promise<string | null>;
}

function Probe({ observation, onAccess }: { observation: Observation; onAccess: (access: PrivateSessionAccess | null) => void }) {
  const access = usePrivateSession(observation);
  onAccess(access);
  return null;
}

afterEach(() => cleanup());

describe("usePrivateSession browser-clear fencing", () => {
  it("fails old access synchronously, keeps signed-out state empty, and permits a fresh verified lifetime", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    let observation: Observation = {
      subject: "subject-a",
      sessionId: "session-a",
      authEpoch: 1,
      identityLoaded: true,
      sessionActive: true,
      loadedUserId: "subject-a",
      verifiedProfileId: "profile-a",
      profileRejected: false,
      suspended: false,
      getToken: vi.fn(async () => "token-a"),
    };
    let latest: PrivateSessionAccess | null = null;
    const view = render(<Probe observation={observation} onAccess={(access) => { latest = access; }} />);
    await waitFor(() => expect(latest).not.toBeNull());
    const oldAccess = latest!;
    const getToken = observation.getToken;

    // Extra fields are rejected and do not suspend a grant.
    window.dispatchEvent(new StorageEvent("storage", {
      key: "truecost.private.browser-clear.v1",
      newValue: JSON.stringify({ type: "private-browser-clear", nonce: `bad-${Date.now()}`, profileId: "profile-a" }),
    }));
    expect(oldAccess.isCurrent()).toBe(true);

    expect(publishPrivateBrowserClearSignal()).toBe(true);
    // This check occurs in the same call stack as publication, before React
    // can process the subscriber state update.
    expect(oldAccess.isCurrent()).toBe(false);
    await expect(oldAccess.getToken()).resolves.toBeNull();
    expect(getToken).not.toHaveBeenCalled();
    await waitFor(() => expect(latest).toBeNull());

    // A transient Clerk loading render must not reopen the revoked lifetime
    // when the same identity returns without a fresh verification epoch.
    observation = { ...observation, identityLoaded: false, sessionActive: false, loadedUserId: null, verifiedProfileId: null };
    view.rerender(<Probe observation={observation} onAccess={(access) => { latest = access; }} />);
    observation = { ...observation, identityLoaded: true, sessionActive: true, loadedUserId: "subject-a", verifiedProfileId: "profile-a" };
    view.rerender(<Probe observation={observation} onAccess={(access) => { latest = access; }} />);
    expect(latest).toBeNull();

    observation = { ...observation, subject: null, sessionId: null, sessionActive: false, loadedUserId: null, verifiedProfileId: null };
    view.rerender(<Probe observation={observation} onAccess={(access) => { latest = access; }} />);
    expect(latest).toBeNull();

    // An explicit new verified auth epoch establishes a new capability.
    observation = { ...observation, subject: "subject-a", sessionId: "session-a", authEpoch: 2, sessionActive: true, loadedUserId: "subject-a", verifiedProfileId: "profile-a" };
    view.rerender(<Probe observation={observation} onAccess={(access) => { latest = access; }} />);
    await waitFor(() => expect(latest).not.toBeNull());
    const freshAccess = latest!;
    expect(freshAccess).not.toBe(oldAccess);
    expect(freshAccess.identity.authEpoch).toBe(2);

    // A later account lifetime fences this one too; no old callback can cross.
    observation = { ...observation, subject: "subject-b", sessionId: "session-b", authEpoch: 3, loadedUserId: "subject-b", verifiedProfileId: "profile-b" };
    await act(async () => view.rerender(<Probe observation={observation} onAccess={(access) => { latest = access; }} />));
    expect(freshAccess.isCurrent()).toBe(false);
    view.unmount();
  });

  it("allows first verification after a signal received while already signed out", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    let observation: Observation = {
      subject: null,
      sessionId: null,
      authEpoch: 0,
      identityLoaded: true,
      sessionActive: false,
      loadedUserId: null,
      verifiedProfileId: null,
      profileRejected: false,
      suspended: false,
      getToken: vi.fn(async () => "token-a"),
    };
    let latest: PrivateSessionAccess | null = null;
    const view = render(<Probe observation={observation} onAccess={(access) => { latest = access; }} />);
    expect(latest).toBeNull();
    expect(publishPrivateBrowserClearSignal()).toBe(true);
    observation = { ...observation, subject: "subject-a", sessionId: "session-a", authEpoch: 1, sessionActive: true, loadedUserId: "subject-a", verifiedProfileId: "profile-a" };
    view.rerender(<Probe observation={observation} onAccess={(access) => { latest = access; }} />);
    await waitFor(() => expect(latest).not.toBeNull());
    view.unmount();
  });
});
