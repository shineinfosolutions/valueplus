/**
 * Mongo document -> D1 row(s) for the master-data collections (Phase 1 of docs/D1_MIGRATION_PLAN.md).
 *
 * Pure functions, shared by the copy job (lib/d1/sync.ts), the status report and the tests. They accept whatever a
 * raw driver read returns (ObjectId, Date, Decimal128, missing fields, legacy strings where an object is expected)
 * and never throw on odd data: a value that cannot be read as the column's type is stored as NULL, and a top-level
 * field the schema does not know is kept in the `extra` JSON column, so nothing is lost.
 *
 * Table and column names follow the plan (§4.1, §4.2): camelCase Mongo field names, `_id` -> `id`, 1:1 subdocuments
 * flattened with a prefix (billing_line1), Item.stockByWarehouse -> itemStock, Item.supplierCodes ->
 * itemSupplierCodes, Item.incentives / warrantyPlans -> JSON text.
 */

export type SqlValue = string | number | null;

type ColType = "text" | "real" | "int" | "bool" | "date" | "json";
type Getter = (doc: any) => unknown;

interface ColumnSpec {
  col: string;
  type: ColType;
  get: Getter;
}

export interface ChildRows {
  table: string;
  /** Column holding the parent id; every child row of the parent is deleted and re-inserted on each copy. */
  parentCol: string;
  columns: string[];
  rows: SqlValue[][];
}

export interface MappedDoc {
  id: string;
  table: string;
  row: Record<string, SqlValue>;
  children: ChildRows[];
}

export interface ChildSpec {
  table: string;
  parentCol: string;
  columns: string[];
  rows: (doc: any, id: string) => SqlValue[][];
}

export interface MasterSpec {
  /** Mongo collection name (the models set it explicitly). */
  collection: string;
  /** D1 table name. */
  table: string;
  columns: ColumnSpec[];
  /** Top-level Mongo fields read by the columns or children; anything else goes to `extra`. */
  known: string[];
  /** 1:1 subdocuments flattened into columns: their unknown keys also go to `extra`. */
  flattened?: Record<string, string[]>;
  children?: ChildSpec[];
  /**
   * Optional: more top-level fields to keep in `extra`, exactly as they are in Mongo, on top of the unknown ones.
   * For a known field whose value its column cannot hold faithfully (a number written as text, a legacy string
   * where an array or subdocument is expected). Its keys replace any the default `extra` already has.
   */
  extraFields?: (doc: any) => Record<string, unknown> | null | undefined;
}

/** Columns every main table ends with, in this order. */
export const TAIL_COLUMNS = ["extra", "createdAt", "updatedAt", "v", "docHash", "syncedAt"] as const;

// ---------------------------------------------------------------------------
// Normalising values
// ---------------------------------------------------------------------------

function bsonType(v: any): string | undefined {
  return v && typeof v === "object" ? (v._bsontype as string | undefined) : undefined;
}

function isObjectId(v: any): boolean {
  const t = bsonType(v);
  return (t === "ObjectId" || t === "ObjectID") && typeof v.toHexString === "function";
}

function isoOf(d: Date): string | null {
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}

function isDate(v: unknown): v is Date {
  return Object.prototype.toString.call(v) === "[object Date]";
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * A JSON-safe copy with object keys in sorted order, so the same document always gives the same text (and hash)
 * whatever order its fields were written in. ObjectId -> 24-hex string, Date -> ISO text, Decimal128 -> its decimal
 * text, Long / Int32 / Double -> number, binary -> base64; `undefined` fields are dropped (as BSON does).
 */
export function normalize(value: any): any {
  if (value === null || value === undefined) return value === null ? null : undefined;
  const t = typeof value;
  if (t === "string" || t === "boolean") return value;
  if (t === "number") return Number.isFinite(value) ? value : null;
  if (t === "bigint") return value.toString();
  if (t !== "object") return undefined; // functions, symbols
  if (isDate(value)) return isoOf(value);
  if (isObjectId(value)) return value.toHexString();
  const bt = bsonType(value);
  if (bt === "Decimal128") return value.toString();
  if (bt === "Long" || bt === "Int32" || bt === "Double") return Number(value.valueOf ? value.valueOf() : value.toString());
  if (bt === "Binary") return bytesToBase64(value.buffer ?? value.value?.() ?? new Uint8Array());
  if (value instanceof Uint8Array) return bytesToBase64(value);
  if (Array.isArray(value)) return value.map((x) => (x === undefined ? null : normalize(x)));
  const out: Record<string, any> = {};
  for (const k of Object.keys(value).sort()) {
    const n = normalize(value[k]);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

/** Deterministic JSON of a value (sorted keys at every level). */
export function canonicalJson(value: unknown): string {
  const n = normalize(value);
  return n === undefined ? "null" : JSON.stringify(n);
}

/** SHA-256 (hex) of the normalised document: what `docHash` holds. Web Crypto works on Workers and in Node 20+. */
export async function docHash(doc: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(doc));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The id as stored in D1: the 24-hex string of an ObjectId, or the text of any other _id. */
export function idText(id: unknown): string {
  if (isObjectId(id)) return (id as any).toHexString();
  const n = normalize(id);
  return typeof n === "string" ? n : JSON.stringify(n);
}

export function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean" || typeof v === "bigint") return String(v);
  const n = normalize(v);
  if (n === null || n === undefined) return null;
  return typeof n === "string" ? n : JSON.stringify(n);
}

export function toReal(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/,/g, ""));
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  const n = normalize(v);
  if (typeof n === "number") return n;
  if (typeof n === "string") return toReal(n);
  return null;
}

