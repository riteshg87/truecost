"use client";

import { useState } from "react";
import { FormError } from "@/components/mobile";
import { useLoan } from "@/lib/loanStore";
import { privateWriteError } from "@/lib/private-storage/messages";

export function LegacyDeviceLoanAdoption() {
  const { legacyDeviceLoanAvailable, legacyDeviceLoanState, adoptLegacyDeviceLoan, keepLegacyDeviceLoan, removeLegacyDeviceLoan } = useLoan();
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionClass = "min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-surface-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

  if (!legacyDeviceLoanAvailable && !["adopted-pending", "adopted", "kept"].includes(legacyDeviceLoanState)) return null;
  if (legacyDeviceLoanState === "adopted-pending") {
    return <section aria-label="Device loan adoption" className="my-4 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2"><p role="status">The saved loan is queued for this account. The original device copy stays here until the account save is acknowledged.</p></section>;
  }
  if (legacyDeviceLoanState === "adopted") {
    return <section aria-label="Device loan adoption" className="my-4 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2"><p role="status">The saved loan is acknowledged on this account. The original device copy is still here until you remove it.</p><div className="mt-3 flex flex-wrap gap-2">{confirmRemove ? <><button type="button" disabled={busy} className={`${actionClass} text-danger`} onClick={removeLegacyDeviceLoan}>Remove device copy</button><button type="button" disabled={busy} className={actionClass} onClick={() => setConfirmRemove(false)}>Keep it</button></> : <button type="button" disabled={busy} className={actionClass} onClick={() => setConfirmRemove(true)}>Remove from this device</button>}</div><FormError>{error}</FormError></section>;
  }
  if (legacyDeviceLoanState === "kept") {
    return <section aria-label="Device loan adoption" className="my-4 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2"><p role="status">The saved loan stayed on this device and was not added to this account.</p></section>;
  }

  const adopt = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await adoptLegacyDeviceLoan();
      const message = privateWriteError(result);
      if (message) setError(message);
    } catch {
      setError("The device loan could not be copied. Keep this page open and try again.");
    } finally { setBusy(false); }
  };

  return (
    <section aria-label="Device loan adoption" className="my-4 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2">
      <h2 className="font-semibold text-ink">A saved loan is on this device</h2>
      <p className="mt-1.5">Choose what to do with it. TrueCost will not attach it to your account without your choice.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={actionClass} onClick={() => void adopt()}>Import to this account</button>
        <button type="button" disabled={busy} className={actionClass} onClick={keepLegacyDeviceLoan}>Keep on this device</button>
        {confirmRemove ? (
          <>
            <button type="button" disabled={busy} className={`${actionClass} text-danger`} onClick={removeLegacyDeviceLoan}>Remove device copy</button>
            <button type="button" disabled={busy} className={actionClass} onClick={() => setConfirmRemove(false)}>Keep it</button>
          </>
        ) : <button type="button" disabled={busy} className={actionClass} onClick={() => setConfirmRemove(true)}>Remove from this device</button>}
      </div>
      <FormError>{error}</FormError>
    </section>
  );
}
