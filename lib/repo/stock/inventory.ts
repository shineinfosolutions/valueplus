/**
 * Stock reads: adjustments, journals, requests, returns, bills of material, transfers, live audits, serial numbers,
 * the GIDA stock orders and the supplier stock sheet. `mongo` = the query as it runs today; `d1` = the same from D1.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import StockAdjustment from "@/models/StockAdjustment";
import StockJournal from "@/models/StockJournal";
import StockRequest from "@/models/StockRequest";
import StockReturn from "@/models/StockReturn";
import BillOfMaterial from "@/models/BillOfMaterial";
import StockTransfer from "@/models/StockTransfer";
import InventoryAudit from "@/models/InventoryAudit";
import SerialNumber from "@/models/SerialNumber";
import StockOrderRequest from "@/models/StockOrderRequest";
import SupplierStockItem from "@/models/SupplierStockItem";
import SupplierStockUpload from "@/models/SupplierStockUpload";
import { escapeRegex, findDocs, findOneDoc, ne, regexFilter, sqlAll, specOf, rowToDoc, useDb } from "./d1-doc";
import { read } from "./types";

const newestFirst = (collection: string, model: any) =>
  read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return model.find({}).sort({ createdAt: -1 }).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), collection, { orderBy: "createdAt DESC, id" }),
  });

/** Today's audit of one kind (app/api/inventory/audit/route.ts kindFilter). */
const kindFilter = (kind: string) => (kind === "mobile" ? { kind: "mobile" } : { kind: { $ne: "mobile" } });

/** Collections the product ledger reads whole with the raw driver. */
const MOVEMENT_COLLECTIONS = ["stock_adjustments", "stock_returns", "stock_journals", "stocktransfers"] as const;