export function toInt(v: unknown): number | null {
  const n = toReal(v);
  return n === null ? null : Math.trunc(n);
}

export function toBool(v: unknown): number {
  return v === true || v === 1 || v === "true" || v === "1" ? 1 : 0;
}

/** Dates become ISO-8601 UTC text. A legacy string that is not a date is kept as it is rather than lost. */
export function toDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (isDate(v)) return isoOf(v);
  if (typeof v === "number") return Number.isFinite(v) ? isoOf(new Date(v)) : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : v;
  }
  return toText(v);
}

export function toJson(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return canonicalJson(v);
}

function convert(type: ColType, v: unknown): SqlValue {
  switch (type) {
    case "text":
      return toText(v);
    case "real":
      return toReal(v);
    case "int":
      return toInt(v);
    case "bool":
      return toBool(v);
    case "date":
      return toDate(v);
    case "json":
      return toJson(v);
  }
}

/** When an ObjectId was made (its first 4 bytes are seconds since 1970): the fallback for a missing createdAt. */
function objectIdTime(id: unknown): string | null {
  if (isObjectId(id)) {
    const hex = (id as any).toHexString() as string;
    return new Date(parseInt(hex.slice(0, 8), 16) * 1000).toISOString();
  }
  return null;
}

const EPOCH = "1970-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Table specs
// ---------------------------------------------------------------------------

const f = (col: string, type: ColType, field: string = col): ColumnSpec => ({ col, type, get: (d) => d?.[field] });

/** A field of a flattened 1:1 subdocument. A legacy plain-string address is read as its first line. */
function sub(col: string, parent: string, field: string, type: ColType = "text"): ColumnSpec {
  return {
    col,
    type,
    get: (d) => {
      const s = d?.[parent];
      if (s && typeof s === "object" && !Array.isArray(s)) return s[field];
      if (typeof s === "string" && field === "line1") return s;
      return undefined;
    },
  };
}

const lower = (col: string, field = "name"): ColumnSpec => ({
  col,
  type: "text",
  get: (d) => (typeof d?.[field] === "string" ? d[field].toLowerCase() : toText(d?.[field])?.toLowerCase() ?? ""),
});

const ITEM_COLUMNS: ColumnSpec[] = [
  f("code", "text"),
  f("vpCode", "text"),
  f("name", "text"),
  lower("nameLower"),
  f("description", "text"),
  f("category", "text"),
  f("brand", "text"),
  f("unit", "text"),
  f("hsnCode", "text"),
  f("gstRate", "real"),
  f("purchasePrice", "real"),
  f("purchaseIncludesGst", "bool"),
  f("sellingPrice", "real"),
  f("vsp", "real"),
  f("vspUpdatedAt", "date"),
  f("vspUpdatedBy", "text"),
  f("vspUpdatedFrom", "text"),
  f("billingEntity", "text"),
  f("minSellingPrice", "real"),
  f("lockedMinPrice", "real"),
  f("priceLockedBy", "text"),
  f("priceLockedAt", "date"),
  f("maxDiscountPercent", "real"),
  f("maxDiscountAmount", "real"),
  f("incentiveTargetAmount", "real"),
  f("incentiveAmount", "real"),
  f("incentiveType", "text"),
  f("incentiveValue", "real"),
  f("incentives", "json"),
  f("mrp", "real"),
  f("openingStock", "real"),
  f("currentStock", "real"),
  f("showroomStock", "real"),
  f("godownStock", "real"),
  f("reorderLevel", "real"),
  f("warehouse", "text"),
  f("mergedIntoItemId", "text"),
  f("status", "text"),
  f("imageUrl", "text"),
  f("isSerialized", "bool"),
  f("isBatchTracked", "bool"),
  f("batchNumber", "text"),
  f("warrantyPlans", "json"),
];

