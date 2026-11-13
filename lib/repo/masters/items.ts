/**
 * Item reads on D1 (stage B2). Each function returns exactly what the MongoDB query it replaces returns
 * (`.lean()` documents, same filter, same order); the routes keep doing the rest themselves, so both paths share it.
 *
 * Items live in `items`, with `itemStock` (Item.stockByWarehouse) and `itemSupplierCodes` (Item.supplierCodes) as
 * child tables. Child rows are read in rowid order: the copy rewrites an item's child rows in array order, so that
 * is the order of the Mongo array.
 */
import type { D1DatabaseLike } from "@/lib/d1/types";
import { SPECS, docFromRow, likeEscape, objectIdHex, project } from "./rows";

// \ny\: the documents stand in for the lean() results of the MongoDB queries they replace, whatever their declared type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

export interface ItemQuery {
  /** SQL condition on `items` (no WHERE), with `?` placeholders. */
  where?: string;
  params?: unknown[];
  orderBy?: string;
  /** Inclusion projection, as `.select(...)`; all fields when absent. */
  fields?: string[];
}

/**
 * Items (with stockByWarehouse / supplierCodes rebuilt) matching a SQL condition. The parent rows and the child
 * rows are read in ONE D1 batch, so they come from the same moment.
 */
export async function queryItems(db: D1DatabaseLike, q: ItemQuery = {}): Promise<Doc[]> {
  const where = q.where || "1 = 1";
  const params = q.params || [];
  const wantStock = !q.fields || q.fields.includes("stockByWarehouse");
  const wantCodes = !q.fields || q.fields.includes("supplierCodes");
  const stmts = [db.prepare(`SELECT * FROM items WHERE ${where}${q.orderBy ? ` ORDER BY ${q.orderBy}` : ""}`).bind(...params)];
  if (wantStock) {
    stmts.push(db.prepare(`SELECT itemId, warehouseId, qty FROM itemStock WHERE itemId IN (SELECT id FROM items WHERE ${where}) ORDER BY rowid`).bind(...params));
  }
  if (wantCodes) {
    stmts.push(db.prepare(`SELECT itemId, code FROM itemSupplierCodes WHERE itemId IN (SELECT id FROM items WHERE ${where}) ORDER BY rowid`).bind(...params));
  }
  const res = await db.batch(stmts);
  const rows = (res[0]?.results || []) as Record<string, unknown>[];
  const stock = new Map<string, Array<{ warehouseId: string; qty: number }>>();
  const codes = new Map<string, string[]>();
  let next = 1;
  if (wantStock) {
    for (const r of (res[next++]?.results || []) as any[]) {
      const list = stock.get(String(r.itemId)) || [];
      list.push({ warehouseId: String(r.warehouseId), qty: Number(r.qty) });
      stock.set(String(r.itemId), list);
    }
  }
  if (wantCodes) {
    for (const r of (res[next++]?.results || []) as any[]) {
      const list = codes.get(String(r.itemId)) || [];
      list.push(String(r.code));
      codes.set(String(r.itemId), list);
    }
  }
  return rows.map((row) => {
    const doc = docFromRow(SPECS.items, row);
    // mongoose creates stockByWarehouse as [] on every item; supplierCodes only exists once a code was learned.
    if (wantStock) doc.stockByWarehouse = stock.get(doc._id) || [];
    if (wantCodes) {
      const c = codes.get(doc._id);
      if (c) doc.supplierCodes = c;
    }
    return q.fields ? project(doc, q.fields) : doc;
  });
}

/** Sort of GET /api/items: `.sort({ currentStock: -1, name: 1 })`; NULLs sort as Mongo's null/missing (lowest). */
const ITEMS_LIST_ORDER = "currentStock DESC, name ASC, id ASC";

/** Showroom-ish names, as the free-text `warehouse` filter of GET /api/items matches them. */
const SHOWROOM_RE = /showroom|ashoka|kunraghat|vp-kun|main\s*store/i;

export interface ItemsListParams {
  brand: string | null;
  category: string | null;
  /** `warehouse` (or `location`) query parameter. */
  warehouse: string | null;
}

/**
 * GET /api/items: `Item.find(filter).sort({ currentStock: -1, name: 1 }).lean()` with the route's filter:
 *  - brand / category: `^value$` case-insensitive regex -> `= ? COLLATE NOCASE` on the trimmed value;
 *  - warehouse = a real warehouse id -> items with an itemStock row for it;
 *  - warehouse = "godown" / "warehouse" -> `warehouse` contains "godown" (LIKE, case-insensitive);
 *  - warehouse = showroom-ish -> every item except those whose `warehouse` says godown without a showroom word
 *    (the regex `main\s*store` has no LIKE form, so this rarely used legacy filter is applied in code);
 *  - any other text -> `warehouse` contains it (LIKE with % _ \ escaped, case-insensitive).
 */
