/** Calendar dates only: neither browser timezone nor daylight saving moves a payment. */
function parts(value: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a valid YYYY-MM-DD date");
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("Use a valid YYYY-MM-DD date");
  }
  return [year, month, day];
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function validateDate(value: string): void { parts(value); }

/** Call with the original anchor each time, so Jan 31 -> Feb 28 -> Mar 31. */
export function addCalendarMonths(anchor: string, offset: number): string {
  const [year, month, day] = parts(anchor);
  if (!Number.isSafeInteger(offset) || Math.abs(offset) > 1200) throw new Error("Invalid calendar month offset");
  const index = year * 12 + month - 1 + offset;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12 + 1;
  if (targetYear < 1900 || targetYear > 9999) throw new Error("Date is outside the supported calendar");
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

/** Calendar grouping only; this does not select tax rates or establish eligibility. */
export function indianFinancialYear(date: string): number {
  const [year, month] = parts(date);
  return month >= 4 ? year : year - 1;
}
