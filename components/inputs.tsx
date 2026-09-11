"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { groupDigits, parseNumber } from "@/lib/finance/format";

/* -------------------------------------------------------------------------- */
/* Field shell                                                                */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  required,
  hint,
  issue,
  issueLevel = "nudge",
  htmlFor,
  children,
  action,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  issue?: string | null;
  issueLevel?: "error" | "nudge";
  htmlFor?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={htmlFor}
          className="text-[13px] font-medium leading-tight text-ink-2"
        >
          {label}
          {required ? <span className="ml-1 text-ink-3">*</span> : null}
        </label>
        {action}
      </div>
      {children}
      {issue ? (
        <p
          className={`text-[12px] leading-snug ${
            issueLevel === "error" ? "text-danger" : "text-warn"
          }`}
        >
          {issue}
        </p>
      ) : hint ? (
        <p className="text-[12px] leading-snug text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border bg-surface-2 px-3.5 py-3 text-[16px] font-medium text-ink " +
  "placeholder:font-normal placeholder:text-ink-3 outline-none transition " +
  "focus:border-accent focus:ring-2 focus:ring-accent/25";

function borderFor(invalid?: boolean) {
  return invalid ? "border-danger/60" : "border-line";
}

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

export function MoneyInput({
  value,
  onChange,
  placeholder,
  id,
  invalid,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() => (value ? groupDigits(String(value)) : ""));
  const [focused, setFocused] = useState(false);

  // Reflect external changes (reset, loan-type switch) only while idle, so we
  // never fight the user's cursor mid-typing.
  useEffect(() => {
    if (!focused) setText(value ? groupDigits(String(value)) : "");
  }, [value, focused]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px] font-medium text-ink-3">
        ₹
      </span>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="numeric"
        autoComplete="off"
        className={`${inputBase} ${borderFor(invalid)} pl-8 tnum`}
        placeholder={placeholder}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(value ? groupDigits(String(value)) : "");
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setText(groupDigits(raw));
          onChange(parseNumber(raw));
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Decimals (rates, percentages, tenure)                                      */
/* -------------------------------------------------------------------------- */

export function DecimalInput({
  value,
  onChange,
  placeholder,
  suffix,
  id,
  invalid,
  ariaLabel,
  maxDecimals = 2,
}: {
  value: number;
  onChange: (next: number) => void;
  placeholder?: string;
  suffix?: string;
  id?: string;
  invalid?: boolean;
  ariaLabel?: string;
  maxDecimals?: number;
}) {
  const [text, setText] = useState(() => (value ? String(value) : ""));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value ? String(value) : "");
  }, [value, focused]);

  return (
    <div className="relative">
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        autoComplete="off"
        className={`${inputBase} ${borderFor(invalid)} ${suffix ? "pr-12" : ""} tnum`}
        placeholder={placeholder}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(value ? String(value) : "");
        }}
        onChange={(event) => {
          const cleaned = event.target.value
            .replace(/[^0-9.]/g, "")
            .replace(/(\..*)\./g, "$1");
          const [whole, decimals] = cleaned.split(".");
          const clamped =
            decimals === undefined
              ? whole
              : `${whole}.${decimals.slice(0, maxDecimals)}`;
          setText(clamped);
          onChange(parseNumber(clamped));
        }}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] font-medium text-ink-3">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="text"
      autoComplete="off"
      className={`${inputBase} ${borderFor(false)}`}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                          */
/* -------------------------------------------------------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "md",
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  const groupId = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex w-full rounded-xl border border-line bg-surface-inset p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={`${groupId}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-lg font-medium transition ${
              size === "sm" ? "px-2.5 py-1.5 text-[13px]" : "px-3 py-2 text-[14px]"
            } ${
              selected
                ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Notices                                                                    */
/* -------------------------------------------------------------------------- */

export function Notice({
  level = "info",
  title,
  children,
}: {
  level?: "info" | "caution";
  title?: string;
  children: ReactNode;
}) {
  const caution = level === "caution";
  return (
    <div
      className={`rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${
        caution
          ? "border-warn-line bg-warn-soft text-warn"
          : "border-accent-line bg-accent-soft text-accent"
      }`}
    >
      {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
      <div className={caution ? "text-warn/90" : "text-accent/90"}>{children}</div>
    </div>
  );
}
