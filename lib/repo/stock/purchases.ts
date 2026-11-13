/**
 * Purchase reads: purchase entries (and debit notes), the deleted-bill archive, purchase orders, expenses, the
 * product catalogue reference and variants. Each `mongo` is the query as the route / helper runs it today (copied,
 * not changed); each `d1` returns the same documents from D1. See INVENTORY.md for where each one is used.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import PurchaseEntry from "@/models/PurchaseEntry";
import DeletedPurchaseEntry from "@/models/DeletedPurchaseEntry";
import PurchaseOrder from "@/models/PurchaseOrder";
import Expense from "@/models/Expense";
import ProductCatalogReference from "@/models/ProductCatalogReference";
import Variant from "@/models/Variant";
import SerialNumber from "@/models/SerialNumber";
import { istDayEnd, istDayStart } from "@/lib/ist";
import { findDocs, findOneDoc, inList, iso, ne, regexFilter, escapeRegex, useDb } from "./d1-doc";
import { read } from "./types";

const PE = "purchase_entries";

/** Same as app/api/dashboard/stats/route.ts PURCHASE_FIELDS. */
const PURCHASE_FIELDS = {
  billNo: 1, supplierName: 1, supplierId: 1, billDate: 1, date: 1, dueDate: 1, total: 1, paid: 1,
  paymentMode: 1, type: 1, status: 1, createdAt: 1,
} as const;

/** `field` between optional bounds, the way profit-loss builds it (both / only start / only end). */
function rangeFilter(field: string, startDate?: string | null, endDate?: string | null) {
  const q: any = {};
  if (startDate && endDate) q[field] = { $gte: startDate, $lte: endDate };
  else if (startDate) q[field] = { $gte: startDate };
  else if (endDate) q[field] = { $lte: endDate };
  return q;
}
function rangeSql(col: string, startDate?: string | null, endDate?: string | null): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (startDate) {
    sql.push(`${col} >= ?`);
    params.push(startDate);
  }
  if (endDate) {
    sql.push(`${col} <= ?`);
    params.push(endDate);
  }
  return { sql, params };
}

const toObjectIds = (ids: string[]) => ids.map((id) => (mongoose.isValidObjectId(id) && /^[0-9a-f]{24}$/i.test(id) ? new mongoose.Types.ObjectId(id) : id));

