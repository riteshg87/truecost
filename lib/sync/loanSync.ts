import { supabase } from "../auth/client";
import type { LoanRecord, TransferQuote } from "../health/types";

/**
 * Making the loan record follow the person rather than the phone.
 *
 * Local-first, always. The device copy is what the screens read, so the app
 * keeps working on a train with no signal and never blocks a render on a round
 * trip. The server copy exists so a new phone is not a blank form.
 *
 * Conflicts are resolved by clock, newest wins. That is the honest rule for
 * one person editing one loan on two devices: anything cleverer would be
 * guessing at an intent the data does not carry.
 */

export const LOANS_TABLE = "loans";

export interface SyncedLoan {
  loan: LoanRecord;
  quote: TransferQuote;
  surplus: number;
  bufferMonths: number;
  rateResolvedAt: string | null;
  /** ISO timestamp of the last local edit. The tiebreaker. */
  updatedAt: string;
}

export type SyncOutcome =
  | { status: "off" }
  | { status: "pushed" }
  | { status: "pulled"; payload: SyncedLoan }
  | { status: "same" }
  | { status: "error"; message: string };

/** Which of two copies should win. Null when there is nothing to choose. */
export function newer(
  local: SyncedLoan | null,
  remote: SyncedLoan | null,
): "local" | "remote" | "same" | null {
  if (!local && !remote) return null;
  if (!remote) return "local";
  if (!local) return "remote";
  if (local.updatedAt === remote.updatedAt) return "same";
  return local.updatedAt > remote.updatedAt ? "local" : "remote";
}

/** A payload is only worth syncing once it describes an actual loan. */
export function worthSyncing(payload: SyncedLoan | null): boolean {
  return Boolean(payload && payload.loan && payload.loan.outstanding > 0);
}

export function stamp(payload: Omit<SyncedLoan, "updatedAt">): SyncedLoan {
  return { ...payload, updatedAt: new Date().toISOString() };
}

/* -------------------------------------------------------------------------- */
/* Server                                                                     */
/* -------------------------------------------------------------------------- */

export async function pullLoan(userId: string): Promise<SyncOutcome> {
  const client = supabase();
  if (!client) return { status: "off" };

  const { data, error } = await client
    .from(LOANS_TABLE)
    .select("payload")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { status: "error", message: error.message };
  if (!data?.payload) return { status: "same" };
  return { status: "pulled", payload: data.payload as SyncedLoan };
}

export async function pushLoan(
  userId: string,
  payload: SyncedLoan,
): Promise<SyncOutcome> {
  const client = supabase();
  if (!client) return { status: "off" };

  const { error } = await client
    .from(LOANS_TABLE)
    .upsert(
      { user_id: userId, payload, updated_at: payload.updatedAt },
      { onConflict: "user_id" },
    );

  if (error) return { status: "error", message: error.message };
  return { status: "pushed" };
}

export async function deleteLoan(userId: string): Promise<SyncOutcome> {
  const client = supabase();
  if (!client) return { status: "off" };

  const { error } = await client.from(LOANS_TABLE).delete().eq("user_id", userId);
  if (error) return { status: "error", message: error.message };
  return { status: "pushed" };
}
