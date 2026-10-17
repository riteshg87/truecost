export type ServiceWorkerState =
  | "unsupported"
  | "registering"
  | "waiting-for-control"
  | "ready"
  | "blocked"
  | "failed";

export interface ServiceWorkerStatus {
  state: ServiceWorkerState;
  version: string | null;
  message: string;
}

const STATUS_TYPE = "TC_SW_STATUS";
const EXPECTED_PREFIX = "truecost-offline-";

export function unsupportedStatus(): ServiceWorkerStatus {
  return { state: "unsupported", version: null, message: "Offline mode is unavailable. Retry before opening private data." };
}

export async function registerPublicServiceWorker(): Promise<ServiceWorkerStatus> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return unsupportedStatus();
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    if (!navigator.serviceWorker.controller) {
      return { state: "waiting-for-control", version: null, message: "Offline mode will be ready after a reload." };
    }
    // Only the controlling worker can prove which version serves this page.
    // A newly installed registration.active may still be waiting behind an old
    // controller, so querying it would incorrectly report readiness.
    const worker = navigator.serviceWorker.controller;
    const controllerAtStart = worker;
    const expectedVersion = OFFLINE_BUILD_VERSION;
    return await new Promise<ServiceWorkerStatus>((resolve) => {
      const finish = (status: ServiceWorkerStatus) => {
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener("message", listener);
        resolve(status);
      };
      const timeout = window.setTimeout(() => finish({ state: "blocked", version: null, message: "Offline mode needs a reload before private data can open." }), 1500);
      const listener = (event: MessageEvent) => {
        if (event.data?.type !== STATUS_TYPE) return;
        if (event.source !== controllerAtStart || navigator.serviceWorker.controller !== controllerAtStart) {
          finish({ state: "blocked", version: null, message: "Offline mode changed during verification. Reload before opening private data." });
          return;
        }
        const version = typeof event.data.version === "string" ? event.data.version : null;
        finish(version && version === expectedVersion && event.data.cache === `${EXPECTED_PREFIX}${version}`
          ? { state: "ready", version, message: "Public offline shell is ready." }
          : { state: "blocked", version, message: "Offline mode could not verify this update. Reload before opening private data." });
      };
      navigator.serviceWorker.addEventListener("message", listener);
      worker.postMessage({ type: STATUS_TYPE });
    });
  } catch {
    return { state: "failed", version: null, message: "Offline mode could not update. Retry before opening private data." };
  }
}

/** Allows a future private-hydration gate to retry after controllerchange. */
export function subscribeServiceWorkerController(listener: () => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  navigator.serviceWorker.addEventListener("controllerchange", listener);
  return () => navigator.serviceWorker.removeEventListener("controllerchange", listener);
}

export function retryPublicServiceWorker(): Promise<ServiceWorkerStatus> {
  return registerPublicServiceWorker();
}
import { OFFLINE_BUILD_VERSION } from "./generated-version";
