/**
 * Shared ledger maths for every party type (vendor, supplier, customer).
 *
 * The three ledger modals that existed before each recomputed their own totals in
 * JSX, with slightly different rules — one of them matched payments by party id
 * without checking the party TYPE, so a customer receipt could surface inside a
 * supplier's ledger. Balances are derived here instead, from source documents,
 * and every screen reads the same numbers.
 *
 * Balances are computed from the bills and payments themselves rather than from a
 * stored `outstandingBalance` / `paid` field, so a ledger stays correct even where
 * those denormalised fields were never updated.
 */

export type LedgerSide = "receivable" | "payable";

export interface LedgerEntryInput {
  /** "bill" raises what is owed, "payment" reduces it, "opening" seeds the balance. */
  kind: "opening" | "bill" | "payment";
  date: string;
  /** Bill / invoice number, or a payment id. */
  ref: string;
  label: string;
  /** Positive amount; direction comes from `kind`. */
  amount: number;
  mode?: string;
  refNo?: string;
  dueDate?: string;
  by?: string;
  notes?: string;
  /** Reverses the sign — a refund on the payment side, a credit note on the bill side. */
  reverse?: boolean;
  raw?: any;
}

export interface LedgerRow extends LedgerEntryInput {
  debit: number;
  credit: number;
  balance: number;
}

export interface AgeingBuckets {
  current: number;
  d31to60: number;
  d61to90: number;
  d90plus: number;
}

export interface LedgerSummary {
  openingBalance: number;
  totalBilled: number;
  totalPaid: number;
  closingBalance: number;
  billCount: number;
  paymentCount: number;
  lastPaymentDate: string | null;
  lastPaymentAmount: number;
  lastPaymentMode: string | null;
  byMode: Record<string, number>;
  ageing: AgeingBuckets;
  overdueAmount: number;
}

export interface LedgerResult {
  side: LedgerSide;
  rows: LedgerRow[];
  summary: LedgerSummary;
}

/** Parse a stored date safely; "YYYY-MM-DD" is read as local noon to dodge TZ drift. */
export function parseLedgerDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Build a running-balance ledger.
 *
 * `side` only changes which column a bill lands in for display; the maths is the
 * same either way — a bill increases the balance, a payment reduces it, and the
 * closing balance is what the party still owes (receivable) or what we still owe
 * them (payable).
 */
