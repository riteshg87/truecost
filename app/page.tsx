"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Page, Screen, Wordmark } from "@/components/mobile";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth/provider";

/**
 * The door.
 *
 * Anyone who already has a standing — signed in, or a guest who chose to look
 * around — goes straight past it. Making people re-announce themselves on every
 * launch is the fastest way to make an app feel like paperwork.
 */
export default function Welcome() {
  const router = useRouter();
  const { viewer, ready, continueAsGuest, configured } = useAuth();

  useEffect(() => {
    if (ready && viewer !== "anonymous") router.replace("/home");
  }, [ready, viewer, router]);

  return (
    <Screen>
      <div className="mx-auto flex w-full max-w-[560px] items-center justify-between px-4 pt-4">
        <Wordmark size="lg" />
        <ThemeToggle />
      </div>

      <Page>
        <div className="flex min-h-[72dvh] flex-col justify-between pt-8">
          <div>
            <h1 className="max-w-[16ch] text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] text-ink">
              Know what your loan really costs.
            </h1>
            <p className="mt-4 max-w-[34ch] text-[15.5px] leading-relaxed text-ink-2">
              Effective APR, not the headline rate. Every fee, GST rupee and bundled
              premium counted.
            </p>

            <ul className="mt-8 flex flex-col gap-3.5">
              {[
                ["Compare loan offers", "Rank two or three lenders honestly"],
                ["Watch your rate", "Catch a reset your bank skipped"],
                ["Prepay or invest", "Post-tax, on both sides"],
              ].map(([k, v]) => (
                <li key={k} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  />
                  <span>
                    <span className="block text-[14.5px] font-medium text-ink">{k}</span>
                    <span className="block text-[13px] leading-snug text-ink-3">{v}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-10 flex flex-col gap-2.5">
            {/* While sign-in is optional the working path leads, and the account
                is the quiet option. Putting a half-built door first would make
                the app look shut. */}
            <button
              type="button"
              onClick={() => {
                continueAsGuest();
                router.push("/home");
              }}
              className="w-full rounded-2xl bg-accent px-4 py-4 text-[15px] font-semibold text-accent-ink transition active:scale-[0.99]"
            >
              {configured ? "Look around as a guest" : "Start"}
            </button>

            {configured ? (
              <Link
                href="/signin"
                className="block w-full rounded-2xl border border-line px-4 py-3.5 text-center text-[14.5px] font-medium text-ink transition hover:border-line-strong active:scale-[0.99]"
              >
                Continue with mobile or email
              </Link>
            ) : null}

            <p className="px-2 pt-1 text-center text-[11.5px] leading-relaxed text-ink-3">
              {configured
                ? "Guests get the comparison. Saving a loan needs an account, so it can follow you to your next phone."
                : "No sign-up needed. Everything runs on this device."}
            </p>
          </div>
        </div>
      </Page>
    </Screen>
  );
}
