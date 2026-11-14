/**
 * Invoice reads of the GET paths (lib/repo/sales/INVENTORY.md lists where each one is used). Each read has two
 * implementations with the same arguments and the same result:
 *  - `mongo…`: the query exactly as the route / helper runs it today (moved here, not changed);
 *  - `d1…`: the same documents rebuilt from the D1 copy (lib/repo/sales/d1-docs.ts), in the same order.
 *
 * Order: Mongo returns rows with an equal sort key in the order of the index (or collection scan) that serves the
 * query, i.e. stored order (_id order for this app's data) or its reverse when an index is read backwards; each D1
 * read spells the same tie-break out in its ORDER BY.
 */
import Invoice from "@/models/Invoice";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { META, Where, countDocs, findDocs, findOneDoc, pathValues, regexMatches, valueEquals, type Projection } from "./d1-docs";

const M = META.invoices;

/**
 * Reads with no .sort() whose filter is on `type` come back in the order of the index the planner uses on the live
 * database (lib/ensure-indexes.ts): { type: 1, createdAt: -1 } for a bare type filter, { type: 1, status: 1,
 * date: -1 } when status is filtered too, { date: -1, createdAt: -1 } with a date range. The order is not part of those queries' contract (the registry marks them
 * `unordered`), but D1 returns the same one so a shadow comparison stays quiet.
 */
const TYPE_CREATED_ORDER = "type ASC, createdAt DESC, id";
const TYPE_STATUS_DATE_ORDER = "type ASC, status ASC, date DESC, id";
/** …and { date: -1, createdAt: -1 } once a date range is given. */
const DATE_ORDER = "date DESC, createdAt DESC, id";

// ---------------------------------------------------------------------------
// GET /api/invoices?invoiceNumber=  (one bill by its number)
// ---------------------------------------------------------------------------

export async function mongoInvoiceByNumber(oneNumber: string) {
  return Invoice.findOne({ invoiceNumber: oneNumber }).lean();
}

export async function d1InvoiceByNumber(db: D1DatabaseLike, oneNumber: string) {
  return findOneDoc(db, M, { where: new Where().eq("invoiceNumber", oneNumber) });
}

// ---------------------------------------------------------------------------
// GET /api/invoices (list: type / includeEstimates / warehouse)
// ---------------------------------------------------------------------------

export interface InvoiceListArgs {
  type: string | null;
  includeEstimates: boolean;
  warehouse: string | null;
}

export async function mongoInvoiceList({ type, includeEstimates, warehouse }: InvoiceListArgs) {
  const query: any = type
    ? { type }
    : { type: { $nin: includeEstimates ? ["sales-order"] : ["sales-order", "proforma"] } };

  const SHOWROOM_PATTERN = /showroom|ashoka|kunraghat|vp-?kun|main\s*store/i;
  let warehouseScoped = false;

  if (warehouse && warehouse !== "all") {
    const escaped = warehouse.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const locationClause = SHOWROOM_PATTERN.test(warehouse)
      ? [
          { warehouse: { $exists: false } },
          { warehouse: "" },
          { warehouse: null },
          { warehouse: { $regex: SHOWROOM_PATTERN } },
        ]
      : [
          { warehouse: { $regex: new RegExp(`^${escaped}$`, "i") } },
          { branchName: { $regex: new RegExp(`^${escaped}$`, "i") } },
        ];

    const scopedCount = await Invoice.countDocuments({ ...query, $or: locationClause });
    if (scopedCount > 0) {
      query.$or = locationClause;
      warehouseScoped = true;
    }
  }

  const invoices = await Invoice.find(query).sort({ createdAt: -1 }).lean();
  return { invoices, warehouseScoped };
}

