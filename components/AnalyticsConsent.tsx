"use client";

import { useState } from "react";
import { FormError } from "@/components/mobile";
import { useOptionalAnalytics } from "@/lib/analytics/provider";

export function AnalyticsConsent() {
  const analytics = useOptionalAnalytics();
  const [busy, setBusy] = useState(false);
  if (!analytics || analytics.status === "disabled" || analytics.status === "loading") return null;
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  const accepted = analytics.status === "accepted";
  return (
    <section aria-labelledby="analytics-consent-title" className="mt-6 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2">
      <h2 id="analytics-consent-title" className="font-semibold text-ink">Optional product analytics</h2>
      <p className="mt-2">Help us understand which comparison steps are useful. Analytics is optional and does not include your loan figures, contact details, or saved record IDs.</p>
      {accepted ? (
        <div className="mt-3 flex flex-col gap-2">
          <p role="status">Analytics is on.</p>
          <button type="button" disabled={busy} className="min-h-11 rounded-lg px-3 py-2 text-left font-medium text-ink hover:bg-surface-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50" onClick={() => void run(analytics.withdraw)}>Turn off analytics</button>
        </div>
      ) : analytics.status === "pending" ? (
        <div className="mt-3">
          <p role="status">{analytics.error ?? "Analytics is off while your privacy choice is being saved."}</p>
          <button type="button" disabled={busy} className="mt-2 min-h-11 rounded-lg px-3 py-2 text-left font-medium text-ink hover:bg-surface-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50" onClick={() => void run(analytics.retry)}>Retry privacy choice</button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={busy} className="min-h-11 flex-1 rounded-lg bg-accent px-3 py-2 font-semibold text-accent-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50" onClick={() => void run(analytics.accept)}>Accept analytics</button>
          <button type="button" disabled={busy} className="min-h-11 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 font-semibold text-ink hover:bg-surface-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50" onClick={() => void run(analytics.decline)}>Decline analytics</button>
        </div>
      )}
      <FormError>{analytics.error}</FormError>
    </section>
  );
}
