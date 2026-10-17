// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRIVATE_BROWSER_CLEAR_SIGNAL_CHANNEL,
  PRIVATE_BROWSER_CLEAR_SIGNAL_KEY,
  getPrivateBrowserClearRevision,
  isPrivateBrowserClearSignal,
  publishPrivateBrowserClearSignal,
  subscribeToPrivateBrowserClearSignal,
} from "../lib/privacy/private-browser-clear-signal";

class FakeBroadcastChannel {
  static channels = new Set<FakeBroadcastChannel>();
  readonly name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.channels.add(this);
  }

  postMessage(data: unknown): void {
    for (const peer of [...FakeBroadcastChannel.channels]) {
      if (peer !== this && peer.name === this.name) peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    FakeBroadcastChannel.channels.delete(this);
  }
}

beforeEach(() => vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel));
afterEach(() => {
  vi.unstubAllGlobals();
  FakeBroadcastChannel.channels.clear();
});

describe("private browser clear signal", () => {
  it("invalidates same-page subscribers synchronously and coalesces duplicate delivery", () => {
    const listener = vi.fn();
    const subscription = subscribeToPrivateBrowserClearSignal(listener);
    const before = getPrivateBrowserClearRevision();

    expect(publishPrivateBrowserClearSignal()).toBe(true);
    expect(getPrivateBrowserClearRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
    const signal = listener.mock.calls[0][0];
    expect(signal).toMatchObject({ type: "private-browser-clear" });
    window.dispatchEvent(new StorageEvent("storage", {
      key: PRIVATE_BROWSER_CLEAR_SIGNAL_KEY,
      newValue: JSON.stringify(signal),
    }));
    expect(listener).toHaveBeenCalledTimes(1);
    subscription.stop();
  });

  it("accepts only the identity-free exact wire shape", () => {
    expect(isPrivateBrowserClearSignal({ type: "private-browser-clear", nonce: "n-1" })).toBe(true);
    expect(isPrivateBrowserClearSignal({ type: "private-browser-clear", nonce: " n-1 " })).toBe(true);
    expect(isPrivateBrowserClearSignal({ type: "private-browser-clear", nonce: "n-1", profileId: "owner" })).toBe(false);
    expect(isPrivateBrowserClearSignal({ type: "private-browser-clear", nonce: "n-1", sessionId: "secret" })).toBe(false);
    expect(isPrivateBrowserClearSignal({ type: "private-browser-clear", nonce: "" })).toBe(false);
    expect(isPrivateBrowserClearSignal({ type: "other", nonce: "n-1" })).toBe(false);
    expect(isPrivateBrowserClearSignal(null)).toBe(false);
  });

  it("uses storage delivery when BroadcastChannel is unavailable and can unsubscribe", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const listener = vi.fn();
    const subscription = subscribeToPrivateBrowserClearSignal(listener);
    const signal = { type: "private-browser-clear", nonce: `storage-${Date.now()}` };
    window.dispatchEvent(new StorageEvent("storage", {
      key: PRIVATE_BROWSER_CLEAR_SIGNAL_KEY,
      newValue: JSON.stringify(signal),
    }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", {
      key: PRIVATE_BROWSER_CLEAR_SIGNAL_KEY,
      newValue: JSON.stringify({ ...signal, extra: true }),
    }));
    expect(listener).toHaveBeenCalledTimes(1);
    subscription.stop();
    window.dispatchEvent(new StorageEvent("storage", {
      key: PRIVATE_BROWSER_CLEAR_SIGNAL_KEY,
      newValue: JSON.stringify({ type: "private-browser-clear", nonce: `after-${Date.now()}` }),
    }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports notification-unavailable while still delivering same-page invalidation", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const originalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined },
    });
    const listener = vi.fn();
    const subscription = subscribeToPrivateBrowserClearSignal(listener);
    expect(publishPrivateBrowserClearSignal()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    subscription.stop();
    Object.defineProperty(window, "localStorage", { configurable: true, value: originalStorage });
  });

  it("keeps the protocol separate from account-deletion signals", () => {
    expect(PRIVATE_BROWSER_CLEAR_SIGNAL_CHANNEL).toBe("truecost.private.browser-clear.v1");
    expect(PRIVATE_BROWSER_CLEAR_SIGNAL_KEY).toBe("truecost.private.browser-clear.v1");
  });
});
