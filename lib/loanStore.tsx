"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LoanRecord, TransferQuote } from "./health/types";

/**
 * The loan record, held on the device.
 *
 * Flow 1 keeps a comparison you are making; this keeps the loan you already
 * have, which is a longer-lived thing. It is the reason a returning user lands
 * on a verdict rather than an empty form, and the reason the prepay screen
 * already knows the balance, rate and term.
 *
 * Deliberately localStorage and nothing else. The moment this needs a server to
 * be useful, the promise on the front page stops being true.
 */

const STORAGE_KEY = "truecost.loan.v1";

export interface LoanState {
  loan: LoanRecord | null;
  quote: TransferQuote;
  surplus: number;
  bufferMonths: number;
  /** Set when the user confirms their statement already shows the right rate. */
  rateResolvedAt: string | null;
}

export function blankLoan(): LoanRecord {
  return {
    lender: "",
    original: 0,
    outstanding: 0,
    ratePct: 0,
    basis: "repo",
    spreadPct: 0,
    cycle: "quarterly",
    lastReset: "",
    monthsLeft: 0,
  };
}

function initialState(): LoanState {
  return {
    loan: null,
    quote: {
      newRatePct: 0,
      feePct: 0.25,
      legalCharges: 5000,
      keepTenure: true,
      newTenureMonths: 240,
    },
    surplus: 0,
    bufferMonths: 0,
    rateResolvedAt: null,
  };
}

interface LoanContextValue extends LoanState {
  hydrated: boolean;
  saveLoan: (loan: LoanRecord) => void;
  setQuote: (patch: Partial<TransferQuote>) => void;
  setSurplus: (v: number) => void;
  setBufferMonths: (v: number) => void;
  markRateResolved: (iso: string) => void;
  clearAll: () => void;
}

const LoanContext = createContext<LoanContextValue | null>(null);

/** Tolerate anything in storage — a stale blob must not white-screen the app. */
function parseStored(raw: string | null): LoanState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LoanState>;
    if (!parsed || typeof parsed !== "object") return null;
    const base = initialState();
    const loan =
      parsed.loan && typeof parsed.loan === "object"
        ? { ...blankLoan(), ...parsed.loan }
        : null;
    return {
      loan,
      quote: { ...base.quote, ...(parsed.quote ?? {}) },
      surplus: typeof parsed.surplus === "number" ? parsed.surplus : 0,
      bufferMonths:
        typeof parsed.bufferMonths === "number" ? parsed.bufferMonths : 0,
      rateResolvedAt:
        typeof parsed.rateResolvedAt === "string" ? parsed.rateResolvedAt : null,
    };
  } catch {
    return null;
  }
}

export function LoanProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoanState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  // Read after mount so the server and first client render always agree.
  useEffect(() => {
    const stored = parseStored(
      typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY),
    );
    if (stored) setState(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private mode or a full quota. The session still works in memory.
    }
  }, [state, hydrated]);

  const saveLoan = useCallback((loan: LoanRecord) => {
    // Any edit to the loan invalidates a previous "my statement is fine".
    setState((prev) => ({ ...prev, loan, rateResolvedAt: null }));
  }, []);

  const setQuote = useCallback((patch: Partial<TransferQuote>) => {
    setState((prev) => ({ ...prev, quote: { ...prev.quote, ...patch } }));
  }, []);

  const setSurplus = useCallback(
    (surplus: number) => setState((prev) => ({ ...prev, surplus })),
    [],
  );
  const setBufferMonths = useCallback(
    (bufferMonths: number) => setState((prev) => ({ ...prev, bufferMonths })),
    [],
  );
  const markRateResolved = useCallback(
    (iso: string) => setState((prev) => ({ ...prev, rateResolvedAt: iso })),
    [],
  );

  const clearAll = useCallback(() => {
    setState(initialState());
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do; the in-memory reset has already happened.
    }
  }, []);

  const value = useMemo<LoanContextValue>(
    () => ({
      ...state,
      hydrated,
      saveLoan,
      setQuote,
      setSurplus,
      setBufferMonths,
      markRateResolved,
      clearAll,
    }),
    [state, hydrated, saveLoan, setQuote, setSurplus, setBufferMonths, markRateResolved, clearAll],
  );

  return <LoanContext.Provider value={value}>{children}</LoanContext.Provider>;
}

export function useLoan(): LoanContextValue {
  const ctx = useContext(LoanContext);
  if (!ctx) throw new Error("useLoan must be used inside LoanProvider");
  return ctx;
}
