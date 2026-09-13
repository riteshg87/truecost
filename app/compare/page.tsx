"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { OfferGrid } from "@/components/OfferGrid";
import { LOAN_TYPES, LOAN_TYPE_ORDER } from "@/lib/finance/loanTypes";
import { allOffersReady, errorsFor } from "@/lib/finance/validate";
import { useCompare } from "@/lib/store";

export default function ComparePage() {
  const router = useRouter();
  const { offers, loanType, setLoanType, addOffer, canAdd, reset, hydrated } =
    useCompare();

  const ready = allOffersReady(offers);
  const missing = offers.reduce((count, offer) => count + errorsFor(offer).length, 0);
  const config = LOAN_TYPES[loanType];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col lg:max-w-3xl">
      {/* Header ------------------------------------------------------------ */}
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="-ml-1 rounded-lg px-1 py-1 text-[14px] font-medium text-ink-3 transition hover:text-ink"
          >
            ← Back
          </Link>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">
            True cost comparison
          </h1>
          <button
            type="button"
            onClick={reset}
            className="-mr-1 rounded-lg px-1 py-1 text-[14px] font-medium text-ink-3 transition hover:text-ink"
          >
            Reset
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 px-5 pb-40 pt-5">
        {/* Product ------------------------------------------------------- */}
        <section>
          <h2 className="mb-2.5 text-[13px] font-medium text-ink-2">
            What are you borrowing for?
          </h2>
          {/* Products that are not built yet stay on screen and grey out. A
              missing chip reads as an oversight; a disabled one reads as a
              roadmap, and says plainly what this tool does and does not cover. */}
          <div className="flex flex-wrap gap-2">
            {LOAN_TYPE_ORDER.map((id) => {
              const selected = id === loanType;
              const available = LOAN_TYPES[id].enabled;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={!available}
                  onClick={() => setLoanType(id)}
                  aria-pressed={selected}
                  title={
                    available
                      ? undefined
                      : `${LOAN_TYPES[id].label}s are not covered yet`
                  }
                  className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                    !available
                      ? "cursor-not-allowed border-dashed border-line bg-transparent text-ink-3 opacity-60"
                      : selected
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-line bg-surface text-ink-2 hover:border-line-strong"
                  }`}
                >
                  {LOAN_TYPES[id].short}
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-[12px] leading-relaxed text-ink-3">
            Home loans only for now — the greyed products are next.{" "}
            {config.prepayNote}
          </p>
        </section>

        {/* Offers ---------------------------------------------------------
            One grid rather than a card each: fields down the left, offers
            across the top, so two rates can be read on one line. */}
        {hydrated ? (
          <OfferGrid />
        ) : (
          <div
            aria-hidden
            className="h-[460px] animate-pulse rounded-2xl border border-line bg-surface-2"
          />
        )}

        {canAdd ? (
          <button
            type="button"
            onClick={addOffer}
            className="rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-4 text-[14px] font-medium text-ink-2 transition hover:border-accent-line hover:text-accent"
          >
            + Add a third offer
          </button>
        ) : (
          <p className="text-center text-[12px] text-ink-3">
            Three offers is the limit — beyond that nobody actually compares, they guess.
          </p>
        )}
      </main>

      {/* CTA ---------------------------------------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/90 backdrop-blur-md">
        <div className="mx-auto w-full max-w-xl px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 lg:max-w-3xl">
          <button
            type="button"
            disabled={!ready}
            onClick={() => router.push("/compare/results")}
            className="w-full rounded-xl bg-accent px-4 py-3.5 text-[15px] font-semibold text-accent-ink transition disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-3"
          >
            {ready ? "See the full breakdown" : `${missing} field${missing === 1 ? "" : "s"} still needed`}
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-3">
            {ready
              ? "Schedule, fee split and what to negotiate."
              : "Ranked on effective APR, not the headline rate."}
          </p>
        </div>
      </div>
    </div>
  );
}