export async function d1InvoiceList(db: D1DatabaseLike, { type, includeEstimates, warehouse }: InvoiceListArgs) {
  const base = () => (type ? new Where().eq("type", type) : new Where().nin("type", includeEstimates ? ["sales-order"] : ["sales-order", "proforma"]));
  const SHOWROOM_PATTERN = /showroom|ashoka|kunraghat|vp-?kun|main\s*store/i;
  let location: ((d: any) => boolean) | undefined;
  let warehouseScoped = false;

  if (warehouse && warehouse !== "all") {
    const escaped = warehouse.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (SHOWROOM_PATTERN.test(warehouse)) {
      location = (d) => d.warehouse === undefined || valueEquals(d.warehouse, "") || valueEquals(d.warehouse, null) || regexMatches(d.warehouse, SHOWROOM_PATTERN);
    } else {
      const re = new RegExp(`^${escaped}$`, "i");
      location = (d) => regexMatches(d.warehouse, re) || regexMatches(d.branchName, re);
    }
    const scopedCount = await countDocs(db, M, { where: base(), filter: location });
    if (scopedCount > 0) warehouseScoped = true;
  }

  const invoices = await findDocs(db, M, { where: base(), orderBy: "createdAt DESC, id", filter: warehouseScoped ? location : undefined });
  return { invoices, warehouseScoped };
}

// ---------------------------------------------------------------------------
// GET /api/orders (type / staff)
// ---------------------------------------------------------------------------

export async function mongoOrderList(type: string | null, staff: string | null) {
  const filter: any = type ? { type } : { type: { $in: ["sales-order", "tax-invoice"] } };

  if (staff && staff !== "all") {
    const firstName = staff.trim().split(" ")[0];
    filter.$or = [
      { salesExecutive: { $regex: new RegExp(staff, "i") } },
      { salesExecutive: { $regex: new RegExp(firstName, "i") } },
      { createdBy: { $regex: new RegExp(staff, "i") } },
      { createdBy: { $regex: new RegExp(firstName, "i") } },
      { salesperson: { $regex: new RegExp(staff, "i") } },
      { salesperson: { $regex: new RegExp(firstName, "i") } },
    ];
  }

  return Invoice.find(filter).sort({ createdAt: -1 }).lean();
}

export async function d1OrderList(db: D1DatabaseLike, type: string | null, staff: string | null) {
  const where = type ? new Where().eq("type", type) : new Where().in("type", ["sales-order", "tax-invoice"]);
  let filter: ((d: any) => boolean) | undefined;
  if (staff && staff !== "all") {
    const firstName = staff.trim().split(" ")[0];
    const res = [new RegExp(staff, "i"), new RegExp(firstName, "i")];
    filter = (d) => ["salesExecutive", "createdBy", "salesperson"].some((f) => res.some((re) => regexMatches(d[f], re)));
  }
  return findDocs(db, M, { where, orderBy: "createdAt DESC, id", filter });
}

// ---------------------------------------------------------------------------
// GET /api/payments: bills with money paid on them (the legacy-receipt backfill)
// ---------------------------------------------------------------------------

export async function mongoPaidInvoices(partyId: string | null) {
  const invoiceFilter = partyId ? { customerId: partyId, paidAmount: { $gt: 0 } } : { paidAmount: { $gt: 0 } };
  return Invoice.find(invoiceFilter).lean();
}

export async function d1PaidInvoices(db: D1DatabaseLike, partyId: string | null) {
  const where = new Where().cmp("paidAmount", ">", 0);
  if (partyId) where.eq("customerId", partyId);
  return findDocs(db, M, { where });
}

// ---------------------------------------------------------------------------
// GET /api/invoices/next-number
// ---------------------------------------------------------------------------

export async function mongoAllInvoiceNumbers() {
  return Invoice.find({}, { invoiceNumber: 1 }).lean();
}

export async function d1AllInvoiceNumbers(db: D1DatabaseLike) {
  return findDocs(db, M, { projection: { invoiceNumber: 1 } });
}

export async function mongoProformaNumbers() {
  return Invoice.find({ type: "proforma" }, { invoiceNumber: 1 }).lean();
}

export async function d1ProformaNumbers(db: D1DatabaseLike) {
  return findDocs(db, M, { where: new Where().eq("type", "proforma"), projection: { invoiceNumber: 1 } });
}

// ---------------------------------------------------------------------------
// GET /api/warranty: every bill except estimates; GET /api/vendors/ledger?party=customer
// ---------------------------------------------------------------------------

export async function mongoNonProformaInvoices() {
  return Invoice.find({ type: { $ne: "proforma" } }).lean();
}

