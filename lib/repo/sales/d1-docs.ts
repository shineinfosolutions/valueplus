/**
 * Rebuilds MongoDB-shaped documents from the D1 copy of the SALES & MONEY area (d1/migrations/0002_sales.sql,
 * written by lib/d1/maps/sales.ts), so a D1 read can return what `Model.find(...).lean()` returned.
 *
 * Inverse of the copy mapping:
 *  - `id` -> `_id` (the 24-hex string; JSON-identical to the ObjectId Mongo returns);
 *  - one key per column, NULL -> key left out (Mongo had no such field), booleans 0/1 -> false/true, "date" columns
 *    (ISO text) -> Date, "json" columns -> parsed, `extra` (unknown top-level fields) merged back in;
 *  - createdAt / updatedAt -> Date, `v` -> `__v`;
 *  - child tables -> the array, in idx order; each element's `extra` merged back, `{"$value": x}` -> the bare
 *    element x, an idx -1 row `{"$raw": x}` -> the field was not an array and held x;
 *  - 1:1 side tables (invoiceFinance, invoiceDelivery) -> their fields merged into the bill when the row exists.
 *
 * What the copy cannot tell apart (see lib/repo/sales/INVENTORY.md, "Known limits"): a field stored as null vs a
 * missing field (both NULL -> left out), a missing boolean vs false (every boolean in this area has a schema default,
 * so it is always emitted), a missing array vs an empty one (emitted as [] where the schema defaults to [], left out
 * where the schema default is undefined), and an absent createdAt / __v (the copy fills them in).
 */
import type { Model } from "mongoose";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { hydrateLikeMongoose } from "@/lib/d1/hydrate";
import { SALES_SPECS, INVOICE_ITEM_FIELDS, INVOICE_PAYMENT_FIELDS, INVOICE_FINANCE_FIELDS, INVOICE_DELIVERY_FIELDS } from "@/lib/d1/maps/sales";

export type ColType = "text" | "real" | "int" | "bool" | "date" | "json";
export type FieldDef = [field: string, type: ColType];

export interface ArrayChildMeta {
  /** Mongo array field. */
  field: string;
  table: string;
  parentCol: string;
  idxCol: string;
  /** The element's own `_id` is in the `id` column. */
  withId: boolean;
  fields: FieldDef[];
  /** No child rows: the schema default ([] -> emit [], undefined -> leave the field out). */
  whenEmpty: "array" | "omit";
}

export interface SideMeta {
  table: string;
  parentCol: string;
  fields: FieldDef[];
}

export interface TableMeta {
  collection: string;
  table: string;
  fields: FieldDef[];
  arrays: ArrayChildMeta[];
  sides: SideMeta[];
}

/** Columns the copy derives from another field (not document fields of their own). */
const DERIVED_COLUMNS: Record<string, Set<string>> = {
  storeActivityApprovals: new Set(["payloadKind", "payloadTarget"]),
};

const ESTIMATE_ITEM_FIELDS: FieldDef[] = [
  ["itemCode", "text"],
  ["name", "text"],
  ["quantity", "real"],
  ["rate", "real"],
  ["discount", "real"],
  ["itemId", "text"],
  ["tax", "real"],
  ["amount", "real"],
];

const EMI_FIELDS: FieldDef[] = [
  ["installmentNumber", "real"],
  ["dueDate", "text"],
  ["amount", "real"],
  ["status", "text"],
  ["paidDate", "text"],
  ["paymentChannel", "text"],
  ["paymentMode", "text"],
  ["collectedBy", "text"],
  ["bankRef", "text"],
  ["receiptNumber", "text"],
  ["bounceReason", "text"],
  ["penaltyAmount", "real"],
  ["notes", "text"],
];

const LINKED_INVOICE_FIELDS: FieldDef[] = [
  ["invoiceNumber", "text"],
  ["amount", "real"],
  ["linkedAt", "date"],
];

/** Array children per collection (field names, defaults from the models). */
const ARRAYS: Record<string, ArrayChildMeta[]> = {
  invoices: [
    { field: "items", table: "invoiceItems", parentCol: "invoiceId", idxCol: "lineNo", withId: true, fields: INVOICE_ITEM_FIELDS, whenEmpty: "array" },
    { field: "payments", table: "invoicePayments", parentCol: "invoiceId", idxCol: "idx", withId: false, fields: INVOICE_PAYMENT_FIELDS, whenEmpty: "array" },
  ],
  estimates: [
    { field: "items", table: "estimateItems", parentCol: "estimateId", idxCol: "idx", withId: false, fields: ESTIMATE_ITEM_FIELDS, whenEmpty: "array" },
  ],
  finance_transactions: [
    { field: "emiSchedule", table: "financeEmiInstallments", parentCol: "financeId", idxCol: "idx", withId: false, fields: EMI_FIELDS, whenEmpty: "array" },
    { field: "linkedInvoices", table: "financeLinkedInvoices", parentCol: "financeId", idxCol: "idx", withId: false, fields: LINKED_INVOICE_FIELDS, whenEmpty: "omit" },
  ],
};

