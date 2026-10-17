import { addCalendarMonths, indianFinancialYear, validateDate } from "./dates";

/** Maximum term accepted by the date-aware prepayment primitive. */
export const MAX_SCHEDULE_MONTHS = 1200;
/**
 * Arithmetic guard for the ledger, rather than a product or UI limit.
 *
 * The existing engine uses binary floating point and permits ordinary retail
 * loan values. Capping a schedule at ₹1 trillion keeps monthly interest and
 * multi-period totals away from unsafe integer magnitudes while leaving ample
 * headroom for those values. Larger values must be handled by a decimal
 * arithmetic implementation before this primitive can accept them.
 */
export const MAX_SCHEDULE_RUPEES = 1_000_000_000_000;
/** Monthly rate is a decimal: 0.01 means 1% per month. */
export const MAX_MONTHLY_RATE = 10;

// Used only to recognise the final EMI's floating-point formula residue. This
// scales with the operands' ulps, so it does not forgive a fixed amount of
// genuine principal at small balances.
const FINAL_PAYMENT_ULPS = 64;

function finalPaymentTolerance(due: number, emi: number): number {
  return Number.EPSILON * Math.max(Math.abs(due), Math.abs(emi)) * FINAL_PAYMENT_ULPS;
}

export interface ImmediatePrepayment {
  /** Principal paid on the anchor date, before the first scheduled payment. */
  amount: number;
}

export interface DatedLoanScheduleInput {
  /** Date on which `principal` is measured, in YYYY-MM-DD form. */
  anchorDate: string;
  principal: number;
  /** Decimal monthly rate, not an annual percentage. */
  monthlyRate: number;
  /** Regular scheduled instalment. The final row may be smaller. */
  scheduledEmi: number;
  termMonths: number;
  /** Optional principal payment at `anchorDate`; intra-month timing is excluded. */
  immediatePrepayment?: ImmediatePrepayment | null;
}

export interface DatedLoanScheduleRow {
  /** 0 is the anchor prepayment event; scheduled payments are numbered from 1. */
  period: number;
  date: string;
  /** Indian financial year start, for example 2025 means FY 2025-26. */
  financialYear: number;
  openingBalance: number;
  interest: number;
  scheduledPayment: number;
  scheduledPrincipal: number;
  immediatePrepayment: number;
  closingBalance: number;
}

export interface FinancialYearTotal {
  financialYear: number;
  interest: number;
  scheduledPayment: number;
  scheduledPrincipal: number;
  immediatePrepayment: number;
}

export interface DatedLoanSchedule {
  anchorDate: string;
  originalPrincipal: number;
  immediatePrepayment: number;
  rows: DatedLoanScheduleRow[];
  financialYearTotals: FinancialYearTotal[];
  totalInterest: number;
  totalScheduledPayment: number;
  totalScheduledPrincipal: number;
  remainingBalance: number;
  cleared: boolean;
}

