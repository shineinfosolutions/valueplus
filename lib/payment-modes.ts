/**
 * Single source of truth for classifying a payment mode string into a revenue bucket.
 *
 * The dashboard used to carry three near-identical copies of this keyword matching
 * (finance down payment, invoice collection, and the payment ledger), each with a
 * slightly different keyword list — so the same mode string could land in different
 * buckets depending on which loop saw it. Everything now routes through here.
 */

export type PaymentBucket = "cash" | "upi" | "card" | "online" | "finance" | "due";

/** Modes whose money is in hand: they count towards `paidAmount` straight away. */
export const COLLECTED_BUCKETS: PaymentBucket[] = ["cash", "upi", "card", "online"];

/**
 * Classify a free-text payment mode. Order matters: the more specific tests run
 * first so "Credit Card" is a card and not mistaken for a credit/due entry, and
 * "Finance Disbursement" is finance rather than an online bank transfer.
 */
export function classifyPaymentMode(raw?: string): PaymentBucket {
  const m = (raw || "").toLowerCase().trim();

  if (!m) return "cash";

  // Finance first — "Consumer EMI", "Bajaj", "HDB" etc. must not fall through to
  // the generic bank/online test below.
  if (
    m.includes("finance") || m.includes("bajaj") || m.includes("hdb") ||
    m.includes("emi") || m.includes("loan") || m.includes("tvs credit") ||
    m.includes("idfc") || m.includes("hdfc consumer")
  ) return "finance";

  // Due / credit / khata — checked before "card" would swallow "credit".
  if (
    m.includes("due") || m.includes("khata") || m.includes("udhar") ||
    m.includes("pending") || m === "credit" || m.includes("credit bill") ||
    m.includes("on credit")
  ) return "due";

  // UPI is tested before card on purpose. Older invoices carry the combined label
  // "UPI / Card / NetBanking", which the dashboard has always counted as UPI —
  // testing card first would silently move ~₹18.9L of historical revenue between
  // buckets. "Credit Card" is unaffected: it contains no UPI keyword.
  if (
    m.includes("upi") || m.includes("phonepe") || m.includes("gpay") ||
    m.includes("google pay") || m.includes("paytm") || m.includes("qr") ||
    m.includes("bhim") || m.includes("scan")
  ) return "upi";

  if (
    m.includes("card") || m.includes("pos") || m.includes("debit") ||
    m.includes("swipe") || m.includes("visa") || m.includes("mastercard") ||
    m.includes("rupay")
  ) return "card";

  if (
    m.includes("online") || m.includes("bank") || m.includes("netbanking") ||
    m.includes("net banking") || m.includes("neft") || m.includes("rtgs") ||
    m.includes("imps") || m.includes("transfer") || m.includes("cheque") ||
    m.includes("check") || m.includes("dd")
  ) return "online";

  if (m.includes("cash") || m.includes("counter")) return "cash";

  // Unrecognised modes behave as they always have: treated as counter cash.
  return "cash";
}

/** True when this mode's money has actually been collected (vs. a receivable). */
export function isCollectedMode(raw?: string): boolean {
  return COLLECTED_BUCKETS.includes(classifyPaymentMode(raw));
}

export interface NormalizedSplit {
  mode: string;
  amount: number;
  bucket: PaymentBucket;
  txnId?: string;
  reference?: string;
}

/**
 * Resolve an invoice into its payment allocations.
 *
 * Invoices created with split payments carry `payments[]`. Everything created
 * before that — and anything saved by an older client — is reconstructed from the
 * legacy single-mode fields so historical reporting is completely unchanged:
 *   • finance sale  -> down payment in its own mode + the financed remainder
 *   • due sale      -> advance in its own mode + the outstanding balance
 *   • plain sale    -> the collected amount under `paymentMode`, balance as due
 */