const SIDES: Record<string, SideMeta[]> = {
  invoices: [
    { table: "invoiceFinance", parentCol: "invoiceId", fields: INVOICE_FINANCE_FIELDS },
    { table: "invoiceDelivery", parentCol: "invoiceId", fields: INVOICE_DELIVERY_FIELDS },
  ],
};

export const SALES_META: Record<string, TableMeta> = Object.fromEntries(
  SALES_SPECS.map((spec) => {
    const derived = DERIVED_COLUMNS[spec.table] || new Set<string>();
    const meta: TableMeta = {
      collection: spec.collection,
      table: spec.table,
      fields: spec.columns.filter((c) => !derived.has(c.col)).map((c) => [c.col, c.type as ColType] as FieldDef),
      arrays: ARRAYS[spec.collection] || [],
      sides: SIDES[spec.collection] || [],
    };
    return [spec.collection, meta];
  })
);

export const META = {
  invoices: SALES_META.invoices,
  payments: SALES_META.payment_transactions,
  advances: SALES_META.customer_advances,
  estimates: SALES_META.estimates,
  salesOrders: SALES_META.sales_orders,
  deletedInvoices: SALES_META.deleted_invoices,
  challans: SALES_META.delivery_challans,
  ewayBills: SALES_META.eway_bills,
  finance: SALES_META.finance_transactions,
  warranties: SALES_META.extended_warranties,
  discountApprovals: SALES_META.discountapprovals,
  storeApprovals: SALES_META.store_activity_approvals,
  billingCompanies: SALES_META.billing_companies,
};

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseJson(text: unknown): any {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** A column value as Mongo held it; undefined = the field was not there. */
export function decode(type: ColType, v: unknown): any {
  if (type === "bool") return v === 1 || v === true || v === "1";
  if (v === null || v === undefined) return undefined;
  switch (type) {
    case "text":
      return typeof v === "string" ? v : String(v);
    case "real":
    case "int":
      return typeof v === "number" ? v : Number(v);
    case "date":
      return typeof v === "string" && ISO_RE.test(v) ? new Date(v) : v;
    case "json":
      return parseJson(v);
  }
}

function setFields(target: Record<string, any>, fields: FieldDef[], row: Record<string, unknown>) {
  for (const [f, t] of fields) {
    const v = decode(t, row[f]);
    if (v !== undefined) target[f] = v;
  }
}

function mergeExtra(target: Record<string, any>, extra: unknown) {
  const e = parseJson(extra);
  if (e && typeof e === "object" && !Array.isArray(e)) Object.assign(target, e);
}

function timeOf(v: unknown): Date | string | undefined {
  if (v === null || v === undefined) return undefined;
  return typeof v === "string" && ISO_RE.test(v) ? new Date(v) : (v as string);
}

/** The top-level document of one main-table row (no array / side fields yet). */
export function rowToDoc(meta: TableMeta, row: Record<string, unknown>): Record<string, any> {
  const doc: Record<string, any> = { _id: row.id };
  setFields(doc, meta.fields, row);
  mergeExtra(doc, row.extra);
  const created = timeOf(row.createdAt);
  const updated = timeOf(row.updatedAt);
  if (created !== undefined) doc.createdAt = created;
  if (updated !== undefined) doc.updatedAt = updated;
  if (row.v !== null && row.v !== undefined) doc.__v = Number(row.v);
  return doc;
}

/** One array element from its child row. */
function childToElement(child: ArrayChildMeta, row: Record<string, unknown>): any {
  const extra = parseJson(row.extra);
  if (extra && typeof extra === "object" && !Array.isArray(extra) && "$value" in extra) return (extra as any).$value;
  const el: Record<string, any> = {};
  if (child.withId && row.id !== null && row.id !== undefined) el._id = row.id;
  setFields(el, child.fields, row);
  if (extra && typeof extra === "object" && !Array.isArray(extra)) Object.assign(el, extra);
  return el;
}

// ---------------------------------------------------------------------------
// Projection (inclusion only, as the app uses it) and mongoose's `minimize`
// ---------------------------------------------------------------------------

export type Projection = Record<string, 0 | 1>;

type Tree = { [k: string]: Tree | true };

function projectionTree(p: Projection): { tree: Tree; withId: boolean } {
  const tree: Tree = {};
  let withId = true;
  for (const [path, on] of Object.entries(p)) {
    if (path === "_id") {
      withId = !!on;
      continue;
    }
    if (!on) continue;
    const parts = path.split(".");
    let node = tree;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) node[part] = true;
      else {
        if (node[part] === true) return;
        node[part] = (node[part] as Tree) || {};
        node = node[part] as Tree;
      }
    });
  }
  return { tree, withId };
}

