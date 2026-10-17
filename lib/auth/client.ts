import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase handle.
 *
 * Created lazily and only when both keys are present, so a checkout without
 * credentials still builds, still runs, and still serves Flow 1 to a guest.
 * The alternative — throwing at import time — makes a missing env var look like
 * a broken app.
 */

const URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_KEY = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

let client: SupabaseClient | null = null;

export function authConfigured(): boolean {
  return Boolean(process.env[URL_KEY] && process.env[ANON_KEY]);
}

export function supabase(): SupabaseClient | null {
  if (!authConfigured()) return null;
  if (!client) {
    client = createBrowserClient(
      process.env[URL_KEY] as string,
      process.env[ANON_KEY] as string,
    );
  }
  return client;
}

/**
 * Turn a provider error into something a person can act on.
 *
 * Supabase messages are written for developers. "AuthApiError: Invalid login
 * credentials" on a phone tells someone nothing about what to do next.
 */
export function readableAuthError(message: string | undefined): string {
  if (!message) return "Something went wrong. Try again.";
  const m = message.toLowerCase();

  if (m.includes("expired") || m.includes("invalid") || m.includes("token")) {
    return "That code is wrong or has expired. Ask for a new one.";
  }
  if (m.includes("rate") || m.includes("too many") || m.includes("limit")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (m.includes("sms") || m.includes("phone") || m.includes("provider")) {
    return "We couldn't send to that number. Try your email instead.";
  }
  if (m.includes("network") || m.includes("fetch")) {
    return "No connection. Check your network and try again.";
  }
  return "Something went wrong. Try again.";
}
