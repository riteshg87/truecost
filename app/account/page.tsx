"use client";

import { useReverification } from "@clerk/nextjs";
import { useAction, useMutation } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { AppBar, FormError, Page, Screen } from "@/components/mobile";
import { LoanSyncStatus } from "@/components/LoanSyncStatus";
import { LegacyDeviceLoanAdoption } from "@/components/LegacyDeviceLoanAdoption";
import { privateWriteError } from "@/lib/private-storage/messages";
import { useViewLifetime } from "@/lib/use-view-lifetime";
import { useAuth } from "@/lib/auth/provider";
import { useLoan } from "@/lib/loanStore";
import { useCompare } from "@/lib/store";
import { AnalyticsConsent } from "@/components/AnalyticsConsent";
import { AccountDeletionPanel } from "@/components/AccountDeletionPanel";

function AccountExportAction() {
  const { viewer, accountKey, authEpoch } = useAuth();
  const isCurrentView = useViewLifetime();
  const liveAuth = useRef({ viewer, accountKey, authEpoch });
  liveAuth.current = { viewer, accountKey, authEpoch };
  const exportAttempt = useRef<{ accountKey: string; authEpoch: number } | null>(null);
  const exchange = useAction(api.privacyApprovals.exchange);
  const begin = useMutation(api.accountExports.beginExport);
  const pageComparisons = useMutation(api.accountExports.pageComparisons);
  const pageFeedback = useMutation(api.accountExports.pageFeedback);
  const pageDismissals = useMutation(api.accountExports.pageFeedbackDismissals);
  const savedLoan = useMutation(api.accountExports.getSavedLoan);
  const finalize = useMutation(api.accountExports.finalizeExport);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approval = useReverification(async () => {
    const attempt = exportAttempt.current;
    const current = liveAuth.current;
    const isCurrentAttempt = () => {
      const latest = liveAuth.current;
      return Boolean(attempt) && isCurrentView() && latest.viewer === "member" && latest.accountKey === attempt?.accountKey && latest.authEpoch === attempt?.authEpoch;
    };
    if (!isCurrentAttempt()) throw new Error("Your account changed during export. Start again.");
    const response = await fetch("/api/privacy/approval", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose: "account_export" }) });
    if (!isCurrentAttempt()) throw new Error("Your account changed during export. Start again.");
    const body = await response.json().catch(() => ({})) as { proof?: string; clerk_error?: string; error?: string };
    if (!isCurrentAttempt()) throw new Error("Your account changed during export. Start again.");
    // Clerk's hook recognizes this structured response and opens its default
    // reverification UI. Throwing a generic Error bypasses that contract.
    if (!response.ok) return new Response(JSON.stringify(body), { status: response.status, headers: { "Content-Type": "application/json" } });
    if (typeof body.proof !== "string") throw new Error("Export approval could not be completed");
    return { proof: body.proof };
  });

  const download = async () => {
    if (busy || viewer !== "member" || !accountKey) return;
    const capturedAccount = accountKey;
    const capturedEpoch = authEpoch;
    exportAttempt.current = { accountKey: capturedAccount, authEpoch: capturedEpoch };
    const assertCurrent = () => {
      const current = liveAuth.current;
      if (!isCurrentView() || current.viewer !== "member" || current.accountKey !== capturedAccount || current.authEpoch !== capturedEpoch) throw new Error("Your account changed during export. Start again.");
    };
    const isAttemptCurrent = () => {
      const current = liveAuth.current;
      return isCurrentView() && current.viewer === "member" && current.accountKey === capturedAccount && current.authEpoch === capturedEpoch;
    };
    setBusy(true); setError(null);
    try {
      const approved = await approval();
      if (!approved || approved instanceof Response || typeof approved.proof !== "string") throw new Error("Export approval could not be completed");
      const { proof } = approved;
      assertCurrent();
      const grant = await exchange({ proof, purpose: "account_export" });
      assertCurrent();
      if ("status" in grant && grant.status === "limited") throw new Error(grant.message);
      assertCurrent();
      const started = await begin({ grantId: grant.grantId, requestId: crypto.randomUUID() });
      assertCurrent();
      if (started.status === "limited") throw new Error(started.message);
      const sessionId = started.session._id;
      const comparisons: unknown[] = [];
      const feedback: unknown[] = [];
      const dismissals: unknown[] = [];
      const pages = async (read: (args: { sessionId: typeof sessionId; paginationOpts: { numItems: number; cursor: string | null } }) => Promise<any>, target: unknown[]) => {
        let cursor: string | null = null;
        for (;;) {
          assertCurrent();
          const page = await read({ sessionId, paginationOpts: { numItems: 50, cursor } });
          assertCurrent();
          if (page.status === "aborted") throw new Error(page.message);
          target.push(...page.result.page);
          if (page.result.isDone) break;
          cursor = page.result.continueCursor;
        }
      };
      await pages(pageComparisons, comparisons);
      await pages(pageFeedback, feedback);
      await pages(pageDismissals, dismissals);
      assertCurrent();
      const loan = await savedLoan({ sessionId });
      assertCurrent();
      if (loan.status === "aborted") throw new Error(loan.message);
      assertCurrent();
      const done = await finalize({ sessionId });
      assertCurrent();
      if (done.status === "aborted") throw new Error(done.message);
      const output = { version: 1, createdAt: new Date().toISOString(), dataScope: ["comparisons", "savedLoan", "feedback", "feedbackDismissals"], comparisons, savedLoan: loan.payload, feedback, feedbackDismissals: dismissals };
      const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "truecost-export.json"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      if (!isAttemptCurrent()) return;
      // Provider exceptions may include account details or server traces.
      setError("Export could not be completed. Try again.");
    } finally {
      exportAttempt.current = null;
      if (isAttemptCurrent()) setBusy(false);
    }
  };

  return <section className="mt-6 rounded-2xl border border-line p-4" aria-label="Account export">
    <h2 className="font-semibold text-ink">Your account data</h2>
    <p className="mt-1 text-sm leading-relaxed text-ink-3">Download your saved comparisons, loan, and feedback as JSON.</p>
    <button type="button" disabled={busy} onClick={() => void download()} className="mt-3 w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink">{busy ? "Preparing export…" : "Download my data"}</button>
    {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
  </section>;
}

