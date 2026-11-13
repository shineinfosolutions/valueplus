/**
 * Phase 1 of docs/D1_MIGRATION_PLAN.md: keep a COPY of the master-data collections in Cloudflare D1.
 *
 * MongoDB stays the only source of truth and nothing in the app reads D1 yet. This job only reads Mongo and writes
 * D1, so the worst a bug here can do is leave the copy stale; it can never change what users see. It is run by the
 * Worker's cron every 5 minutes (app/api/cron/d1-sync) and never throws: every failure is caught, written to the
 * `sync_errors` table and counted in the result.
 *
 * Per collection, each run does one of:
 *  - full copy: every document in _id order, resumable (`sync_state.fullCopyLastId`), until it has gone through once;
 *  - incremental copy: documents with updatedAt > watermark - 2 min (the overlap covers clocks a little apart and
 *    writes that land while a page is read), in (updatedAt, _id) order.
 * Then, once a night (23:00-00:59 India time, after the store closes at 22:00), a reconciliation pass per
 * collection: re-copies every row whose hash differs from Mongo (a write that skipped updatedAt, a failed batch) and
 * deletes D1 rows whose Mongo document no longer exists.
 *
 * A run stops starting new work once its time budget (default 18 s) is used, so a Worker invocation never runs long;
 * the next run carries on from the saved cursors.
 *
 * D1 limits respected: at most 100 bound parameters per statement (one parent row per statement: items has 49
 * columns; child rows and id lists in chunks that stay under 100), small batches (a batch is one transaction and
 * must finish within 30 s), Dates as ISO text, no undefined.
 */
import mongoose from "mongoose";
import { istHour } from "@/lib/ist";
import type { D1DatabaseLike, D1PreparedStatementLike } from "./types";
import { MasterSpec, MappedDoc, idText, mapDoc, tableColumns } from "./masters-map";
import { ALL_SPECS } from "./registry";

/** Re-read this much before the watermark, so a write that landed just before it is not missed. */
export const OVERLAP_MS = 2 * 60 * 1000;
/** A run starts no new page after this much time (the route promises ≤ 20 s per invocation). */
export const DEFAULT_BUDGET_MS = 18_000;
const DEFAULT_PAGE_SIZE = 200;
/** Documents written per D1 batch (an item is 1 upsert + 2 deletes + its child inserts). */
const DEFAULT_BATCH_DOCS = 20;
/** D1 allows 100 bound parameters per statement. */
const MAX_PARAMS = 100;
const KEEP_ERRORS = 2000;
/** A nightly reconciliation is not started again within this long of the last one. */
const RECONCILE_EVERY_MS = 20 * 3600 * 1000;

export type ReconcileMode = "auto" | "force" | "skip";

export interface SyncOptions {
  /** Mongo database to read (default: mongoose's connected database). */
  mongo?: any;
  budgetMs?: number;
  /** Clock used ONLY for the time budget (tests advance it to exercise time-boxing). */
  budgetClock?: () => number;
  pageSize?: number;
  batchDocs?: number;
  /** "auto": only in the night window, at most once per night; "force": now; "skip": never. */
  reconcile?: ReconcileMode;
  /** Only these collections (default: all master collections). */
  collections?: string[];
}

export interface CollectionRunResult {
  mode: "full" | "incremental" | "skipped";
  copied: number;
  fullCopyDone: boolean;
  reconcile?: { repaired: number; deleted: number; finished: boolean };
}

export interface SyncRunResult {
  ok: boolean;
  ms: number;
  timedOut: boolean;
  errors: number;
  collections: Record<string, CollectionRunResult>;
}

interface SyncState {
  collection: string;
  watermark: string | null;
  fullCopyStartedAt: string | null;
  fullCopyLastId: string | null;
  fullCopyDoneAt: string | null;
  lastRunAt: string | null;
  lastRunCopied: number;
  totalCopied: number;
  reconcileStartedAt: string | null;
  reconcileCursor: string | null;
  lastReconcileAt: string | null;
  lastReconcileRepaired: number;
  lastReconcileDeleted: number;
  mongoCount: number | null;
  d1Count: number | null;
}

