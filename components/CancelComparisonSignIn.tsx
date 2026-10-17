"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/provider";
import { GuestHandoffStorage } from "@/lib/guest/handoff";
import { useViewLifetime } from "@/lib/use-view-lifetime";

export function CancelComparisonSignIn({ next }: { next: string }) {
  const router = useRouter();
  const auth = useAuth();
  const isCurrentView = useViewLifetime();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = new URL(next, "https://truecost.invalid").searchParams;
  const requestId = params.get("requestId");
  if (!requestId) return null;
  const cancel = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    const result = await new GuestHandoffStorage().cancel(requestId, { initiatingTabId: auth.initiatingTabId });
    if (!isCurrentView()) return;
    if (result.kind === "storage-unavailable" || result.kind === "locked" || result.kind === "invalid") {
      setError("This sign-in action could not be cancelled safely. Try again.");
      setBusy(false); return;
    }
    auth.cancelVerification();
    auth.continueAsGuest();
    router.replace(params.get("action") === "recalculate_existing_draft" ? "/compare" : "/compare/results");
  };
  return <div className="mt-4 text-sm text-ink-2">
    <button type="button" disabled={busy} onClick={() => void cancel()}
      className="min-h-11 w-full rounded-lg px-4 py-3 font-medium hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">
      {busy ? "Returning…" : "Cancel and return to comparison"}
    </button>
    {error ? <p role="alert" className="mt-2">{error}</p> : null}
  </div>;
}
