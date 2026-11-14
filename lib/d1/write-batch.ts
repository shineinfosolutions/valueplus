/**
 * Stage D (docs/D1_MIGRATION_PLAN.md §5.4, §6.8a): the shared pieces of a D1 write path.
 *
 * Every write op of lib/repo/<area>/writes.ts is: READ what it needs from D1 -> DECIDE in JS with the same rules as
 * the MongoDB path (the mongoose model still does the casting, defaults and validation, so the document is the
 * one MongoDB would have stored) -> ONE guarded D1 batch that writes the rows AND queues their mirror_outbox rows.
 *
 *  - Guards: `INSERT INTO _guard (ok) SELECT 0 WHERE NOT (condition)`. While the condition holds nothing is
 *    inserted; when it fails, the CHECK (ok = 1) fails and D1 rolls back the WHOLE batch. The op then answers 409
 *    ("changed meanwhile"): e.g. the row it read was changed by someone else before the batch ran.
 *  - Outbox: one statement per collection (ids passed as one JSON list) in the same batch, so a committed write is
 *    always queued for the reverse mirror, and a rolled-back one never is.
 *  - After the batch: the drain of those documents into MongoDB is queued to run right after the response (the
 *    same after-response queue as the shadow reads); the 5-minute cron drains whatever is left.
 */
import { NextResponse } from "next/server";
import type { Model } from "mongoose";
import type { D1DatabaseLike, D1PreparedStatementLike } from "./types";
import { mapDoc, tableColumns, type MappedDoc, type MasterSpec } from "./masters-map";
import { deleteStatements, statementsFor } from "./upsert";
import { specOf } from "./stored-docs";
import { deferAfterResponse } from "./shadow";
import { getWriteModeConfig } from "./write-mode";

// ---------------------------------------------------------------------------
// Errors and answers
// ---------------------------------------------------------------------------

/** A guard failed: what the write was decided on changed before the batch ran. Nothing was written. */
export class WriteConflictError extends Error {
  status = 409;
  constructor(message = "This record was changed by someone else a moment ago. Nothing was saved. Please reload and try again.") {
    super(message);
    this.name = "WriteConflictError";
  }
}

export function conflictResponse(e?: WriteConflictError): NextResponse {
  return NextResponse.json({ success: false, error: (e || new WriteConflictError()).message }, { status: 409 });
}

/** D1's error for a failed CHECK on _guard (workerd: "D1_ERROR: CHECK constraint failed: ok = 1: SQLITE_CONSTRAINT"). */
export function isGuardFailure(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /CHECK constraint failed/i.test(msg) && /ok = 1|_guard/i.test(msg);
}