export async function d1NonProformaInvoices(db: D1DatabaseLike) {
  return findDocs(db, M, { where: new Where().ne("type", "proforma"), orderBy: TYPE_CREATED_ORDER });
}

export async function mongoCustomerLedgerInvoices(id: string | null) {
  return id
    ? Invoice.find({ customerId: id, type: { $ne: "proforma" } }).lean()
    : Invoice.find({ type: { $ne: "proforma" } }).lean();
}

export async function d1CustomerLedgerInvoices(db: D1DatabaseLike, id: string | null) {
  const where = new Where().ne("type", "proforma");
  if (id) where.eq("customerId", id);
  return findDocs(db, M, { where, orderBy: id ? "id" : TYPE_CREATED_ORDER });
}

// ---------------------------------------------------------------------------
// GET /api/track/[id]
// ---------------------------------------------------------------------------

export async function mongoTrackInvoice(decodedId: string) {
  return Invoice.findOne({
    $or: [
      { invoiceNumber: decodedId },
      { invoiceNumber: { $regex: new RegExp(`^${decodedId}$`, "i") } },
      { deliveryChallanNo: decodedId },
    ]
  }).lean();
}

export async function d1TrackInvoice(db: D1DatabaseLike, decodedId: string) {
  const re = new RegExp(`^${decodedId}$`, "i");
  return findOneDoc(db, M, {
    filter: (d) => valueEquals(d.invoiceNumber, decodedId) || regexMatches(d.invoiceNumber, re) || valueEquals(d.deliveryChallanNo, decodedId),
  });
}

// ---------------------------------------------------------------------------
// GET /api/reports/sales-out
// ---------------------------------------------------------------------------

export interface SalesOutArgs {
  startDate: string | null;
  endDate: string | null;
  paymentMode: string | null;
  bank: string | null;
  dueOnly: string | null;
  staff: string | null;
  customer: string | null;
}

export async function mongoSalesOut({ startDate, endDate, paymentMode, bank, dueOnly, staff, customer }: SalesOutArgs) {
  const filter: any = {
    type: { $nin: ["sales-order", "proforma"] },
  };

  if (startDate && endDate) {
    filter.date = { $gte: startDate, $lte: endDate };
  } else if (startDate) {
    filter.date = { $gte: startDate };
  } else if (endDate) {
    filter.date = { $lte: endDate };
  }

  if (bank && bank !== "all") {
    if (["Cash", "UPI", "Online", "Card"].includes(bank)) {
      filter.paymentMode = bank;
    } else if (bank === "Finance") {
      filter.paymentMode = "Finance";
    } else {
      filter.$or = [
        { financeProvider: { $regex: bank, $options: "i" } },
        { paymentMode: { $regex: bank, $options: "i" } }
      ];
    }
  } else if (paymentMode && paymentMode !== "all") {
    filter.paymentMode = paymentMode;
  }

  if (dueOnly === "true") {
    filter.balanceAmount = { $gt: 0 };
  }

  if (staff && staff !== "all") {
    filter.salesExecutive = staff;
  }

  if (customer) {
    filter.customerName = { $regex: customer, $options: "i" };
  }

  return Invoice.find(filter).sort({ date: -1, createdAt: -1 }).lean();
}

export async function d1SalesOut(db: D1DatabaseLike, { startDate, endDate, paymentMode, bank, dueOnly, staff, customer }: SalesOutArgs) {
  const where = new Where().nin("type", ["sales-order", "proforma"]);
  const filters: ((d: any) => boolean)[] = [];
  if (startDate) where.cmp("date", ">=", startDate);
  if (endDate) where.cmp("date", "<=", endDate);

  if (bank && bank !== "all") {
    if (["Cash", "UPI", "Online", "Card", "Finance"].includes(bank)) {
      where.eq("paymentMode", bank);
    } else {
      const re = new RegExp(bank, "i");
      filters.push((d) => regexMatches(d.financeProvider, re) || regexMatches(d.paymentMode, re));
    }
  } else if (paymentMode && paymentMode !== "all") {
    where.eq("paymentMode", paymentMode);
  }
  if (dueOnly === "true") where.cmp("balanceAmount", ">", 0);
  if (staff && staff !== "all") where.eq("salesExecutive", staff);
  if (customer) {
    const re = new RegExp(customer, "i");
    filters.push((d) => regexMatches(d.customerName, re));
  }

  return findDocs(db, M, {
    where,
    orderBy: "date DESC, createdAt DESC, id",
    filter: filters.length ? (d) => filters.every((f) => f(d)) : undefined,
  });
}

