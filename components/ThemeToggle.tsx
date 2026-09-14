"use client";

import { useCallback, useEffect, useState } from "react";
import {
  THEME_COLOR,
  THEME_KEY,
  attributeFor,
  isThemeMode,
  labelFor,
  nextMode,
  resolveMode,
  type ThemeMode,
} from "@/lib/theme";

/**
 * The appearance control.
 *
 * One button that cycles, rather than three that sit there — appearance is set
 * once and forgotten, and a segmented control would take header room from
 * things people actually operate. The icon shows the state it is in, and the
 * label says so for anyone who cannot see the icon.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_KEY);
    } catch {
      // Private mode. The control still works for this session.
    }
    if (isThemeMode(stored)) setMode(stored);
    setMounted(true);
  }, []);

  const apply = useCallback((next: ThemeMode) => {
    const attr = attributeFor(next);
    const root = document.documentElement;
    if (attr) root.setAttribute("data-theme", attr);
    else root.removeAttribute("data-theme");

    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute("content", THEME_COLOR[resolveMode(next, prefersDark)]);

    try {
      if (next === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Nothing to persist to; the attribute is already applied.
    }
  }, []);

  // While on "system", follow the OS if it changes under us rather than
  // holding whatever it happened to be when the page opened.
  useEffect(() => {
    if (!mounted || mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mounted, mode, apply]);

  const cycle = () => {
    const next = nextMode(mode);
    setMode(next);
    apply(next);
  };

  // Render a stable placeholder until mounted: the server cannot know the
  // stored choice, and guessing produces a hydration mismatch.
  const icon = !mounted ? "◐" : mode === "light" ? "☀" : mode === "dark" ? "☾" : "◐";

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Appearance: ${labelFor(mode)}. Switch to ${labelFor(nextMode(mode))}.`}
      title={`Appearance: ${labelFor(mode)}`}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[15px] leading-none text-ink-3 transition hover:bg-surface-2 hover:text-ink ${className}`}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}