export const PURCHASE_READS = {
  /** GET /api/purchase-entries[?type=] — entries (default) or one type, newest first. */
  "purchaseEntries.list": read<{ type?: string | null }>({
    mongo: async ({ type }) => {
      await connectToDatabase();
      const query = type ? { type } : { type: { $ne: "debit-note" } };
      return PurchaseEntry.find(query).sort({ createdAt: -1 }).lean();
    },
    d1: async ({ type }, db) =>
      findDocs(useDb(db), PE, {
        where: type ? "type = ?" : ne("type"),
        params: [type || "debit-note"],
        orderBy: "createdAt DESC, id",
      }),
  }),

  /** Every purchase bill in stored order: serial-number reconcile (GET /api/serial-numbers), supplier ledgers (GET /api/vendors/ledger?party=supplier). */
  "purchaseEntries.allNatural": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return PurchaseEntry.find({}).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), PE, { orderBy: "id" }),
  }),

  /** Every bill newest first: GET /api/admin/debug-stock. */
  "purchaseEntries.allNewestFirst": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return PurchaseEntry.find({}).sort({ createdAt: -1 }).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), PE, { orderBy: "createdAt DESC, id" }),
  }),

  /**
   * By bill date, newest first: GET /api/inventory/stock-flow (no range) and GET /api/reports/product-ledger
   * (billDate range only when both dates are given).
   */
  "purchaseEntries.byBillDateDesc": read<{ startDate?: string | null; endDate?: string | null }>({
    mongo: async ({ startDate, endDate }) => {
      await connectToDatabase();
      const purchaseQuery: any = {};
      if (startDate && endDate) purchaseQuery.billDate = { $gte: startDate, $lte: endDate };
      return PurchaseEntry.find(purchaseQuery).sort({ billDate: -1, createdAt: -1 }).lean();
    },
    d1: async ({ startDate, endDate }, db) => {
      const both = !!(startDate && endDate);
      return findDocs(useDb(db), PE, {
        where: both ? "billDate >= ? AND billDate <= ?" : undefined,
        params: both ? [startDate, endDate] : [],
        orderBy: "billDate DESC, createdAt DESC, id",
      });
    },
  }),

  /** GET /api/gstr-reports?type=GSTR2 — every bill, oldest bill date first. */
  "purchaseEntries.gstr2": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return PurchaseEntry.find({}).sort({ billDate: 1 }).lean();
    },
    // Live, the production index { billDate: -1, createdAt: -1 } (lib/ensure-indexes.ts) is read backwards for this
    // sort, so bills with the same bill date come oldest-created first and, on a full tie, newest-stored first.
    d1: async (_a, db) => findDocs(useDb(db), PE, { orderBy: "billDate, createdAt, id DESC" }),
  }),

  /** GET /api/reports/aged-stock — dates, state and the item of each line. */
  "purchaseEntries.agedStock": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return PurchaseEntry.find({}, { billDate: 1, date: 1, createdAt: 1, status: 1, type: 1, "items.itemId": 1, "items.name": 1 }).lean();
    },
    d1: async (_a, db) =>
      findDocs(useDb(db), PE, {
        orderBy: "id",
        projection: { billDate: 1, date: 1, createdAt: 1, status: 1, type: 1, "items.itemId": 1, "items.name": 1 },
      }),
  }),

  /** GET /api/dashboard/stats — every bill (PURCHASE_FIELDS), stored order. */
  "purchaseEntries.dashboard": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return PurchaseEntry.find({}, PURCHASE_FIELDS).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), PE, { orderBy: "id", projection: { ...PURCHASE_FIELDS }, lines: false }),
  }),

  /** GET /api/reports/profit-loss — bills that are not cancelled, in the bill-date range. */
  "purchaseEntries.profitLoss": read<{ startDate?: string | null; endDate?: string | null }>({
    mongo: async ({ startDate, endDate }) => {
      await connectToDatabase();
      const purchaseQuery: any = { status: { $ne: "cancelled" }, ...rangeFilter("billDate", startDate, endDate) };
      return PurchaseEntry.find(purchaseQuery).lean();
    },
    d1: async ({ startDate, endDate }, db) => {
      const r = rangeSql("billDate", startDate, endDate);
      // No sort is asked for, so MongoDB returns its plan's order: stored order for a collection scan, but with a bill
      // date range it walks the index { billDate: -1, createdAt: -1 } (lib/ensure-indexes.ts), newest bill date first.
      return findDocs(useDb(db), PE, {
        where: [ne("status"), ...r.sql].join(" AND "),
        params: ["cancelled", ...r.params],
        orderBy: r.sql.length ? "billDate DESC, createdAt DESC, id" : "id",
      });
    },
  }),

  /** GET /api/items/brand-info — the product's last 5 purchase bills. */
  "purchaseEntries.brandInfo": read<{ id: string; name: string }>({
    mongo: async ({ id, name }) => {
      await connectToDatabase();
      return PurchaseEntry.find(
        { type: { $ne: "debit-note" }, status: { $ne: "cancelled" }, $or: [{ "items.itemId": id }, { "items.name": name }] },
        { billNo: 1, supplierName: 1, billDate: 1, items: 1 }
      )
        .sort({ billDate: -1 })
        .limit(5)
        .lean();
    },
    d1: async ({ id, name }, db) =>
      findDocs(useDb(db), PE, {
        where: `${ne("type")} AND ${ne("status")} AND EXISTS (SELECT 1 FROM purchaseEntryItems l WHERE l.purchaseEntryId = purchaseEntries.id AND l.lineNo >= 0 AND (l.itemId = ? OR l.name = ?))`,
        params: ["debit-note", "cancelled", id, name],
        orderBy: "billDate DESC, id",
        limit: 5,
        projection: { billNo: 1, supplierName: 1, billDate: 1, items: 1 },
      }),
  }),

  /** POST /api/purchase-entries/serials, PUT / DELETE /api/purchase-entries, lib/change-requests.ts — one bill by number (a mongoose document). */
  "purchaseEntries.byBillNo": read<{ billNo: string }>({
    mongo: async ({ billNo }) => {
      await connectToDatabase();
      return PurchaseEntry.findOne({ billNo });
    },
    d1: async ({ billNo }, db) => findOneDoc(useDb(db), PE, { where: "billNo = ?", params: [billNo], orderBy: "id" }),
  }),

  /** GET /api/audit?view=deleted-purchase-entries — the deleted-bill archive. */
  "deletedPurchaseEntries.audit": read<{ from?: string | null; to?: string | null; q?: string; limit: number }>({
    mongo: async ({ from, to, q, limit }) => {
      await connectToDatabase();
      const range: any = {};
      if (from) range.$gte = istDayStart(from);
      if (to) range.$lte = istDayEnd(to);
      const filter: any = {};
      if (from || to) filter.deletedAt = range;
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [{ billNo: rx }, { supplierName: rx }, { deletedBy: rx }];
      }
      return DeletedPurchaseEntry.find(filter).sort({ deletedAt: -1 }).limit(limit).lean();
    },
    d1: async ({ from, to, q, limit }, db) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (from) {
        where.push("deletedAt >= ?");
        params.push(iso(istDayStart(from)));
      }
      if (to) {
        where.push("deletedAt <= ?");
        params.push(iso(istDayEnd(to)));
      }
      let post: ((d: any) => boolean) | undefined;
      if (q) {
        const parts = ["billNo", "supplierName", "deletedBy"].map((f) => regexFilter(f, f, escapeRegex(q)));
        if (parts.every((p) => p.sql)) {
          where.push(`(${parts.map((p) => p.sql).join(" OR ")})`);
          parts.forEach((p) => params.push(...p.params));
        } else post = (d) => parts.some((p) => p.test(d));
      }
      return findDocs(useDb(db), "deleted_purchase_entries", {
        where: where.join(" AND ") || undefined,
        params,
        orderBy: "deletedAt DESC, id",
        limit,
        post,
      });
    },
  }),

  /** GET /api/purchase-orders — newest first. */
  "purchaseOrders.list": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return PurchaseOrder.find({}).sort({ createdAt: -1 }).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), "purchase_orders", { orderBy: "createdAt DESC, id" }),
  }),

  /** GET /api/dashboard/stats — status / date / amount of every PO, newest first. */
  "purchaseOrders.dashboard": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return PurchaseOrder.find({}, { status: 1, date: 1, createdAt: 1, totalAmount: 1 }).sort({ createdAt: -1 }).lean();
    },
    d1: async (_a, db) =>
      findDocs(useDb(db), "purchase_orders", { orderBy: "createdAt DESC, id", projection: { status: 1, date: 1, createdAt: 1, totalAmount: 1 } }),
  }),

  /** GET /api/expenses — mongoose documents, newest first. */
  "expenses.list": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return Expense.find({}).sort({ createdAt: -1 });
    },
    d1: async (_a, db) => findDocs(useDb(db), "expenses", { orderBy: "createdAt DESC, id" }),
  }),

  /** GET /api/dashboard/stats — the fields that pick the period's expenses, newest first. */
  "expenses.dashboard": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return Expense.find({}, { warehouse: 1, branchName: 1, date: 1, createdAt: 1 }).sort({ createdAt: -1 }).lean();
    },
    d1: async (_a, db) =>
      findDocs(useDb(db), "expenses", { orderBy: "createdAt DESC, id", projection: { warehouse: 1, branchName: 1, date: 1, createdAt: 1 } }),
  }),

  /** GET /api/dashboard/stats — loadComplete(Expense, rows): the whole documents of the picked rows (aggregate $match, stored order). */
  "expenses.byIds": read<{ ids: string[] }>({
    mongo: async ({ ids }) => {
      await connectToDatabase();
      return Expense.aggregate([{ $match: { _id: { $in: toObjectIds(ids) } } }]);
    },
    d1: async ({ ids }, db) => findDocs(useDb(db), "expenses", { where: inList("id"), params: [JSON.stringify(ids)], orderBy: "id" }),
  }),

  /** GET /api/reports/profit-loss — expenses in the date range, stored order. */
  "expenses.profitLoss": read<{ startDate?: string | null; endDate?: string | null }>({
    mongo: async ({ startDate, endDate }) => {
      await connectToDatabase();
      return Expense.find(rangeFilter("date", startDate, endDate)).lean();
    },
    d1: async ({ startDate, endDate }, db) => {
      const r = rangeSql("date", startDate, endDate);
      return findDocs(useDb(db), "expenses", { where: r.sql.join(" AND ") || undefined, params: r.params, orderBy: "id" });
    },
  }),

  /** lib/cashRegister.ts getCashRegisterSummary — cash expenses (mongoose documents), newest first. */
  "expenses.cash": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return Expense.find({ $or: [{ paymentMode: "Cash" }, { paymentMode: "cash" }] }).sort({ createdAt: -1 });
    },
    d1: async (_a, db) => findDocs(useDb(db), "expenses", { where: "paymentMode IN ('Cash', 'cash')", orderBy: "createdAt DESC, id" }),
  }),

  /** GET /api/product-reference — the whole catalogue reference by VP code. */
  "productCatalogReferences.list": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return ProductCatalogReference.find({}).sort({ vpCode: 1 }).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), "product_catalog_references", { orderBy: "vpCode, id" }),
  }),

  /** POST /api/purchase-entries/import (preview) — category / brand of every reference that has a category. */
  "productCatalogReferences.withCategory": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return ProductCatalogReference.find({ category: { $ne: "" } }, { vpCode: 1, category: 1, brand: 1 }).lean();
    },
    d1: async (_a, db) =>
      findDocs(useDb(db), "product_catalog_references", { where: ne("category"), params: [""], orderBy: "id", projection: { vpCode: 1, category: 1, brand: 1 } }),
  }),

  /** POST /api/product-reference/parse — earlier Group Name -> Category choices. */
  "productCatalogReferences.groupMappings": read<{ groups: string[] }>({
    mongo: async ({ groups }) => {
      await connectToDatabase();
      return ProductCatalogReference.find({ groupName: { $in: groups }, category: { $ne: "" } }, { groupName: 1, category: 1 }).lean();
    },
    d1: async ({ groups }, db) =>
      findDocs(useDb(db), "product_catalog_references", {
        where: `${inList("groupName")} AND ${ne("category")}`,
        params: [JSON.stringify(groups), ""],
        orderBy: "id",
        projection: { groupName: 1, category: 1 },
      }),
  }),

  /** GET /api/variants — newest first. */
  "variants.list": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return Variant.find({}).sort({ createdAt: -1 }).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), "variants", { orderBy: "createdAt DESC, id" }),
  }),

  /**
   * POST /api/purchase-entries/serials — which of these serial numbers exist: `fields: "status"` is the replace
   * check (number, status, bill), `fields: "number"` the already-registered check.
   */
  "serialNumbers.byNumbers": read<{ serials: string[]; fields: "status" | "number" }>({
    mongo: async ({ serials, fields }) => {
      await connectToDatabase();
      return fields === "status"
        ? SerialNumber.find({ serialNumber: { $in: serials } }, { serialNumber: 1, status: 1, purchaseEntryId: 1 }).lean()
        : SerialNumber.find({ serialNumber: { $in: serials } }, { serialNumber: 1 }).lean();
    },
    d1: async ({ serials, fields }, db) =>
      findDocs(useDb(db), "serial_numbers", {
        where: inList("serialNumber"),
        params: [JSON.stringify(serials)],
        // $in on the unique serialNumber index returns the documents in serial-number order.
        orderBy: "serialNumber, id",
        projection: fields === "status" ? { serialNumber: 1, status: 1, purchaseEntryId: 1 } : { serialNumber: 1 },
      }),
  }),
};
