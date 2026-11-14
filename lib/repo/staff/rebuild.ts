/**
 * D1 row(s) -> the Mongo document they were copied from, for the STAFF & SYSTEM read side (lib/repo/staff/d1.ts).
 *
 * The copy (lib/d1/maps/staff-system.ts) keeps every field, but three things cannot be told apart from the columns
 * alone: a field that is ABSENT vs one that is null (a NULL column), a boolean that is absent vs false (bool columns
 * are NOT NULL DEFAULT 0), and a missing `__v` vs 0. The first guess follows the schema (what a document saved by
 * mongoose holds: booleans present, `readAt: null` present, `__v` present); every row also carries `docHash`, the
 * SHA-256 of the canonical Mongo document, so the guess is CHECKED, and when it does not match the few other
 * readings are tried until one does. A row whose document cannot be rebuilt exactly (a legacy value of another type,
 * e.g. a number saved as text) falls back to the first guess; the shadow comparison will show it.
 *
 * Then, per read: the mongoose projection (select strings / objects, with the `select: false` secrets), and for
 * NON-lean reads the hydration mongoose does (defaults filled in, arrays as [], empty objects removed), so the JSON
 * is the same as JSON.stringify of a mongoose document.
 *
 * Nothing here logs a value: rows hold password / PIN hashes.
 */
import { docHash, type MasterSpec } from "@/lib/d1/masters-map";
import { ALL_SPEC_BY_COLLECTION } from "@/lib/d1/registry";
import { STAFF_SYSTEM_DERIVED } from "@/lib/d1/maps/staff-system";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { ARRAY_PATHS, DEFAULTS, ELEMENT_DEFAULTS, NULL_DEFAULTS, SELECT_FALSE, defaultValue } from "./meta";

export type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

export async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<Row[]> {
  const res = await db.prepare(sql).bind(...args.map((a) => (a === undefined ? null : a))).all();
  return (res.results || []) as Row[];
}

/** A LIKE pattern matching `s` literally (use with ESCAPE '\'). */
export function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

/** `col IN (...)` for a list, passed as ONE JSON parameter (no limit on the list length). */
export const IN_JSON = (col: string) => `${col} IN (SELECT value FROM json_each(?))`;

/**
 * `\s` as MongoDB's regex engine (PCRE, no Unicode properties) reads it, for SQLite's trim(x, chars): the regex
 * `^\s*name\s*$` matches a value with any run of these around the name. Passed as a bound parameter.
 */
export const PCRE_WS = " \t\n\r\f\v";

export function isObjectIdHex(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
}

/** The error mongoose throws for an _id that is not an ObjectId (findById("x")). */
export function castError(value: unknown): Error {
  const e: any = new Error(`Cast to ObjectId failed for value "${String(value)}" (type ${typeof value}) at path "_id" for model`);
  e.name = "CastError";
  return e;
}

// ---------------------------------------------------------------------------
// Row -> document
// ---------------------------------------------------------------------------

function specOf(collection: string): MasterSpec {
  const spec = ALL_SPEC_BY_COLLECTION[collection];
  if (!spec) throw new Error(`No D1 spec for ${collection}`);
  return spec;
}

function fromSql(type: string, v: any): any {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "bool":
      return v === 1 || v === true;
    case "json":
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    case "real":
    case "int":
      return typeof v === "number" ? v : Number(v);
    default:
      return v;
  }
}

/** One reading of a row: `toggles` say which ambiguous fields are absent / null rather than the first guess. */
function buildDoc(spec: MasterSpec, row: Row, payments: Row[] | null, toggles: Set<string>): any {
  const derived = STAFF_SYSTEM_DERIVED[spec.table] || [];
  const nullDefaults = NULL_DEFAULTS[spec.collection] || [];
  const doc: any = { _id: row.id };
  const subs: Record<string, any> = {};
  for (const c of spec.columns) {
    if (derived.includes(c.col)) continue;
    const v = row[c.col];
    if (c.col.includes("_")) {
      const [parent, field] = c.col.split("_");
      if (!(parent in subs)) {
        subs[parent] = {};
        doc[parent] = undefined; // keeps the parent at its place in the key order
      }
      if (v !== null && v !== undefined) subs[parent][field] = fromSql(c.type, v);
      continue;
    }
    if (c.type === "bool") {
      if (v === 1 || v === true) doc[c.col] = true;
      else if (!toggles.has(`absent:${c.col}`)) doc[c.col] = false;
      continue;
    }
    if (v === null || v === undefined) {
      if (nullDefaults.includes(c.col) ? !toggles.has(`absent:${c.col}`) : toggles.has(`null:${c.col}`)) doc[c.col] = null;
      continue;
    }
    doc[c.col] = fromSql(c.type, v);
  }
  let extra: Record<string, any> = {};
  if (row.extra) {
    try {
      extra = JSON.parse(row.extra) || {};
    } catch {
      extra = {};
    }
  }
  for (const k of Object.keys(extra)) {
    if (spec.flattened?.[k] && extra[k] && typeof extra[k] === "object" && !Array.isArray(extra[k])) {
      subs[k] = { ...(subs[k] || {}), ...extra[k] };
      if (!(k in doc)) doc[k] = undefined;
    } else {
      doc[k] = extra[k];
    }
  }
  for (const p of Object.keys(subs)) {
    if (Object.keys(subs[p]).length) doc[p] = subs[p];
    else delete doc[p];
  }
  if (payments) {
    if (payments.length || !toggles.has("absent:history")) doc.history = payments.map(paymentEntry);
  }
  doc.createdAt = row.createdAt;
  doc.updatedAt = row.updatedAt;
  if (!toggles.has("absent:__v")) doc.__v = row.v;
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
  return doc;
}

