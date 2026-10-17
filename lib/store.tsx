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
import {
  DEFAULT_GST_PCT,
  ENABLED_LOAN_TYPES,
  LOAN_TYPES,
  isLoanTypeEnabled,
} from "./finance/loanTypes";
import type { LoanTypeId, Offer } from "./finance/types";

const STORAGE_KEY = "truecost.compare.v1";
export const MAX_OFFERS = 3;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `o_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A fresh offer. Mandatory figures start empty on purpose — pre-filling an
 * amount or a rate invites someone to compare numbers they never checked.
 * Tenure and GST are defaulted because they are conventional and visible.
 */
export function makeOffer(loanType: LoanTypeId): Offer {
  const config = LOAN_TYPES[loanType];
  return {
    id: newId(),
    lender: "",
    loanType,
    amount: 0,
    ratePct: 0,
    rateType: config.defaultRateType,
    rateStructure: config.defaultRateStructure,
    tenureValue: config.typicalTenureYears,
    tenureUnit: "years",
    processingFee: { mode: "percent", value: 0 },
    gstPct: DEFAULT_GST_PCT,
    insurancePremium: 0,
    insuranceFunding: "financed",
    otherFees: [],
  };
}

interface CompareState {
  loanType: LoanTypeId;
  offers: Offer[];
}

function initialState(): CompareState {
  const loanType: LoanTypeId = ENABLED_LOAN_TYPES[0] ?? "home";
  return { loanType, offers: [makeOffer(loanType), makeOffer(loanType)] };
}

interface CompareContextValue extends CompareState {
  hydrated: boolean;
  setLoanType: (loanType: LoanTypeId) => void;
  updateOffer: (id: string, patch: Partial<Offer>) => void;
  addOffer: () => void;
  removeOffer: (id: string) => void;
  reset: () => void;
  canAdd: boolean;
}

const CompareContext = createContext<CompareContextValue | null>(null);

function isOffer(value: unknown): value is Offer {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.amount === "number" &&
    typeof o.ratePct === "number" &&
    typeof o.loanType === "string" &&
    o.loanType in LOAN_TYPES &&
    typeof o.processingFee === "object" &&
    o.processingFee !== null
  );
}

/**
 * Bring an offer written by an older build up to the current shape.
 *
 * Storage is a year of someone's saved comparisons, so the key is not bumped
 * on every field. Two things need repairing: rateStructure did not exist
 * before fixed-versus-floating was collected, and a product that has since
 * been switched off has to fall back to one that is on.
 */
function migrateOffer(offer: Offer): Offer {
  const loanType = isLoanTypeEnabled(offer.loanType)
    ? offer.loanType
    : (ENABLED_LOAN_TYPES[0] ?? "home");
  const config = LOAN_TYPES[loanType];
  return {
    ...offer,
    loanType,
    rateStructure:
      offer.rateStructure === "fixed" || offer.rateStructure === "floating"
        ? offer.rateStructure
        : config.defaultRateStructure,
    rateType: config.rateTypeLocked ? config.defaultRateType : offer.rateType,
  };
}

/** Tolerate anything in storage — a stale or hand-edited blob must not white-screen the app. */
function parseStored(raw: string | null): CompareState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Record<string, unknown>;
    const offers = (Array.isArray(candidate.offers)
      ? candidate.offers.filter(isOffer)
      : []
    ).map(migrateOffer);
    if (offers.length < 2) return null;
    const stored =
      typeof candidate.loanType === "string" && candidate.loanType in LOAN_TYPES
        ? (candidate.loanType as LoanTypeId)
        : offers[0].loanType;
    const loanType = isLoanTypeEnabled(stored) ? stored : offers[0].loanType;
    return { loanType, offers: offers.slice(0, MAX_OFFERS) };
  } catch {
    return null;
  }
}

export function CompareProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CompareState>(initialState);
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
      // Private mode or a full quota. Losing persistence is survivable; the
      // session still works entirely in memory.
    }
  }, [state, hydrated]);

  const setLoanType = useCallback((loanType: LoanTypeId) => {
    setState((prev) => {
      // A disabled product is on screen to show what is coming, not to be picked.
      if (prev.loanType === loanType || !isLoanTypeEnabled(loanType)) return prev;
      const config = LOAN_TYPES[loanType];
      return {
        loanType,
        offers: prev.offers.map((offer) => ({
          ...offer,
          loanType,
          // A locked product cannot stay on a flat rate the user picked earlier.
          rateType: config.rateTypeLocked ? config.defaultRateType : offer.rateType,
          rateStructure: config.defaultRateStructure,
          tenureValue:
            offer.tenureUnit === "years" &&
            offer.tenureValue === LOAN_TYPES[prev.loanType].typicalTenureYears
              ? config.typicalTenureYears
              : offer.tenureValue,
        })),
      };
    });
  }, []);

  const updateOffer = useCallback((id: string, patch: Partial<Offer>) => {
    setState((prev) => ({
      ...prev,
      offers: prev.offers.map((offer) =>
        offer.id === id ? { ...offer, ...patch } : offer,
      ),
    }));
  }, []);

  const addOffer = useCallback(() => {
    setState((prev) =>
      prev.offers.length >= MAX_OFFERS
        ? prev
        : { ...prev, offers: [...prev.offers, makeOffer(prev.loanType)] },
    );
  }, []);

  const removeOffer = useCallback((id: string) => {
    setState((prev) =>
      prev.offers.length <= 2
        ? prev
        : { ...prev, offers: prev.offers.filter((offer) => offer.id !== id) },
    );
  }, []);

  const reset = useCallback(() => setState(initialState()), []);

  const value = useMemo<CompareContextValue>(
    () => ({
      ...state,
      hydrated,
      setLoanType,
      updateOffer,
      addOffer,
      removeOffer,
      reset,
      canAdd: state.offers.length < MAX_OFFERS,
    }),
    [state, hydrated, setLoanType, updateOffer, addOffer, removeOffer, reset],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare(): CompareContextValue {
  const ctx = useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used inside CompareProvider");
  return ctx;
}