const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && Object.prototype.toString.call(v) === "[object Object]";

const DROP = Symbol("drop");

/** MongoDB's inclusion projection of `value` under `tree`: arrays map over their documents, scalars drop out. */
function applyTree(value: any, tree: Tree): any {
  if (Array.isArray(value)) {
    const out: any[] = [];
    for (const el of value) {
      const p = applyTree(el, tree);
      if (p !== DROP) out.push(p);
    }
    return out;
  }
  if (!isPlainObject(value)) return DROP;
  const out: Record<string, any> = {};
  for (const [k, sub] of Object.entries(tree)) {
    if (!(k in value) || value[k] === undefined) continue;
    if (sub === true) out[k] = value[k];
    else {
      const p = applyTree(value[k], sub);
      if (p !== DROP) out[k] = p;
    }
  }
  return out;
}

export function project(doc: Record<string, any>, p: Projection): Record<string, any> {
  const { tree, withId } = projectionTree(p);
  const out = applyTree(doc, tree) as Record<string, any>;
  if (withId && doc._id !== undefined) return { _id: doc._id, ...out };
  return out;
}

/** Top-level fields a projection reads (null = the whole document). */
function projectedTopFields(p?: Projection): Set<string> | null {
  if (!p) return null;
  return new Set(Object.keys(p).filter((k) => p[k]).map((k) => k.split(".")[0]));
}