// ---------------------------------------------------------------------------
// GET /api/gstr-reports
// ---------------------------------------------------------------------------

/** type=HSN_SUMMARY */
export async function mongoGstrHsnInvoices() {
  return Invoice.find({
    type: { $in: ["tax-invoice", "credit-note"] },
    status: { $ne: "cancelled" },
  })
    .sort({ date: 1 })
    .lean();
}

export async function d1GstrHsnInvoices(db: D1DatabaseLike) {
  return findDocs(db, M, { where: new Where().in("type", ["tax-invoice", "credit-note"]).ne("status", "cancelled"), orderBy: GSTR_ORDER });
}

/** type=GSTR1_B2B / GSTR1_B2C */
export async function mongoGstrB2bInvoices() {
  return Invoice.find({ type: "tax-invoice", status: { $ne: "cancelled" } })
    .sort({ date: 1 })
    .lean();
}

export async function d1GstrB2bInvoices(db: D1DatabaseLike) {
  return findDocs(db, M, { where: new Where().eq("type", "tax-invoice").ne("status", "cancelled"), orderBy: GSTR_ORDER });
}

/** type=GSTR1 */
export async function mongoGstr1Invoices() {
  return Invoice.find({ type: "tax-invoice" }).sort({ date: 1 }).lean();
}

export async function d1Gstr1Invoices(db: D1DatabaseLike) {
  return findDocs(db, M, { where: new Where().eq("type", "tax-invoice"), orderBy: GSTR_ORDER });
}

/**
 * `.sort({ date: 1 })` alone. Mongo serves it from the { date: -1, createdAt: -1 } index read backwards, so bills of
 * the same date come oldest createdAt first, and (same createdAt too) in reverse stored order.
 */
const GSTR_ORDER = "date ASC, createdAt ASC, id DESC";

// ---------------------------------------------------------------------------
// GET /api/reports/profit-loss
// ---------------------------------------------------------------------------

export interface ProfitLossArgs {
  startDate: string | null;
  endDate: string | null;
  branch: string | null;
}

export async function mongoProfitLossInvoices({ startDate, endDate, branch }: ProfitLossArgs) {
  const invoiceQuery: any = {
    status: { $nin: ["cancelled", "draft"] },
    type: { $ne: "proforma" },
  };

  if (startDate && endDate) {
    invoiceQuery.date = { $gte: startDate, $lte: endDate };
  } else if (startDate) {
    invoiceQuery.date = { $gte: startDate };
  } else if (endDate) {
    invoiceQuery.date = { $lte: endDate };
  }

  if (branch && branch !== "ALL") {
    invoiceQuery["branch.name"] = branch;
  }

  return Invoice.find(invoiceQuery).lean();
}

