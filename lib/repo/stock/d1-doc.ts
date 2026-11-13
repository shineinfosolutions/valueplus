/**
 * Turning D1 rows of the purchase, stock and cash area (d1/migrations/0003_stock_cash.sql, written by
 * lib/d1/maps/stock-cash.ts) back into the documents MongoDB returns, plus the few query helpers the read functions
 * in this folder share. See lib/repo/stock/INVENTORY.md for what each read reproduces.
 *
 * A rebuilt document has:
 *  - `_id` as the 24-hex string (what the routes send after JSON);
 *  - every non-NULL column under its Mongo field name (flattened 1:1 subdocuments folded back: vendors.address_* ->
 *    address.*, bank_* -> bankDetails.*; variants.valuesJson -> values), typed as the column says: text -> string,
 *    real -> number, bool -> boolean (always present: the column is NOT NULL), date -> Date, json -> parsed JSON;
 *  - the `extra` JSON merged back (top-level unknown fields, and unknown keys of a flattened subdocument);
 *  - line arrays rebuilt from the child tables in `lineNo` order (subdocument `_id` as a string, line `extra` merged,
 *    a non-object element from {"$value": ...}, a non-array field from the lineNo -1 row's {"$notArray": ...});
 *  - createdAt / updatedAt as Date, `__v` from `v`.
 *
 * What cannot come back exactly (the copy does not keep it; see INVENTORY.md "Known differences"): a field stored as
 * explicit null (comes back missing), a missing `__v` (comes back 0), a value whose type differs from its column
 * (e.g. a number in a text column comes back as text, a date-like string in a date column comes back as a Date),
 * a legacy plain-string vendor address (comes back as { line1 }), and the order of keys inside a document.
 */
import type { D1DatabaseLike } from "@/lib/d1/types";
import type { MasterSpec } from "@/lib/d1/masters-map";
import { ALL_SPEC_BY_COLLECTION } from "@/lib/d1/registry";
import { LINE_TABLES, type LineTable } from "@/lib/d1/maps/stock-cash";
import { getD1 } from "@/lib/d1/client";

type ColType = MasterSpec["columns"][number]["type"];

/** The D1 database to read: the one passed in (tests), else the Worker's binding. */
export function useDb(db?: D1DatabaseLike | null): D1DatabaseLike {
  const d = db ?? getD1();
  if (!d) throw new Error("D1 is not available here (no DB binding)");
  return d;
}

export async function sqlAll(db: D1DatabaseLike, sql: string, params: unknown[] = []): Promise<any[]> {
  const res = await db.prepare(sql).bind(...params).all();
  return (res.results || []) as any[];
}

// ---------------------------------------------------------------------------
// Column -> field
// ---------------------------------------------------------------------------

interface FieldOf {
  col: string;
  type: ColType;
  path: string[];
}

const FLATTENED_PREFIX: Record<string, string> = { address: "address", bank: "bankDetails" };
/** Columns that are not a stored field (derived for indexing) or are named differently from the field. */
const SPECIAL: Record<string, Record<string, string[] | null>> = {
  vendors: { nameLower: null },
  variants: { valuesJson: ["values"] },
};

