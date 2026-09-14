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
  const { sendCode, configured, viewer, ready } = useAuth();

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
    const q = new URLSearchParams({
      kind: parsed.id.kind,
      value: parsed.id.value,
      next,
    });
    router.push(`/verify?${q.toString()}`);
  };

  return (
    <Screen>
      <AppBar back={{ href: "/" }} title="Sign in" />
      <Page>
        <h2 className="mt-4 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">
          Your mobile or email
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          We send a six-digit code. No password to remember.
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
            inputMode="email"
            autoComplete="username"
            aria-label="Mobile number or email"
            placeholder="98765 43210"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setError(null);
            }}
            className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-4 text-[17px] font-medium text-ink outline-none transition placeholder:font-normal placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/25"
          />

          <FormError>{error}</FormError>

          {!configured ? (
            <div className="rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-warn">
              Sign-in isn&apos;t connected yet. The comparison still works —
              <a href="/home" className="ml-1 underline">
                carry on as a guest
              </a>
              .
            </div>
          ) : null}

          <PrimaryButton type="submit" busy={busy} disabled={!configured}>
            Send code
          </PrimaryButton>
        </form>

        <div className="mt-5">
          <Hint>
            An account exists so your loan can follow you to a new phone. We keep
            your balance and rate, and nothing else.
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