export const INVENTORY_READS = {
  /** GET /api/inventory/adjustment */
  "stockAdjustments.list": newestFirst("stock_adjustments", StockAdjustment),
  /** GET /api/inventory/journal */
  "stockJournals.list": newestFirst("stock_journals", StockJournal),
  /** GET /api/inventory/request */
  "stockRequests.list": newestFirst("stock_requests", StockRequest),
  /** GET /api/inventory/return */
  "stockReturns.list": newestFirst("stock_returns", StockReturn),
  /** GET /api/inventory/bom */
  "billOfMaterials.list": newestFirst("bill_of_materials", BillOfMaterial),
  /** GET /api/stock-transfers */
  "stockTransfers.list": newestFirst("stocktransfers", StockTransfer),

  /** GET /api/inventory/stock-flow — every transfer by date, newest first. */
  "stockTransfers.byDateDesc": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return StockTransfer.find({}).sort({ date: -1, createdAt: -1 }).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), "stocktransfers", { orderBy: "date DESC, createdAt DESC, id" }),
  }),

  /** GET /api/reports/product-ledger — a whole movement collection, read with the raw driver in stored order. */
  "productLedger.movements": read<{ collection: (typeof MOVEMENT_COLLECTIONS)[number] }>({
    mongo: async ({ collection }) => {
      await connectToDatabase();
      const db = mongoose.connection.db;
      try {
        return db ? await db.collection(collection).find({}).toArray() : [];
      } catch {
        return [];
      }
    },
    d1: async ({ collection }, db) => findDocs(useDb(db), collection, { orderBy: "id" }),
  }),

  /** GET /api/inventory/audit?checkPending=true (and POST start) — today's newest audit of a kind ("all" / "mobile"). */
  "inventoryAudits.forDay": read<{ date: string; kind: string }>({
    mongo: async ({ date, kind }) => {
      await connectToDatabase();
      return InventoryAudit.findOne({ auditDate: date, ...kindFilter(kind) }).sort({ createdAt: -1 }).lean();
    },
    d1: async ({ date, kind }, db) =>
      findOneDoc(useDb(db), "inventory_audits", {
        where: kind === "mobile" ? "auditDate = ? AND kind = ?" : `auditDate = ? AND ${ne("kind")}`,
        params: [date, "mobile"],
        orderBy: "createdAt DESC, id",
      }),
  }),

  /** GET /api/inventory/audit?id= — one audit with all its lines. */
  "inventoryAudits.byId": read<{ id: string }>({
    mongo: async ({ id }) => {
      await connectToDatabase();
      return InventoryAudit.findById(id).lean();
    },
    d1: async ({ id }, db) => findOneDoc(useDb(db), "inventory_audits", { where: "id = ?", params: [id] }),
  }),

  /** GET /api/inventory/audit[?date=] — the audit history (aggregate): no lines, with line count and counted count. */
  "inventoryAudits.list": read<{ date?: string | null }>({
    mongo: async ({ date }) => {
      await connectToDatabase();
      const filter: any = {};
      if (date) filter.auditDate = date;
      return InventoryAudit.aggregate([
        { $match: filter },
        { $sort: { auditDate: -1, createdAt: -1 } },
        { $limit: 200 },
        {
          $addFields: {
            total: { $size: { $ifNull: ["$items", []] } },
            counted: { $size: { $filter: { input: { $ifNull: ["$items", []] }, as: "i", cond: { $eq: ["$$i.counted", true] } } } },
          },
        },
        { $project: { items: 0 } },
      ]);
    },
    d1: async ({ date }, db) => {
      const d = useDb(db);
      const spec = specOf("inventory_audits");
      // The counts come from the line table in the same query; a line that is not an object counts in `total` only.
      const rows = await sqlAll(
        d,
        `SELECT a.*,
           (SELECT COUNT(*) FROM inventoryAuditItems l WHERE l.auditId = a.id AND l.lineNo >= 0) AS _total,
           (SELECT COUNT(*) FROM inventoryAuditItems l WHERE l.auditId = a.id AND l.lineNo >= 0 AND l.counted = 1) AS _counted
         FROM inventoryAudits a ${date ? "WHERE a.auditDate = ?" : ""}
         ORDER BY a.auditDate DESC, a.createdAt DESC, a.id LIMIT 200`,
        date ? [date] : []
      );
      return rows.map((r) => ({ ...rowToDoc(spec, r), total: Number(r._total) || 0, counted: Number(r._counted) || 0 }));
    },
  }),

  /** GET /api/serial-numbers — the list after the reconcile, newest first. */
  "serialNumbers.list": read<{ status?: string | null; vpCode?: string | null; itemId?: string | null; name?: string | null }>({
    mongo: async ({ status, vpCode, itemId, name }) => {
      await connectToDatabase();
      const st = status || "AVAILABLE";
      const filter: any = {};
      if (st && st !== "ALL") filter.status = st;
      if (vpCode) filter.vpCode = vpCode;
      if (itemId) filter.itemId = itemId;
      if (name) filter.itemName = { $regex: new RegExp(name.trim(), "i") };
      return SerialNumber.find(filter).sort({ createdAt: -1 }).lean();
    },
    d1: async ({ status, vpCode, itemId, name }, db) => {
      const st = status || "AVAILABLE";
      const where: string[] = [];
      const params: unknown[] = [];
      if (st && st !== "ALL") {
        where.push("status = ?");
        params.push(st);
      }
      if (vpCode) {
        where.push("vpCode = ?");
        params.push(vpCode);
      }
      if (itemId) {
        where.push("itemId = ?");
        params.push(itemId);
      }
      let post: ((d: any) => boolean) | undefined;
      if (name) {
        // The route builds the regex from the raw text (not escaped): a pattern is tested in JS.
        const r = regexFilter("itemName", "itemName", name.trim());
        if (r.sql) {
          where.push(r.sql);
          params.push(...r.params);
        } else post = r.test;
      }
      return findDocs(useDb(db), "serial_numbers", { where: where.join(" AND ") || undefined, params, orderBy: "createdAt DESC, id", post });
    },
    // The AVAILABLE list (the default) is what the bill and purchase forms offer to sell: a serial sold a moment ago
    // must never be offered again, so that list keeps answering from MongoDB in d1 mode. Other lists may use D1.
    mongoOnlyInD1: ({ status }) => (status || "AVAILABLE") === "AVAILABLE",
  }),

  /** GET /api/reports/product-ledger — the product's serial numbers (by VP code, code, id or exact name), stored order. */
  "serialNumbers.productLedger": read<{ itemVpCode?: string; itemCode?: string; itemId?: string; itemName: string }>({
    mongo: async ({ itemVpCode, itemCode, itemId, itemName }) => {
      await connectToDatabase();
      return SerialNumber.find({
        $or: [
          { vpCode: itemVpCode },
          { vpCode: itemCode },
          { itemId: itemId ? String(itemId) : "NO_MATCH" },
          { itemName: { $regex: new RegExp(`^${escapeRegex(itemName.trim())}$`, "i") } },
        ],
      }).lean();
    },
    d1: async ({ itemVpCode, itemCode, itemId, itemName }, db) => {
      // { vpCode: undefined } is { vpCode: null } to MongoDB: it matches a missing / null vpCode.
      const eq = (col: string, v: unknown) => (v === undefined || v === null ? { sql: `${col} IS NULL`, params: [] } : { sql: `${col} = ?`, params: [v] });
      const parts = [eq("vpCode", itemVpCode), eq("vpCode", itemCode), eq("itemId", itemId ? String(itemId) : "NO_MATCH")];
      const rx = regexFilter("itemName", "itemName", `^${escapeRegex(itemName.trim())}$`);
      if (rx.sql) {
        const sql = [...parts.map((p) => p.sql), rx.sql].join(" OR ");
        return findDocs(useDb(db), "serial_numbers", { where: `(${sql})`, params: [...parts.flatMap((p) => p.params), ...rx.params], orderBy: "id" });
      }
      const eqTest = (field: string, v: unknown) => (doc: any) => (v === undefined || v === null ? doc[field] === undefined || doc[field] === null : doc[field] === v);
      const tests = [eqTest("vpCode", itemVpCode), eqTest("vpCode", itemCode), eqTest("itemId", itemId ? String(itemId) : "NO_MATCH"), rx.test];
      return findDocs(useDb(db), "serial_numbers", { orderBy: "id", post: (d) => tests.some((t) => t(d)) });
    },
  }),

  /** GET /api/search — 5 serial numbers whose number, VP code or product name matches (mongoose documents, stored order). */
  "serialNumbers.search": read<{ q: string }>({
    mongo: async ({ q }) => {
      await connectToDatabase();
      const regex = new RegExp(q, "i");
      return SerialNumber.find({ $or: [{ serialNumber: regex }, { vpCode: regex }, { itemName: regex }] }).limit(5);
    },
    d1: async ({ q }, db) => {
      const parts = ["serialNumber", "vpCode", "itemName"].map((f) => regexFilter(f, f, q));
      if (parts.every((p) => p.sql)) {
        return findDocs(useDb(db), "serial_numbers", { where: `(${parts.map((p) => p.sql).join(" OR ")})`, params: parts.flatMap((p) => p.params), orderBy: "id", limit: 5 });
      }
      return findDocs(useDb(db), "serial_numbers", { orderBy: "id", limit: 5, post: (d) => parts.some((p) => p.test(d)) });
    },
  }),

  /**
   * GET /api/stock-orders[?status=] — the GIDA order requests, newest 200. A salesman (`salespersonId` given) sees his own
   * requests and the combined orders they were merged into (the route's two reads, done here the same way).
   */
  "stockOrders.list": read<{ status?: string | null; salespersonId?: string | null }>({
    mongo: async ({ status, salespersonId }) => {
      await connectToDatabase();
      const query: any = {};
      if (status) query.status = status;
      if (salespersonId !== undefined && salespersonId !== null) {
        const mine: any[] = await StockOrderRequest.find({ salespersonId }, { requestNumber: 1 }).lean();
        query.$or = [{ salespersonId }, { mergedFrom: { $in: mine.map((m) => m.requestNumber) } }];
      }
      return StockOrderRequest.find(query).sort({ createdAt: -1 }).limit(200).lean();
    },
    d1: async ({ status, salespersonId }, db) => {
      const d = useDb(db);
      const where: string[] = [];
      const params: unknown[] = [];
      if (status) {
        where.push("status = ?");
        params.push(status);
      }
      if (salespersonId !== undefined && salespersonId !== null) {
        const mine = await findDocs(d, "stock_order_requests", { where: "salespersonId = ?", params: [salespersonId], projection: { requestNumber: 1 } });
        // mergedFrom is a JSON array; $in matches when any element is one of his request numbers.
        where.push(
          `(salespersonId = ? OR (json_type(mergedFrom) = 'array' AND EXISTS (SELECT 1 FROM json_each(mergedFrom) m WHERE m.value IN (SELECT value FROM json_each(?)))))`
        );
        params.push(salespersonId, JSON.stringify(mine.map((m) => m.requestNumber).filter((n) => n !== undefined)));
      }
      return findDocs(d, "stock_order_requests", { where: where.join(" AND ") || undefined, params, orderBy: "createdAt DESC, id", limit: 200 });
    },
  }),

  /** lib/stock-order-retention.ts — pending requests, oldest first, for the morning reminder. */
  "stockOrders.pending": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return StockOrderRequest.find({ status: "pending" }, { requestNumber: 1, salesperson: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean();
    },
    d1: async (_a, db) =>
      findDocs(useDb(db), "stock_order_requests", {
        where: "status = ?",
        params: ["pending"],
        orderBy: "createdAt, id",
        projection: { requestNumber: 1, salesperson: 1, createdAt: 1 },
      }),
  }),

  /** GET /api/supplier-stock — the newest stock-sheet upload. */
  "supplierStock.lastUpload": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return SupplierStockUpload.findOne({}).sort({ createdAt: -1 }).lean();
    },
    d1: async (_a, db) => findOneDoc(useDb(db), "supplier_stock_uploads", { orderBy: "createdAt DESC, id" }),
  }),

  /** GET /api/supplier-stock — what can be ordered (active, in stock): new arrivals first, then brand and description. */
  "supplierStock.items": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return SupplierStockItem.find({ active: true, availableStock: { $gt: 0 } }).sort({ isNewArrival: -1, brand: 1, description: 1 }).lean();
    },
    d1: async (_a, db) =>
      findDocs(useDb(db), "supplier_stock_items", { where: "active = 1 AND availableStock > 0", orderBy: "isNewArrival DESC, brand, description, id" }),
  }),
};

export { MOVEMENT_COLLECTIONS };