export function buildLedger(
  entries: LedgerEntryInput[],
  options: { side: LedgerSide; openingBalance?: number; openingDate?: string; asOf?: Date }
): LedgerResult {
  const { side, openingBalance = 0, openingDate, asOf = new Date() } = options;

  const sorted = [...entries].sort((a, b) => {
    const da = parseLedgerDate(a.date)?.getTime() ?? 0;
    const db = parseLedgerDate(b.date)?.getTime() ?? 0;
    if (da !== db) return da - db;
    // A bill dated the same day as its payment must come first, or the running
    // balance dips negative for one row and reads like an overpayment.
    if (a.kind !== b.kind) return a.kind === "bill" ? -1 : 1;
    return 0;
  });

  const rows: LedgerRow[] = [];
  let balance = 0;

  if (openingBalance !== 0) {
    balance = openingBalance;
    rows.push({
      kind: "opening",
      date: openingDate || "",
      ref: "OPENING",
      label: "Opening Balance",
      amount: Math.abs(openingBalance),
      debit: openingBalance > 0 ? openingBalance : 0,
      credit: openingBalance < 0 ? Math.abs(openingBalance) : 0,
      balance,
    });
  }

  let totalBilled = 0;
  let totalPaid = 0;
  let billCount = 0;
  let paymentCount = 0;
  let lastPaymentDate: string | null = null;
  let lastPaymentAmount = 0;
  let lastPaymentMode: string | null = null;
  const byMode: Record<string, number> = {};

  for (const entry of sorted) {
    const signedAmount = (entry.reverse ? -1 : 1) * (Number(entry.amount) || 0);
    let debit = 0;
    let credit = 0;

    if (entry.kind === "bill") {
      debit = signedAmount;
      balance += signedAmount;
      totalBilled += signedAmount;
      billCount += 1;
    } else {
      credit = signedAmount;
      balance -= signedAmount;
      totalPaid += signedAmount;
      paymentCount += 1;
      // Rows are in date order, so the last one seen is the most recent.
      lastPaymentDate = entry.date;
      lastPaymentAmount = signedAmount;
      lastPaymentMode = entry.mode || null;
      const modeKey = entry.mode || "Cash";
      byMode[modeKey] = (byMode[modeKey] || 0) + signedAmount;
    }

    rows.push({ ...entry, debit, credit, balance });
  }

  // Ageing walks unsettled bills oldest-first, consuming the money actually
  // received. What is left on each bill is bucketed by how overdue it is — so a
  // party who pays regularly shows nothing in 90+ even with old bills on file.
  const ageing: AgeingBuckets = { current: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
  let overdueAmount = 0;
  // A reversed bill (credit note on a sale, debit note on a purchase) cancels part
  // of what is owed just as a payment does, so it settles outstanding bills too.
  // Without this the buckets come up short of the balance by the note's value.
  const reversedBillTotal = sorted
    .filter((e) => e.kind === "bill" && e.reverse)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  let unapplied =
    totalPaid + reversedBillTotal + (openingBalance < 0 ? Math.abs(openingBalance) : 0);

  // An opening balance is money owed from before this ledger began, so it is
  // settled first and aged from its own date. Leaving it out would make the
  // buckets add up to less than the closing balance they are meant to explain.
  if (openingBalance > 0) {
    const settled = Math.min(unapplied, openingBalance);
    unapplied -= settled;
    const outstanding = openingBalance - settled;
    if (outstanding > 0) {
      const reference = parseLedgerDate(openingDate);
      const age = reference ? daysBetween(reference, asOf) : Infinity;
      if (age <= 30) ageing.current += outstanding;
      else if (age <= 60) ageing.d31to60 += outstanding;
      else if (age <= 90) ageing.d61to90 += outstanding;
      else ageing.d90plus += outstanding;
      overdueAmount += outstanding;
    }
  }

  const bills = sorted.filter((e) => e.kind === "bill" && !e.reverse);
  for (const bill of bills) {
    const amount = Number(bill.amount) || 0;
    const settled = Math.min(unapplied, amount);
    unapplied -= settled;
    const outstanding = amount - settled;
    if (outstanding <= 0) continue;

    const reference = parseLedgerDate(bill.dueDate) || parseLedgerDate(bill.date);
    const age = reference ? daysBetween(reference, asOf) : 0;

    if (age <= 30) ageing.current += outstanding;
    else if (age <= 60) ageing.d31to60 += outstanding;
    else if (age <= 90) ageing.d61to90 += outstanding;
    else ageing.d90plus += outstanding;

    if (parseLedgerDate(bill.dueDate) && age > 0) overdueAmount += outstanding;
  }

  return {
    side,
    rows: rows.reverse(), // newest first for display
    summary: {
      openingBalance,
      totalBilled,
      totalPaid,
      closingBalance: balance,
      billCount,
      paymentCount,
      lastPaymentDate,
      lastPaymentAmount,
      lastPaymentMode,
      byMode,
      ageing,
      overdueAmount,
    },
  };
}

/** Keep only entries inside a date range; `from`/`to` are optional. */
export function filterByRange(entries: LedgerEntryInput[], from?: string, to?: string): LedgerEntryInput[] {
  if (!from && !to) return entries;
  const start = from ? parseLedgerDate(from) : null;
  const end = to ? parseLedgerDate(to) : null;
  if (end) end.setHours(23, 59, 59, 999);

  return entries.filter((e) => {
    const d = parseLedgerDate(e.date);
    if (!d) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });
}

/** Sum of entries falling before `from` — the carry-forward for a filtered view. */
export function carryForwardBefore(entries: LedgerEntryInput[], from?: string): number {
  if (!from) return 0;
  const start = parseLedgerDate(from);
  if (!start) return 0;

  let balance = 0;
  for (const e of entries) {
    const d = parseLedgerDate(e.date);
    if (!d || d >= start) continue;
    const signed = (e.reverse ? -1 : 1) * (Number(e.amount) || 0);
    balance += e.kind === "bill" ? signed : -signed;
  }
  return balance;
}