const PAYMENT_FIELDS: [string, string][] = [
  ["date", "text"],
  ["amount", "real"],
  ["paymentMode", "text"],
  ["txnRef", "text"],
  ["notes", "text"],
];

/** A salaryPayments row back to its Salary.history[] entry (lib/d1/maps/staff-system.ts salaryPaymentRows). */
function paymentEntry(p: Row): any {
  let extra: any = null;
  if (p.extra) {
    try {
      extra = JSON.parse(p.extra);
    } catch {
      extra = null;
    }
  }
  const allNull = p.id === null && PAYMENT_FIELDS.every(([f]) => p[f] === null || p[f] === undefined);
  if (allNull && extra && typeof extra === "object" && Object.keys(extra).length === 1 && "value" in extra) return extra.value;
  const e: any = {};
  if (p.id !== null && p.id !== undefined) e._id = p.id;
  for (const [f, t] of PAYMENT_FIELDS) if (p[f] !== null && p[f] !== undefined) e[f] = fromSql(t, p[f]);
  if (extra && typeof extra === "object") Object.assign(e, extra);
  return e;
}

/** Non-empty subsets of `list` in order of size, up to `maxSize` items. */
function* subsets(list: string[], maxSize: number): Generator<string[]> {
  const n = list.length;
  for (let size = 1; size <= Math.min(maxSize, n); size++) {
    const idx = Array.from({ length: size }, (_, i) => i);
    while (true) {
      yield idx.map((i) => list[i]);
      let i = size - 1;
      while (i >= 0 && idx[i] === n - size + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
    }
  }
}

/** The document a row was copied from, checked against the row's docHash (see the file comment). */
export async function rowToDoc(spec: MasterSpec, row: Row, payments: Row[] | null = null): Promise<any> {
  const first = buildDoc(spec, row, payments, new Set());
  if (!row.docHash || (await docHash(first)) === row.docHash) return first;

  const nullDefaults = NULL_DEFAULTS[spec.collection] || [];
  const derived = STAFF_SYSTEM_DERIVED[spec.table] || [];
  const primary: string[] = [];
  const secondary: string[] = [];
  const secondaryDates: string[] = [];
  for (const c of spec.columns) {
    if (derived.includes(c.col) || c.col.includes("_")) continue;
    const v = row[c.col];
    if (c.type === "bool") {
      if (!(v === 1 || v === true)) primary.push(`absent:${c.col}`);
    } else if (v === null || v === undefined) {
      if (nullDefaults.includes(c.col)) primary.push(`absent:${c.col}`);
      else (c.type === "date" ? secondaryDates : secondary).push(`null:${c.col}`);
    }
  }
  primary.push("absent:__v");
  if (payments && payments.length === 0) primary.push("absent:history");
  // Explicit nulls on date fields first: that is what the app writes (`$set: { pinLockedUntil: null }` when a PIN
  // lock is cleared), so they are the likeliest.
  secondary.unshift(...secondaryDates);

  // Most likely first: absent booleans / null defaults / __v (any mix of them when there are few); then one or two
  // explicit nulls, EACH COMBINED WITH every one of those readings. The combination matters: a user saved before
  // liveAuditAccess existed whose PIN lock was later cleared has BOTH an absent boolean and an explicit null
  // (shadow finding of 14 Nov 2026: users.list read liveAuditAccess false from D1 where MongoDB had none, because
  // that mix was never tried and the first guess was kept). At most MAX_TRIES hashes for a row matching no reading.
  let tries = 0;
  const attempt = async (set: string[]) => {
    tries++;
    const d = buildDoc(spec, row, payments, new Set(set));
    return (await docHash(d)) === row.docHash ? d : null;
  };
  const primarySets = Array.from(subsets(primary, primary.length <= 6 ? primary.length : 2));
  for (const set of primarySets) {
    if (tries >= MAX_TRIES) return first;
    const d = await attempt(set);
    if (d) return d;
  }
  for (const set of subsets(secondary, 2)) {
    for (const extra of [[], ...primarySets]) {
      if (tries >= MAX_TRIES) return first;
      const d = await attempt([...set, ...extra]);
      if (d) return d;
    }
  }
  return first;
}

/** Hashes tried at most for one row whose first reading does not match its docHash. */
const MAX_TRIES = 256;

/** Rows of one collection's table -> their documents, in the same order (salary history read from salaryPayments). */
export async function rowsToDocs(db: D1DatabaseLike, collection: string, rows: Row[]): Promise<any[]> {
  const spec = specOf(collection);
  let byParent: Map<string, Row[]> | null = null;
  if (spec.children?.length) {
    const child = spec.children[0];
    byParent = new Map();
    if (rows.length) {
      const kids = await all(
        db,
        `SELECT * FROM ${child.table} WHERE ${IN_JSON(child.parentCol)} ORDER BY ${child.parentCol}, idx`,
        JSON.stringify(rows.map((r) => r.id))
      );
      for (const k of kids) {
        const list = byParent.get(k[child.parentCol]) || [];
        list.push(k);
        byParent.set(k[child.parentCol], list);
      }
    }
  }
  const out: any[] = [];
  for (const r of rows) out.push(await rowToDoc(spec, r, byParent ? byParent.get(r.id) || [] : null));
  return out;
}

// ---------------------------------------------------------------------------
// Projection (mongoose select) and hydration
// ---------------------------------------------------------------------------

export type Select = string | Record<string, 0 | 1> | null | undefined;

interface Projection {
  inclusive: boolean;
  fields: Set<string>; // inclusive: fields kept; exclusive: fields removed
  keepId: boolean;
}

/** Mongoose's reading of a select, including the `select: false` paths of the schema. */
export function parseSelect(collection: string, select: Select): Projection {
  const hidden = SELECT_FALSE[collection] || [];
  const include: string[] = [];
  const exclude: string[] = [];
  const plus: string[] = [];
  if (typeof select === "string") {
    for (const t of select.split(/\s+/).filter(Boolean)) {
      if (t.startsWith("-")) exclude.push(t.slice(1));
      else if (t.startsWith("+")) plus.push(t.slice(1));
      else include.push(t);
    }
  } else if (select && typeof select === "object") {
    for (const [k, v] of Object.entries(select)) (v ? include : exclude).push(k);
  }
  const keepId = !exclude.includes("_id");
  if (include.length) {
    return { inclusive: true, fields: new Set([...include, ...plus]), keepId };
  }
  const removed = new Set([...exclude, ...hidden.filter((h) => !plus.includes(h))]);
  removed.delete("_id");
  return { inclusive: false, fields: removed, keepId };
}

function isSelected(p: Projection, path: string): boolean {
  if (path === "_id") return p.keepId;
  return p.inclusive ? p.fields.has(path) : !p.fields.has(path);
}

/** A lean read's projection applied to the full document. */
export function project(collection: string, doc: any, select: Select): any {
  if (!doc) return doc;
  const p = parseSelect(collection, select);
  const out: any = {};
  for (const k of Object.keys(doc)) if (isSelected(p, k)) out[k] = doc[k];
  return out;
}

const isPlainObject = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);

