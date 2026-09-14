"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Shared furniture for the loan health screens.
 *
 * Kept in the app's own tokens rather than the darker palette the design was
 * drawn in: Flow 1 and Flow 2 are one product on one URL, and two type systems
 * in one app reads as two products stitched together. The design's teal and
 * ochre are what these tokens already resolve to in dark mode.
 */

export function Screen({
  back,
  title,
  eyebrow,
  children,
}: {
  back?: { href: string; label: string };
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col lg:max-w-[1080px]">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={back?.href ?? "/home"}
            className="-ml-1 rounded-lg px-1 py-1 text-[14px] font-medium text-ink-3 transition hover:text-ink"
          >
            ← {back?.label ?? "Home"}
          </Link>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h1>
          <div className="flex items-center justify-end gap-1">
            {eyebrow ? <span className="hidden text-[12px] text-ink-3 sm:inline">{eyebrow}</span> : null}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex-1 px-5 pb-16 pt-4">{children}</main>
    </div>
  );
}

export function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[24px] font-semibold leading-tight tracking-tight text-ink">
        {title}
      </h2>
      {sub ? (
        <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed text-ink-2">{sub}</p>
      ) : null}
    </div>
  );
}

type Tone = "good" | "warn" | "neutral";

const TONE: Record<Tone, { box: string; tag: string; pip: string; cta: string }> = {
  good: {
    box: "border-accent-line bg-accent-soft",
    tag: "text-accent",
    pip: "bg-accent",
    cta: "text-accent",
  },
  warn: {
    box: "border-warn-line bg-warn-soft",
    tag: "text-warn",
    pip: "bg-warn",
    cta: "text-warn",
  },
  neutral: {
    box: "border-line bg-surface-2",
    tag: "text-ink-3",
    pip: "bg-ink-3",
    cta: "text-ink",
  },
};

/** The card that carries a verdict. Tone is the loudest thing about it. */
export function Verdict({
  tone,
  label,
  title,
  children,
  caveat,
  action,
}: {
  tone: Tone;
  label: string;
  title: string;
  children?: ReactNode;
  caveat?: ReactNode;
  action?: { href: string; label: string };
}) {
  const t = TONE[tone];
  return (
    <section className={`rounded-2xl border px-5 py-5 ${t.box}`}>
      <p className={`flex items-center gap-2 text-[11.5px] font-semibold ${t.tag}`}>
        <span aria-hidden className={`h-[7px] w-[7px] shrink-0 rounded-full ${t.pip}`} />
        {label}
      </p>
      <h3 className="mt-2.5 text-[21px] font-semibold leading-tight tracking-tight text-ink">
        {title}
      </h3>
      {children ? (
        <div className="mt-2 flex flex-col gap-2 text-[13.5px] leading-relaxed text-ink-2">
          {children}
        </div>
      ) : null}
      {caveat ? (
        <p className="mt-3 border-t border-line/70 pt-3 text-[12.5px] leading-relaxed text-ink-3">
          {caveat}
        </p>
      ) : null}
      {action ? (
        <Link
          href={action.href}
          className={`mt-3.5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold transition hover:gap-2.5 ${t.cta}`}
        >
          {action.label} <span aria-hidden>→</span>
        </Link>
      ) : null}
    </section>
  );
}

export function Card({
  label,
  title,
  children,
  action,
}: {
  label: string;
  title: string;
  children?: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface px-5 py-5 shadow-[var(--shadow-card)]">
      <p className="flex items-center gap-2 text-[12px] text-ink-3">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-3" />
        {label}
      </p>
      <h3 className="mt-2 text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
      {children ? (
        <div className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{children}</div>
      ) : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent transition hover:gap-2.5"
        >
          {action.label} <span aria-hidden>→</span>
        </Link>
      ) : null}
    </section>
  );
}

/** The transparent working. Every row is a figure the user can check. */
export function Ledger({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      {rows.map((row) => (
        <div
          key={row.k}
          className={`flex items-baseline justify-between gap-4 border-b border-line px-3.5 py-2.5 text-[13px] last:border-b-0 ${
            row.tone === "warn" ? "bg-warn-soft" : ""
          }`}
        >
          <span className="text-ink-2">{row.k}</span>
          <span
            className={`tnum shrink-0 font-semibold ${
              row.tone === "warn"
                ? "text-warn"
                : row.tone === "good"
                  ? "text-accent"
                  : "text-ink"
            }`}
          >
            {row.v}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface LedgerRow {
  k: string;
  v: string;
  tone?: Tone;
}

export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="my-4 flex flex-col gap-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-[13px] leading-relaxed text-ink-2">
          <span className="tnum mt-[1px] grid h-[19px] w-[19px] shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-[11px] font-semibold text-ink">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function Disclosure({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[12px] leading-relaxed text-ink-3">
      {children}
    </p>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2.5 border-t border-line py-3 text-[12.5px] leading-relaxed text-ink-2">
      <span aria-hidden className="shrink-0 font-semibold text-accent">
        →
      </span>
      <span>{children}</span>
    </p>
  );
}

/** Shown when someone reaches a health screen with no loan saved. */
export function NoLoan() {
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-8 text-center">
      <p className="text-[15px] font-semibold text-ink">No loan saved yet</p>
      <p className="mx-auto mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-ink-2">
        Tell us your balance, rate and remaining term once. It stays on this
        device and greets you next time.
      </p>
      <Link
        href="/loan/setup"
        className="mt-4 inline-block rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-accent-ink"
      >
        Set up your loan
      </Link>
    </div>
  );
}
