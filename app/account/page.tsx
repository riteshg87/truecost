"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppBar, GhostButton, Page, Screen } from "@/components/mobile";
import { useAuth } from "@/lib/auth/provider";
import { useLoan } from "@/lib/loanStore";

export default function AccountPage() {
  const router = useRouter();
  const { viewer, account, ready, signOut } = useAuth();
  const { loan, clearAll } = useLoan();

  useEffect(() => {
    if (ready && viewer === "anonymous") router.replace("/");
  }, [ready, viewer, router]);

  const rows: [string, string][] =
    viewer === "member"
      ? [
          ["Signed in as", account?.phone ?? account?.email ?? "—"],
          ["Loan saved", loan ? `${loan.lender || "Home loan"}` : "None yet"],
        ]
      : [
          ["Standing", "Guest"],
          ["Available", "Compare offers only"],
        ];

  return (
    <Screen>
      <AppBar back={{ href: "/home" }} title="Account" />
      <Page>
        <dl className="mt-2 overflow-hidden rounded-2xl border border-line">
          {rows.map(([k, v]) => (
            <div
              key={k}
              className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3.5 text-[13.5px] last:border-b-0"
            >
              <dt className="text-ink-3">{k}</dt>
              <dd className="truncate font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-col gap-2.5">
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
            <GhostButton
              onClick={() => {
                clearAll();
                router.push("/home");
              }}
            >
              Delete my loan record
            </GhostButton>
          ) : null}

          <GhostButton
            onClick={() => {
              void signOut().then(() => router.replace("/"));
            }}
          >
            {viewer === "member" ? "Sign out" : "Leave guest mode"}
          </GhostButton>
        </div>

        <p className="mt-6 text-[11.5px] leading-relaxed text-ink-3">
          Comparison figures stay on this device. A saved loan is stored against
          your account so it survives a new phone — balance, rate and term, and
          nothing else. No lender connection, no statements, no credit checks.
        </p>
      </Page>
    </Screen>
  );
}
