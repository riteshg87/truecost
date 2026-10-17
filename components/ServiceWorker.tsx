"use client";

import { useEffect, useState } from "react";
import { registerPublicServiceWorker, retryPublicServiceWorker, subscribeServiceWorkerController, unsupportedStatus, type ServiceWorkerStatus } from "@/lib/pwa/controller";

/** Registers only the public offline shell. Account gating is owned by the auth flow. */
export function ServiceWorker() {
  const [status, setStatus] = useState<ServiceWorkerStatus>(unsupportedStatus());
  useEffect(() => {
    let mounted = true;
    setStatus({ state: "registering", version: null, message: "Checking offline mode…" });
    const run = () => void registerPublicServiceWorker().then((next) => { if (mounted) setStatus(next); });
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run, { once: true });
    const unsubscribe = subscribeServiceWorkerController(() => { if (mounted) run(); });
    return () => { mounted = false; unsubscribe(); window.removeEventListener("load", run); };
  }, []);
  if (status.state === "blocked" || status.state === "failed") {
    return <p role="status" style={{ position: "fixed", insetInline: 12, bottom: 12, zIndex: 10, margin: 0, padding: 10, background: "#fff8e9", color: "#805005", borderRadius: 8 }}>{status.message} <button type="button" onClick={() => { setStatus({ state: "registering", version: null, message: "Retrying offline mode…" }); void retryPublicServiceWorker().then(setStatus); }}>Retry</button></p>;
  }
  return null;
}
