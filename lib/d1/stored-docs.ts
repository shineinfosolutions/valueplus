/**
 * Stage D: a D1 row -> the EXACT document MongoDB stores for it, with MongoDB's types (ObjectId _id, Date
 * timestamps). Used by the D1 write paths (an update starts from the stored document, as MongoDB's $set does) and
 * by the reverse mirror (lib/d1/reverse-mirror.ts), which writes this document into MongoDB.
 *
 * The area rebuild helpers (lib/repo/masters/rows.ts, lib/repo/stock/d1-doc.ts) give the document as a lean()
 * read shows it, but a NULL column cannot say whether the field was null or absent, and a 0 / false column whether
 * it was there at all. Every row carries `docHash`, the SHA-256 of the canonical stored document (masters-map.ts),
 * so the first guess is CHECKED against it and, when it differs, the few other readings (null fields present,
 * false booleans / __v 0 absent) are tried until one matches. A row no reading matches (a legacy value of another
 * type) keeps the first guess; the docHash compare of the copy job and the shadow reads would show it.
 */
import mongoose from "mongoose";
import type { Model } from "mongoose";
import { docHash, type MasterSpec } from "./masters-map";
import { ALL_SPEC_BY_COLLECTION } from "./registry";
import type { D1DatabaseLike } from "./types";
import { SPECS as MASTER_ROW_SPECS, docFromRow } from "@/lib/repo/masters/rows";
import { rowToDoc as stockRowToDoc } from "@/lib/repo/stock/d1-doc";
import Brand from "@/models/Brand";
import Category from "@/models/Category";
import Unit from "@/models/Unit";
import Warehouse from "@/models/Warehouse";
import Variant from "@/models/Variant";
import ProductCatalogReference from "@/models/ProductCatalogReference";

type Row = Record<string, any>;

interface StoredSpec {
  model: () => Model<any>;
  /** The area's own row -> lean document rebuild. */
  toDoc: (row: Row) => any;
  /** D1 column -> Mongo field, where they differ. */
  fieldOf?: Record<string, string>;
}

const STORED: Record<string, StoredSpec> = {
  brands: { model: () => Brand, toDoc: (r) => docFromRow(MASTER_ROW_SPECS.brands, r) },
  categories: { model: () => Category, toDoc: (r) => docFromRow(MASTER_ROW_SPECS.categories, r) },
  units: { model: () => Unit, toDoc: (r) => docFromRow(MASTER_ROW_SPECS.units, r) },
  warehouses: { model: () => Warehouse, toDoc: (r) => docFromRow(MASTER_ROW_SPECS.warehouses, r) },
  variants: { model: () => Variant, toDoc: (r) => stockRowToDoc(specOf("variants"), r), fieldOf: { valuesJson: "values" } },
  product_catalog_references: { model: () => ProductCatalogReference, toDoc: (r) => stockRowToDoc(specOf("product_catalog_references"), r) },
};

export const STORED_COLLECTIONS = Object.keys(STORED);

export function specOf(collection: string): MasterSpec {
  const s = ALL_SPEC_BY_COLLECTION[collection];
  if (!s) throw new Error(`No D1 spec for ${collection}`);
  return s;
}

export function modelOf(collection: string): Model<any> {
  const s = STORED[collection];
  if (!s) throw new Error(`No D1 write path for ${collection}`);
  return s.model();
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX24 = /^[0-9a-f]{24}$/i;

/** MongoDB's types back on a rebuilt document: ObjectId _id, Date for the timestamp and date columns. */
function withMongoTypes(spec: MasterSpec, doc: any, fieldOf: Record<string, string>): any {
  if (typeof doc._id === "string" && HEX24.test(doc._id)) doc._id = new mongoose.Types.ObjectId(doc._id);
  const dateFields = ["createdAt", "updatedAt", ...spec.columns.filter((c) => c.type === "date").map((c) => fieldOf[c.col] ?? c.col)];
  for (const f of dateFields) {
    const v = doc[f];
    if (typeof v === "string" && ISO.test(v)) doc[f] = new Date(v);
  }
  return doc;
}

/** Subsets of `n` toggles, smallest first (the most likely readings first). Capped: 2^10 hashes at most. */
function* subsets(n: number): Generator<number[]> {
  const total = 1 << n;
  const bySize: number[][][] = Array.from({ length: n + 1 }, () => []);
  for (let mask = 1; mask < total; mask++) {
    const picked: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) picked.push(i);
    bySize[picked.length].push(picked);
  }
  for (const list of bySize) for (const s of list) yield s;
}

/** The stored MongoDB document for one D1 row of a write-area collection, checked against the row's docHash. */
export async function storedDocFromRow(collection: string, row: Row): Promise<any> {
  const st = STORED[collection];
  if (!st) throw new Error(`No D1 write path for ${collection}`);
  const spec = specOf(collection);
  const fieldOf = st.fieldOf || {};
  const base = withMongoTypes(spec, st.toDoc(row), fieldOf);
  const want = row.docHash ? String(row.docHash) : "";
  if (!want || (await docHash(base)) === want) return base;

  type Toggle = (d: any) => void;
  const toggles: Toggle[] = [];
  for (const c of spec.columns) {
    const field = fieldOf[c.col] ?? c.col;
    if (c.col === "nameLower") continue; // derived helper column, not a Mongo field
    if (row[c.col] === null && !(field in base)) toggles.push((d) => (d[field] = null));
    if (c.type === "bool" && base[field] === false) toggles.push((d) => delete d[field]);
  }
  if (base.__v === 0) toggles.push((d) => delete d.__v);
  if (toggles.length > 10) return base;
  // A field put back as null goes to its column's place (the schema order mongoose stores it in), not to the end.
  const order = ["_id", ...spec.columns.filter((c) => c.col !== "nameLower").map((c) => fieldOf[c.col] ?? c.col)];
  const inOrder = (d: any) => {
    const out: any = {};
    for (const k of order) if (k in d) out[k] = d[k];
    for (const k of Object.keys(d)) if (!(k in out)) out[k] = d[k];
    return out;
  };
  for (const pick of subsets(toggles.length)) {
    const candidate = { ...base };
    for (const i of pick) toggles[i](candidate);
    if ((await docHash(candidate)) === want) return inOrder(candidate);
  }
  return base;
}

export interface StoredRow {
  doc: any;
  /** What the optimistic-concurrency guard checks: the row must still hold exactly this. */
  id: string;
  updatedAt: string;
  docHash: string;
}

/** Rows of a write-area table matching `where`, as stored documents (with what a guard needs). */
export async function loadStored(db: D1DatabaseLike, collection: string, where: string, params: unknown[] = [], orderBy = "id"): Promise<StoredRow[]> {
  const spec = specOf(collection);
  const res = await db.prepare(`SELECT * FROM ${spec.table} WHERE ${where} ORDER BY ${orderBy}`).bind(...params).all<Row>();
  const out: StoredRow[] = [];
  for (const row of res.results || []) {
    out.push({ doc: await storedDocFromRow(collection, row), id: String(row.id), updatedAt: String(row.updatedAt), docHash: String(row.docHash) });
  }
  return out;
}

/** Stored documents by id (24-hex or text), as a map id -> row; missing ids are simply absent. */
export async function loadStoredByIds(db: D1DatabaseLike, collection: string, ids: string[]): Promise<Map<string, Row>> {
  const spec = specOf(collection);
  const out = new Map<string, Row>();
  if (!ids.length) return out;
  const res = await db.prepare(`SELECT * FROM ${spec.table} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<Row>();
  for (const row of res.results || []) out.set(String(row.id), row);
  return out;
}
