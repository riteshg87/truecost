/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPublicServiceWorker } from "../lib/pwa/controller";
import { OFFLINE_BUILD_VERSION } from "../lib/pwa/generated-version";

function installWorker(version: string, sourceOverride?: object) {
  const listeners = new Map<string, (event: MessageEvent) => void>();
  const controller = { postMessage: () => setTimeout(() => listeners.get("message")?.({ source: sourceOverride ?? controller, data: { type: "TC_SW_STATUS", version, cache: `truecost-offline-${version}` } } as MessageEvent), 0) };
  const serviceWorker = {
    controller,
    register: vi.fn(async () => ({ active: controller })),
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
}

afterEach(() => vi.restoreAllMocks());

describe("service worker version handshake", () => {
  it("rejects a stale worker even when its cache prefix is valid", async () => {
    installWorker("old-build");
    const status = await registerPublicServiceWorker();
    expect(status.state).toBe("blocked");
  });

  it("rejects a status message from a different worker source", async () => {
    installWorker(OFFLINE_BUILD_VERSION, {});
    const status = await registerPublicServiceWorker();
    expect(status.state).toBe("blocked");
  });

  it("reports ready only for the current controlling worker and manifest", async () => {
    installWorker(OFFLINE_BUILD_VERSION);
    const status = await registerPublicServiceWorker();
    expect(status).toMatchObject({ state: "ready", version: OFFLINE_BUILD_VERSION });
  });
});
