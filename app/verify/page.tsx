"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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

const RESEND_SECONDS = 30;

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { verifyCode, sendCode } = useAuth();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(RESEND_SECONDS);
  const submitted = useRef(false);

  const next = safeNext(params.get("next"));
  const id = useMemo<ParsedIdentifier | null>(() => {
    const kind = params.get("kind");
    const value = params.get("value");
    if ((kind !== "email" && kind !== "phone") || !value) return null;
    return { kind, value, display: value };
  }, [params]);

  useEffect(() => {
    if (!id) router.replace("/signin");
  }, [id, router]);

  // A resend that is available instantly invites people to spam it, and every
  // press costs an SMS.
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const submit = async (value: string) => {
    if (!id || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(null);

    const result = await verifyCode(id, value);
    setBusy(false);
    submitted.current = false;

    if (!result.ok) {
      setError(result.error ?? "That code didn't work.");
      setCode("");
      return;
    }
    router.replace(next);
  };

  if (!id) return null;

  return (
    <Screen>
      <AppBar back={{ href: "/signin" }} title="Enter code" />
      <Page>
        <h2 className="mt-4 text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink">
          Six digits
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Sent to <span className="tnum font-medium text-ink">{maskedDestination(id)}</span>
        </p>

        <form
          className="mt-7 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code);
          }}
        >
          <input
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
              // Submitting on the sixth digit saves a tap, and the OS pastes
              // the whole code from the SMS in one go anyway.
              if (isCompleteOtp(v)) void submit(v);
            }}
            className="tnum w-full rounded-2xl border border-line bg-surface-2 px-4 py-4 text-center text-[30px] font-semibold tracking-[0.35em] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/25"
          />

          <FormError>{error}</FormError>

          <PrimaryButton type="submit" busy={busy} disabled={!isCompleteOtp(code)}>
            Verify
          </PrimaryButton>
        </form>

        <div className="mt-5 text-center">
          {left > 0 ? (
            <p className="tnum text-[13px] text-ink-3">Resend in {left}s</p>
          ) : (
            <button
              type="button"
              onClick={() => {
                setLeft(RESEND_SECONDS);
                setError(null);
                void sendCode(id);
              }}
              className="text-[13.5px] font-semibold text-accent"
            >
              Send a new code
            </button>
          )}
        </div>
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