export function resolveInvoicePayments(inv: any): NormalizedSplit[] {
  const rows: NormalizedSplit[] = [];

  if (Array.isArray(inv?.payments) && inv.payments.length > 0) {
    for (const p of inv.payments) {
      const amount = Number(p?.amount) || 0;
      if (amount <= 0) continue;
      rows.push({
        mode: p.mode || "Cash",
        amount,
        bucket: classifyPaymentMode(p.mode),
        txnId: p.txnId || "",
        reference: p.reference || "",
      });
    }
    if (rows.length > 0) return rows;
  }

  // ── Legacy reconstruction ────────────────────────────────────────────────
  const total = Number(inv?.total) || 0;
  const paid = Number(inv?.paidAmount) || 0;
  const balance = Math.max(0, Number(inv?.balanceAmount) ?? Math.max(0, total - paid));
  const rawMode = inv?.paymentMode || "";
  const isFinance =
    Boolean(inv?.financeProvider) || classifyPaymentMode(rawMode) === "finance";

  if (isFinance) {
    const downPay = Math.min(
      total,
      Number(inv?.financeDownPayment) || Number(inv?.downPayment) || 0
    );
    if (downPay > 0) {
      const dpMode = inv?.financeDownPaymentMode || inv?.downPaymentMode || "Cash";
      rows.push({ mode: dpMode, amount: downPay, bucket: classifyPaymentMode(dpMode) });
    }
    const financed = Math.max(0, total - downPay);
    if (financed > 0) {
      rows.push({ mode: rawMode || "Finance", amount: financed, bucket: "finance" });
    }
    return rows;
  }

  if (classifyPaymentMode(rawMode) === "due") {
    const advance = Math.min(total, Number(inv?.dueAdvanceAmount) || paid || 0);
    if (advance > 0) {
      const advMode = inv?.dueAdvanceMode || "Cash";
      rows.push({ mode: advMode, amount: advance, bucket: classifyPaymentMode(advMode) });
    }
    const outstanding = Math.max(0, total - advance);
    if (outstanding > 0) {
      rows.push({ mode: rawMode || "Due / Credit", amount: outstanding, bucket: "due" });
    }
    return rows;
  }

  if (paid > 0) {
    rows.push({ mode: rawMode || "Cash", amount: paid, bucket: classifyPaymentMode(rawMode) });
  }
  if (balance > 0) {
    rows.push({ mode: "Due / Credit", amount: balance, bucket: "due" });
  }
  return rows;
}

/**
 * True when the unpaid part of this bill is owed by a finance company, not by the
 * customer. Such a balance is never khata: it is settled by a bank payout from the
 * financier, recorded against a store bank account, and must stay out of every
 * customer-due list.
 */
export function isFinanceInvoice(inv: any): boolean {
  if (!inv) return false;
  if (inv.financeProvider || inv.financeDoId) return true;
  if (classifyPaymentMode(inv.paymentMode) === "finance") return true;
  return Array.isArray(inv.payments)
    ? inv.payments.some((p: any) => (Number(p?.amount) || 0) > 0 && classifyPaymentMode(p?.mode) === "finance")
    : false;
}

/**
 * A receipt that settles a finance receivable — the financier's bank payout —
 * as opposed to money a customer paid. `TXN-DUE-*` is included because finance
 * bills used to be closed through the khata "Clear Due" flow, which tagged the
 * payout as an ordinary due receipt.
 */
export function isFinanceSettlementReceipt(p: any, financeInvoiceNumbers: Set<string>): boolean {
  if (!p || p.type !== "received") return false;
  if (String(p.paymentMode || "").toLowerCase().includes("finance disbursement")) return true;
  const txnId = String(p.transactionId || "");
  return (
    Boolean(p.referenceId) &&
    financeInvoiceNumbers.has(p.referenceId) &&
    (txnId.startsWith("TXN-DUE-") || txnId.startsWith("TXN-FIN-"))
  );
}

/** Amount actually collected across the split (excludes finance & due receivables). */
export function collectedTotal(rows: NormalizedSplit[]): number {
  return rows
    .filter((r) => COLLECTED_BUCKETS.includes(r.bucket))
    .reduce((sum, r) => sum + r.amount, 0);
}

/** How much of an invoice was settled in one particular bucket. */
export function amountInBucket(rows: NormalizedSplit[], bucket: PaymentBucket): number {
  return rows.filter((r) => r.bucket === bucket).reduce((sum, r) => sum + r.amount, 0);
}

/**
 * Summary label for the invoice's `paymentMode` field. Kept in sync so the ~38
 * existing readers of that field continue to work: a single row keeps its own mode
 * name, several rows collapse to "Multiple".
 */
export function derivePaymentModeLabel(payments: Array<{ mode: string; amount: number }>): string {
  const active = (payments || []).filter((p) => (Number(p.amount) || 0) > 0);
  if (active.length === 0) return "Cash";
  if (active.length === 1) return active[0].mode || "Cash";
  return "Multiple";
}