export default function AccountPage() {
  const router = useRouter();
  const isCurrentView = useViewLifetime();
  const { viewer, account, ready, signOut, configured, accountKey, authEpoch } = useAuth();
  const { loan, hydrated, clearAll, sync, draftDirty, discardPrivateData } = useLoan();
  const comparisons = useCompare();
  const privateReady = hydrated && comparisons.signOutReady;
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"signout" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const buttonClass = "min-h-11 w-full rounded-lg px-4 py-3 text-sm font-medium text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";

  const confirmAction = async () => {
    if (!confirmation || busy || (viewer === "member" && !privateReady)) return;
    setBusy(true);
    setSignOutError(null);
    try {
      if (confirmation === "delete") {
        const error = privateWriteError(await clearAll());
        if (!isCurrentView()) return;
        if (error) { setSignOutError(error); return; }
        setConfirmation(null);
      } else {
        if (viewer === "member") {
          const comparisonResult = await comparisons.discardPrivateData(true);
          if (!isCurrentView()) return;
          if (comparisonResult.kind === "error") { setSignOutError(comparisonResult.message); return; }
          const result = await discardPrivateData(true);
          if (!isCurrentView()) return;
          const error = result.kind === "storage-unavailable"
            ? "This browser could not clear your private loan copy. Stay on this page and try again."
            : privateWriteError(result);
          if (error) { setSignOutError(error); return; }
        }
        await signOut();
        if (isCurrentView()) router.replace("/");
      }
    } catch {
      setSignOutError(confirmation === "signout"
        ? "Sign out could not be completed. Local private data may already be cleared. Try again."
        : "The deletion could not be queued. Try again.");
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (ready && viewer === "anonymous") router.replace("/");
  }, [ready, viewer, router]);

  const rows: [string, string][] =
    viewer === "member"
      ? [
          ["Signed in as", account?.phone ?? account?.email ?? "—"],
          ["Current loan", loan ? `${loan.lender || "Home loan"}` : "None shown"],
        ]
      : [
          ["Standing", "Guest"],
          ["Available", "Compare Loan Offers only"],
        ];

  return (
    <Screen>
      <AppBar back={{ href: "/home" }} title="Account" />
      <Page>
        <dl className="mt-2 overflow-hidden rounded-2xl border border-line">
          {rows.map(([k, v]) => (
            <div
              key={k}
              className="border-b border-line px-4 py-3.5 text-[13.5px] last:border-b-0"
            >
              <dt className="text-ink-3">{k}</dt>
              <dd className="mt-1 font-medium text-ink [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
        {viewer === "member" ? <LoanSyncStatus /> : null}
        {viewer === "member" ? <LegacyDeviceLoanAdoption /> : null}
        {viewer === "member" ? <AnalyticsConsent /> : null}
        {viewer === "member" && configured ? <AccountExportAction key={`${accountKey ?? "none"}:${authEpoch}`} /> : null}
        <AccountDeletionPanel />

        <div className="mt-6 flex flex-col gap-2.5">
          {viewer === "member" ? <Link href="/comparisons" className={buttonClass}>Saved comparisons</Link> : null}
          {viewer === "guest" ? (
            <button
              type="button"
              onClick={() => router.push("/signin")}
              className="w-full rounded-2xl bg-accent px-4 py-4 text-[15px] font-semibold text-accent-ink"
            >
              Create an account
            </button>
          ) : null}

          {loan ? (
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => { setSignOutError(null); setConfirmation("delete"); }}
            >
              Delete my loan record
            </button>
          ) : null}

          <button
            type="button"
            disabled={busy || (viewer === "member" && !privateReady)}
            className={buttonClass}
            onClick={() => { setSignOutError(null); setConfirmation("signout"); }}
          >
            {viewer === "member" ? "Sign out" : "Leave guest mode"}
          </button>
          {confirmation ? (
            <section aria-label={confirmation === "signout" ? "Confirm sign out" : "Confirm loan deletion"} className="rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2">
              <h2 className="font-semibold text-ink">{confirmation === "delete" ? "Delete your loan?" : "Sign out of this account?"}</h2>
              <p className="mt-2">
                {confirmation === "delete"
                  ? "This queues a deletion of your saved loan and transfer quote. Check the save status for confirmation from your account."
                  : viewer === "member"
                    ? `Signing out clears this browser’s private loan copy, comparisons, queued changes and unsaved edits. ${sync.pendingCount || draftDirty || comparisons.pendingCount ? "You have pending work that will be discarded. " : ""}Changes already received by your account remain there.`
                    : "You can return to guest mode from the welcome screen."}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <button type="button" disabled={busy} className={buttonClass} onClick={() => setConfirmation(null)}>{confirmation === "signout" ? "Stay signed in" : "Keep my loan"}</button>
                <button type="button" disabled={busy || (viewer === "member" && !privateReady)} className={`${buttonClass} text-danger`} onClick={() => void confirmAction()}>{busy ? "Working…" : confirmation === "delete" ? "Confirm loan deletion" : "Confirm sign out"}</button>
              </div>
            </section>
          ) : null}
          <FormError>{signOutError}</FormError>
        </div>

        <p className="mt-6 text-[11.5px] leading-relaxed text-ink-3">
          Your account stores loan details and any transfer quote you save.
          Pending changes stay in this browser until syncing succeeds. TrueCost
          does not connect to your lender or run a credit check.
        </p>
      </Page>
    </Screen>
  );
}