/** The D1 database of the write paths (the binding the write switch was read from). */
export function writeDb(): D1DatabaseLike {
  const db = getWriteModeConfig().resolveD1();
  if (!db) throw new Error("No D1 binding here, but the area is set to write to D1");
  return db;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Abort the batch unless `condition` (SQL, with ? placeholders) holds when the batch runs. */
export function guardThat(db: D1DatabaseLike, condition: string, params: unknown[] = []): D1PreparedStatementLike {
  return db.prepare(`INSERT INTO _guard (ok) SELECT 0 WHERE NOT (${condition})`).bind(...params);
}

/** Abort unless the row still holds exactly what was read (optimistic concurrency). */
export function guardUnchanged(db: D1DatabaseLike, table: string, id: string, updatedAt: string, hash: string): D1PreparedStatementLike {
  return guardThat(db, `EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND updatedAt = ? AND docHash = ?)`, [id, updatedAt, hash]);
}

/** Abort unless every listed row still has the updatedAt that was read (one statement for any number of rows). */
export function guardAllUnchanged(db: D1DatabaseLike, table: string, rows: { id: string; updatedAt: string }[]): D1PreparedStatementLike {
  return guardThat(
    db,
    `(SELECT COUNT(*) FROM ${table} t JOIN json_each(?) j ON t.id = json_extract(j.value, '$[0]') AND t.updatedAt = json_extract(j.value, '$[1]')) = ?`,
    [JSON.stringify(rows.map((r) => [r.id, r.updatedAt])), rows.length]
  );
}

/** Abort if any row of `table` matches `where` (a unique value taken meanwhile, a row created meanwhile). */
export function guardNone(db: D1DatabaseLike, table: string, where: string, params: unknown[] = []): D1PreparedStatementLike {
  return guardThat(db, `NOT EXISTS (SELECT 1 FROM ${table} WHERE ${where})`, params);
}

// ---------------------------------------------------------------------------
// Documents as mongoose would store them
// ---------------------------------------------------------------------------

/** The plain stored form of a mongoose document (ObjectId / Date values kept, as the driver would insert it). */
export function storedForm(doc: any): any {
  return doc.toObject({ depopulate: true, virtuals: false, getters: false, versionKey: true, transform: false, flattenMaps: false });
}

/**
 * A NEW document exactly as `Model.create(payload)` stores it: mongoose casts, applies defaults and gives it its
 * ObjectId; then, as mongoose's save does, createdAt (kept when given), updatedAt (= createdAt on insert) and
 * __v = 0. The caller validates it (`await doc.validate()`, which is what create runs and how it fails).
 */
export function newDocument(model: Model<any>, payload: any, now: Date): any {
  const doc: any = new model(payload);
  const ts = model.schema.get("timestamps");
  if (ts) {
    if (doc.get("createdAt") == null) doc.set("createdAt", now);
    doc.set("updatedAt", doc.get("createdAt"));
  }
  doc.set("__v", 0);
  return doc;
}

/** Fields an update never changes this way (mongoose / MongoDB handle them themselves). */
const NOT_SET_BY_UPDATE = new Set(["_id", "createdAt", "updatedAt"]);

export interface UpdateResult {
  /** The stored document after the update (what MongoDB would hold). */
  stored: any;
  /** The mongoose document `findByIdAndUpdate(..., { new: true })` returns (defaults filled in on load). */
  returned: any;
}

/**
 * `Model.findByIdAndUpdate(id, body, { new: true, runValidators? })` applied to a stored document, the way mongoose
 * and MongoDB do it: a plain body is a `$set` of its keys; keys the schema does not know are dropped (strict); _id,
 * createdAt and updatedAt in the body are ignored (updatedAt becomes now); __v is set when given; values are cast
 * by the schema; with runValidators the validators of the set paths run (the "Validation failed: ..." error).
 * Only `$set` is supported among operators (the routes send plain bodies).
 */
export function applyPlainUpdate(model: Model<any>, stored: any, body: any, opts: { runValidators?: boolean; now: Date }): UpdateResult {
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body && typeof body === "object" ? body : {})) {
    if (k === "$set" && v && typeof v === "object") Object.assign(update, v);
    else if (k.startsWith("$")) throw new Error(`The update operator ${k} is not supported while this data is written to D1`);
    else update[k] = v;
  }
  if (update._id !== undefined && update._id !== null && String(update._id) !== String(stored._id)) {
    throw new Error("Performing an update on the path '_id' would modify the immutable field '_id'");
  }
  const keys = Object.keys(update).filter((k) => !NOT_SET_BY_UPDATE.has(k) && model.schema.path(k) != null);
  const h: any = model.hydrate(structuredCloneDoc(stored));
  for (const k of keys) h.set(k, update[k]);
  const err = h.validateSync(keys);
  if (err) {
    const errors: Record<string, any> = err.errors || {};
    const cast = Object.values(errors).find((x: any) => x?.name === "CastError");
    // Without runValidators MongoDB still refuses a value the schema cannot cast; that is a CastError.
    if (cast) throw cast;
    if (opts.runValidators) {
      const e: any = new Error(String(err.message).replace(/^.*? validation failed/, "Validation failed"));
      e.name = "ValidationError";
      e.errors = errors;
      throw e;
    }
  }
  const next = structuredCloneDoc(stored);
  for (const k of keys) {
    const v = h.get(k);
    if (v === undefined) delete next[k];
    else next[k] = v && typeof v.toObject === "function" ? v.toObject() : Array.isArray(v) ? [...v] : v;
  }
  if (model.schema.get("timestamps")) next.updatedAt = opts.now;
  return { stored: next, returned: model.hydrate(structuredCloneDoc(next)) };
}

/** A copy of a stored document that keeps ObjectId and Date values (they are immutable, so sharing them is fine). */
export function structuredCloneDoc(doc: any): any {
  const copy = (v: any): any => {
    if (Array.isArray(v)) return v.map(copy);
    if (v && typeof v === "object" && !(v instanceof Date) && !v._bsontype) {
      const o: any = {};
      for (const k of Object.keys(v)) o[k] = copy(v[k]);
      return o;
    }
    return v;
  };
  return copy(doc);
}

/** The error mongoose's findById* throws for an id that is not an ObjectId. */
export function castIdError(model: Model<any>, id: string): Error {
  const e: any = new Error(`Cast to ObjectId failed for value "${id}" (type string) at path "_id" for model "${model.modelName}"`);
  e.name = "CastError";
  return e;
}

/** The 24-hex text of an id mongoose would accept for findById, lower-cased as D1 stores it; null otherwise. */
export function idHex(id: unknown): string | null {
  const s = typeof id === "string" ? id : id && typeof (id as any).toHexString === "function" ? (id as any).toHexString() : null;
  return s && /^[0-9a-fA-F]{24}$/.test(s) ? s.toLowerCase() : null;
}

