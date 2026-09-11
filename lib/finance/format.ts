const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹12,34,567 — Indian digit grouping, no decimals. */
export function formatINR(value: number, opts?: { decimals?: boolean }): string {
  if (!isFinite(value)) return "—";
  const rounded = opts?.decimals ? inr2.format(value) : inr.format(Math.round(value));
  return `₹${rounded}`;
}

/** ₹12.3 L / ₹1.24 Cr — for headline figures where every digit is noise. */
export function formatCompactINR(value: number): string {
  if (!isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1000) return `${sign}₹${inr.format(Math.round(abs))}`;
  return `${sign}₹${Math.round(abs)}`;
}

export function formatPct(value: number | null, decimals = 2): string {
  if (value === null || !isFinite(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

/** Strip grouping and stray symbols from typed input. */
export function parseNumber(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const value = Number.parseFloat(cleaned);
  return isFinite(value) ? value : 0;
}

/** Live grouping for text inputs, preserving a trailing decimal point. */
export function groupDigits(input: string): string {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const [whole, ...rest] = cleaned.split(".");
  const grouped = whole ? inr.format(Number.parseInt(whole, 10) || 0) : "";
  if (rest.length === 0) return grouped;
  return `${grouped}.${rest.join("").slice(0, 2)}`;
}

/** "12.3 L" style helper for axis labels and chips. */
export function shortINR(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(1)}L`;
  if (abs >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return `${Math.round(value)}`;
}