/** stockByWarehouse -> itemStock rows; a warehouse listed twice is one row with the quantities added. */
function itemStockRows(doc: any, id: string): SqlValue[][] {
  const list = Array.isArray(doc?.stockByWarehouse) ? doc.stockByWarehouse : [];
  const byWh = new Map<string, number>();
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const wh = toText(e.warehouseId) ?? "";
    byWh.set(wh, (byWh.get(wh) ?? 0) + (toReal(e.qty) ?? 0));
  }
  return Array.from(byWh, ([wh, qty]) => [id, wh, qty]);
}

function supplierCodeRows(doc: any, id: string): SqlValue[][] {
  const list = Array.isArray(doc?.supplierCodes) ? doc.supplierCodes : [];
  const seen = new Set<string>();
  for (const c of list) {
    const t = toText(c);
    if (t !== null && t !== "") seen.add(t);
  }
  return Array.from(seen, (c) => [id, c]);
}

const ADDRESS_FIELDS = ["line1", "line2", "city", "state", "pincode", "country"];

export const MASTER_SPECS: MasterSpec[] = [
  {
    collection: "items",
    table: "items",
    columns: ITEM_COLUMNS,
    known: [...ITEM_COLUMNS.filter((c) => c.col !== "nameLower").map((c) => c.col), "stockByWarehouse", "supplierCodes"],
    children: [
      { table: "itemStock", parentCol: "itemId", columns: ["itemId", "warehouseId", "qty"], rows: itemStockRows },
      { table: "itemSupplierCodes", parentCol: "itemId", columns: ["itemId", "code"], rows: supplierCodeRows },
    ],
  },
  {
    collection: "categories",
    table: "categories",
    columns: [f("name", "text"), f("description", "text"), f("parentId", "text"), f("status", "text")],
    known: ["name", "description", "parentId", "status"],
  },
  {
    collection: "brands",
    table: "brands",
    columns: [f("name", "text"), f("description", "text"), f("status", "text")],
    known: ["name", "description", "status"],
  },
  {
    collection: "units",
    table: "units",
    columns: [f("name", "text"), f("shortName", "text"), f("type", "text"), f("status", "text")],
    known: ["name", "shortName", "type", "status"],
  },
  {
    collection: "warehouses",
    table: "warehouses",
    columns: [
      f("name", "text"),
      f("code", "text"),
      f("type", "text"),
      f("address", "text"),
      f("city", "text"),
      f("state", "text"),
      f("pincode", "text"),
      f("contactPerson", "text"),
      f("phone", "text"),
      f("email", "text"),
      f("status", "text"),
      f("isDefault", "bool"),
    ],
    known: ["name", "code", "type", "address", "city", "state", "pincode", "contactPerson", "phone", "email", "status", "isDefault"],
  },
  {
    collection: "customers",
    table: "customers",
    columns: [
      f("code", "text"),
      f("name", "text"),
      lower("nameLower"),
      f("email", "text"),
      f("phone", "text"),
      f("gstNumber", "text"),
      f("panNumber", "text"),
      ...ADDRESS_FIELDS.map((k) => sub(`billing_${k}`, "billingAddress", k)),
      ...ADDRESS_FIELDS.map((k) => sub(`shipping_${k}`, "shippingAddress", k)),
      f("creditLimit", "real"),
      f("creditDays", "real"),
      f("outstandingBalance", "real"),
      f("advanceBalance", "real"),
      f("loyaltyPoints", "real"),
      f("customerGroup", "text"),
      f("status", "text"),
    ],
    known: [
      "code", "name", "email", "phone", "gstNumber", "panNumber", "billingAddress", "shippingAddress", "creditLimit",
      "creditDays", "outstandingBalance", "advanceBalance", "loyaltyPoints", "customerGroup", "status",
    ],
    flattened: { billingAddress: ADDRESS_FIELDS, shippingAddress: ADDRESS_FIELDS },
  },
  {
    collection: "suppliers",
    table: "suppliers",
    columns: [
      f("code", "text"),
      f("name", "text"),
      lower("nameLower"),
      f("email", "text"),
      f("phone", "text"),
      f("gstNumber", "text"),
      f("panNumber", "text"),
      sub("address_line1", "address", "line1"),
      sub("address_city", "address", "city"),
      sub("address_state", "address", "state"),
      sub("address_pincode", "address", "pincode"),
      sub("address_country", "address", "country"),
      f("creditLimit", "real"),
      f("creditDays", "real"),
      f("outstandingBalance", "real"),
      sub("bank_bankName", "bankDetails", "bankName"),
      sub("bank_accountNumber", "bankDetails", "accountNumber"),
      sub("bank_ifscCode", "bankDetails", "ifscCode"),
      sub("bank_accountType", "bankDetails", "accountType"),
      f("status", "text"),
    ],
    known: ["code", "name", "email", "phone", "gstNumber", "panNumber", "address", "creditLimit", "creditDays", "outstandingBalance", "bankDetails", "status"],
    flattened: {
      address: ["line1", "city", "state", "pincode", "country"],
      bankDetails: ["bankName", "accountNumber", "ifscCode", "accountType"],
    },
  },
];

