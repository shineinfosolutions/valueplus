/**
 * Shared D1 read machinery for the CRM, documents and accounting area (lib/repo/crm/*). Turns D1 rows (written by
 * the copy job / write-through from lib/d1/maps/crm-docs.ts) back into the document MongoDB holds, so each read can
 * then apply exactly what its Mongo query applied (projection, `.lean()` or a hydrated Mongoose document).
 *
 *  - columns -> fields (NULL = field absent; bool 0/1 -> boolean; json parsed; date -> Date), flattened `cloudApi_*`
 *    columns -> the `cloudApi` subdocument;
 *  - child tables -> arrays in `idx` order (journal `lineId` -> `_id`), each element's `extra` merged back, a
 *    non-object element restored from {"$value": ...}; no child rows -> [] (every array here has a schema default);
 *  - the row's `extra` (unknown fields, and the original of any value its column cannot hold) applied last;
 *  - `_id` is the 24-hex text (JSON-identical to an ObjectId), createdAt / updatedAt Date, `v` -> `__v`.
 *
 * Secrets: a caller names the columns it must never read (`omit`); they are left out of the SELECT itself, and
 * removed from any copy of their subdocument kept in `extra`.
 */
import mongoose from "mongoose";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { ALL_SPEC_BY_COLLECTION } from "@/lib/d1/registry";
import { tableColumns, type MasterSpec } from "@/lib/d1/masters-map";
import { getD1 } from "@/lib/d1/client";

