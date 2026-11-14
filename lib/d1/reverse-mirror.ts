/**
 * Stage D (docs/D1_MIGRATION_PLAN.md §6.8, §6.8a): the REVERSE MIRROR, D1 -> MongoDB.
 *
 * While a write area is 'd1', each of its writes is one D1 batch that also queues mirror_outbox rows. This drainer
 * copies those documents BY ID from D1 into MongoDB, so MongoDB stays a current fallback (and the rollback to
 * 'mongo' loses nothing). It runs right after the write's response (after-response queue, lib/d1/write-batch.ts),
 * from the 5-minute /api/cron/d1-sync, from the Stage D rollback, and before a fallback from 'd1' to MongoDB.
 *
 * WHAT IT WRITES: the document's CURRENT D1 row, rebuilt as the exact stored MongoDB document (lib/d1/stored-docs.ts:
 * same _id as ObjectId, createdAt, updatedAt, __v, every field), with replaceOne(upsert). A row that is gone from
 * D1 deletes the MongoDB document. So the outbox's `op` is only informative: whatever happened in between, MongoDB
 * ends up equal to D1, and copying twice is harmless.
 *
 * NEVER BACKWARDS: the replace only applies while MongoDB's updatedAt is not newer than D1's (two drains running at
 * once, a slow one finishing last). A MongoDB copy that is newer is left alone (the upsert's duplicate-key error is
 * how that shows) and the row counts as done.
 *
 * NO BOUNCE: the MongoDB writes run inside mirrorWriteContext, which the write-through (Mongo -> D1) ignores.
 *
 * FAILURES: a document that cannot be written keeps its outbox rows pending (attempts + 1, lastError) and is logged
 * in mirror_failures; the next drain retries it. Stage D rolls the area back after more than 3 failures in an hour
 * or when the oldest pending row is over 10 minutes old. Never throws.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import type { D1DatabaseLike } from "./types";
import { mirrorWriteContext } from "./write-areas";
import { loadStoredByIds, storedDocFromRow } from "./stored-docs";

export interface DrainOptions {
  /** MongoDB database to write (default: mongoose's connected database, connecting first when needed). */
  mongo?: any;
  /** Only these collections (default: every collection in the outbox). */
  collections?: string[];
  /** Outbox rows read per round. */
  limit?: number;
  /** Stop starting new rounds after this long. */
  budgetMs?: number;
  now?: () => number;
}

export interface DrainReport {
  ok: boolean;
  /** Documents copied (or deleted) in MongoDB. */
  drained: number;
  /** Documents that failed this run (their rows stay pending). */
  failed: number;
  /** Outbox rows still pending afterwards (for the drained collections). */
  pending: number;
  oldestPendingAt: string | null;
  error?: string;
}

const DONE_KEEP_MS = 7 * 24 * 3600_000;
const FAILURES_KEEP_MS = 14 * 24 * 3600_000;

function errText(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);
}

function inList(collections: string[] | undefined): { sql: string; params: unknown[] } {
  return collections && collections.length
    ? { sql: " AND collection IN (SELECT value FROM json_each(?))", params: [JSON.stringify(collections)] }
    : { sql: "", params: [] };
}

/** Outbox rows still to copy (and the oldest one's time), for the given collections. */
export async function outboxPending(db: D1DatabaseLike, collections?: string[]): Promise<{ pending: number; oldestAt: string | null }> {
  const f = inList(collections);
  const row = await db
    .prepare(`SELECT COUNT(*) AS n, MIN(at) AS oldest FROM mirror_outbox WHERE doneAt IS NULL${f.sql}`)
    .bind(...f.params)
    .first<{ n: number; oldest: string | null }>();
  return { pending: Number(row?.n ?? 0), oldestAt: row?.oldest ?? null };
}

const isDuplicateKey = (e: any) => e && (e.code === 11000 || /E11000/.test(String(e.message)));

/** Make MongoDB hold D1's current version of one document (or not hold it, when D1 no longer has it). */
async function mirrorOne(mongo: any, collection: string, id: string, row: Record<string, any> | undefined) {
  const coll = mongo.collection(collection);
  const _id = /^[0-9a-f]{24}$/i.test(id) ? new mongoose.Types.ObjectId(id) : id;
  await mirrorWriteContext.run(true, async () => {
    if (!row) {
      await coll.deleteOne({ _id });
      return;
    }
    const doc = await storedDocFromRow(collection, row);
    // A MongoDB copy without a real Date updatedAt (missing, legacy text) can never be "newer": replace it.
    const filter =
      doc.updatedAt instanceof Date
        ? { _id, $or: [{ updatedAt: { $lte: doc.updatedAt } }, { updatedAt: { $not: { $type: "date" } } }] }
        : { _id };
    try {
      await coll.replaceOne(filter, doc, { upsert: true });
    } catch (e) {
      // The document exists with a NEWER updatedAt: MongoDB is ahead of this copy, leave it.
      if (!isDuplicateKey(e)) throw e;
    }
  });
}

async function mongoDb(opts: DrainOptions): Promise<any> {
  if (opts.mongo) return opts.mongo;
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB is not connected");
  return db;
}

