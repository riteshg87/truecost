/**
 * The benchmark feed.
 *
 * Deliberately a static table rather than a live API. The RBI publishes no
 * public endpoint for this, and reaching for a third-party one would mean
 * either a server of our own or a request from the user's browser to somebody
 * else's — both of which break the promise that nothing about this loan leaves
 * the device.
 *
 * A table costs one edit roughly six times a year, whenever the MPC moves, and
 * the client reads it as ordinary application code. No request at all.
 */

export interface BenchmarkChange {
  /** ISO date the rate took effect. */
  from: string;
  ratePct: number;
}

/** RBI policy repo rate, most recent last. */
export const REPO_HISTORY: BenchmarkChange[] = [
  { from: "2023-02-08", ratePct: 6.5 },
  { from: "2025-02-07", ratePct: 6.25 },
  { from: "2025-04-09", ratePct: 6.0 },
  { from: "2025-06-06", ratePct: 5.75 },
  { from: "2025-12-05", ratePct: 5.25 },
];

/** The benchmark in force on a given date. */
export function repoOn(iso: string): number {
  let rate = REPO_HISTORY[0].ratePct;
  for (const change of REPO_HISTORY) {
    if (iso >= change.from) rate = change.ratePct;
  }
  return rate;
}

export function repoToday(today: string = isoToday()): number {
  return repoOn(today);
}

/** Today as an ISO date, in the user's own timezone rather than UTC. */
export function isoToday(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Months between two ISO dates, rounded down. */
export function monthsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}

/** The most recent benchmark move at or before a date, for "since when". */
export function lastChangeOnOrBefore(iso: string): BenchmarkChange {
  let change = REPO_HISTORY[0];
  for (const c of REPO_HISTORY) if (iso >= c.from) change = c;
  return change;
}