/** The Mongo array field behind each child table, and its Date-typed columns. */
const CHILD_INFO: Record<string, { field: string; dates: string[]; idCol?: string }> = {
  leadFollowUps: { field: "followUps", dates: ["loggedAt"] },
  leadCalls: { field: "calls", dates: ["at"] },
  leadShares: { field: "sharedWith", dates: ["requestedAt", "respondedAt"] },
  journalEntryLines: { field: "lines", dates: [], idCol: "lineId" },
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const asDate = (v: unknown) => (typeof v === "string" && ISO.test(v) ? new Date(v) : v);

export function specOf(collection: string): MasterSpec {
  const spec = ALL_SPEC_BY_COLLECTION[collection];
  if (!spec) throw new Error(`No D1 spec for collection ${collection}`);
  return spec;
}

/** The D1 database to read: the one passed in, else the Worker binding. */
export function resolveDb(db?: D1DatabaseLike | null): D1DatabaseLike {
  const d = db || getD1();
  if (!d) throw new Error("D1 is not available here");
  return d;
}

export interface Loaded {
  spec: MasterSpec;
  rows: any[];
  children: Record<string, Map<string, any[]>>;
  omit: Set<string>;
  /** Child tables not read: their arrays are left out of the rebuilt document. */
  skipChildren?: boolean;
}

export interface LoadOptions {
  /** SQL condition on the main table (alias-free column names), with `?` placeholders. */
  where?: string;
  args?: unknown[];
  /** ORDER BY clause, without the keywords. */
  orderBy?: string;
  limit?: number;
  /** Columns never to read (secrets). */
  omit?: string[];
  /** false: skip the child tables (a projection that does not include the arrays). */
  children?: boolean;
}

/** Bound parameters per child statement (D1 allows 100). */
const CHUNK = 90;

/** Reads matching rows and all their child rows (two round trips: the rows, then one batch for the children). */
export async function loadRows(db: D1DatabaseLike, collection: string, opts: LoadOptions = {}): Promise<Loaded> {
  const spec = specOf(collection);
  const omit = new Set(opts.omit || []);
  const cols = tableColumns(spec).filter((c) => !omit.has(c) && c !== "docHash" && c !== "syncedAt");
  let sql = `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM ${spec.table}`;
  if (opts.where) sql += ` WHERE ${opts.where}`;
  if (opts.orderBy) sql += ` ORDER BY ${opts.orderBy}`;
  if (opts.limit !== undefined) sql += ` LIMIT ${Math.max(0, Math.trunc(opts.limit))}`;
  const res = await db.prepare(sql).bind(...(opts.args || [])).all();
  const rows = (res.results || []) as any[];
  const children = opts.children === false ? {} : await loadChildren(db, spec, rows.map((r) => String(r.id)));
  return { spec, rows, children, omit, skipChildren: opts.children === false };
}

async function loadChildren(db: D1DatabaseLike, spec: MasterSpec, ids: string[]): Promise<Record<string, Map<string, any[]>>> {
  const out: Record<string, Map<string, any[]>> = {};
  const children = spec.children || [];
  if (!children.length) return out;
  const stmts: { table: string; parentCol: string; stmt: any }[] = [];
  for (const c of children) {
    out[c.table] = new Map();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      const sql = `SELECT * FROM ${c.table} WHERE ${c.parentCol} IN (${part.map(() => "?").join(", ")}) ORDER BY ${c.parentCol}, idx`;
      stmts.push({ table: c.table, parentCol: c.parentCol, stmt: db.prepare(sql).bind(...part) });
    }
  }
  if (!stmts.length) return out;
  const results = await db.batch(stmts.map((s) => s.stmt));
  results.forEach((r, i) => {
    const { table, parentCol } = stmts[i];
    for (const row of (r.results || []) as any[]) {
      const key = String(row[parentCol]);
      const list = out[table].get(key);
      if (list) list.push(row);
      else out[table].set(key, [row]);
    }
  });
  return out;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** The Mongo document one D1 row (+ its child rows) holds. */
export function rebuildDoc(loaded: Loaded, row: any): any {
  const { spec, children, omit } = loaded;
  const flat = spec.flattened || {};
  const doc: any = { _id: row.id };
  for (const c of spec.columns) {
    if (omit.has(c.col)) continue;
    let v = row[c.col];
    if (v === null || v === undefined) continue;
    if (c.type === "bool") v = v === 1 || v === true;
    else if (c.type === "json") v = JSON.parse(v);
    else if (c.type === "date") v = asDate(v);
    const parent = Object.keys(flat).find((p) => c.col.startsWith(`${p}_`) && flat[p].includes(c.col.slice(p.length + 1)));
    if (parent) (doc[parent] ??= {})[c.col.slice(parent.length + 1)] = v;
    else doc[c.col] = v;
  }
  for (const c of loaded.skipChildren ? [] : spec.children || []) {
    const info = CHILD_INFO[c.table];
    if (!info) throw new Error(`Unknown child table ${c.table}`);
    const rows = children[c.table]?.get(String(row.id)) || [];
    doc[info.field] = rows.map((r) => {
      const ex = r.extra ? JSON.parse(r.extra) : {};
      if (isObj(ex) && "$value" in ex) return ex.$value;
      const el: any = {};
      for (const k of c.columns) {
        if (k === c.parentCol || k === "idx" || k === "extra" || r[k] === null || r[k] === undefined) continue;
        if (k === info.idCol) el._id = r[k];
        else el[k] = info.dates.includes(k) ? asDate(r[k]) : r[k];
      }
      return { ...el, ...ex };
    });
  }
  const extra = row.extra ? JSON.parse(row.extra) : {};
  for (const k of Object.keys(extra)) {
    if (k in flat && isObj(extra[k]) && isObj(doc[k])) doc[k] = { ...doc[k], ...extra[k] };
    else doc[k] = extra[k];
  }
  // A secret column left out of the SELECT must not come back through a copy of its subdocument kept in `extra`.
  for (const col of omit) {
    const parent = Object.keys(flat).find((p) => col.startsWith(`${p}_`));
    if (parent && isObj(doc[parent])) delete doc[parent][col.slice(parent.length + 1)];
    else if (!parent) delete doc[col];
  }
  doc.createdAt = asDate(row.createdAt);
  doc.updatedAt = asDate(row.updatedAt);
  doc.__v = row.v;
  return doc;
}

/** Every loaded row as its Mongo document, in row order. */
export function rebuildAll(loaded: Loaded): any[] {
  return loaded.rows.map((r) => rebuildDoc(loaded, r));
}

/** The documents as `.lean()` gives them (a plain object; `_id` as its hex text). */
export async function loadLean(db: D1DatabaseLike, collection: string, opts: LoadOptions = {}): Promise<any[]> {
  return rebuildAll(await loadRows(db, collection, opts));
}

/**
 * The documents as a plain (non-lean) Mongoose query gives them: hydrated through the same model, so casting,
 * schema defaults for missing fields and toJSON are exactly those of the Mongo read. No database is touched.
 */
export function hydrateAll(model: mongoose.Model<any>, docs: any[], projection?: Record<string, 0 | 1>): any[] {
  return docs.map((d) => (projection ? (model as any).hydrate(d, projection) : model.hydrate(d)));
}

/** Inclusion projection on a lean document: `_id` plus each named field the document has. */
export function pick(doc: any, fields: string[]): any {
  const out: any = { _id: doc._id };
  for (const f of fields) if (doc[f] !== undefined) out[f] = doc[f];
  return out;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Escapes a value for `LIKE ? ESCAPE '\'`. */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Whether a regex source is a plain literal (no metacharacter), so `LIKE '%…%'` finds exactly what it finds. */
export function isLiteralRegex(source: string): boolean {
  return !/[.*+?^${}()|[\]\\]/.test(source);
}

/** Mongo `{ field: /literal/i }` (unanchored, case-insensitive) as SQL. */
export function likeContains(col: string): string {
  return `${col} LIKE ? ESCAPE '\\'`;
}
export const containsArg = (s: string) => `%${likeEscape(s)}%`;

/**
 * Mongo casts a string to an ObjectId for an ObjectId-typed path (and throws a CastError when it cannot). The same
 * cast here, so an invalid id fails the same way and a valid one gives the hex D1 stores.
 */
export function castObjectIdHex(v: unknown): string {
  return new mongoose.Types.ObjectId(v as any).toHexString();
}