/** An E11000 error shaped like the driver's (the routes look at `code`; some show the message). */
export function duplicateKeyError(collection: string, keys: Record<string, unknown>): Error {
  const dbName = process.env.MONGODB_DB || "valueplus";
  const index = Object.keys(keys).map((k) => `${k}_1`).join("_");
  const dup = Object.entries(keys).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
  const e: any = new Error(`E11000 duplicate key error collection: ${dbName}.${collection} index: ${index} dup key: { ${dup} }`);
  e.code = 11000;
  return e;
}

// ---------------------------------------------------------------------------
// The batch
// ---------------------------------------------------------------------------

export interface WritePlan {
  /** Conditions checked inside the batch, before anything is written. */
  guards?: D1PreparedStatementLike[];
  /** Documents to write (their full stored form). */
  upserts?: { collection: string; doc: any }[];
  /** Documents to delete, by id. */
  deletes?: { collection: string; id: string }[];
}

/** More documents than this for one collection are written with one json_each statement per chunk. */
const BULK_FROM = 20;
/** Keep each JSON parameter well under D1's 2 MB value limit. */
const BULK_JSON_BYTES = 900_000;

/** Upserts of many rows of a child-less table as a few statements (one JSON list parameter each). */
function bulkUpsertStatements(db: D1DatabaseLike, spec: MasterSpec, mapped: MappedDoc[]): D1PreparedStatementLike[] {
  const cols = tableColumns(spec);
  const select = cols.map((_, i) => `json_extract(value, '$[${i}]')`).join(", ");
  const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
  // "WHERE true" keeps SQLite from reading ON CONFLICT as part of the SELECT (documented upsert parsing rule).
  const sql = `INSERT INTO ${spec.table} (${cols.join(", ")}) SELECT ${select} FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET ${updates}`;
  const out: D1PreparedStatementLike[] = [];
  let part: unknown[][] = [];
  let bytes = 0;
  const flush = () => {
    if (part.length) out.push(db.prepare(sql).bind(JSON.stringify(part)));
    part = [];
    bytes = 0;
  };
  for (const m of mapped) {
    const values = cols.map((c) => (m.row[c] === undefined ? null : m.row[c]));
    const size = JSON.stringify(values).length;
    if (bytes + size > BULK_JSON_BYTES) flush();
    part.push(values);
    bytes += size;
  }
  flush();
  return out;
}

function outboxStatement(db: D1DatabaseLike, collection: string, ids: string[], op: "upsert" | "delete", at: string): D1PreparedStatementLike {
  return db
    .prepare("INSERT INTO mirror_outbox (collection, docId, op, at) SELECT ?, value, ?, ? FROM json_each(?)")
    .bind(collection, op, at, JSON.stringify(ids));
}

/**
 * Runs the plan as ONE D1 batch: guards, row writes, outbox rows. A failed guard -> WriteConflictError (nothing
 * written). Afterwards the touched documents are queued for the reverse mirror right after the response.
 */
export async function commitWrite(db: D1DatabaseLike, plan: WritePlan, now: Date): Promise<void> {
  const at = now.toISOString();
  const stmts: D1PreparedStatementLike[] = [...(plan.guards || [])];
  const outbox = new Map<string, { upsert: string[]; delete: string[] }>();
  const queue = (collection: string, op: "upsert" | "delete", id: string) => {
    const entry = outbox.get(collection) || { upsert: [], delete: [] };
    entry[op].push(id);
    outbox.set(collection, entry);
  };

  const byCollection = new Map<string, MappedDoc[]>();
  for (const u of plan.upserts || []) {
    const spec = specOf(u.collection);
    const m = await mapDoc(spec, u.doc, at);
    byCollection.set(u.collection, [...(byCollection.get(u.collection) || []), m]);
    queue(u.collection, "upsert", m.id);
  }
  for (const [collection, list] of Array.from(byCollection)) {
    const spec = specOf(collection);
    if (list.length >= BULK_FROM && !(spec.children || []).length) stmts.push(...bulkUpsertStatements(db, spec, list));
    else for (const m of list) stmts.push(...statementsFor(db, spec, m));
  }
  for (const d of plan.deletes || []) {
    stmts.push(...deleteStatements(db, specOf(d.collection), [d.id]));
    queue(d.collection, "delete", d.id);
  }
  for (const [collection, ids] of Array.from(outbox)) {
    if (ids.upsert.length) stmts.push(outboxStatement(db, collection, ids.upsert, "upsert", at));
    if (ids.delete.length) stmts.push(outboxStatement(db, collection, ids.delete, "delete", at));
  }

  try {
    await db.batch(stmts);
  } catch (e) {
    if (isGuardFailure(e)) throw new WriteConflictError();
    throw e;
  }
  scheduleDrain(db, Array.from(outbox.keys()));
}

/** Copy the just-written documents into MongoDB right after the response (the cron catches anything left). */
export function scheduleDrain(db: D1DatabaseLike, collections: string[]) {
  if (!collections.length) return;
  deferAfterResponse(async () => {
    const { drainOutbox } = await import("./reverse-mirror");
    await drainOutbox(db, { collections });
  });
}