export async function d1ProfitLossInvoices(db: D1DatabaseLike, { startDate, endDate, branch }: ProfitLossArgs) {
  const where = new Where().nin("status", ["cancelled", "draft"]).ne("type", "proforma");
  if (startDate) where.cmp("date", ">=", startDate);
  if (endDate) where.cmp("date", "<=", endDate);
  const filter = branch && branch !== "ALL" ? (d: any) => pathValues(d.branch, ["name"]).some((v) => valueEquals(v, branch)) : undefined;
  return findDocs(db, M, { where, filter, orderBy: startDate || endDate ? DATE_ORDER : TYPE_STATUS_DATE_ORDER });
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/stats
// ---------------------------------------------------------------------------

/** Every invoice: what the all-time checks need (the route's INVOICE_SUMMARY_FIELDS). */
export const INVOICE_SUMMARY_FIELDS: Projection = {
  invoiceNumber: 1, type: 1, status: 1, date: 1, createdAt: 1, total: 1, customerName: 1,
  warehouse: 1, branchName: 1, paymentMode: 1, payments: 1, financeProvider: 1, financeDoId: 1,
  printLogs: 1, lastPrintedAt: 1, reprintCount: 1,
};

export async function mongoDashboardInvoiceSummary() {
  return Invoice.find({}, INVOICE_SUMMARY_FIELDS).sort({ createdAt: -1 }).lean();
}

export async function d1DashboardInvoiceSummary(db: D1DatabaseLike) {
  return findDocs(db, M, { orderBy: "createdAt DESC, id", projection: INVOICE_SUMMARY_FIELDS });
}

/** lib/mongo-read-helpers.ts loadComplete(Invoice, rows): the whole documents of the given _ids. */
export async function mongoInvoicesByIds(ids: any[]) {
  return Invoice.aggregate([{ $match: { _id: { $in: ids } } }]);
}

export async function d1InvoicesByIds(db: D1DatabaseLike, ids: any[]) {
  return findDocs(db, M, { where: new Where().in("id", ids.map((x) => String(x))) });
}

// ---------------------------------------------------------------------------
// lib/cashRegister.ts getCashRegisterSummary (GET /api/cash-register, /api/admin-cash, /api/day-close …)
// ---------------------------------------------------------------------------

export async function mongoCashInvoices() {
  return Invoice.find({
    type: "tax-invoice",
    $or: [
      { paymentMode: "Cash" },
      { paymentMode: "cash" },
      { "payments.mode": { $regex: /cash/i } },
    ],
    status: { $ne: "cancelled" },
  }).sort({ createdAt: -1 });
}

export async function d1CashInvoices(db: D1DatabaseLike) {
  const where = new Where()
    .eq("type", "tax-invoice")
    .raw(
      `(paymentMode IN ('Cash', 'cash') OR EXISTS (SELECT 1 FROM invoicePayments p WHERE p.invoiceId = invoices.id AND p.idx >= 0 AND p.mode LIKE '%cash%'))`
    )
    .ne("status", "cancelled");
  return findDocs(db, M, { where, orderBy: "createdAt DESC, id", hydrateWith: Invoice });
}

export async function mongoFinanceLinkedInvoices(financeInvoiceNumbers: string[]) {
  return financeInvoiceNumbers.length
    ? await Invoice.find(
        { invoiceNumber: { $in: financeInvoiceNumbers } },
        { invoiceNumber: 1, financeDownPaymentMode: 1 }
      ).lean()
    : [];
}

export async function d1FinanceLinkedInvoices(db: D1DatabaseLike, financeInvoiceNumbers: string[]) {
  if (!financeInvoiceNumbers.length) return [];
  return findDocs(db, M, { where: new Where().in("invoiceNumber", financeInvoiceNumbers), projection: { invoiceNumber: 1, financeDownPaymentMode: 1 } });
}

export async function mongoDueCashBills() {
  return Invoice.find(
    {
      type: "tax-invoice",
      status: { $ne: "cancelled" },
      paymentMode: { $regex: /due|credit/i },
      dueAdvanceMode: { $regex: /cash/i },
      paidAmount: { $gt: 0 },
    },
    { invoiceNumber: 1, customerName: 1, paidAmount: 1, dueAdvanceAmount: 1, date: 1, createdAt: 1 }
  ).lean();
}

export async function d1DueCashBills(db: D1DatabaseLike) {
  const where = new Where()
    .eq("type", "tax-invoice")
    .ne("status", "cancelled")
    .raw(`(paymentMode LIKE '%due%' OR paymentMode LIKE '%credit%')`)
    .raw(`dueAdvanceMode LIKE '%cash%'`)
    .cmp("paidAmount", ">", 0);
  return findDocs(db, M, { where, projection: { invoiceNumber: 1, customerName: 1, paidAmount: 1, dueAdvanceAmount: 1, date: 1, createdAt: 1 } });
}

// ---------------------------------------------------------------------------
// lib/staff-incentive.ts loadIncentiveBook (GET /api/staff/overview, my-incentive, incentive-payout)
// ---------------------------------------------------------------------------

const INCENTIVE_FIELDS: Projection = {
  invoiceNumber: 1, date: 1, customerName: 1, total: 1, salesExecutive: 1, salesExecutiveIncentive: 1, onsitegoIncentive: 1,
  "items.salesExecutive": 1, "items.incentiveEarned": 1, "items.extendedWarrantyProvider": 1, "items.extendedWarrantyAmount": 1,
  "items.amount": 1, "items.quantity": 1,
};

export async function mongoIncentiveBills() {
  return Invoice.find(
    { type: { $nin: ["proforma", "sales-order", "credit-note"] }, status: { $ne: "cancelled" } },
    {
      invoiceNumber: 1, date: 1, customerName: 1, total: 1, salesExecutive: 1, salesExecutiveIncentive: 1, onsitegoIncentive: 1,
      "items.salesExecutive": 1, "items.incentiveEarned": 1, "items.extendedWarrantyProvider": 1, "items.extendedWarrantyAmount": 1,
      "items.amount": 1, "items.quantity": 1,
    }
  )
    .sort({ date: -1, createdAt: -1 })
    .lean();
}

export async function d1IncentiveBills(db: D1DatabaseLike) {
  return findDocs(db, M, {
    where: new Where().nin("type", ["proforma", "sales-order", "credit-note"]).ne("status", "cancelled"),
    orderBy: "date DESC, createdAt DESC, id",
    projection: INCENTIVE_FIELDS,
  });
}

// ---------------------------------------------------------------------------
// lib/staff-brand-sales.ts brandSalesFor (GET /api/staff/brand-sales)
// ---------------------------------------------------------------------------

export async function mongoBrandSalesBills(from?: string, to?: string) {
  const dateQuery: any = {};
  if (from) dateQuery.$gte = from;
  if (to) dateQuery.$lte = to;
  const query: any = { type: { $nin: ["proforma", "sales-order", "credit-note"] }, status: { $ne: "cancelled" } };
  if (from || to) query.date = dateQuery;
  return Invoice.find(query, { salesExecutive: 1, items: 1, date: 1 }).lean();
}

export async function d1BrandSalesBills(db: D1DatabaseLike, from?: string, to?: string) {
  const where = new Where().nin("type", ["proforma", "sales-order", "credit-note"]).ne("status", "cancelled");
  if (from) where.cmp("date", ">=", from);
  if (to) where.cmp("date", "<=", to);
  return findDocs(db, M, { where, projection: { salesExecutive: 1, items: 1, date: 1 }, orderBy: from || to ? DATE_ORDER : TYPE_STATUS_DATE_ORDER });
}

// ---------------------------------------------------------------------------
// lib/delivery-reminders.ts sendDueDeliveryReminders (run from GET /api/notifications)
// ---------------------------------------------------------------------------

export async function mongoDueDeliveryInvoices(until: string) {
  return Invoice.find(
    {
      expectedDeliveryDate: { $nin: ["", null], $lte: until },
      deliveryStatus: { $ne: "delivered" },
      status: { $ne: "cancelled" },
      deliveryReminderSentAt: { $exists: false },
    },
    { invoiceNumber: 1, customerName: 1, customerPhone: 1, expectedDeliveryDate: 1, salesExecutive: 1, deliveryNote: 1, items: 1 }
  )
    .limit(50)
    .lean();
}

export async function d1DueDeliveryInvoices(db: D1DatabaseLike, until: string) {
  const where = new Where()
    .raw(`expectedDeliveryDate IS NOT NULL AND expectedDeliveryDate <> ''`)
    .cmp("expectedDeliveryDate", "<=", until)
    .ne("deliveryStatus", "delivered")
    .ne("status", "cancelled")
    .raw(`NOT EXISTS (SELECT 1 FROM invoiceDelivery dl WHERE dl.invoiceId = invoices.id AND dl.deliveryReminderSentAt IS NOT NULL)`);
  return findDocs(db, M, {
    where,
    limit: 50,
    projection: { invoiceNumber: 1, customerName: 1, customerPhone: 1, expectedDeliveryDate: 1, salesExecutive: 1, deliveryNote: 1, items: 1 },
  });
}