/** What mongoose's toJSON does to a hydrated document with `minimize` on: empty objects are left out. */
export function minimize(value: any): any {
  if (Array.isArray(value)) return value.map(minimize);
  if (!isPlainObject(value)) return value;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    const m = minimize(v);
    if (isPlainObject(m) && Object.keys(m).length === 0) continue;
    out[k] = m;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL building
// ---------------------------------------------------------------------------

/** A WHERE clause built from parts (AND-ed), with its bound values. */
export class Where {
  parts: string[] = [];
  params: unknown[] = [];

  raw(sql: string, ...params: unknown[]): this {
    this.parts.push(sql);
    this.params.push(...params);
    return this;
  }
  /** { col: value } for a scalar value. */
  eq(col: string, v: unknown): this {
    return this.raw(`${col} = ?`, v);
  }
  /** { col: { $ne: v } }: also matches a missing field. */
  ne(col: string, v: unknown): this {
    return this.raw(`(${col} IS NULL OR ${col} <> ?)`, v);
  }
  /** { col: { $in: list } } (one bound JSON array, so any length fits D1's 100-parameter limit). */
  in(col: string, list: unknown[]): this {
    return this.raw(`${col} IN (SELECT value FROM json_each(?))`, JSON.stringify(list));
  }
  /** { col: { $nin: list } } (no null in the list): also matches a missing field. */
  nin(col: string, list: unknown[]): this {
    return this.raw(`(${col} IS NULL OR ${col} NOT IN (SELECT value FROM json_each(?)))`, JSON.stringify(list));
  }
  cmp(col: string, op: ">" | ">=" | "<" | "<=", v: unknown): this {
    return this.raw(`${col} ${op} ?`, v);
  }
  get sql(): string {
    return this.parts.length ? `WHERE ${this.parts.join(" AND ")}` : "";
  }
}

/** SQL LIKE pattern text with %, _ and \ escaped (use with ESCAPE '\'). */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// Mongo-style matching in JS (regex filters that SQL LIKE cannot express exactly)
// ---------------------------------------------------------------------------

/** { field: /re/ }: true when the value is a matching string, or an array holding one. */
export function regexMatches(value: unknown, re: RegExp): boolean {
  const test = (s: string) => {
    re.lastIndex = 0;
    return re.test(s);
  };
  if (typeof value === "string") return test(value);
  if (Array.isArray(value)) return value.some((x) => typeof x === "string" && test(x));
  return false;
}

/** The values a dotted path reaches, walking into arrays of documents as MongoDB does ("branch.name"). */
export function pathValues(value: any, parts: string[]): any[] {
  if (parts.length === 0) return [value];
  if (Array.isArray(value)) return value.flatMap((v) => (isPlainObject(v) ? pathValues(v, parts) : []));
  if (isPlainObject(value)) return pathValues(value[parts[0]], parts.slice(1));
  return [];
}

/** { field: v } for a scalar v (null also matches a missing field). */
export function valueEquals(value: unknown, v: unknown): boolean {
  if (v === null) return value === null || value === undefined;
  if (Array.isArray(value)) return value.some((x) => x === v);
  return value === v;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface FindOptions {
  where?: Where;
  /** SQL ORDER BY list; always end with a tie-break (default "id"). */
  orderBy?: string;
  limit?: number;
  /** A filter on the top-level document (columns + extra), for conditions SQL cannot express exactly. */
  filter?: (doc: Record<string, any>) => boolean;
  projection?: Projection;
  /**
   * The Mongo read is NOT .lean(): give the documents as that read does, hydrated through this model (schema
   * defaults for fields the stored copy lacks, casting, toJSON). See lib/d1/hydrate.ts.
   */
  hydrateWith?: Model<any>;
}

async function allRows(db: D1DatabaseLike, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const res = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
  return res.results || [];
}

/** The documents of one table, rebuilt whole (or projected), in the requested order. */
export async function findDocs(db: D1DatabaseLike, meta: TableMeta, opts: FindOptions = {}): Promise<any[]> {
  const where = opts.where || new Where();
  const order = opts.orderBy || "id";
  const sqlLimit = opts.limit !== undefined && !opts.filter ? ` LIMIT ${Math.max(0, Math.floor(opts.limit))}` : "";
  const rows = await allRows(db, `SELECT * FROM ${meta.table} ${where.sql} ORDER BY ${order}${sqlLimit}`, where.params);
  let docs = rows.map((r) => rowToDoc(meta, r));
  if (opts.filter) docs = docs.filter(opts.filter);
  if (opts.limit !== undefined && opts.filter) docs = docs.slice(0, Math.max(0, Math.floor(opts.limit)));
  await attachChildren(db, meta, docs, projectedTopFields(opts.projection));
  const out = opts.projection ? docs.map((d) => project(d, opts.projection!)) : docs;
  // A non-lean read: mongoose fills in the defaults of fields an older document never stored (an estimate saved
  // before advanceAmount existed reads advanceAmount 0 from MongoDB), so the D1 answer is hydrated the same way.
  return opts.hydrateWith ? hydrateLikeMongoose(opts.hydrateWith, out, opts.projection) : out;
}

export async function findOneDoc(db: D1DatabaseLike, meta: TableMeta, opts: FindOptions = {}): Promise<any | null> {
  const docs = await findDocs(db, meta, { ...opts, limit: 1 });
  return docs[0] ?? null;
}

export async function countDocs(db: D1DatabaseLike, meta: TableMeta, opts: Pick<FindOptions, "where" | "filter"> = {}): Promise<number> {
  const where = opts.where || new Where();
  if (!opts.filter) {
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${meta.table} ${where.sql}`).bind(...where.params).first<{ n: number }>();
    return Number(row?.n ?? 0);
  }
  const rows = await allRows(db, `SELECT * FROM ${meta.table} ${where.sql}`, where.params);
  return rows.map((r) => rowToDoc(meta, r)).filter(opts.filter).length;
}

/** Array and side-table fields of the given documents (only those a projection asks for). */
async function attachChildren(db: D1DatabaseLike, meta: TableMeta, docs: Record<string, any>[], fields: Set<string> | null) {
  if (docs.length === 0) return;
  const ids = JSON.stringify(docs.map((d) => d._id));
  const byId = new Map(docs.map((d) => [d._id, d]));
  const inIds = (col: string) => `${col} IN (SELECT value FROM json_each(?))`;

  for (const child of meta.arrays) {
    if (fields && !fields.has(child.field)) continue;
    const rows = await allRows(db, `SELECT * FROM ${child.table} WHERE ${inIds(child.parentCol)} ORDER BY ${child.parentCol}, ${child.idxCol}`, [ids]);
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const k = String(r[child.parentCol]);
      const list = grouped.get(k) || [];
      list.push(r);
      grouped.set(k, list);
    }
    for (const doc of docs) {
      const list = grouped.get(doc._id) || [];
      if (list.length === 1 && Number(list[0][child.idxCol]) === -1) {
        const raw = parseJson(list[0].extra);
        const v = raw && typeof raw === "object" ? (raw as any).$raw : undefined;
        if (v !== undefined) doc[child.field] = v;
        continue;
      }
      if (list.length === 0 && child.whenEmpty === "omit") continue;
      doc[child.field] = list.map((r) => childToElement(child, r));
    }
  }

  for (const side of meta.sides) {
    if (fields && !side.fields.some(([f]) => fields.has(f))) continue;
    const rows = await allRows(db, `SELECT * FROM ${side.table} WHERE ${inIds(side.parentCol)}`, [ids]);
    for (const r of rows) {
      const doc = byId.get(String(r[side.parentCol]));
      if (doc) setFields(doc, side.fields, r);
    }
  }
}
