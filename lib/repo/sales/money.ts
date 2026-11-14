/**
 * Payment, advance, finance, deleted-bill and billing-company reads of the GET paths (see invoices.ts for the
 * mongo… / d1… convention and lib/repo/sales/INVENTORY.md for where each is used).
 */
import PaymentTransaction from "@/models/PaymentTransaction";
import CustomerAdvance from "@/models/CustomerAdvance";
import FinanceTransaction from "@/models/FinanceTransaction";
import DeletedInvoice from "@/models/DeletedInvoice";
import BillingCompany from "@/models/BillingCompany";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { META, Where, findDocs, regexMatches, type Projection } from "./d1-docs";

// ---------------------------------------------------------------------------
// payment_transactions
// ---------------------------------------------------------------------------

/** GET /api/payments (partyId / partyType). */
export async function mongoPaymentList(partyId: string | null, partyType: string | null) {
  const filter: any = {};
  if (partyId) filter.partyId = partyId;
  if (partyType) filter.partyType = partyType;
  return PaymentTransaction.find(filter).sort({ date: -1 }).lean();
}

export async function d1PaymentList(db: D1DatabaseLike, partyId: string | null, partyType: string | null) {
  const where = new Where();
  if (partyId) where.eq("partyId", partyId);
  if (partyType) where.eq("partyType", partyType);
  return findDocs(db, META.payments, { where, orderBy: "date DESC, id" });
}

/** GET /api/dashboard/stats: the supplier payments of the khata (ledger) cards. */
export async function mongoDashboardSupplierPayments() {
  return PaymentTransaction.find(
    { partyType: "Supplier" },
    { partyId: 1, referenceId: 1, date: 1, transactionId: 1, paymentMode: 1, amount: 1, type: 1 }
  ).lean();
}

export async function d1DashboardSupplierPayments(db: D1DatabaseLike) {
  return findDocs(db, META.payments, {
    where: new Where().eq("partyType", "Supplier"),
    projection: { partyId: 1, referenceId: 1, date: 1, transactionId: 1, paymentMode: 1, amount: 1, type: 1 },
  });
}

/** GET /api/dashboard/stats: every receipt / payment (the route's PAYMENT_SUMMARY_FIELDS). */
export const PAYMENT_SUMMARY_FIELDS: Projection = {
  type: 1, partyType: 1, partyName: 1, referenceId: 1, transactionId: 1, paymentMode: 1, amount: 1,
  date: 1, createdAt: 1, notes: 1, bankTxnRef: 1, bankAccountRef: 1,
};

export async function mongoDashboardPaymentSummary() {
  return PaymentTransaction.find({}, PAYMENT_SUMMARY_FIELDS).sort({ createdAt: -1 }).lean();
}

export async function d1DashboardPaymentSummary(db: D1DatabaseLike) {
  return findDocs(db, META.payments, { orderBy: "createdAt DESC, id", projection: PAYMENT_SUMMARY_FIELDS });
}

/** lib/mongo-read-helpers.ts loadComplete(PaymentTransaction, rows) (dashboard). */
export async function mongoPaymentsByIds(ids: any[]) {
  return PaymentTransaction.aggregate([{ $match: { _id: { $in: ids } } }]);
}

export async function d1PaymentsByIds(db: D1DatabaseLike, ids: any[]) {
  return findDocs(db, META.payments, { where: new Where().in("id", ids.map((x) => String(x))) });
}

/** lib/cashRegister.ts: cash collected later against a bill. */
export async function mongoCashReceipts() {
  return PaymentTransaction.find(
    { partyType: "Customer", type: "received", paymentMode: { $regex: /^cash/i } },
    { transactionId: 1, amount: 1, date: 1, referenceId: 1, partyName: 1, notes: 1, createdAt: 1 }
  ).lean();
}