export const SPEC_BY_COLLECTION: Record<string, MasterSpec> = Object.fromEntries(MASTER_SPECS.map((s) => [s.collection, s]));

/** Every column of a spec's main table, in insert order. */
export function tableColumns(spec: MasterSpec): string[] {
  return ["id", ...spec.columns.map((c) => c.col), ...TAIL_COLUMNS];
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const ALWAYS_KNOWN = new Set(["_id", "createdAt", "updatedAt", "__v"]);

/** Fields the columns do not hold, kept as JSON so the copy is lossless (subdocument ids are dropped). */
function extraOf(spec: MasterSpec, doc: any): string | null {
  const known = new Set(spec.known);
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(doc || {})) {
    if (ALWAYS_KNOWN.has(k) || doc[k] === undefined) continue;
    if (!known.has(k)) {
      extra[k] = doc[k];
      continue;
    }
    const subFields = spec.flattened?.[k];
    const s = doc[k];
    if (subFields && s && typeof s === "object" && !Array.isArray(s)) {
      const rest: Record<string, unknown> = {};
      for (const sk of Object.keys(s)) {
        if (sk !== "_id" && !subFields.includes(sk) && s[sk] !== undefined) rest[sk] = s[sk];
      }
      if (Object.keys(rest).length) extra[k] = rest;
    }
  }
  if (spec.extraFields) {
    try {
      const more = spec.extraFields(doc);
      for (const k of Object.keys(more || {})) if (more![k] !== undefined) extra[k] = more![k];
    } catch {
      // never throw on odd data: the default `extra` is still written
    }
  }
  return Object.keys(extra).length ? canonicalJson(extra) : null;
}

/**
 * The row and child rows for one Mongo document, without the hash (see mapDoc). `syncedAt` is passed in so the
 * function stays pure.
 */
export function mapDocWithoutHash(spec: MasterSpec, doc: any, syncedAt: string): MappedDoc {
  const id = idText(doc?._id);
  const row: Record<string, SqlValue> = { id };
  for (const c of spec.columns) {
    let v: unknown;
    try {
      v = c.get(doc);
    } catch {
      v = undefined;
    }
    row[c.col] = convert(c.type, v);
  }
  // createdAt / updatedAt are NOT NULL and must be real ISO times (text order = time order): a missing or garbled
  // one falls back to the ObjectId's own creation time.
  const isIso = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s);
  const createdAt = toDate(doc?.createdAt);
  const created = isIso(createdAt) ? createdAt : objectIdTime(doc?._id) ?? EPOCH;
  const updatedAt = toDate(doc?.updatedAt);
  row.extra = extraOf(spec, doc);
  row.createdAt = created;
  row.updatedAt = isIso(updatedAt) ? updatedAt : created;
  row.v = toInt(doc?.__v) ?? 0;
  row.docHash = "";
  row.syncedAt = syncedAt;
  const children = (spec.children || []).map((c) => ({
    table: c.table,
    parentCol: c.parentCol,
    columns: c.columns,
    rows: c.rows(doc, id),
  }));
  return { id, table: spec.table, row, children };
}

/** Row + child rows + docHash for one Mongo document. */
export async function mapDoc(spec: MasterSpec, doc: any, syncedAt: string = new Date().toISOString()): Promise<MappedDoc> {
  const mapped = mapDocWithoutHash(spec, doc, syncedAt);
  mapped.row.docHash = await docHash(doc);
  return mapped;
}