function nonnegativeFinite(value: number, field: string, maximum: number): number {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${field} must be a finite non-negative value within the supported range`);
  }
  return value;
}

function validateInput(input: DatedLoanScheduleInput): number {
  validateDate(input.anchorDate);
  nonnegativeFinite(input.principal, "principal", MAX_SCHEDULE_RUPEES);
  nonnegativeFinite(input.monthlyRate, "monthlyRate", MAX_MONTHLY_RATE);
  nonnegativeFinite(input.scheduledEmi, "scheduledEmi", MAX_SCHEDULE_RUPEES);
  if (!Number.isSafeInteger(input.termMonths) || input.termMonths < 1 || input.termMonths > MAX_SCHEDULE_MONTHS) {
    throw new Error(`termMonths must be an integer from 1 to ${MAX_SCHEDULE_MONTHS}`);
  }

  const immediate = input.immediatePrepayment?.amount ?? 0;
  nonnegativeFinite(immediate, "immediatePrepayment.amount", MAX_SCHEDULE_RUPEES);
  if (immediate > input.principal) {
    throw new Error("immediatePrepayment.amount cannot exceed principal");
  }
  return immediate;
}

function addYearTotals(
  totals: Map<number, FinancialYearTotal>,
  row: DatedLoanScheduleRow,
): void {
  const current = totals.get(row.financialYear) ?? {
    financialYear: row.financialYear,
    interest: 0,
    scheduledPayment: 0,
    scheduledPrincipal: 0,
    immediatePrepayment: 0,
  };
  current.interest += row.interest;
  current.scheduledPayment += row.scheduledPayment;
  current.scheduledPrincipal += row.scheduledPrincipal;
  current.immediatePrepayment += row.immediatePrepayment;
  totals.set(row.financialYear, current);
}

/**
 * Build a dated fixed monthly reducing-balance schedule.
 *
 * Payment dates are always calculated from the original anchor date. This
 * preserves an end-of-month anchor such as Jan 31 through February and March.
 * The function models timing and arithmetic only. It contains no tax rates,
 * deduction caps, eligibility, or tax-credit policy.
 */
export function buildDatedLoanSchedule(input: DatedLoanScheduleInput): DatedLoanSchedule {
  const immediatePrepayment = validateInput(input);
  const balanceAfterImmediate = input.principal - immediatePrepayment;

  const rows: DatedLoanScheduleRow[] = [];
  const totals = new Map<number, FinancialYearTotal>();
  const anchorRow: DatedLoanScheduleRow = {
    period: 0,
    date: input.anchorDate,
    financialYear: indianFinancialYear(input.anchorDate),
    openingBalance: input.principal,
    interest: 0,
    scheduledPayment: 0,
    scheduledPrincipal: 0,
    immediatePrepayment,
    closingBalance: balanceAfterImmediate,
  };
  rows.push(anchorRow);
  addYearTotals(totals, anchorRow);

  let balance = balanceAfterImmediate;
  let totalInterest = 0;
  let totalScheduledPayment = 0;
  let totalScheduledPrincipal = 0;

  for (let period = 1; period <= input.termMonths; period += 1) {
    const date = addCalendarMonths(input.anchorDate, period);
    const openingBalance = balance;
    const interest = openingBalance * input.monthlyRate;
    const due = openingBalance + interest;
    if (!Number.isFinite(interest) || !Number.isFinite(due)) {
      throw new Error("schedule arithmetic exceeds the supported range");
    }

    // A zero balance needs no instalment. Otherwise an instalment that does
    // not exceed that month's interest cannot amortise the loan.
    if (openingBalance > 0 && input.scheduledEmi <= interest) {
      throw new Error("scheduledEmi does not amortise the remaining balance");
    }

    // An EMI generated from the amortisation formula can undershoot the exact
    // final amount by a few floating-point ulps. Treat that narrow comparison
    // as a payoff and keep every other balance at full calculation precision.
    const paysInFull = openingBalance > 0 &&
      (input.scheduledEmi >= due || due - input.scheduledEmi <= finalPaymentTolerance(due, input.scheduledEmi));
    const scheduledPayment = openingBalance > 0
      ? (paysInFull ? due : Math.min(input.scheduledEmi, due))
      : 0;
    const scheduledPrincipal = paysInFull ? openingBalance : Math.max(0, scheduledPayment - interest);
    const closingBalance = Math.max(0, openingBalance - scheduledPrincipal);
    const row: DatedLoanScheduleRow = {
      period,
      date,
      financialYear: indianFinancialYear(date),
      openingBalance,
      interest,
      scheduledPayment,
      scheduledPrincipal,
      immediatePrepayment: 0,
      closingBalance,
    };
    rows.push(row);
    addYearTotals(totals, row);

    totalInterest += interest;
    totalScheduledPayment += scheduledPayment;
    totalScheduledPrincipal += scheduledPrincipal;
    balance = closingBalance;
  }

  return {
    anchorDate: input.anchorDate,
    originalPrincipal: input.principal,
    immediatePrepayment,
    rows,
    financialYearTotals: [...totals.values()].sort(
      (left, right) => left.financialYear - right.financialYear,
    ),
    totalInterest,
    totalScheduledPayment,
    totalScheduledPrincipal,
    remainingBalance: balance,
    cleared: balance === 0,
  };
}