export async function d1CashReceipts(db: D1DatabaseLike) {
  return findDocs(db, META.payments, {
    where: new Where().eq("partyType", "Customer").eq("type", "received").raw(`paymentMode LIKE 'cash%'`),
    projection: { transactionId: 1, amount: 1, date: 1, referenceId: 1, partyName: 1, notes: 1, createdAt: 1 },
  });
}

/** GET /api/vendors/ledger?party=supplier|customer: every payment of one party type. */
export async function mongoPaymentsOfPartyType(partyType: "Supplier" | "Customer") {
  return PaymentTransaction.find({ partyType }).lean();
}

export async function d1PaymentsOfPartyType(db: D1DatabaseLike, partyType: "Supplier" | "Customer") {
  return findDocs(db, META.payments, { where: new Where().eq("partyType", partyType) });
}

// ---------------------------------------------------------------------------
// customer_advances
// ---------------------------------------------------------------------------

/** GET /api/crm/advances (phone / status / search). */
export async function mongoAdvanceList(phone: string | null, status: string | null, search: string | null) {
  const query: any = {};
  if (phone) {
    query.customerPhone = phone.trim();
  }
  if (status && status !== "all") {
    query.status = status;
  }
  if (search) {
    const regex = new RegExp(search.trim(), "i");
    query.$or = [
      { customerName: regex },
      { customerPhone: regex },
      { receiptNumber: regex },
      { productBooked: regex },
      { targetBrand: regex },
    ];
  }

  return CustomerAdvance.find(query)
    .sort({ createdAt: -1 })
    .lean();
}

export async function d1AdvanceList(db: D1DatabaseLike, phone: string | null, status: string | null, search: string | null) {
  const where = new Where();
  if (phone) where.eq("customerPhone", phone.trim());
  if (status && status !== "all") where.eq("status", status);
  let filter: ((d: any) => boolean) | undefined;
  if (search) {
    const regex = new RegExp(search.trim(), "i");
    filter = (d) => ["customerName", "customerPhone", "receiptNumber", "productBooked", "targetBrand"].some((f) => regexMatches(d[f], regex));
  }
  return findDocs(db, META.advances, { where, orderBy: "createdAt DESC, id", filter });
}

// ---------------------------------------------------------------------------
// finance_transactions
// ---------------------------------------------------------------------------

/**
 * GET /api/finance (invoiceNumber / doId / status / provider). Not .lean(): the route then fills a missing EMI
 * schedule and saves the document (a write on a GET; see INVENTORY.md).
 */
export async function mongoFinanceList(invoiceNumber: string | null, doId: string | null, status: string | null, provider: string | null) {
  const filter: any = {};
  if (invoiceNumber) filter.invoiceNumber = invoiceNumber;
  if (doId) filter.doId = doId;
  if (status && status !== "all") filter.approvalStatus = status;
  if (provider && provider !== "all") filter.financeProvider = provider;
  return FinanceTransaction.find(filter).sort({ createdAt: -1 });
}

export async function d1FinanceList(db: D1DatabaseLike, invoiceNumber: string | null, doId: string | null, status: string | null, provider: string | null) {
  const where = new Where();
  if (invoiceNumber) where.eq("invoiceNumber", invoiceNumber);
  if (doId) where.eq("doId", doId);
  if (status && status !== "all") where.eq("approvalStatus", status);
  if (provider && provider !== "all") where.eq("financeProvider", provider);
  return findDocs(db, META.finance, { where, orderBy: "createdAt DESC, id", hydrateWith: FinanceTransaction });
}

const REMINDER_FIELDS: Projection = {
  doId: 1,
  invoiceNumber: 1,
  customerName: 1,
  financeProvider: 1,
  date: 1,
  paymentReceivedDate: 1,
  actualReceivedAmount: 1,
  netDisbursement: 1,
  bankAccountRef: 1,
  transactionRef: 1,
};

