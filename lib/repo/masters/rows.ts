/**
 * D1 row -> the document MongoDB's `.lean()` returns, for the master-data tables (d1/migrations/0001_masters.sql).
 *
 * The copy (lib/d1/masters-map.ts) stores every Mongo field either in a column, in a child table (itemStock,
 * itemSupplierCodes) or, when the schema does not know it, in the `extra` JSON column. This file runs that mapping
 * backwards, from the same column list, so a route served from D1 returns the same JSON as from MongoDB:
 *   _id (24-hex string), the fields, createdAt / updatedAt (ISO text, as JSON shows a Date), __v.
 *
 * What D1 cannot give back (and the shadow comparison is told to ignore, see MASTER_COMPARE in ./compare.ts):
 *   - the `_id` MongoDB puts on each stockByWarehouse entry and on Customer.billingAddress / shippingAddress
 *     (the copy drops subdocument ids; no screen reads them);
 *   - a field that is ABSENT vs. null: both are NULL in D1, and a NULL column is left out of the document here;
 *   - a boolean field that is absent in an older document: the column is NOT NULL DEFAULT 0, so it reads `false`;
 *   - stockByWarehouse absent in a (raw-inserted) document: it reads `[]`, as mongoose itself would create it.
 */
import type { D1DatabaseLike } from "@/lib/d1/types";
import { SPEC_BY_COLLECTION, type MasterSpec } from "@/lib/d1/masters-map";

type Row = Record<string, unknown>;

/** Flattened 1:1 subdocuments: column prefix -> Mongo field (masters-map flattens them the same way). */
const PREFIXES: Record<string, Record<string, string>> = {
  customers: { billing_: "billingAddress", shipping_: "shippingAddress" },
  suppliers: { address_: "address", bank_: "bankDetails" },
};

/** Columns that are derived helpers of the copy, not Mongo fields. */
const DERIVED = new Set(["nameLower"]);

function decode(type: string, v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  switch (type) {
    case "real":
    case "int":
      return typeof v === "number" ? v : Number(v);
    case "bool":
      return v === 1 || v === true || v === "1";
    case "json":
      try {
        return JSON.parse(String(v));
      } catch {
        return undefined;
      }
    default:
      return v; // text and date: dates are ISO text already, exactly what JSON shows for a Date
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The Mongo-shaped document for one row of a master table (without the item child arrays). */
export function docFromRow(spec: MasterSpec, row: Row): Record<string, any> {
  const doc: Record<string, any> = { _id: String(row.id) };
  const prefixes = PREFIXES[spec.table] || {};
  for (const c of spec.columns) {
    if (DERIVED.has(c.col)) continue;
    const value = decode(c.type, row[c.col]);
    if (value === undefined) continue;
    const prefix = Object.keys(prefixes).find((p) => c.col.startsWith(p));
    if (prefix) {
      const parent = prefixes[prefix];
      const sub = (doc[parent] = isPlainObject(doc[parent]) ? doc[parent] : {});
      sub[c.col.slice(prefix.length)] = value;
    } else {
      doc[c.col] = value;
    }
  }
  // Fields the schema does not know, and unknown keys of the flattened subdocuments, come back from `extra`.
  if (row.extra) {
    try {
      const extra = JSON.parse(String(row.extra));
      if (isPlainObject(extra)) {
        for (const [k, v] of Object.entries(extra)) {
          if (isPlainObject(v) && isPlainObject(doc[k])) Object.assign(doc[k], v);
          else doc[k] = v;
        }
      }
    } catch {
      // a broken extra loses only the unknown fields; the shadow comparison would show it
    }
  }
  doc.createdAt = row.createdAt;
  doc.updatedAt = row.updatedAt;
  doc.__v = typeof row.v === "number" ? row.v : Number(row.v ?? 0);
  return doc;
}

export const SPECS = {
  items: SPEC_BY_COLLECTION.items,
  categories: SPEC_BY_COLLECTION.categories,
  brands: SPEC_BY_COLLECTION.brands,
  units: SPEC_BY_COLLECTION.units,
  warehouses: SPEC_BY_COLLECTION.warehouses,
  customers: SPEC_BY_COLLECTION.customers,
  suppliers: SPEC_BY_COLLECTION.suppliers,
};

/** Rows of a prepared query (never undefined). */
export async function allRows(db: D1DatabaseLike, sql: string, params: unknown[] = []): Promise<Row[]> {
  const res = await db.prepare(sql).bind(...params).all<Row>();
  return (res.results || []) as Row[];
}

/**
 * Mongo inclusion projection on a document: `_id` plus the listed fields that exist, as
 * `.select("a b")` / `find(filter, { a: 1, b: 1 })` returns it.
 */
export function project(doc: Record<string, any>, fields: string[]): Record<string, any> {
  const out: Record<string, any> = { _id: doc._id };
  for (const f of fields) if (doc[f] !== undefined) out[f] = doc[f];
  return out;
}

/** Escape a user value for LIKE ... ESCAPE '\' (so % and _ are literal, as they are inside an escaped regex). */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The 24-hex text MongoDB stores for a string mongoose would cast to an ObjectId (mongoose 8 accepts only a
 * 24-hex string; the ObjectId's text is lower-case). Null when not castable.
 */
export function objectIdHex(v: string): string | null {
  return /^[0-9a-fA-F]{24}$/.test(v) ? v.toLowerCase() : null;
}

/** mongoose.isValidObjectId for a string, without mongoose: what objectIdHex can cast. */
export function isObjectIdLike(v: string | null | undefined): v is string {
  return typeof v === "string" && objectIdHex(v) !== null;
}