const STATE_COLUMNS: (keyof SyncState)[] = [
  "watermark",
  "fullCopyStartedAt",
  "fullCopyLastId",
  "fullCopyDoneAt",
  "lastRunAt",
  "lastRunCopied",
  "totalCopied",
  "reconcileStartedAt",
  "reconcileCursor",
  "lastReconcileAt",
  "lastReconcileRepaired",
  "lastReconcileDeleted",
  "mongoCount",
  "d1Count",
];

interface Ctx {
  db: D1DatabaseLike;
  mongo: any;
  deadline: number;
  clock: () => number;
  pageSize: number;
  batchDocs: number;
  result: SyncRunResult;
}

const nowIso = () => new Date().toISOString();

function errText(e: unknown): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.slice(0, 1000);
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const outOfTime = (ctx: Ctx) => ctx.clock() >= ctx.deadline;

/** Records a failure in sync_errors. Never throws: if D1 itself is down, the console is the last resort. */
async function logError(ctx: Ctx, collection: string | null, docId: string | null, phase: string, e: unknown) {
  ctx.result.errors++;
  ctx.result.ok = false;
  const message = errText(e);
  try {
    await ctx.db
      .prepare("INSERT INTO sync_errors (at, collection, docId, phase, message) VALUES (?, ?, ?, ?, ?)")
      .bind(nowIso(), collection, docId, phase, message)
      .run();
  } catch (e2) {
    console.warn(`d1-sync ${phase} ${collection ?? ""} ${docId ?? ""}: ${message} (and logging it failed: ${errText(e2)})`);
  }
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const upsertSqlCache = new Map<string, string>();

function upsertSql(spec: MasterSpec): string {
  let sql = upsertSqlCache.get(spec.table);
  if (!sql) {
    const cols = tableColumns(spec);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    sql = `INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT(id) DO UPDATE SET ${updates.join(", ")}`;
    upsertSqlCache.set(spec.table, sql);
  }
  return sql;
}

/** The statements that make D1 match one document: upsert the parent, then replace its child rows. */
function statementsFor(db: D1DatabaseLike, spec: MasterSpec, m: MappedDoc): D1PreparedStatementLike[] {
  const cols = tableColumns(spec);
  const stmts = [db.prepare(upsertSql(spec)).bind(...cols.map((c) => (m.row[c] === undefined ? null : m.row[c])))];
  for (const child of m.children) {
    stmts.push(db.prepare(`DELETE FROM ${child.table} WHERE ${child.parentCol} = ?`).bind(m.id));
    const perStmt = Math.max(1, Math.floor(MAX_PARAMS / child.columns.length));
    for (const rows of chunk(child.rows, perStmt)) {
      const values = rows.map(() => `(${child.columns.map(() => "?").join(", ")})`).join(", ");
      stmts.push(db.prepare(`INSERT INTO ${child.table} (${child.columns.join(", ")}) VALUES ${values}`).bind(...rows.flat()));
    }
  }
  return stmts;
}

/** Statements that delete rows (and their child rows) by id, ≤ 100 ids per statement. */
function deleteStatements(db: D1DatabaseLike, spec: MasterSpec, ids: string[]): D1PreparedStatementLike[] {
  const stmts: D1PreparedStatementLike[] = [];
  for (const part of chunk(ids, MAX_PARAMS)) {
    const marks = part.map(() => "?").join(", ");
    // Children first and explicitly, so the delete does not depend on foreign-key enforcement being on.
    for (const child of spec.children || []) {
      stmts.push(db.prepare(`DELETE FROM ${child.table} WHERE ${child.parentCol} IN (${marks})`).bind(...part));
    }
    stmts.push(db.prepare(`DELETE FROM ${spec.table} WHERE id IN (${marks})`).bind(...part));
  }
  return stmts;
}

async function existingHashes(db: D1DatabaseLike, table: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk(ids, MAX_PARAMS)) {
    const res = await db
      .prepare(`SELECT id, docHash FROM ${table} WHERE id IN (${part.map(() => "?").join(", ")})`)
      .bind(...part)
      .all<{ id: string; docHash: string }>();
    for (const r of res.results || []) out.set(String(r.id), String(r.docHash));
  }
  return out;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

async function loadStates(ctx: Ctx, specs: MasterSpec[]): Promise<Map<string, SyncState>> {
  await ctx.db.batch(specs.map((s) => ctx.db.prepare("INSERT OR IGNORE INTO sync_state (collection) VALUES (?)").bind(s.collection)));
  const res = await ctx.db.prepare("SELECT * FROM sync_state").all<SyncState>();
  const map = new Map<string, SyncState>();
  for (const r of res.results || []) map.set(r.collection, { ...r });
  return map;
}

async function saveState(ctx: Ctx, st: SyncState) {
  await ctx.db
    .prepare(`UPDATE sync_state SET ${STATE_COLUMNS.map((c) => `${c} = ?`).join(", ")} WHERE collection = ?`)
    .bind(...STATE_COLUMNS.map((c) => (st[c] === undefined ? null : st[c])), st.collection)
    .run();
}

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

/**
 * Writes the documents whose hash differs from D1's (or that D1 lacks). A batch that fails is retried one document
 * at a time, so one bad document cannot hold back the others; it is logged and left for the nightly repair.
 * Returns how many documents were written.
 */
async function writeDocs(ctx: Ctx, spec: MasterSpec, docs: any[], phase: string): Promise<number> {
  const syncedAt = nowIso();
  const mapped: MappedDoc[] = [];
  for (const doc of docs) {
    try {
      mapped.push(await mapDoc(spec, doc, syncedAt));
    } catch (e) {
      await logError(ctx, spec.collection, idText(doc?._id), phase, e);
    }
  }
  if (!mapped.length) return 0;
  const have = await existingHashes(ctx.db, spec.table, mapped.map((m) => m.id));
  const changed = mapped.filter((m) => have.get(m.id) !== m.row.docHash);

  let written = 0;
  for (const group of chunk(changed, ctx.batchDocs)) {
    try {
      await ctx.db.batch(group.flatMap((m) => statementsFor(ctx.db, spec, m)));
      written += group.length;
    } catch {
      for (const m of group) {
        try {
          await ctx.db.batch(statementsFor(ctx.db, spec, m));
          written++;
        } catch (e) {
          await logError(ctx, spec.collection, m.id, phase, e);
        }
      }
    }
  }
  return written;
}

function oid(hex: string) {
  return new mongoose.mongo.ObjectId(hex);
}

const OID_ONLY = { _id: { $type: "objectId" } };
const NON_OID = { _id: { $not: { $type: "objectId" } } };

/** Documents whose _id is not an ObjectId (none expected; legacy imports could have them) are copied in one sweep. */
async function sweepNonObjectIds(ctx: Ctx, spec: MasterSpec, phase: string): Promise<number> {
  const docs = await ctx.mongo.collection(spec.collection).find(NON_OID).limit(5000).toArray();
  return docs.length ? writeDocs(ctx, spec, docs, phase) : 0;
}

async function fullCopy(ctx: Ctx, spec: MasterSpec, st: SyncState, out: CollectionRunResult) {
  out.mode = "full";
  if (!st.fullCopyStartedAt) {
    // Everything changed from now on is picked up by the incremental copy once the full copy is through.
    st.fullCopyStartedAt = nowIso();
    st.watermark = st.fullCopyStartedAt;
    st.fullCopyLastId = null;
    await saveState(ctx, st);
  }
  const coll = ctx.mongo.collection(spec.collection);
  for (;;) {
    if (outOfTime(ctx)) {
      ctx.result.timedOut = true;
      return;
    }
    const filter = st.fullCopyLastId ? { _id: { $gt: oid(st.fullCopyLastId) } } : OID_ONLY;
    const docs = await coll.find(filter).sort({ _id: 1 }).limit(ctx.pageSize).toArray();
    const written = docs.length ? await writeDocs(ctx, spec, docs, "full") : 0;
    out.copied += written;
    st.totalCopied += written;
    st.lastRunAt = nowIso();
    if (docs.length) st.fullCopyLastId = idText(docs[docs.length - 1]._id);
    if (docs.length < ctx.pageSize) {
      const swept = await sweepNonObjectIds(ctx, spec, "full");
      out.copied += swept;
      st.totalCopied += swept;
      st.fullCopyDoneAt = nowIso();
      st.fullCopyLastId = null;
      st.lastRunCopied = out.copied;
      await saveState(ctx, st);
      out.fullCopyDone = true;
      return;
    }
    st.lastRunCopied = out.copied;
    await saveState(ctx, st);
  }
}

async function incrementalCopy(ctx: Ctx, spec: MasterSpec, st: SyncState, out: CollectionRunResult) {
  out.mode = "incremental";
  out.fullCopyDone = true;
  const coll = ctx.mongo.collection(spec.collection);
  const since = new Date((st.watermark ? Date.parse(st.watermark) : 0) - OVERLAP_MS);
  let cursorTs: Date | null = null;
  let cursorId: unknown = null;
  for (;;) {
    if (outOfTime(ctx)) {
      ctx.result.timedOut = true;
      break;
    }
    const filter: Record<string, unknown> = cursorTs
      ? { $or: [{ updatedAt: { $gt: cursorTs } }, { updatedAt: cursorTs, _id: { $gt: cursorId } }] }
      : { updatedAt: { $gt: since } };
    const docs: any[] = await coll.find(filter).sort({ updatedAt: 1, _id: 1 }).limit(ctx.pageSize).toArray();
    if (docs.length) {
      const n = await writeDocs(ctx, spec, docs, "incremental");
      out.copied += n;
      st.totalCopied += n;
      const last: any = docs[docs.length - 1];
      const lastTs: Date = last.updatedAt instanceof Date ? last.updatedAt : new Date(last.updatedAt);
      cursorTs = lastTs;
      cursorId = last._id;
      // Never move the watermark past "now": a document stamped in the future (a wrong clock) would otherwise
      // hide every later change until that time came.
      const lastMs = Math.min(lastTs.getTime(), Date.now());
      if (Number.isFinite(lastMs) && (!st.watermark || lastMs > Date.parse(st.watermark))) {
        st.watermark = new Date(lastMs).toISOString();
      }
    }
    st.lastRunCopied = out.copied;
    st.lastRunAt = nowIso();
    // Saved per page, so a run cut short (time budget, a Mongo error) keeps what it has done.
    await saveState(ctx, st);
    if (docs.length < ctx.pageSize || !cursorTs || !Number.isFinite(cursorTs.getTime())) break;
  }
}

// ---------------------------------------------------------------------------
// Nightly reconciliation
// ---------------------------------------------------------------------------

function reconcileDue(st: SyncState, mode: ReconcileMode): boolean {
  if (mode === "skip" || !st.fullCopyDoneAt) return false;
  if (st.reconcileCursor) return true; // finish one already started
  if (mode === "force") return true;
  const hour = istHour();
  const nightWindow = hour >= 23 || hour < 1;
  const last = st.lastReconcileAt ? Date.parse(st.lastReconcileAt) : 0;
  return nightWindow && Date.now() - last > RECONCILE_EVERY_MS;
}

/** Mongo _id values to look an id up by: the ObjectId for a 24-hex id, and the plain text too. */
function idCandidates(id: string): unknown[] {
  return /^[0-9a-f]{24}$/i.test(id) ? [oid(id), id] : [id];
}

async function reconcile(ctx: Ctx, spec: MasterSpec, st: SyncState, out: CollectionRunResult) {
  const rec = { repaired: 0, deleted: 0, finished: false };
  out.reconcile = rec;
  if (!st.reconcileCursor) {
    st.reconcileStartedAt = nowIso();
    st.reconcileCursor = "repair:";
    st.lastReconcileRepaired = 0;
    st.lastReconcileDeleted = 0;
    await saveState(ctx, st);
  }
  const coll = ctx.mongo.collection(spec.collection);

  // 1. Repair: every Mongo document whose D1 row is missing or has another hash is copied again.
  while (st.reconcileCursor?.startsWith("repair:")) {
    if (outOfTime(ctx)) {
      ctx.result.timedOut = true;
      return;
    }
    const after = st.reconcileCursor.slice("repair:".length);
    const docs = await coll.find(after ? { _id: { $gt: oid(after) } } : OID_ONLY).sort({ _id: 1 }).limit(ctx.pageSize).toArray();
    const n = docs.length ? await writeDocs(ctx, spec, docs, "reconcile") : 0;
    rec.repaired += n;
    st.lastReconcileRepaired += n;
    if (docs.length < ctx.pageSize) {
      const swept = await sweepNonObjectIds(ctx, spec, "reconcile");
      rec.repaired += swept;
      st.lastReconcileRepaired += swept;
      st.reconcileCursor = "delete:";
    } else {
      st.reconcileCursor = `repair:${idText(docs[docs.length - 1]._id)}`;
    }
    await saveState(ctx, st);
  }

  // 2. Delete: D1 rows (in id order) whose document is gone from Mongo.
  while (st.reconcileCursor?.startsWith("delete:")) {
    if (outOfTime(ctx)) {
      ctx.result.timedOut = true;
      return;
    }
    const after = st.reconcileCursor.slice("delete:".length);
    const res = await ctx.db
      .prepare(`SELECT id FROM ${spec.table} WHERE id > ? ORDER BY id LIMIT ?`)
      .bind(after, ctx.pageSize)
      .all<{ id: string }>();
    const ids = (res.results || []).map((r) => String(r.id));
    if (ids.length) {
      const found = await coll.find({ _id: { $in: ids.flatMap(idCandidates) } }, { projection: { _id: 1 } }).toArray();
      const present = new Set(found.map((d: any) => idText(d._id)));
      const gone = ids.filter((id) => !present.has(id));
      if (gone.length) {
        try {
          await ctx.db.batch(deleteStatements(ctx.db, spec, gone));
          rec.deleted += gone.length;
          st.lastReconcileDeleted += gone.length;
        } catch (e) {
          await logError(ctx, spec.collection, gone.slice(0, 5).join(","), "reconcile", e);
        }
      }
    }
    if (ids.length < ctx.pageSize) {
      st.reconcileCursor = null;
      st.lastReconcileAt = nowIso();
      st.mongoCount = await coll.countDocuments({});
      const c = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table}`).first<{ n: number }>();
      st.d1Count = Number(c?.n ?? 0);
      rec.finished = true;
    } else {
      st.reconcileCursor = `delete:${ids[ids.length - 1]}`;
    }
    await saveState(ctx, st);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** One run of the copy job. Never throws; look at `ok` / `errors` (details in the sync_errors table). */
export async function runD1Sync(db: D1DatabaseLike, opts: SyncOptions = {}): Promise<SyncRunResult> {
  const clock = opts.budgetClock || (() => Date.now());
  const started = clock();
  const wallStart = Date.now();
  const result: SyncRunResult = { ok: true, ms: 0, timedOut: false, errors: 0, collections: {} };
  const ctx: Ctx = {
    db,
    mongo: null,
    deadline: started + (opts.budgetMs ?? DEFAULT_BUDGET_MS),
    clock,
    pageSize: opts.pageSize ?? DEFAULT_PAGE_SIZE,
    batchDocs: opts.batchDocs ?? DEFAULT_BATCH_DOCS,
    result,
  };
  const specs = opts.collections ? ALL_SPECS.filter((s) => opts.collections!.includes(s.collection)) : ALL_SPECS;

  try {
    ctx.mongo = opts.mongo || mongoose.connection.db;
    if (!ctx.mongo) throw new Error("MongoDB is not connected");
    const states = await loadStates(ctx, specs);

    // Unfinished full copies first, then the collection served longest ago, so when the time budget runs out the
    // same collections are not always the ones left waiting.
    const order = [...specs].sort((a, b) => {
      const sa = states.get(a.collection);
      const sb = states.get(b.collection);
      const da = sa?.fullCopyDoneAt ? 1 : 0;
      const db_ = sb?.fullCopyDoneAt ? 1 : 0;
      if (da !== db_) return da - db_;
      return String(sa?.lastRunAt ?? "").localeCompare(String(sb?.lastRunAt ?? ""));
    });

    for (const spec of order) {
      const out: CollectionRunResult = { mode: "skipped", copied: 0, fullCopyDone: false };
      result.collections[spec.collection] = out;
      const st = states.get(spec.collection);
      if (!st) continue;
      if (outOfTime(ctx)) {
        result.timedOut = true;
        out.fullCopyDone = !!st.fullCopyDoneAt;
        continue;
      }
      try {
        if (!st.fullCopyDoneAt) await fullCopy(ctx, spec, st, out);
        else await incrementalCopy(ctx, spec, st, out);
      } catch (e) {
        await logError(ctx, spec.collection, null, st.fullCopyDoneAt ? "incremental" : "full", e);
      }
    }

    const mode = opts.reconcile ?? "auto";
    for (const spec of specs) {
      const st = states.get(spec.collection);
      if (!st || !reconcileDue(st, mode)) continue;
      if (outOfTime(ctx)) {
        result.timedOut = true;
        break;
      }
      try {
        await reconcile(ctx, spec, st, result.collections[spec.collection]);
      } catch (e) {
        await logError(ctx, spec.collection, null, "reconcile", e);
      }
    }

    try {
      await db.prepare("DELETE FROM sync_errors WHERE id <= (SELECT MAX(id) FROM sync_errors) - ?").bind(KEEP_ERRORS).run();
    } catch {
      // Pruning is housekeeping; the next run tries again.
    }
  } catch (e) {
    await logError(ctx, null, null, "run", e);
  }
  result.ms = Date.now() - wallStart;
  return result;
}

// ---------------------------------------------------------------------------
// Status report (GET /api/admin/d1-sync-status)
// ---------------------------------------------------------------------------

export interface CollectionStatus {
  collection: string;
  table: string;
  mongoCount: number | null;
  d1Count: number | null;
  childCounts?: Record<string, number | null>;
  state: Partial<SyncState> | null;
  sample: { size: number; matched: number; mismatched: number; missing: number; mismatchedIds: string[] } | null;
  error?: string;
}

export interface D1SyncStatus {
  generatedAt: string;
  collections: CollectionStatus[];
  lastErrors: { at: string; collection: string | null; docId: string | null; phase: string; message: string }[];
  errorCount: number | null;
}

/** Counts, cursors and a hash comparison of a random sample of documents per collection. Never throws. */
export async function getD1SyncStatus(db: D1DatabaseLike, opts: { mongo?: any; sampleSize?: number } = {}): Promise<D1SyncStatus> {
  const mongo = opts.mongo || mongoose.connection.db;
  const sampleSize = opts.sampleSize ?? 25;
  const status: D1SyncStatus = { generatedAt: nowIso(), collections: [], lastErrors: [], errorCount: null };

  let states = new Map<string, SyncState>();
  try {
    const res = await db.prepare("SELECT * FROM sync_state").all<SyncState>();
    states = new Map((res.results || []).map((r) => [r.collection, r]));
  } catch {
    // reported per collection as state: null
  }

  for (const spec of ALL_SPECS) {
    const cs: CollectionStatus = { collection: spec.collection, table: spec.table, mongoCount: null, d1Count: null, state: states.get(spec.collection) ?? null, sample: null };
    status.collections.push(cs);
    const problems: string[] = [];
    try {
      cs.mongoCount = await mongo.collection(spec.collection).countDocuments({});
    } catch (e) {
      problems.push(`mongo count: ${errText(e)}`);
    }
    try {
      cs.d1Count = Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table}`).first<{ n: number }>())?.n ?? 0);
      if (spec.children?.length) {
        cs.childCounts = {};
        for (const c of spec.children) {
          cs.childCounts[c.table] = Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${c.table}`).first<{ n: number }>())?.n ?? 0);
        }
      }
    } catch (e) {
      problems.push(`d1 count: ${errText(e)}`);
    }
    try {
      if (sampleSize > 0) {
        const docs = await mongo.collection(spec.collection).aggregate([{ $sample: { size: sampleSize } }]).toArray();
        const mapped = await Promise.all(docs.map((d: any) => mapDoc(spec, d)));
        const have = await existingHashes(db, spec.table, mapped.map((m) => m.id));
        const sample = { size: mapped.length, matched: 0, mismatched: 0, missing: 0, mismatchedIds: [] as string[] };
        for (const m of mapped) {
          const h = have.get(m.id);
          if (h === undefined) sample.missing++;
          else if (h === m.row.docHash) sample.matched++;
          else sample.mismatched++;
          if (h !== m.row.docHash && sample.mismatchedIds.length < 10) sample.mismatchedIds.push(m.id);
        }
        cs.sample = sample;
      }
    } catch (e) {
      problems.push(`sample: ${errText(e)}`);
    }
    if (problems.length) cs.error = problems.join("; ");
  }

  try {
    const res = await db.prepare("SELECT at, collection, docId, phase, message FROM sync_errors ORDER BY id DESC LIMIT 20").all<any>();
    status.lastErrors = res.results || [];
    status.errorCount = Number((await db.prepare("SELECT COUNT(*) AS n FROM sync_errors").first<{ n: number }>())?.n ?? 0);
  } catch {
    // leave empty
  }
  return status;
}

