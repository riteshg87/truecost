"use client";

import { useEffect } from "react";
import { reportMonitoringError } from "@/lib/monitoring/reporter";

export default function GlobalRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportMonitoringError(new Error("route_render_failed"), {
      release: process.env.NEXT_PUBLIC_RELEASE ?? "0.1.0",
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
      source: "client",
      errorCode: "unknown",
    });
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-12 text-center text-ink">
      <section className="w-full rounded-2xl border border-line bg-surface px-5 py-8 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-3">TrueCost</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">This page needs a refresh</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink-2">Your comparison data is still protected. Try the page again, or return to the calculator.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="min-h-11 rounded-lg bg-accent px-4 py-2 font-semibold text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Try again</button>
          <a href="/compare" className="inline-flex min-h-11 items-center rounded-lg px-4 py-2 font-semibold text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Open calculator</a>
        </div>
      </section>
    </main>
  );
}
