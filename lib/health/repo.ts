/**
 * The benchmark feed.
 *
 * Deliberately a static table rather than a live feed. This keeps benchmark
 * lookup deterministic and offline, while making source dates and freshness
 * boundaries visible in code. The final entry is historical data, not proof of
 * today's policy rate; updating it requires a separately reviewed source edit.
 */

export interface BenchmarkChange {
  /** ISO date the rate took effect. */
  from: string;
  ratePct: number;
}

export interface BenchmarkCoverageInterval {
  /** Inclusive ISO dates for an interval supported by an explicitly reviewed source. */
  from: string;
  through: string;
  ratePct: number;
}

export interface VerifiedBenchmarkObservation extends BenchmarkChange {
  /** Primary source supporting this effective-date observation. */
  sourceUrl: string;
  /** Date the source check was performed, for review and freshness context. */
  checkedOn: string;
}

/** RBI policy repo rate, most recent last. */
export const REPO_HISTORY: BenchmarkChange[] = [
  { from: "2023-02-08", ratePct: 6.5 },
  { from: "2025-02-07", ratePct: 6.25 },
  { from: "2025-04-09", ratePct: 6.0 },
  { from: "2025-06-06", ratePct: 5.5 },
  { from: "2025-12-05", ratePct: 5.25 },
];

/**
 * Effective-date observations independently supported by the reviewed source
 * check. REPO_HISTORY also retains inherited historical rows for audit and
 * display, but those rows do not establish a verified observation here.
 */
export const REPO_VERIFIED_OBSERVATIONS: readonly VerifiedBenchmarkObservation[] = [
  {
    from: "2023-02-08",
    ratePct: 6.5,
    sourceUrl: "https://rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=55178",
    checkedOn: "2026-09-16",
  },
  {
    from: "2025-06-06",
    ratePct: 5.5,
    sourceUrl: "https://www.rbi.org.in/scripts/BS_CircularIndexDisplay.aspx?Id=12854",
    checkedOn: "2026-09-16",
  },
  {
    from: "2025-12-05",
    ratePct: 5.25,
    sourceUrl: "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61749",
    checkedOn: "2026-09-16",
  },
];

/**
 * Continuous coverage must be sourced separately from effective-date points.
 * No such interval has been reviewed yet, so this remains intentionally empty.
 */
export const REPO_COVERAGE_INTERVALS: readonly BenchmarkCoverageInterval[] = [];

export function isRepoDateCovered(iso: string): boolean {
  if (!isValidIsoDate(iso)) return false;
  if (REPO_VERIFIED_OBSERVATIONS.some((change) => change.from === iso)) return true;
  return REPO_COVERAGE_INTERVALS.some((interval) => interval.from <= iso && iso <= interval.through);
}

/** The benchmark observed on a date, or null when no reviewed coverage supports it. */
export function repoOn(iso: string): number | null {
  if (!isValidIsoDate(iso)) throw new RangeError("Expected a calendar date in YYYY-MM-DD format.");
  const observed = REPO_VERIFIED_OBSERVATIONS.find((change) => change.from === iso);
  if (observed) return observed.ratePct;
  return REPO_COVERAGE_INTERVALS.find((interval) => interval.from <= iso && iso <= interval.through)?.ratePct ?? null;
}

export function repoToday(today: string = isoToday()): number | null {
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
  if (!isValidIsoDate(fromIso) || !isValidIsoDate(toIso)) return 0;
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}

/** A strict calendar date check used before benchmark and reset arithmetic. */
export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Adds calendar months while clamping a day to the end of a shorter month.
 * For example, January 31 plus one month is February 28 (or February 29 in
 * a leap year). This models an anniversary rather than elapsed whole months.
 */
export function addCalendarMonths(iso: string, months: number): string | null {
  if (!isValidIsoDate(iso) || !Number.isInteger(months)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const monthIndex = year * 12 + month - 1 + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

/** True after the contractual month anniversary; null means an invalid date. */
export function isResetOverdue(lastReset: string, today: string, cycleMonths: number): boolean | null {
  if (!isValidIsoDate(lastReset) || !isValidIsoDate(today) || today < lastReset) return null;
  const due = addCalendarMonths(lastReset, cycleMonths);
  return due === null ? null : today > due;
}

/** The most recent benchmark move at or before a date, for "since when". */
export function lastChangeOnOrBefore(iso: string): BenchmarkChange {
  let change = REPO_HISTORY[0];
  for (const c of REPO_HISTORY) if (iso >= c.from) change = c;
  return change;
}