/** GET /api/finance/reminders (also /api/me/summary): paid-out DOs with no bank account or UTR. */
export async function mongoFinanceReminders() {
  const missing = { $in: ["", null] };
  return FinanceTransaction.find(
    {
      approvalStatus: { $in: ["Disbursed", "Reconciled"] },
      $or: [{ bankAccountRef: missing }, { transactionRef: missing }],
    },
    {
      doId: 1,
      invoiceNumber: 1,
      customerName: 1,
      financeProvider: 1,
      date: 1,
      paymentReceivedDate: 1,
      actualReceivedAmount: 1,
      netDisbursement: 1,
      bankAccountRef: 1,
      transactionRef: 1,
    }
  )
    .sort({ paymentReceivedDate: 1 })
    .lean();
}

export async function d1FinanceReminders(db: D1DatabaseLike) {
  const where = new Where()
    .in("approvalStatus", ["Disbursed", "Reconciled"])
    .raw(`(bankAccountRef IS NULL OR bankAccountRef = '' OR transactionRef IS NULL OR transactionRef = '')`);
  return findDocs(db, META.finance, { where, orderBy: "paymentReceivedDate ASC, id", projection: REMINDER_FIELDS });
}

/** GET /api/dashboard/stats: every finance record (finance figures, settlement checks). */
export async function mongoDashboardFinanceSummary() {
  return FinanceTransaction.find({}, { invoiceNumber: 1, approvalStatus: 1, financeProvider: 1, doId: 1, bankAccountRef: 1, transactionRef: 1, paymentReceivedDate: 1, actualReceivedAmount: 1 }).lean();
}

export async function d1DashboardFinanceSummary(db: D1DatabaseLike) {
  return findDocs(db, META.finance, {
    projection: { invoiceNumber: 1, approvalStatus: 1, financeProvider: 1, doId: 1, bankAccountRef: 1, transactionRef: 1, paymentReceivedDate: 1, actualReceivedAmount: 1 },
  });
}

/** lib/cashRegister.ts: every finance record, newest first (not .lean()). */
export async function mongoCashRegisterFinanceRecords() {
  return FinanceTransaction.find({}).sort({ createdAt: -1 });
}

export async function d1CashRegisterFinanceRecords(db: D1DatabaseLike) {
  return findDocs(db, META.finance, { orderBy: "createdAt DESC, id", hydrateWith: FinanceTransaction });
}

// ---------------------------------------------------------------------------
// deleted_invoices
// ---------------------------------------------------------------------------

/** GET /api/dashboard/stats: bills deleted in the period. */
export async function mongoDeletedInRange(rangeStart: Date, rangeEnd: Date) {
  return DeletedInvoice.find({ deletedAt: { $gte: rangeStart, $lte: rangeEnd } })
    .sort({ deletedAt: -1 })
    .lean();
}

export async function d1DeletedInRange(db: D1DatabaseLike, rangeStart: Date, rangeEnd: Date) {
  const where = new Where().cmp("deletedAt", ">=", rangeStart.toISOString()).cmp("deletedAt", "<=", rangeEnd.toISOString());
  return findDocs(db, META.deletedInvoices, { where, orderBy: "deletedAt DESC, id" });
}

/** GET /api/invoices/next-number: numbers of deleted bills (still taken). */
export async function mongoDeletedInvoiceNumbers() {
  return DeletedInvoice.find({}, { invoiceNumber: 1 }).lean();
}

export async function d1DeletedInvoiceNumbers(db: D1DatabaseLike) {
  return findDocs(db, META.deletedInvoices, { projection: { invoiceNumber: 1 } });
}

// ---------------------------------------------------------------------------
// billing_companies
// ---------------------------------------------------------------------------

/** GET /api/billing-companies. */
export async function mongoBillingCompanies() {
  return BillingCompany.find({}).sort({ usageCount: -1, companyName: 1 }).lean();
}

export async function d1BillingCompanies(db: D1DatabaseLike) {
  return findDocs(db, META.billingCompanies, { orderBy: "usageCount DESC, companyName ASC, id" });
}
