/**
 * STOCK and STAFF reads that live in files shared with the sales area (dashboard stats, profit & loss, product ledger,
 * GSTR reports, the cash register, staff incentives, notifications), run through their areas' read switches
 * (`read:stock`, `read:staff`). Each is
 *
 *   readWithShadow(area, name, () => REGISTRY[name].mongo(args), (db) => REGISTRY[name].d1(args, db), { compare })
 *
 * The registry's mongo functions are the queries those files ran, moved, and they connect to MongoDB themselves.
 * Only the reads of those shared files are given compare rules here; the stock / staff routes of their own are wired
 * with their area's other reads.
 *
 * Compare rules, and why (same reasoning as lib/repo/sales/compare.ts):
 *  - no sort in MongoDB -> compared as a set (its natural order is not part of the query);
 *  - sorted -> `tieOrder` on the sort key (equal keys have no defined order);
 *  - `__v`: 0 equals absent (D1's NOT NULL DEFAULT 0 for a document written without mongoose);
 *  - a boolean column: `false` equals absent (D1 keeps 0/1, so an old document without the field reads `false`).
 * Nothing else is ignored; no amount is ever left out.
 */
import { readWithShadow } from "@/lib/d1/shadow";
import type { CompareOptions } from "@/lib/d1/compare";
import { STOCK_READS, type StockRead } from "@/lib/repo/stock";
import { isMongoOnlyInD1 } from "@/lib/repo/stock/types";
import { STAFF_READS } from "@/lib/repo/staff";

type Key = (d: any) => unknown;
const k = (...fields: string[]): Key => (d: any) => fields.map((f) => d?.[f] ?? null);
const V = { defaultsWhenMissing: { "[].__v": 0 } };
const sorted = (key: Key, docs = true): CompareOptions => ({ tieOrder: [{ path: "", key }], ...(docs ? V : {}) });
const unordered = (docs = true): CompareOptions => ({ unorderedPaths: [""], ...(docs ? V : {}) });

export const STOCK_SHARED_COMPARE: Record<string, CompareOptions> = {
  // dashboard stats
  "purchaseEntries.dashboard": unordered(false),
  "purchaseOrders.dashboard": sorted(k("createdAt"), false),
  "expenses.dashboard": sorted(k("createdAt"), false),
  "expenses.byIds": unordered(),
  "vendors.dashboard": unordered(false),
  "vendorBills.dashboard": unordered(false),
  "vendorPayments.dashboard": unordered(),
  // profit & loss
  "purchaseEntries.profitLoss": unordered(),
  "expenses.profitLoss": unordered(),
  // GSTR-2
  "purchaseEntries.gstr2": sorted(k("billDate")),
  // product ledger
  "purchaseEntries.byBillDateDesc": sorted(k("billDate", "createdAt")),
  "productLedger.movements": unordered(),
  "serialNumbers.productLedger": unordered(),
  // cash register
  // `voided` is a boolean column (0/1): an entry saved before the field existed reads `false` from D1.
  "cashTransactions.all": { tieOrder: [{ path: "", key: k("createdAt") }], defaultsWhenMissing: { "[].__v": 0, "[].voided": false } },
  "expenses.cash": sorted(k("createdAt")),
  "cashRegisterSetting.get": { defaultsWhenMissing: { __v: 0 } },
};

export const STAFF_SHARED_COMPARE: Record<string, CompareOptions> = {
  // notifications (the bell)
  "notifications.latest": sorted(k("createdAt")),
  "notifications.unreadCount": {},
  "notifications.unreadTaskRefs": unordered(false),
  // staff incentive book
  "salaries.paidIncentives": unordered(false),
  "payouts.amounts": unordered(false),
};

export function stockRead<T = any>(name: string, args: any = {}): Promise<T> {
  const entry = STOCK_READS[name];
  if (!entry) throw new Error(`unknown stock read ${name}`);
  return readWithShadow<T>("stock", name, () => entry.mongo(args), (db) => entry.d1(args, db), {
    compare: STOCK_SHARED_COMPARE[name],
    // The cash register reads answer from MongoDB even in d1 mode (they validate payouts; lib/repo/stock/types.ts).
    mongoOnlyInD1: isMongoOnlyInD1(entry as StockRead, args),
  });
}

/**
 * The staff D1 reads take their database from the Worker binding (or setStaffD1 in tests), which is the database the
 * read switch resolved, so `db` is not passed on.
 */
export function staffRead<T = any>(name: string, ...args: any[]): Promise<T> {
  const entry = STAFF_READS[name];
  if (!entry) throw new Error(`unknown staff read ${name}`);
  return readWithShadow<T>("staff", name, () => entry.mongo(...args), () => entry.d1(...args), { compare: STAFF_SHARED_COMPARE[name] });
}