export async function listItems(db: D1DatabaseLike, p: ItemsListParams): Promise<Doc[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (p.brand && p.brand !== "all") {
    conds.push("brand = ? COLLATE NOCASE");
    params.push(p.brand.trim());
  }
  if (p.category && p.category !== "all") {
    conds.push("category = ? COLLATE NOCASE");
    params.push(p.category.trim());
  }
  let showroom = false;
  const wh = p.warehouse;
  if (wh && wh !== "all") {
    const hex = objectIdHex(wh);
    if (hex) {
      conds.push("EXISTS (SELECT 1 FROM itemStock s WHERE s.itemId = items.id AND s.warehouseId = ?)");
      params.push(hex);
    } else {
      const lowerWh = wh.toLowerCase().trim();
      if (lowerWh === "godown" || lowerWh === "warehouse") {
        conds.push("warehouse LIKE '%godown%'");
      } else if (lowerWh === "showroom" || lowerWh.includes("ashoka") || lowerWh.includes("kunraghat") || lowerWh === "vp-kun") {
        showroom = true;
      } else {
        conds.push("warehouse LIKE ? ESCAPE '\\'");
        params.push(`%${likeEscape(wh.trim())}%`);
      }
    }
  }
  const docs = await queryItems(db, { where: conds.length ? conds.join(" AND ") : undefined, params, orderBy: ITEMS_LIST_ORDER });
  if (!showroom) return docs;
  // Mongo: { $or: [missing, "", null, /showroom|.../i, { $not: /godown/i }] }
  return docs.filter((d) => {
    const w = d.warehouse;
    if (w === undefined || w === null || w === "") return true;
    if (typeof w !== "string") return true;
    return SHOWROOM_RE.test(w) || !/godown/i.test(w);
  });
}

/** `Item.findById(id).lean()`; null when there is no such item (or the id is not an ObjectId). */
export async function getItemById(db: D1DatabaseLike, id: string): Promise<Doc | null> {
  const hex = objectIdHex(id);
  if (!hex) return null;
  const [doc] = await queryItems(db, { where: "id = ?", params: [hex] });
  return doc || null;
}

/** GET /api/items/incentive-plan: active products with an incentive rule or a flat incentive type, natural order. */
export const INCENTIVE_PLAN_FIELDS = [
  "name", "code", "vpCode", "brand", "category", "sellingPrice", "gstRate", "currentStock",
  "incentives", "incentiveType", "incentiveValue", "incentiveAmount", "incentiveTargetAmount",
];
export function incentivePlanItems(db: D1DatabaseLike): Promise<Doc[]> {
  return queryItems(db, {
    // status $ne "inactive" (also matches a missing status); "incentives.0" exists = a non-empty array.
    where:
      "(status IS NULL OR status <> 'inactive') AND ((json_type(incentives) = 'array' AND json_array_length(incentives) > 0) OR incentiveType IN ('fixed', 'percentage'))",
    orderBy: "id",
    fields: INCENTIVE_PLAN_FIELDS,
  });
}

/** GET /api/items/assign-brands: `Item.find({ status: "active" }).select(...)`, natural order. */
export const ASSIGN_BRANDS_FIELDS = ["name", "vpCode", "code", "category", "brand", "currentStock"];
export function activeItemsForBrands(db: D1DatabaseLike): Promise<Doc[]> {
  return queryItems(db, { where: "status = 'active'", orderBy: "id", fields: ASSIGN_BRANDS_FIELDS });
}

/** GET /api/items/gst-fix: not inactive, gstRate 0 / null / missing, sorted by name. */
export const GST_FIX_FIELDS = ["name", "vpCode", "code", "category", "brand", "hsnCode", "gstRate", "currentStock"];
export function itemsMissingGst(db: D1DatabaseLike): Promise<Doc[]> {
  return queryItems(db, {
    where: "(status IS NULL OR status <> 'inactive') AND (gstRate = 0 OR gstRate IS NULL)",
    orderBy: "name ASC, id ASC",
    fields: GST_FIX_FIELDS,
  });
}

/** GET /api/items/purchase-gst-flag: `Item.find({ vpCode: { $in: codes } }).select(...)`, natural order. */
export const PURCHASE_GST_FIELDS = ["name", "vpCode", "purchasePrice", "purchaseIncludesGst"];
export function itemsByVpCodes(db: D1DatabaseLike, codes: string[]): Promise<Doc[]> {
  if (codes.length === 0) return Promise.resolve([]);
  return queryItems(db, { where: `vpCode IN (${codes.map(() => "?").join(", ")})`, params: codes, orderBy: "id", fields: PURCHASE_GST_FIELDS });
}

/**
 * GET /api/items/vp-code-backfill's two reads: items with supplier codes, and every item showing a VP code.
 * `supplierCodes: { $exists: true, $ne: [] }` -> has an itemSupplierCodes row; `vpCode: { $exists: true, $ne: "" }`
 * -> vpCode not NULL and not "" (a null vpCode is skipped by the route either way).
 */
export async function vpBackfillSources(db: D1DatabaseLike): Promise<{ items: Doc[]; withVp: Doc[] }> {
  const [items, withVp] = await Promise.all([
    queryItems(db, { where: "EXISTS (SELECT 1 FROM itemSupplierCodes c WHERE c.itemId = items.id)", orderBy: "id", fields: ["name", "code", "vpCode", "supplierCodes"] }),
    queryItems(db, { where: "vpCode IS NOT NULL AND vpCode <> ''", orderBy: "id", fields: ["vpCode"] }),
  ]);
  return { items, withVp };
}
