"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppBar, Page, Screen } from "@/components/mobile";
import { FEATURES, canOpen, lockReason } from "@/lib/auth/access";
import { useAuth } from "@/lib/auth/provider";

/**
 * The feature list.
 *
 * Where everyone lands, signed in or not. A locked card stays on screen and
 * says why it is locked — hiding it would leave a guest with no idea the app
 * does more, and no reason to make an account.
 */
export default function HomePage() {
  const router = useRouter();
  const { viewer, ready, account, gating } = useAuth();

  useEffect(() => {
    if (ready && viewer === "anonymous") router.replace("/");
  }, [ready, viewer, router]);

  if (!ready || viewer === "anonymous") {
    return (
      <Screen>
        <AppBar />
        <Page>
          <div className="h-56 animate-pulse rounded-2xl border border-line bg-surface-2" />
        </Page>
      </Screen>
    );
  }

  const who =
    viewer === "member" ? account?.phone ?? account?.email ?? "Signed in" : "Guest";
  const optionalSignIn = gating === "open";

  return (
    <Screen>
      <AppBar
        action={
          <Link
            href="/account"
            aria-label="Account"
            className="grid h-8 w-8 place-items-center rounded-full border border-line text-[12px] font-semibold text-ink-2 transition hover:border-line-strong hover:text-ink"
          >
            {viewer === "member" ? "●" : "○"}
          </Link>
        }
      />
      <Page wide>
        <p className="text-[12.5px] text-ink-3">{who}</p>
        <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">
          What do you need?
        </h2>

        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          {FEATURES.map((feature) => {
            const open = canOpen(viewer, feature, gating);
            const reason = lockReason(viewer, feature, gating);
            const href = open
              ? feature.href
              : feature.available
                ? `/signin?next=${encodeURIComponent(feature.href)}`
                : "#";

            const card = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[17px] font-semibold tracking-tight text-ink">
                    {feature.name}
                  </h3>
                  {reason ? (
                    <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[10.5px] font-medium text-ink-3">
                      {reason}
                    </span>
                  ) : (
                    <span aria-hidden className="shrink-0 text-[17px] text-accent">
                      →
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2">
                  {feature.tagline}
                </p>
              </>
            );

            const base =
              "block rounded-2xl border px-5 py-5 transition shadow-[var(--shadow-card)]";

            if (!feature.available) {
              return (
                <div
                  key={feature.id}
                  aria-disabled
                  className={`${base} border-dashed border-line bg-surface-2 opacity-65`}
                >
                  {card}
                </div>
              );
            }

            return (
              <Link
                key={feature.id}
                href={href}
                className={`${base} border-line bg-surface hover:border-accent-line hover:shadow-[var(--shadow-lift)] active:scale-[0.995]`}
              >
                {card}
              </Link>
            );
          })}
        </div>

        {viewer === "guest" && !optionalSignIn ? (
          <div className="mt-6 rounded-2xl border border-accent-line bg-accent-soft px-5 py-4">
            <p className="text-[13.5px] font-semibold text-ink">Saving a loan needs an account</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              So it is still there on your next phone, and so we can tell you when
              your rate should have moved.
            </p>
            <Link
              href="/signin"
              className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-accent"
            >
              Create one <span aria-hidden>→</span>
            </Link>
          </div>
        ) : null}

        {optionalSignIn ? (
          <p className="mt-6 text-[11.5px] leading-relaxed text-ink-3">
            Everything is open while this is in testing. Your loan is saved on this
            device — accounts, and carrying it to a new phone, come later.
          </p>
        ) : null}
      </Page>
    </Screen>
  );
}
