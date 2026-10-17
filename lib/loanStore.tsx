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
import { useAuth } from "./auth/provider";
import { deleteLoan, newer, pullLoan, pushLoan, stamp, worthSyncing, type SyncedLoan } from "./sync/loanSync";

/**
 * The loan record, held on the device.
 *
 * Flow 1 keeps a comparison you are making; this keeps the loan you already
 * have, which is a longer-lived thing. It is the reason a returning user lands
 * on a verdict rather than an empty form, and the reason the prepay screen
 * already knows the balance, rate and term.
 *
 * Local-first, and for a member also synced. The device copy is what every
 * screen reads, so the app works offline and never renders behind a request;
 * the server copy exists so a new phone is not a blank form. A guest keeps the
 * device copy only, and nothing about them is stored anywhere else.
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
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const { viewer, account } = useAuth();

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

  /* --- Sync ---------------------------------------------------------------
     Local first: the device copy is what the screens read, so nothing renders
     behind a network call. The server copy is reconciled once, on sign-in, and
     pushed after edits. */
  useEffect(() => {
    if (!hydrated || viewer !== "member" || !account) return;
    let alive = true;

    const local: SyncedLoan | null =
      state.loan && updatedAt
        ? {
            loan: state.loan,
            quote: state.quote,
            surplus: state.surplus,
            bufferMonths: state.bufferMonths,
            rateResolvedAt: state.rateResolvedAt,
            updatedAt,
          }
        : null;

    void pullLoan(account.id).then((out) => {
      if (!alive) return;
      const remote = out.status === "pulled" ? out.payload : null;
      const winner = newer(local, remote);

      if (winner === "remote" && remote) {
        setState({
          loan: remote.loan,
          quote: remote.quote,
          surplus: remote.surplus,
          bufferMonths: remote.bufferMonths,
          rateResolvedAt: remote.rateResolvedAt,
        });
        setUpdatedAt(remote.updatedAt);
      } else if (winner === "local" && worthSyncing(local)) {
        void pushLoan(account.id, local as SyncedLoan);
      }
    });

    return () => {
      alive = false;
    };
    // Reconcile on sign-in, not on every keystroke that touches the record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, viewer, account?.id]);

  const saveLoan = useCallback(
    (loan: LoanRecord) => {
      // Any edit to the loan invalidates a previous "my statement is fine".
      setState((prev) => {
        const next = { ...prev, loan, rateResolvedAt: null };
        if (viewer === "member" && account) {
          const payload = stamp({
            loan: next.loan as LoanRecord,
            quote: next.quote,
            surplus: next.surplus,
            bufferMonths: next.bufferMonths,
            rateResolvedAt: next.rateResolvedAt,
          });
          setUpdatedAt(payload.updatedAt);
          if (worthSyncing(payload)) void pushLoan(account.id, payload);
        } else {
          setUpdatedAt(new Date().toISOString());
        }
        return next;
      });
    },
    [viewer, account],
  );

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
    setUpdatedAt(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do; the in-memory reset has already happened.
    }
    // Deleting locally while the server copy survives would resurrect the loan
    // on the next sign-in, which is not what "delete" means to anyone.
    if (viewer === "member" && account) void deleteLoan(account.id);
  }, [viewer, account]);

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
