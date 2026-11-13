/**
 * Stage B2 wiring of the STOCK / PURCHASE / CASH reads: a route calls
 *
 *   const rows = await readStock("purchaseOrders.list", {});
 *
 * which is readWithShadow("stock", name, () => STOCK_READS[name].mongo(args), (db) => STOCK_READS[name].d1(args, db))
 * with the comparison rules below. The `mongo` side is the route's old query, unchanged (lib/repo/stock/*.ts, each
 * connects to MongoDB itself), so with the switch `read:stock` on 'mongo' (or missing) nothing changes.
 *
 * Comparison rules (lib/d1/compare.ts), and WHY each exists:
 *  - `__v`: `0` equals absent. D1's `v` column always holds a number, so a document written without mongoose (an
 *    import, a script) and therefore without __v reads 0 from D1. No screen reads __v. Given for a single document
 *    ("__v"), a list ("[].__v") and the lines of a document, so one rule fits every read.
 *  - Sorted reads (`tieOrder`): documents with an EQUAL sort key come back from MongoDB in no defined order (its
 *    in-memory sort is not stable and differs between server builds), D1 gives them in _id order. The sequence of
 *    sort keys must still match exactly.
 *  - Reads without a sort (`unorderedPaths`): MongoDB's natural order is not defined; D1 uses _id order.
 * Everything else must be identical, as in tests/d1-stock-reads.test.ts.
 */
import { readWithShadow } from "@/lib/d1/shadow";
import type { CompareOptions } from "@/lib/d1/compare";
import { STOCK_READS } from "./index";

const DOC_DEFAULTS: Record<string, unknown> = { __v: 0, "[].__v": 0 };

const sorted = (key: (d: any) => unknown): CompareOptions => ({ defaultsWhenMissing: DOC_DEFAULTS, tieOrder: [{ path: "", key }] });
const unordered: CompareOptions = { defaultsWhenMissing: DOC_DEFAULTS, unorderedPaths: [""] };
const plain: CompareOptions = { defaultsWhenMissing: DOC_DEFAULTS };

const byCreatedAt = sorted((d) => d?.createdAt ?? null);
const byDateCreated = sorted((d) => [d?.date ?? null, d?.createdAt ?? null]);
const byDate = sorted((d) => d?.date ?? null);

export const STOCK_COMPARE: Record<string, CompareOptions> = {
  // purchases
  "purchaseEntries.list": byCreatedAt,
  "purchaseEntries.allNatural": unordered,
  "purchaseEntries.allNewestFirst": byCreatedAt,
  "purchaseEntries.byBillDateDesc": sorted((d) => [d?.billDate ?? null, d?.createdAt ?? null]),
  "purchaseEntries.gstr2": sorted((d) => d?.billDate ?? null),
  "purchaseEntries.agedStock": unordered,
  "purchaseEntries.dashboard": unordered,
  "purchaseEntries.profitLoss": unordered,
  "purchaseEntries.brandInfo": sorted((d) => d?.billDate ?? null),
  "purchaseEntries.byBillNo": plain,
  "deletedPurchaseEntries.audit": sorted((d) => d?.deletedAt ?? null),
  "purchaseOrders.list": byCreatedAt,
  "purchaseOrders.dashboard": byCreatedAt,
  "expenses.list": byCreatedAt,
  "expenses.dashboard": byCreatedAt,
  "expenses.byIds": unordered,
  "expenses.profitLoss": unordered,
  "expenses.cash": byCreatedAt,
  "productCatalogReferences.list": sorted((d) => d?.vpCode ?? null),
  "productCatalogReferences.withCategory": unordered,
  "productCatalogReferences.groupMappings": unordered,
  "variants.list": byCreatedAt,
  "serialNumbers.byNumbers": unordered,
  // stock
  "stockAdjustments.list": byCreatedAt,
  "stockJournals.list": byCreatedAt,
  "stockRequests.list": byCreatedAt,
  "stockReturns.list": byCreatedAt,
  "billOfMaterials.list": byCreatedAt,
  "stockTransfers.list": byCreatedAt,
  "stockTransfers.byDateDesc": byDateCreated,
  "productLedger.movements": unordered,
  "inventoryAudits.forDay": plain,
  "inventoryAudits.byId": plain,
  "inventoryAudits.list": sorted((d) => [d?.auditDate ?? null, d?.createdAt ?? null]),
  "serialNumbers.list": byCreatedAt,
  "serialNumbers.productLedger": unordered,
  "serialNumbers.search": unordered,
  "stockOrders.list": byCreatedAt,
  "stockOrders.pending": byCreatedAt,
  "supplierStock.lastUpload": plain,
  "supplierStock.items": sorted((d) => [d?.isNewArrival ?? null, d?.brand ?? null, d?.description ?? null]),
  // vendors
  "vendors.list": byCreatedAt,
  "vendors.ledger": unordered,
  "vendors.dashboard": unordered,
  "vendorBills.list": byDateCreated,
  "vendorBills.ledger": unordered,
  "vendorBills.detail": byDate,
  "vendorBills.dashboard": unordered,
  "vendorPayments.list": byDateCreated,
  "vendorPayments.ledger": unordered,
  "vendorPayments.detail": byDate,
  "vendorPayments.dashboard": unordered,
  // cash
  "cashTransactions.all": byCreatedAt,
  "cashRegisterSetting.get": plain,
  "dayCloses.latest": plain,
  "dayCloses.latestDate": plain,
  "dayCloses.history": byDate,
  "dayCloses.allAsc": byDate,
  "adminCashEntries.book": byDateCreated,
  "bankAccounts.list": byCreatedAt,
  "bankAccounts.legacy": unordered,
};

/** One STOCK_READS entry through the `read:stock` switch (mongo / shadow / d1). */
export function readStock<T = any>(name: keyof typeof STOCK_READS & string, args: Record<string, unknown> = {}): Promise<T> {
  const entry = STOCK_READS[name];
  if (!entry) throw new Error(`readStock: unknown read ${name}`);
  return readWithShadow<T>(
    "stock",
    name,
    () => entry.mongo(args),
    (db) => entry.d1(args, db),
    { compare: STOCK_COMPARE[name] ?? plain }
  );
}
