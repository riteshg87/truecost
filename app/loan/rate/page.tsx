"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  Disclosure,
  Ledger,
  NoLoan,
  PageHead,
  Screen,
  Steps,
  type LedgerRow,
} from "@/components/health";
import { formatINR, formatPct } from "@/lib/finance/format";
import { rateVerdict } from "@/lib/health/analyse";
import { isoToday } from "@/lib/health/repo";
import { useLoan } from "@/lib/loanStore";

/**
 * The verdict with its working shown.
 *
 * Everything on this screen is either a figure the user typed or the published
 * repo rate, and it is laid out so each line can be checked independently. The
 * claim never hardens beyond "this is worth verifying" — we cannot see what the
 * lender actually applied, and a tool that accuses a bank on incomplete
 * evidence would deserve to be ignored.
 */
export default function RateResetPage() {
  const router = useRouter();
  const { loan, hydrated, markRateResolved, rateResolvedAt } = useLoan();
  const today = isoToday();

  const verdict = useMemo(() => (loan ? rateVerdict(loan, today) : null), [loan, today]);

  if (!hydrated) {
    return (
      <Screen back={{ href: "/loan", label: "Loan health" }} title="Rate check">
        <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface-2" />
      </Screen>
    );
  }
  if (!loan || !verdict) {
    return (
      <Screen back={{ href: "/loan", label: "Loan health" }} title="Rate check">
        <NoLoan />
      </Screen>
    );
  }

  /* ---- MCLR: a conversion, not a reset ---------------------------------- */
  if (verdict.kind === "mclr") {
    return (
      <Screen back={{ href: "/loan", label: "Loan health" }} title="Rate basis">
        <PageHead
          title="Moving off MCLR"
          sub="A conversion inside your own bank, not a transfer to another one."
        />
        <Steps
          items={[
            "Ask your lender for their current external-benchmark rate, and the spread they would set for your profile.",
            <>
              Compare it with the {formatPct(loan.ratePct)} you pay now. A conversion
              usually costs a small administrative fee, sometimes nothing at all.
            </>,
            "Get the new spread in writing before you agree. The spread is fixed for the life of the loan — the benchmark is the only part that moves afterwards.",
            "If their offer is poor, that is the moment to price a transfer elsewhere. You now have a number to beat.",
          ]}
        />
        <Disclosure>
          MCLR loans re-price on the bank&apos;s own reset schedule, which is why rate
          cuts reach them late. Since October 2019 new floating retail loans must be
          tied to an external benchmark, but older loans were not converted
          automatically — so a good many people are still on MCLR without having
          chosen to be.
        </Disclosure>
        <Link
          href="/loan/transfer"
          className="mt-4 block w-full rounded-xl border border-line px-4 py-3 text-center text-[14px] font-medium text-ink transition hover:border-accent-line hover:text-accent"
        >
          Price a transfer instead →
        </Link>
      </Screen>
    );
  }

  /* ---- Fixed: nothing to reset ------------------------------------------ */
  if (verdict.kind === "fixed" || verdict.kind === "unknown") {
    return (
      <Screen back={{ href: "/loan", label: "Loan health" }} title="Rate check">
        <PageHead
          title={verdict.kind === "fixed" ? "Fixed rate" : "Benchmark not tracked"}
          sub={
            verdict.kind === "fixed"
              ? "Nothing to reset — but the exit is where it costs you."
              : "We would rather say so than guess."
          }
        />
        <Disclosure>
          {verdict.kind === "fixed" ? (
            <>
              RBI bars foreclosure and part-payment charges on floating-rate home loans
              to individual borrowers. Fixed-rate loans sit outside that protection and
              typically cost 2–4% of the outstanding to close early. Your EMI is
              certain; your exit is not free.
            </>
          ) : (
            <>
              T-bill linked loans follow a benchmark whose history we do not carry, so
              we will not invent a figure for what your rate ought to be. Check the
              published yield on your reset date against your sanction letter&apos;s
              spread.
            </>
          )}
        </Disclosure>
      </Screen>
    );
  }

  /* ---- Repo-linked: the ledger ------------------------------------------ */
  const stale = verdict.kind === "stale" && rateResolvedAt === null;
  const rows: LedgerRow[] = [
    { k: `Repo at your last reset · ${longDate(loan.lastReset)}`, v: formatPct(verdict.repoThen ?? 0) },
    { k: "Repo today", v: formatPct(verdict.repoNow ?? 0) },
    { k: "Your spread", v: formatPct(loan.spreadPct) },
    { k: "Your rate should be", v: formatPct(verdict.shouldBePct ?? 0), tone: "good" },
    { k: "You're paying", v: formatPct(loan.ratePct), tone: stale ? "warn" : undefined },
  ];

  return (
    <Screen back={{ href: "/loan", label: "Loan health" }} title="Rate check">
      <PageHead
        title={stale ? "Getting your rate reset" : "Your rate, checked"}
        sub="Every figure comes from what you entered and the published repo history — nothing hidden, nothing fetched."
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Ledger rows={rows} />

          {stale ? (
            <Ledger
              rows={[
                { k: "Gap", v: formatPct(verdict.gapPct ?? 0), tone: "warn" },
                { k: "Roughly, per month", v: formatINR(verdict.monthlyExcess ?? 0), tone: "warn" },
                { k: "Over a year", v: formatINR((verdict.monthlyExcess ?? 0) * 12), tone: "warn" },
              ]}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {stale ? (
            <>
              <Steps
                items={[
                  "Check your latest statement for the rate actually applied.",
                  <>
                    If it is above {formatPct(verdict.shouldBePct ?? 0)}, a{" "}
                    {loan.cycle === "half" ? "half-yearly" : loan.cycle} reset has not
                    passed the cut through to you.
                  </>,
                  "Write to your lender citing the reset — RBI requires external-benchmark loans to re-price at least once a quarter.",
                  "Keep it in writing. A phone call leaves you nothing to point at if it is not applied.",
                ]}
              />
              <Disclosure>
                This is a prompt to verify, not proof of overcharging. We work only from
                the figures you gave us and the published repo rate — we cannot see your
                account. If your statement already shows{" "}
                {formatPct(verdict.shouldBePct ?? 0)}, mark it resolved and the flag
                clears.
              </Disclosure>
              <button
                type="button"
                onClick={() => {
                  markRateResolved(today);
                  router.push("/loan");
                }}
                className="w-full rounded-xl border border-line px-4 py-3 text-[13.5px] font-medium text-ink transition hover:border-accent-line hover:text-accent"
              >
                My statement already shows {formatPct(verdict.shouldBePct ?? 0)} — mark resolved
              </button>
            </>
          ) : (
            <Disclosure>
              Your rate matches what the benchmark and your spread imply. We will flag it
              again if the repo moves and your rate does not follow within a quarter.
            </Disclosure>
          )}
        </div>
      </div>
    </Screen>
  );
}

function longDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[Number(m) - 1] ?? ""} ${y}`;
}
