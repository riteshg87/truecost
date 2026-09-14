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
import { authConfigured, readableAuthError, supabase } from "./client";
import type { ParsedIdentifier } from "./identifier";
import type { Gating, Viewer } from "./access";

/**
 * Session state for the whole app.
 *
 * Three standings, not two. "Guest" is someone who chose to look around without
 * an account — a real, remembered decision, not the absence of one — and the
 * difference matters because a guest gets sent to the feature list while an
 * anonymous visitor gets sent to the door.
 */

const GUEST_KEY = "truecost.guest";

export interface Account {
  id: string;
  email: string | null;
  phone: string | null;
}

interface AuthValue {
  viewer: Viewer;
  account: Account | null;
  ready: boolean;
  /** False when no provider keys are configured — the UI says so rather than failing. */
  configured: boolean;
  /** Sign-in requirements only bite once there is somewhere to sign in to. */
  gating: Gating;
  sendCode: (id: ParsedIdentifier) => Promise<{ ok: boolean; error?: string }>;
  verifyCode: (
    id: ParsedIdentifier,
    code: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  continueAsGuest: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [guest, setGuest] = useState(false);
  const [ready, setReady] = useState(false);
  const configured = authConfigured();

  useEffect(() => {
    let alive = true;

    try {
      if (window.localStorage.getItem(GUEST_KEY) === "1") setGuest(true);
    } catch {
      // Blocked storage. Guest standing lasts the session instead.
    }

    const client = supabase();
    if (!client) {
      setReady(true);
      return;
    }

    client.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setAccount(toAccount(data.session?.user));
      setReady(true);
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setAccount(toAccount(session?.user));
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const sendCode = useCallback(async (id: ParsedIdentifier) => {
    const client = supabase();
    if (!client) return { ok: false, error: "Sign-in is not configured yet." };

    const { error } =
      id.kind === "email"
        ? await client.auth.signInWithOtp({
            email: id.value,
            // shouldCreateUser keeps register and sign-in as one door: a first
            // code creates the account, a later one signs into it.
            options: { shouldCreateUser: true },
          })
        : await client.auth.signInWithOtp({
            phone: id.value,
            options: { shouldCreateUser: true },
          });

    return error ? { ok: false, error: readableAuthError(error.message) } : { ok: true };
  }, []);

  const verifyCode = useCallback(async (id: ParsedIdentifier, code: string) => {
    const client = supabase();
    if (!client) return { ok: false, error: "Sign-in is not configured yet." };

    const { data, error } = await client.auth.verifyOtp(
      id.kind === "email"
        ? { email: id.value, token: code, type: "email" }
        : { phone: id.value, token: code, type: "sms" },
    );

    if (error) return { ok: false, error: readableAuthError(error.message) };

    setAccount(toAccount(data.user ?? undefined));
    // Signing in supersedes looking around.
    setGuest(false);
    try {
      window.localStorage.removeItem(GUEST_KEY);
    } catch {
      // Nothing to clear.
    }
    return { ok: true };
  }, []);

  const continueAsGuest = useCallback(() => {
    setGuest(true);
    try {
      window.localStorage.setItem(GUEST_KEY, "1");
    } catch {
      // In-memory guest standing still works for this session.
    }
  }, []);

  const signOut = useCallback(async () => {
    const client = supabase();
    if (client) await client.auth.signOut();
    setAccount(null);
    setGuest(false);
    try {
      window.localStorage.removeItem(GUEST_KEY);
    } catch {
      // Nothing to clear.
    }
  }, []);

  const viewer: Viewer = account ? "member" : guest ? "guest" : "anonymous";

  const value = useMemo<AuthValue>(
    () => ({
      viewer,
      account,
      ready,
      configured,
      gating: configured ? "enforced" : "open",
      sendCode,
      verifyCode,
      continueAsGuest,
      signOut,
    }),
    [viewer, account, ready, configured, sendCode, verifyCode, continueAsGuest, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function toAccount(user: { id: string; email?: string; phone?: string } | undefined) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    phone: user.phone ?? null,
  };
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