async function recordRun(db: D1DatabaseLike, at: string, report: DrainReport) {
  try {
    const result = report.error ? "error" : report.failed ? "partial" : "ok";
    await db
      .prepare(
        `INSERT INTO mirror_drain_state (id, lastRunAt, lastResult, lastOkAt, lastDrained, lastFailed, lastError, runs)
         VALUES (1, ?1, ?2, CASE WHEN ?2 = 'ok' THEN ?1 ELSE NULL END, ?3, ?4, ?5, 1)
         ON CONFLICT(id) DO UPDATE SET lastRunAt = excluded.lastRunAt, lastResult = excluded.lastResult,
           lastOkAt = CASE WHEN excluded.lastResult = 'ok' THEN excluded.lastRunAt ELSE mirror_drain_state.lastOkAt END,
           lastDrained = excluded.lastDrained, lastFailed = excluded.lastFailed, lastError = excluded.lastError,
           runs = mirror_drain_state.runs + 1`
      )
      .bind(at, result, report.drained, report.failed, report.error ?? null)
      .run();
  } catch (e) {
    console.warn(`d1 reverse mirror: cannot write the drain heartbeat (${errText(e)})`);
  }
}

/**
 * Copies pending outbox documents from D1 into MongoDB, oldest first, until none is left or the budget is used.
 * Never throws. A run with nothing to do touches nothing (no heartbeat row).
 */
export async function drainOutbox(db: D1DatabaseLike, opts: DrainOptions = {}): Promise<DrainReport> {
  const now = opts.now || (() => Date.now());
  const started = now();
  const budget = opts.budgetMs ?? 8000;
  const limit = opts.limit ?? 200;
  const f = inList(opts.collections);
  const report: DrainReport = { ok: true, drained: 0, failed: 0, pending: 0, oldestPendingAt: null };
  let touched = false;
  try {
    let afterId = 0;
    let mongo: any = null;
    while (now() - started < budget) {
      const res = await db
        .prepare(`SELECT id, collection, docId FROM mirror_outbox WHERE doneAt IS NULL AND id > ?${f.sql} ORDER BY id LIMIT ?`)
        .bind(afterId, ...f.params, limit)
        .all<{ id: number; collection: string; docId: string }>();
      const rows = res.results || [];
      if (!rows.length) break;
      touched = true;
      afterId = Number(rows[rows.length - 1].id);
      if (!mongo) mongo = await mongoDb(opts);

      // One MongoDB write per document, however many outbox rows it has (several quick edits of one brand).
      const byDoc = new Map<string, { collection: string; docId: string; rowIds: number[] }>();
      for (const r of rows) {
        const key = `${r.collection}\u0000${r.docId}`;
        const e = byDoc.get(key) || { collection: String(r.collection), docId: String(r.docId), rowIds: [] };
        e.rowIds.push(Number(r.id));
        byDoc.set(key, e);
      }
      const byCollection = new Map<string, string[]>();
      for (const e of Array.from(byDoc.values())) byCollection.set(e.collection, [...(byCollection.get(e.collection) || []), e.docId]);
      const d1Rows = new Map<string, Map<string, Record<string, any>>>();
      for (const [collection, ids] of Array.from(byCollection)) d1Rows.set(collection, await loadStoredByIds(db, collection, ids));

      const done: number[] = [];
      const at = new Date(now()).toISOString();
      for (const e of Array.from(byDoc.values())) {
        try {
          await mirrorOne(mongo, e.collection, e.docId, d1Rows.get(e.collection)?.get(e.docId));
          done.push(...e.rowIds);
          report.drained++;
        } catch (err) {
          report.failed++;
          const msg = errText(err);
          await db.batch([
            db
              .prepare("UPDATE mirror_outbox SET attempts = attempts + 1, lastError = ?, lastAttemptAt = ? WHERE id IN (SELECT value FROM json_each(?))")
              .bind(msg, at, JSON.stringify(e.rowIds)),
            db.prepare("INSERT INTO mirror_failures (at, collection, docId, error) VALUES (?, ?, ?, ?)").bind(at, e.collection, e.docId, msg),
          ]);
        }
      }
      if (done.length) {
        await db.prepare("UPDATE mirror_outbox SET doneAt = ?, lastAttemptAt = ? WHERE id IN (SELECT value FROM json_each(?))").bind(at, at, JSON.stringify(done)).run();
      }
      if (rows.length < limit) break;
    }
    if (touched) {
      const cutoff = new Date(now() - DONE_KEEP_MS).toISOString();
      await db.batch([
        db.prepare("DELETE FROM mirror_outbox WHERE doneAt IS NOT NULL AND doneAt < ?").bind(cutoff),
        db.prepare("DELETE FROM mirror_failures WHERE at < ?").bind(new Date(now() - FAILURES_KEEP_MS).toISOString()),
      ]);
    }
  } catch (e) {
    report.ok = false;
    report.error = errText(e);
    touched = true;
    console.warn(`d1 reverse mirror: drain failed (${report.error})`);
  }
  try {
    const p = await outboxPending(db, opts.collections);
    report.pending = p.pending;
    report.oldestPendingAt = p.oldestAt;
  } catch {
    // reported as unknown (0); the next run reads it again
  }
  if (report.failed) report.ok = false;
  if (touched) await recordRun(db, new Date(now()).toISOString(), report);
  return report;
}
