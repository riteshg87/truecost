/** Twelve calendar months in UTC, clamping leap day to the prior February end. */
export function feedbackRetentionCutoff(now: number): number {
  if (!Number.isFinite(now)) throw new TypeError("Invalid retention clock");
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid retention clock");
  const year = date.getUTCFullYear() - 1;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
}