const fieldsCache = new Map<string, FieldOf[]>();
function fieldsOf(spec: MasterSpec): FieldOf[] {
  let list = fieldsCache.get(spec.table);
  if (list) return list;
  list = [];
  for (const c of spec.columns) {
    const special = SPECIAL[spec.table]?.[c.col];
    if (special === null) continue;
    let path = special;
    if (!path) {
      const m = c.col.match(/^([a-z]+)_(.+)$/);
      const parent = m ? FLATTENED_PREFIX[m[1]] : undefined;
      path = parent && spec.flattened?.[parent] ? [parent, m![2]] : [c.col];
    }
    list.push({ col: c.col, type: c.type, path });
  }
  fieldsCache.set(spec.table, list);
  return list;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A column value as the Mongo value; undefined = leave the field out. */
export function fromColumn(type: ColType, v: any): any {
  if (type === "bool") return v === 1 || v === true || v === "1";
  if (v === null || v === undefined) return undefined;
  switch (type) {
    case "text":
      return String(v);
    case "real":
    case "int":
      return Number(v);
    case "date":
      // toDate() keeps a legacy string that is not a date as it was.
      return typeof v === "string" && ISO.test(v) ? new Date(v) : v;
    case "json":
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
  }
}

function parseJson(s: any): any {
  if (s === null || s === undefined) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const isPlainObject = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

/** One main-table row as the Mongo document (without its line arrays). */
export function rowToDoc(spec: MasterSpec, row: any): any {
  const doc: any = { _id: row.id };
  for (const f of fieldsOf(spec)) {
    const v = fromColumn(f.type, row[f.col]);
    if (v === undefined) continue;
    if (f.path.length === 1) doc[f.path[0]] = v;
    else (doc[f.path[0]] ||= {})[f.path[1]] = v;
  }
  const extra = parseJson(row.extra);
  if (extra && typeof extra === "object") {
    for (const k of Object.keys(extra)) {
      if (spec.flattened?.[k] && isPlainObject(extra[k])) doc[k] = { ...(doc[k] || {}), ...extra[k] };
      else doc[k] = extra[k];
    }
  }
  if (row.createdAt) doc.createdAt = new Date(row.createdAt);
  if (row.updatedAt) doc.updatedAt = new Date(row.updatedAt);
  doc.__v = Number(row.v) || 0;
  return doc;
}

/** One child row as the array element it came from. */
function lineToElement(t: LineTable, r: any): any {
  const extra = parseJson(r.extra);
  if (extra && typeof extra === "object" && !Array.isArray(extra) && "$value" in extra) return extra.$value;
  const el: any = {};
  if (r.id !== null && r.id !== undefined) el._id = r.id;
  for (const c of t.cols) {
    const v = fromColumn(c.type, r[c.col]);
    if (v !== undefined) el[c.field ?? c.col] = v;
  }
  if (extra && typeof extra === "object") Object.assign(el, extra);
  return el;
}

const LINE_BY_TABLE: Record<string, LineTable> = Object.fromEntries(Object.values(LINE_TABLES).map((t) => [t.table, t]));

/** Fills each document's line arrays from the child tables (one query per child table). */
async function attachLines(db: D1DatabaseLike, spec: MasterSpec, docs: any[]): Promise<void> {
  if (!spec.children?.length || !docs.length) return;
  const ids = JSON.stringify(docs.map((d) => d._id));
  for (const child of spec.children) {
    const t = LINE_BY_TABLE[child.table];
    const rows = await sqlAll(
      db,
      `SELECT * FROM ${t.table} WHERE ${t.parentCol} IN (SELECT value FROM json_each(?)) ORDER BY ${t.parentCol}, lineNo`,
      [ids]
    );
    const byParent = new Map<string, any[]>();
    for (const r of rows) {
      const k = r[t.parentCol];
      const list = byParent.get(k);
      if (list) list.push(r);
      else byParent.set(k, [r]);
    }
    for (const d of docs) {
      const list = byParent.get(d._id) || [];
      const notArray = list.find((r) => r.lineNo === -1);
      d[t.field] = notArray ? parseJson(notArray.extra)?.$notArray : list.map((r) => lineToElement(t, r));
    }
  }
}

// ---------------------------------------------------------------------------
// Finding
// ---------------------------------------------------------------------------

export function specOf(collection: string): MasterSpec {
  const s = ALL_SPEC_BY_COLLECTION[collection];
  if (!s) throw new Error(`No D1 spec for ${collection}`);
  return s;
}

export interface FindOptions {
  where?: string;
  params?: unknown[];
  /** SQL ORDER BY; always end with a tie-break (natural order = `id`). */
  orderBy?: string;
  limit?: number;
  /** A filter SQL cannot express exactly (a regex): applied in JS, before the limit. */
  post?: (doc: any) => boolean;
  /** Mongo projection, applied to the rebuilt document. */
  projection?: Record<string, 0 | 1>;
  /** false: the line arrays are not needed (excluded by the projection), so the child tables are not read. */
  lines?: boolean;
}

/** The rows of a collection's table as Mongo documents: filtered, sorted, limited and projected as asked. */
export async function findDocs(db: D1DatabaseLike, collection: string, o: FindOptions = {}): Promise<any[]> {
  const spec = specOf(collection);
  let sql = `SELECT * FROM ${spec.table}`;
  if (o.where) sql += ` WHERE ${o.where}`;
  sql += ` ORDER BY ${o.orderBy || "id"}`;
  if (o.limit !== undefined && !o.post) sql += ` LIMIT ${Math.max(0, Math.floor(o.limit))}`;
  let docs = (await sqlAll(db, sql, o.params || [])).map((r) => rowToDoc(spec, r));
  const needLines = o.lines !== false && (!o.projection || projectionKeepsLines(spec, o.projection));
  if (o.post) {
    // The regex may read a line field only through the document, so lines are attached first when needed.
    if (needLines) await attachLines(db, spec, docs);
    docs = docs.filter(o.post);
    if (o.limit !== undefined) docs = docs.slice(0, o.limit);
  } else if (needLines) {
    await attachLines(db, spec, docs);
  }
  return o.projection ? docs.map((d) => applyProjection(d, o.projection!)) : docs;
}

export async function findOneDoc(db: D1DatabaseLike, collection: string, o: FindOptions = {}): Promise<any | null> {
  const docs = await findDocs(db, collection, { ...o, limit: 1 });
  return docs[0] ?? null;
}

function projectionKeepsLines(spec: MasterSpec, p: Record<string, 0 | 1>): boolean {
  const lineFields = (spec.children || []).map((c) => LINE_BY_TABLE[c.table].field);
  const inclusive = Object.entries(p).some(([k, v]) => k !== "_id" && v);
  if (inclusive) return Object.keys(p).some((k) => p[k] && lineFields.includes(k.split(".")[0]));
  return lineFields.some((f) => p[f] !== 0);
}

// ---------------------------------------------------------------------------
// Projection (what MongoDB does with find(filter, projection))
// ---------------------------------------------------------------------------

function pick(value: any, paths: string[][]): any {
  if (Array.isArray(value)) {
    // Inclusion of a sub-path keeps only the array's documents, each reduced to the sub-path.
    return value.filter((e) => isPlainObject(e) || Array.isArray(e)).map((e) => pick(e, paths));
  }
  if (!isPlainObject(value)) return undefined;
  const out: any = {};
  const groups = new Map<string, string[][]>();
  for (const p of paths) {
    const g = groups.get(p[0]);
    if (g) g.push(p.slice(1));
    else groups.set(p[0], [p.slice(1)]);
  }
  for (const k of Object.keys(value)) {
    const g = groups.get(k);
    if (!g) continue;
    if (g.some((p) => p.length === 0)) out[k] = value[k];
    else {
      const v = pick(value[k], g);
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

export function applyProjection(doc: any, p: Record<string, 0 | 1>): any {
  const inclusive = Object.entries(p).some(([k, v]) => k !== "_id" && v);
  if (inclusive) {
    const paths = Object.keys(p).filter((k) => p[k] && k !== "_id").map((k) => k.split("."));
    if (p._id !== 0) paths.push(["_id"]);
    return pick(doc, paths);
  }
  const out: any = { ...doc };
  for (const k of Object.keys(p)) if (!p[k]) delete out[k];
  return out;
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

/** `{ col: { $ne: v } }`: a missing / NULL field matches too. */
export const ne = (col: string) => `(${col} IS NULL OR ${col} <> ?)`;

/** `col IN (...)` with one bound parameter, whatever the list's length (D1 allows 100 parameters). */
export const inList = (col: string) => `${col} IN (SELECT value FROM json_each(?))`;

export const escapeRegex = (v: string) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isAscii = (s: string) => /^[\x00-\x7f]*$/.test(s);

/**
 * A case-insensitive regex filter on a text column, as SQL where that is exact, else as a JS test.
 * `source` is the regex source as the route builds it; when it is a plain literal (nothing a regex would read
 * specially) and ASCII, SQL can say it exactly: contains -> instr(lower(col), lower(lit)) (LIKE patterns are limited to
 * 50 bytes on D1), anchored ^lit$ -> lower(col) = lower(lit). SQLite's lower() only folds ASCII, which is exactly what
 * a JS /lit/i does for an ASCII literal. Anything else (a non-ASCII literal, a real pattern) is tested in JS with the
 * same RegExp the route uses.
 */
export function regexFilter(col: string, field: string, source: string): { sql: string | null; params: unknown[]; test: (doc: any) => boolean } {
  const rx = new RegExp(source, "i");
  const test = (doc: any) => typeof doc?.[field] === "string" && rx.test(doc[field]);
  const anchored = source.startsWith("^") && source.endsWith("$") && !source.endsWith("\\$");
  const body = anchored ? source.slice(1, -1) : source;
  const literal = body.replace(/\\([.*+?^${}()|[\]\\])/g, "$1");
  if (escapeRegex(literal) !== body || !isAscii(literal)) return { sql: null, params: [], test };
  if (anchored) return { sql: `lower(${col}) = ?`, params: [literal.toLowerCase()], test };
  return { sql: `instr(lower(${col}), ?) > 0`, params: [literal.toLowerCase()], test };
}

/** A Date for SQL comparison with an ISO date column. */
export const iso = (d: Date) => d.toISOString();
