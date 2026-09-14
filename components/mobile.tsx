"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * The app shell.
 *
 * Phone-first and sparse on purpose. A lending tool earns trust by looking like
 * it knows the one thing you came for, not by explaining itself — so screens
 * carry a title, the figures, and as little prose as the meaning survives.
 */

export function AppBar({
  back,
  title,
  action,
}: {
  back?: { href: string; label?: string };
  title?: string;
  action?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[560px] items-center justify-between gap-3 px-4 lg:max-w-[1080px]">
        <div className="flex min-w-0 items-center gap-2">
          {back ? (
            <Link
              href={back.href}
              aria-label={back.label ?? "Back"}
              className="-ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-2 transition hover:bg-surface-2 hover:text-ink"
            >
              <span aria-hidden className="text-[17px] leading-none">←</span>
            </Link>
          ) : null}
          {title ? (
            <h1 className="truncate text-[16px] font-semibold tracking-tight text-ink">
              {title}
            </h1>
          ) : (
            <Wordmark />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function Wordmark({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span
      className={`inline-flex items-center gap-2 font-semibold tracking-tight text-ink ${
        size === "lg" ? "text-[19px]" : "text-[16px]"
      }`}
    >
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-[7px] bg-accent font-bold text-accent-ink ${
          size === "lg" ? "h-7 w-7 text-[13px]" : "h-6 w-6 text-[11px]"
        }`}
      >
        ₹
      </span>
      TrueCost
    </span>
  );
}

/** A phone-width column. Widens on a desktop rather than stranding itself. */
export function Page({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main
      className={`mx-auto w-full flex-1 px-4 pb-14 pt-4 ${
        wide ? "max-w-[560px] lg:max-w-[1080px]" : "max-w-[560px]"
      }`}
    >
      {children}
    </main>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}

/** The primary action. One per screen, full width, thumb-reachable. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
  busy,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  busy?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className="w-full rounded-2xl bg-accent px-4 py-4 text-[15px] font-semibold text-accent-ink transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-3"
    >
      {busy ? "…" : children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-line px-4 py-3.5 text-[14.5px] font-medium text-ink transition hover:border-line-strong active:scale-[0.99]"
    >
      {children}
    </button>
  );
}

/** Errors go where the eye already is, not in a toast that vanishes. */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-danger"
    >
      {children}
    </p>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] leading-relaxed text-ink-3">{children}</p>;
}
