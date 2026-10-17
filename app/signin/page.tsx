"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  AppBar,
  FormError,
  Hint,
  Page,
  PrimaryButton,
  Screen,
} from "@/components/mobile";
import { useAuth } from "@/lib/auth/provider";
import { safeNext } from "@/lib/auth/access";
import { parseIdentifier } from "@/lib/auth/identifier";

/**
 * One field for both.
 *
 * Asking someone to choose "email or mobile" before typing is a tap that earns
 * nothing — what they type already says which it is. Register and sign in are
 * the same door too: a first code creates the account, a later one opens it.
 */
function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { sendCode, demoMode, viewer, ready } = useAuth();

  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (ready && viewer === "member") router.replace(next);
  }, [ready, viewer, router, next]);

  const submit = async () => {
    setError(null);
    const parsed = parseIdentifier(raw);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }

    setBusy(true);
    const result = await sendCode(parsed.id);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Could not send the code.");
      return;
    }
    const q = new URLSearchParams({ value: parsed.id.value, next });
    router.push(`/verify?${q.toString()}`);
  };

  return (
    <Screen>
      <AppBar back={{ href: "/" }} title="Sign in" />
      <Page>
        <h2 className="mt-4 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">
          Your email
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          A six-digit code, no password to remember.
        </p>

        <form
          className="mt-7 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-label="Email address"
            placeholder="you@example.com"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setError(null);
            }}
            className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-4 text-[17px] font-medium text-ink outline-none transition placeholder:font-normal placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/25"
          />

          <FormError>{error}</FormError>

          {demoMode ? (
            <div className="rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-warn">
              <span className="font-semibold">Demo sign-in.</span> No email is sent
              yet — the code appears on the next screen. Any address works.
            </div>
          ) : null}

          <PrimaryButton type="submit" busy={busy}>
            {demoMode ? "Get a code" : "Send code"}
          </PrimaryButton>
        </form>

        <div className="mt-5">
          <Hint>
            An account is what lets the Loan Health Monitor save your loan. The
            comparison needs no account —{" "}
            <a href="/home" className="underline">
              carry on as a guest
            </a>{" "}
            for that.
          </Hint>
        </div>
      </Page>
    </Screen>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<Screen><AppBar back={{ href: "/" }} title="Sign in" /></Screen>}>
      <SignInForm />
    </Suspense>
  );
}
