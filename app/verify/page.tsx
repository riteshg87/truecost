"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  AppBar,
  FormError,
  Page,
  PrimaryButton,
  Screen,
} from "@/components/mobile";
import { useAuth } from "@/lib/auth/provider";
import { safeNext } from "@/lib/auth/access";
import { isCompleteOtp, maskedDestination, type ParsedIdentifier } from "@/lib/auth/identifier";
import { CancelComparisonSignIn } from "@/components/CancelComparisonSignIn";

const RESEND_SECONDS = 30;

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { verifyCode, sendCode, cancelVerification, pendingEmail, pendingNext, verificationReady, verificationPhase, ready } = useAuth();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(RESEND_SECONDS);
  const submitted = useRef(false);

  // React StrictMode performs a setup-cleanup-setup probe in development.
  // Defer cancellation one microtask so that probe cleanup does not cancel a
  // live request, while a real unmount still invalidates late callbacks.
  const lifecycle = useRef(0);
  useEffect(() => {
    const current = ++lifecycle.current;
    return () => {
      queueMicrotask(() => {
        if (lifecycle.current === current) cancelVerification();
      });
    };
  }, [cancelVerification]);

  const next = safeNext(params.get("next") ?? pendingNext);
  const signInHref = `/signin?next=${encodeURIComponent(next)}`;
  const id: ParsedIdentifier | null = pendingEmail
    ? { kind: "email", value: pendingEmail, display: pendingEmail }
    : null;

  useEffect(() => {
    if (ready && !id) router.replace(signInHref);
  }, [id, router, signInHref, ready]);

  // Keep a short resend pause so an accidental double press does not send
  // another email immediately.
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const submit = async (value: string) => {
    if (!id || submitted.current || busy) return;
    submitted.current = true;
    setBusy(true);
    setError(null);

    const result = await verifyCode(id, value, next);
    setBusy(false);
    submitted.current = false;

    if (!result.ok) {
      setError(result.error ?? "That code didn't work.");
      setCode("");
      return;
    }
  };

  if (!id) return <Screen><Page><p role="status" className="py-6 text-sm text-ink-2">Loading sign-in…</p></Page></Screen>;

  if (!verificationReady) {
    return (
      <Screen>
        <AppBar back={{ href: signInHref }} title="Enter code" />
        <Page>
          <h2 className="mt-4 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">
            Verification needs a restart
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
            This tab no longer has the active verification request. Start again to request a fresh code.
          </p>
          <PrimaryButton disabled={!ready} onClick={() => router.replace(signInHref)}>
            Start again
          </PrimaryButton>
          <CancelComparisonSignIn next={next} />
        </Page>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar back={{ href: signInHref }} title="Enter code" />
      <Page>
        <h2 className="mt-4 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">
          Six digits
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Sent to <span className="font-medium text-ink">{maskedDestination(id)}</span>
        </p>

        <div id="clerk-captcha" aria-label="Security check" />

        <form
          className="mt-7 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code);
          }}
        >
          <label htmlFor="signin-code" className="text-[13px] font-medium text-ink-2">
            Six digit code
          </label>
          <input
            id="signin-code"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            aria-label="Six digit code"
            placeholder="000000"
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              setError(null);
              // Submitting on the sixth digit saves a tap, and the OS can paste
              // the complete email code in one go.
              if (isCompleteOtp(v)) void submit(v);
            }}
            className="tnum w-full rounded-2xl border border-line bg-surface-2 px-4 py-4 text-center text-[30px] font-semibold tracking-[0.35em] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/25"
          />

          <FormError>{error}</FormError>

          <PrimaryButton type="submit" busy={busy || verificationPhase === "sending" || verificationPhase === "verifying"} disabled={!isCompleteOtp(code)}>
            Verify
          </PrimaryButton>
        </form>
        <CancelComparisonSignIn next={next} />

        <div className="mt-5 text-center">
          {left > 0 ? (
            <p className="tnum text-[13px] text-ink-3">Resend in {left}s</p>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (busy) return;
                setBusy(true);
                setLeft(RESEND_SECONDS);
                setError(null);
                void sendCode(id, next).then((result) => {
                  if (!result.ok) {
                    setLeft(0);
                    setError(result.error ?? "Could not send a new code.");
                  }
                }).finally(() => setBusy(false));
              }}
              className="text-[13.5px] font-semibold text-accent"
            >
              Send a new code
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            cancelVerification();
            router.replace(`/signin?next=${encodeURIComponent(next)}`);
          }}
          className="mt-5 min-h-11 w-full text-[13.5px] font-semibold text-accent"
        >
          Change email
        </button>
      </Page>
    </Screen>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<Screen><AppBar back={{ href: "/signin" }} title="Enter code" /></Screen>}>
      <VerifyForm />
    </Suspense>
  );
}
