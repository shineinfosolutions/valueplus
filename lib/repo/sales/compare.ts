/**
 * How the shadow comparison (lib/d1/compare.ts) treats each SALES & MONEY read, and WHY. The routes pass the matching
 * entry to readWithShadow (through salesRead in lib/repo/sales/shadow.ts); tests/d1-wiring-sales-crm.test.ts uses
 * the same entries, so "identical" in the test means exactly what the live comparison checks.
 *
 * The rules are only the ones the copy forces (lib/repo/sales/INVENTORY.md, "Known limits"):
 *  - Reads with no .sort() (`unordered` in SALES_READS): MongoDB's order is whatever the planner picks, so the array
 *    is compared as a set (unorderedPaths).
 *  - Sorted reads: `tieOrder` on the sort key. The key sequence must match exactly; only documents with an EQUAL key
 *    (two bills created in the same millisecond) may come in another order, because MongoDB does not define it.
 *  - `__v`: `0` equals absent. D1's `v` column is NOT NULL DEFAULT 0, so a document written without mongoose (an
 *    import, a script) reads __v 0 from D1 (known limit 4). No screen reads __v.
 *  - Booleans: `false` equals absent (known limit 2). D1 keeps a boolean as 0/1, so an old bill saved before e.g.
 *    `adminOverridePinUsed` existed reads `false` from D1 while MongoDB leaves the field out; both are falsy for the
 *    app. Only the boolean columns of the copy (lib/d1/maps/sales.ts) are listed, and only with the value `false`.
 * Nothing else is ignored: no money field, no total, no status. A null and a missing field are already the same to
 * the comparator.
 */
import type { CompareOptions } from "@/lib/d1/compare";
import { SALES_READS } from "./registry";

type Key = (d: any) => unknown;
const k = (...fields: string[]): Key => (d: any) => fields.map((f) => d?.[f] ?? null);

/** The boolean columns of each copied document kind (lib/d1/maps/sales.ts): `false` there equals absent. */
const BOOLEANS: Record<string, string[]> = {
  invoice: ["adminOverridePinUsed", "isShippingSameAsBilling", "receivedBySelf", "deliverySerialMatched", "items[].adminOverrideRate"],
  deleted: ["pinVerified", "usedLegacyPin"],
  challan: ["autoFromBill"],
  none: [],
};

/** The "absent equals" rules for documents at `prefix` ("" = the answer itself is one document). */
function docDefaults(prefix: string, kind: keyof typeof BOOLEANS, withV: boolean): Record<string, unknown> {
  const p = prefix ? `${prefix}.` : "";
  const out: Record<string, unknown> = withV ? { [`${p}__v`]: 0 } : {};
  for (const b of BOOLEANS[kind]) out[`${p}${b}`] = false;
  return out;
}

/** Sorted list at `path` ("" = the answer itself). `docs`: whole documents (they carry __v). */
function sorted(path: string, key: Key, docs = true, kind: keyof typeof BOOLEANS = "none"): CompareOptions {
  const defaults = docDefaults(path ? `${path}[]` : "[]", kind, docs);
  return { tieOrder: [{ path, key }], ...(Object.keys(defaults).length ? { defaultsWhenMissing: defaults } : {}) };
}

/** A find() without sort: compared as a set. */
function unordered(kind: keyof typeof BOOLEANS = "none", docs = true): CompareOptions {
  const defaults = docDefaults("[]", kind, docs);
  return { unorderedPaths: [""], ...(Object.keys(defaults).length ? { defaultsWhenMissing: defaults } : {}) };
}

/** One document (or null). */
const oneDoc = (kind: keyof typeof BOOLEANS = "none"): CompareOptions => ({ defaultsWhenMissing: docDefaults("", kind, true) });

const byCreatedAt = k("createdAt");

export const SALES_COMPARE: Record<string, CompareOptions> = {
  // invoices
  "invoices.byNumber": oneDoc("invoice"),
  /** { invoices, warehouseScoped }: newest first. */
  "invoices.list": sorted("invoices", byCreatedAt, true, "invoice"),
  "orders.list": sorted("", byCreatedAt, true, "invoice"),
  "track.invoice": oneDoc("invoice"),
  /** sort { date: -1, createdAt: -1 } */
  "salesOut.invoices": sorted("", k("date", "createdAt"), true, "invoice"),
  /** sort { date: 1 }: same-day bills come in index order, which D1 reproduces but a planner change can alter. */
  "gstr.hsnInvoices": sorted("", k("date"), true, "invoice"),
  "gstr.b2bInvoices": sorted("", k("date"), true, "invoice"),
  "gstr.gstr1Invoices": sorted("", k("date"), true, "invoice"),
  /** Projection without __v. */
  "dashboard.invoiceSummary": sorted("", byCreatedAt, false),
  "cashRegister.cashInvoices": sorted("", byCreatedAt, true, "invoice"),
  /** Projection without __v; sort { date: -1, createdAt: -1 }. */
  "staffIncentive.bills": sorted("", k("date", "createdAt"), false),

  // payment_transactions
  "payments.list": sorted("", k("date")),
  "dashboard.paymentSummary": sorted("", byCreatedAt, false),

  // customer_advances / finance / deleted / billing companies
  "advances.list": sorted("", byCreatedAt),
  "finance.list": sorted("", byCreatedAt),
  "finance.reminders": sorted("", k("paymentReceivedDate"), false),
  "cashRegister.financeRecords": sorted("", byCreatedAt),
  "dashboard.deletedInRange": sorted("", k("deletedAt"), true, "deleted"),
  "billingCompanies.list": sorted("", k("usageCount", "companyName")),

  // estimates / challans / e-way bills / warranties
  "estimates.list": sorted("", byCreatedAt),
  "challans.list": sorted("", byCreatedAt, true, "challan"),
  "track.challan": oneDoc("challan"),
  "ewayBills.list": sorted("", byCreatedAt),
  "warranty.list": sorted("", byCreatedAt),

  // approvals
  "discountApprovals.list": sorted("", byCreatedAt),
  /** { approvals, pendingCount }: newest first. */
  "approvals.list": sorted("approvals", byCreatedAt),
};

// Every read without a sort is compared as a set. Whole bills (and the projections that keep `items`) also get the
// invoice booleans; a projection that leaves a field out simply never has it on either side.
const UNORDERED_KIND: Record<string, keyof typeof BOOLEANS> = {
  "payments.paidInvoices": "invoice",
  "warranty.invoices": "invoice",
  "vendorsLedger.customerInvoices": "invoice",
  "profitLoss.invoices": "invoice",
  "dashboard.invoicesByIds": "invoice",
  "staffBrandSales.bills": "invoice",
  "deliveryReminders.dueInvoices": "invoice",
};
for (const [name, r] of Object.entries(SALES_READS)) {
  if (r.unordered && !SALES_COMPARE[name]) SALES_COMPARE[name] = unordered(UNORDERED_KIND[name] || "none");
}