/** mongoose's `minimize`: empty objects are left out (at every level). */
function minimize(v: any): any {
  if (Array.isArray(v)) return v.map((x) => (isPlainObject(x) ? minimizeObject(x) : minimize(x)));
  if (isPlainObject(v)) return minimizeObject(v);
  return v;
}
function minimizeObject(o: any): any {
  const out: any = {};
  for (const k of Object.keys(o)) {
    const m = minimize(o[k]);
    if (isPlainObject(m) && Object.keys(m).length === 0) continue;
    out[k] = m;
  }
  return out;
}

/**
 * What JSON.stringify gives for a NON-lean read: the projected document as mongoose hydrates it (schema defaults for
 * selected paths the stored copy lacks, arrays as [], element defaults in document arrays, empty objects removed).
 * Not reproducible: an array element without an _id gets a random new one from mongoose on every read.
 */
export function hydrateJson(collection: string, doc: any, select: Select = undefined): any {
  if (!doc) return doc;
  const p = parseSelect(collection, select);
  const out = project(collection, doc, select);
  const defs = DEFAULTS[collection] || {};
  for (const path of Object.keys(defs)) {
    if (out[path] === undefined && isSelected(p, path)) out[path] = defaultValue(defs[path]);
  }
  for (const path of ARRAY_PATHS[collection] || []) {
    if (out[path] === undefined && isSelected(p, path)) out[path] = [];
  }
  const elemDefs = ELEMENT_DEFAULTS[collection] || {};
  for (const path of Object.keys(elemDefs)) {
    if (!Array.isArray(out[path])) continue;
    out[path] = out[path].map((e: any) => {
      if (!isPlainObject(e)) return e;
      const copy = { ...e };
      for (const [k, d] of Object.entries(elemDefs[path])) if (copy[k] === undefined) copy[k] = defaultValue(d);
      return copy;
    });
  }
  return minimize(out);
}
