/**
 * Stage B1 of docs/D1_MIGRATION_PLAN.md: WRITE-THROUGH. Every write to MongoDB on a collection the D1 copy holds
 * (lib/d1/registry.ts) is also copied into D1 in the same request, before the response, so D1 is always current
 * and can later serve reads. MongoDB stays the source of truth; the 5-minute copy job (lib/d1/sync.ts) and its
 * nightly repair keep running as the safety net.
 *
 * WHERE THE HOOK SITS. On the MongoDB driver's own Collection class (`mongoose.mongo.Collection.prototype`), not on
 * mongoose middleware. Every write the app makes ends there: mongoose's NativeCollection forwards each model
 * operation to the driver collection by name (Model.create / save -> insertOne, save of an existing doc ->
 * updateOne, findByIdAndUpdate -> findOneAndUpdate, insertMany -> insertMany, bulkWrite / bulkSave -> bulkWrite,
 * ...), and `mongoose.connection.collection(x)` and `mongoose.connection.db.collection(x)` writes are driver calls
 * too. The driver's insertMany calls its own bulkWrite internally; an AsyncLocalStorage marker makes such inner
 * calls plain, so one write is handled once.
 *
 * WHAT A WRITE DOES (only for collections in ALL_SPECS, only when D1 is bound, the env switch is not "off" and the
 * D1 flag says "on"):
 *  1. before: the _ids the write can touch. From the filter itself when it names _id (save(), findByIdAndUpdate:
 *     no extra read), otherwise one read of the matching _ids (projection {_id: 1}, at most `cap` + 1). More than
 *     `cap` -> the write is not copied inline; the collection is marked for a full re-copy by the copy job.
 *  2. the original write runs, untouched. Its result (or its error) is what the caller gets, exactly as before.
 *  3. after: inserted / upserted _ids are added, the documents are read again from Mongo and written to D1 (upsert +
 *     child rows replaced, or deleted with their child rows when gone), in one D1 batch.
 *
 * ORDERING RULE (two requests changing the same document can finish out of order):
 *  - D1 is always written from a FRESH Mongo read, never from what the request wrote;
 *  - the upsert is guarded: a row is never replaced by a snapshot with an OLDER updatedAt, and child rows are only
 *    replaced when the parent row holds that very snapshot (lib/d1/upsert.ts). This also covers a D1 batch that
 *    was given up on by the timeout but still lands later;
 *  - after writing, the request reads the documents from Mongo once more and compares their hash with the hash D1
 *    now holds (read in the same D1 batch); any that differ (a newer write slipped in between, with the same
 *    updatedAt) are written again, up to 3 rounds. What still differs because the document is still changing is
 *    DEFERRED to the copy job (counted apart, not a failure: see logDeferred); anything else is a failure.
 *
 * NEVER BREAKS THE USER'S REQUEST: every D1 problem is caught and written to `sync_errors` (and counted in
 * `write_through_state`); the D1 part is capped by a timeout (3 s), after which the request goes on and the copy
 * job catches the documents up. Awaited rather than put in waitUntil, so the next read in the same session sees D1
 * current.
 *
 * KILL SWITCH: `UPDATE feature_flags SET value = 'off' WHERE key = 'writeThrough'` (read at most once a minute per
 * Worker isolate), or the env var D1_WRITE_THROUGH = "off".
 *
 * STAGE D (lib/d1/write-mode.ts): while a write area writes to D1 ('d1' and honoured), D1 is the source of truth for
 * its collections and the write-through leaves them alone: the only MongoDB writes left there are the reverse
 * mirror's copies FROM D1 (lib/d1/reverse-mirror.ts), and copying those back would only bounce them. The reverse
 * mirror's writes are also recognised by their own marker (mirrorWriteContext), whatever the switch says.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import mongoose from "mongoose";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Result } from "./types";
import { MasterSpec, MappedDoc, docHash, idText, mapDoc, toDate } from "./masters-map";
import { OVERLAP_MS } from "./sync";
import { ALL_SPECS } from "./registry";
import { chunk, deleteStatements, hashStatements, statementsFor } from "./upsert";
import { getD1 } from "./client";
import { isD1OwnedCollection } from "./write-mode";
import { mirrorWriteContext } from "./write-areas";

export const WRITE_METHODS = [
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "deleteOne",
  "deleteMany",
  "bulkWrite",
] as const;
type WriteMethod = (typeof WRITE_METHODS)[number];

export interface WriteThroughConfig {
  /** The D1 database, or null when there is none (local dev, scripts): then writes are not touched at all. */
  resolveD1: () => D1DatabaseLike | null;
  /** True when the env var switch D1_WRITE_THROUGH is "off". */
  envOff: () => boolean;
  /** Longest the D1 part of a write may add to the request. */
  timeoutMs: number;
  /** Longest the logging of a failure may add on top (D1 may be the thing that is slow). */
  logTimeoutMs: number;
  /** More documents than this in one write -> not copied inline; the collection is marked for a full re-copy. */
  cap: number;
  /** How long the feature_flags value is trusted before it is read again. */
  flagTtlMs: number;
  /** Write + verify rounds per write before what is left is handed to the copy job. */
  maxRounds: number;
  /** Tests only: runs before each D1 write batch (to force two requests to interleave). */
  beforeD1Write?: (info: { collection: string; ids: string[]; round: number }) => Promise<void> | void;
  /** Stage D: true while D1 owns the collection's writes (then a MongoDB write of it is not copied into D1). */
  d1Owns: (collection: string) => Promise<boolean>;
}

function envSwitchOff(): boolean {
  const off = (v: unknown) => String(v ?? "").trim().toLowerCase() === "off";
  if (off(process.env.D1_WRITE_THROUGH)) return true;
  try {
    return off((getCloudflareContext().env as any)?.D1_WRITE_THROUGH);
  } catch {
    return false;
  }
}

const DEFAULTS: WriteThroughConfig = {
  resolveD1: getD1,
  envOff: envSwitchOff,
  timeoutMs: 3000,
  logTimeoutMs: 500,
  // D1 counts every statement of a batch towards the per-request query limit, and a document with child rows is
  // several statements; 500 documents keeps one write well inside both that limit and the 3 s budget.
  cap: 500,
  flagTtlMs: 60_000,
  maxRounds: 3,
  d1Owns: isD1OwnedCollection,
};

const cfg: WriteThroughConfig = { ...DEFAULTS };
const SPECS = new Map<string, MasterSpec>(ALL_SPECS.map((s) => [s.collection, s]));
/** Set while the original driver method runs: writes it makes internally (insertMany -> bulkWrite) are plain. */
const inWrite = new AsyncLocalStorage<boolean>();
const PATCHED = Symbol.for("valueplus.d1WriteThrough");

/** What the last handled write did (tests and diagnostics). */
export interface WriteThroughReport {
  collection: string;
  method: string;
  ids: number;
  /** deferred: the document kept changing during the verify rounds; the copy job copies its last change. */
  outcome: "mirrored" | "deferred" | "full-recopy" | "timeout" | "error" | "nothing";
  ms: number;
  rounds: number;
}
let lastWriteThrough: WriteThroughReport | null = null;
export function getLastWriteThrough(): WriteThroughReport | null {
  return lastWriteThrough;
}

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------

let flag: { on: boolean; at: number } | null = null;
let flagLoading: Promise<boolean> | null = null;

/** Forget the cached flag (tests; the next write reads feature_flags again). */
export function resetWriteThroughFlagCache() {
  flag = null;
  flagLoading = null;
}

/**
 * The `writeThrough` row of feature_flags, cached for flagTtlMs. Off when the row is missing or reads 'off', and
 * also off (for the same minute) when it cannot be read at all: a D1 that is down then costs one slow read a
 * minute, not one per write.
 */
async function flagOn(db: D1DatabaseLike): Promise<boolean> {
  if (flag && Date.now() - flag.at < cfg.flagTtlMs) return flag.on;
  if (!flagLoading) {
    flagLoading = (async () => {
      let on = false;
      try {
        const row = await withTimeout(
          db.prepare("SELECT value FROM feature_flags WHERE key = ?").bind("writeThrough").first<{ value: string }>(),
          Math.min(cfg.timeoutMs, 1000)
        );
        on = row !== TIMED_OUT && !!row && String(row.value).trim().toLowerCase() === "on";
      } catch (e) {
        console.warn(`d1 write-through: cannot read feature_flags (${errText(e)}); off for now`);
      }
      flag = { on, at: Date.now() };
      flagLoading = null;
      return on;
    })();
  }
  return flagLoading;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIMED_OUT = Symbol("timed out");

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errText(e: unknown): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.slice(0, 1000);
}

const nowIso = () => new Date().toISOString();

function isOperatorObject(v: any): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v) || v._bsontype || v instanceof Date || v instanceof RegExp) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => k.startsWith("$"));
}

/** The _id values a filter is limited to, when it says so itself ({_id: x}, {_id: {$in: [...]}}, {_id: {$eq: x}}). */
export function idsFromFilter(filter: any): unknown[] | null {
  if (!filter || typeof filter !== "object") return null;
  const v = filter._id;
  if (v === undefined || v === null || v instanceof RegExp) return null;
  if (!isOperatorObject(v)) return [v];
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === "$eq" && !(v.$eq instanceof RegExp)) return [v.$eq];
  if (keys.length === 1 && keys[0] === "$in" && Array.isArray(v.$in) && !v.$in.some((x: unknown) => x instanceof RegExp)) return v.$in;
  return null;
}

/** Mongo _id values to look a document up by: a 24-hex text id is tried as ObjectId and as plain text. */
function lookupValues(ids: unknown[]): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    const key = `${typeof v === "object" && v && (v as any)._bsontype ? "o" : typeof v}:${idText(v)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  };
  for (const id of ids) {
    if (id === undefined || id === null) continue;
    add(id);
    const text = idText(id);
    if (/^[0-9a-f]{24}$/i.test(text)) {
      add(new mongoose.mongo.ObjectId(text));
      add(text);
    }
  }
  return out;
}

const PRIMARY = { readPreference: "primary" as const };

/** The documents with these ids, by id text, read from the primary (it has just acknowledged the write). */
async function readDocs(coll: any, ids: unknown[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  for (const part of chunk(lookupValues(ids), 500)) {
    const docs: any[] = await coll.find({ _id: { $in: part } }, PRIMARY).toArray();
    for (const d of docs) out.set(idText(d._id), d);
  }
  return out;
}

interface FilterRead {
  filter: any;
  collation?: unknown;
}

/** The _ids matching these filters, at most cap + 1 of them (one read for all the filters without a collation). */
async function matchingIds(coll: any, reads: FilterRead[]): Promise<{ ids: unknown[]; tooMany: boolean }> {
  const ids: unknown[] = [];
  const plain: any[] = [];
  const withCollation: FilterRead[] = [];
  for (const r of reads) {
    const direct = idsFromFilter(r.filter);
    if (direct) ids.push(...direct);
    else if (r.collation) withCollation.push(r);
    else plain.push(r.filter || {});
  }
  const finds: { filter: any; collation?: unknown }[] = [];
  if (plain.length) finds.push({ filter: plain.length === 1 ? plain[0] : { $or: plain } });
  finds.push(...withCollation);
  for (const f of finds) {
    if (ids.length > cfg.cap) break;
    const opts: any = { ...PRIMARY, projection: { _id: 1 }, limit: cfg.cap + 1 - ids.length };
    if (f.collation) opts.collation = f.collation;
    const docs: any[] = await coll.find(f.filter, opts).toArray();
    ids.push(...docs.map((d) => d._id));
  }
  return { ids, tooMany: uniqueTexts(ids).length > cfg.cap };
}

function uniqueTexts(ids: unknown[]): string[] {
  return [...new Set(ids.filter((v) => v !== undefined && v !== null).map(idText))];
}

// ---------------------------------------------------------------------------
// Before / after a write
// ---------------------------------------------------------------------------

interface Plan {
  ids: unknown[];
  tooMany: boolean;
  /** findOneAnd* with a projection that hides _id: the result cannot name the document. */
  preRead: boolean;
}

const BULK_FILTER_OPS = ["updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany"] as const;

async function planBefore(coll: any, method: WriteMethod, args: any[]): Promise<Plan> {
  switch (method) {
    case "insertOne":
    case "insertMany":
      return { ids: [], tooMany: false, preRead: false };
    case "updateOne":
    case "updateMany":
    case "replaceOne":
      return { ...(await matchingIds(coll, [{ filter: args[0], collation: args[2]?.collation }])), preRead: true };
    case "deleteOne":
    case "deleteMany":
      return { ...(await matchingIds(coll, [{ filter: args[0], collation: args[1]?.collation }])), preRead: true };
    case "findOneAndUpdate":
    case "findOneAndReplace":
    case "findOneAndDelete": {
      const opts = method === "findOneAndDelete" ? args[1] : args[2];
      const p = opts?.projection;
      const hidesId = p && (p._id === 0 || p._id === false);
      if (!hidesId) return { ids: [], tooMany: false, preRead: false };
      return { ...(await matchingIds(coll, [{ filter: args[0], collation: opts?.collation }])), preRead: true };
    }
    case "bulkWrite": {
      const reads: FilterRead[] = [];
      for (const op of Array.isArray(args[0]) ? args[0] : []) {
        for (const k of BULK_FILTER_OPS) {
          if (op?.[k]) reads.push({ filter: op[k].filter, collation: op[k].collation });
        }
      }
      return { ...(reads.length ? await matchingIds(coll, reads) : { ids: [], tooMany: false }), preRead: reads.length > 0 };
    }
  }
}

function valuesOf(map: any): unknown[] {
  if (!map || typeof map !== "object") return [];
  return map instanceof Map ? [...map.values()] : Object.values(map);
}

/** Every _id the write touched: the planned ones plus those it inserted or upserted. */
async function touchedIds(coll: any, method: WriteMethod, args: any[], plan: Plan, result: any, error: any): Promise<unknown[]> {
  const ids = [...plan.ids];
  switch (method) {
    case "insertOne":
      // The driver gives the document its _id before sending it, so it is known even when the insert failed.
      ids.push(args[0]?._id, result?.insertedId);
      break;
    case "insertMany":
      for (const d of Array.isArray(args[0]) ? args[0] : []) ids.push(d?._id);
      ids.push(...valuesOf(result?.insertedIds), ...valuesOf(error?.insertedIds));
      break;
    case "updateOne":
    case "updateMany":
    case "replaceOne":
      ids.push(result?.upsertedId);
      break;
    case "findOneAndUpdate":
    case "findOneAndReplace":
    case "findOneAndDelete": {
      const opts = method === "findOneAndDelete" ? args[1] : args[2];
      const doc = opts?.includeResultMetadata ? result?.value : result;
      if (doc && typeof doc === "object") ids.push(doc._id);
      if (opts?.includeResultMetadata) ids.push(result?.lastErrorObject?.upserted);
      // An upsert asked for the document as it was BEFORE gets null back: find the new document by the filter.
      if (!error && method !== "findOneAndDelete" && opts?.upsert && !uniqueTexts(ids).length) {
        const found = await matchingIds(coll, [{ filter: args[0], collation: opts?.collation }]);
        ids.push(...found.ids);
      }
      break;
    }
    case "bulkWrite":
      for (const op of Array.isArray(args[0]) ? args[0] : []) ids.push(op?.insertOne?.document?._id);
      ids.push(...valuesOf(result?.insertedIds), ...valuesOf(result?.upsertedIds));
      ids.push(...valuesOf(error?.insertedIds), ...valuesOf(error?.result?.upsertedIds ?? error?.upsertedIds));
      break;
  }
  return ids.filter((v) => v !== undefined && v !== null);
}

// ---------------------------------------------------------------------------
// Writing D1
// ---------------------------------------------------------------------------

function metricStatement(db: D1DatabaseLike, collection: string, docs: number): D1PreparedStatementLike {
  return db
    .prepare(
      "INSERT INTO write_through_state (collection, lastWriteAt, writes, docs) VALUES (?, ?, 1, ?) " +
        "ON CONFLICT(collection) DO UPDATE SET lastWriteAt = excluded.lastWriteAt, writes = writes + 1, docs = docs + excluded.docs"
    )
    .bind(collection, nowIso(), docs);
}

/** sync_errors row + failure count. Never throws, and gives up after logTimeoutMs (D1 may be what is failing). */
async function logFailure(db: D1DatabaseLike, collection: string, ids: string[], message: string) {
  const at = nowIso();
  const docId = ids.slice(0, 5).join(",") + (ids.length > 5 ? `,+${ids.length - 5}` : "") || null;
  try {
    const r = await withTimeout(
      db.batch([
        db.prepare("INSERT INTO sync_errors (at, collection, docId, phase, message) VALUES (?, ?, ?, ?, ?)").bind(at, collection, docId, "write-through", message.slice(0, 1000)),
        db
          .prepare(
            "INSERT INTO write_through_state (collection, failures, lastFailureAt, lastError) VALUES (?, 1, ?, ?) " +
              "ON CONFLICT(collection) DO UPDATE SET failures = failures + 1, lastFailureAt = excluded.lastFailureAt, lastError = excluded.lastError"
          )
          .bind(collection, at, message.slice(0, 500)),
      ]),
      cfg.logTimeoutMs
    );
    if (r === TIMED_OUT) console.warn(`d1 write-through ${collection} ${docId ?? ""}: ${message} (logging it timed out)`);
  } catch (e) {
    console.warn(`d1 write-through ${collection} ${docId ?? ""}: ${message} (and logging it failed: ${errText(e)})`);
  }
}

/**
 * The document kept changing while its write was copied (several quick updates of the same document, e.g. many
 * phones claiming today's `scheduled_runs` row at once), so after maxRounds D1 may hold one change less than Mongo.
 * That is NOT a failure: D1 was written from Mongo every round, nothing was refused, and the very next write of the
 * document, or the copy job within 5 minutes (its updatedAt watermark, every collection here has updatedAt), copies
 * the last change. So it is counted apart (`deferred`), never in `failures`, which the stage C guard turns the
 * write-through off for (14 Nov 2026: one such race switched it off for the whole day).
 * A sync_errors row is still written, phase 'write-through-deferred': the freshness guard (lib/d1/read-source.ts)
 * then keeps the collection's read area on MongoDB answers for 15 minutes, until the copy job has caught up for sure.
 * Never throws; gives up after logTimeoutMs.
 */
async function logDeferred(db: D1DatabaseLike, collection: string, ids: string[], message: string) {
  const at = nowIso();
  const docId = ids.slice(0, 5).join(",") + (ids.length > 5 ? `,+${ids.length - 5}` : "") || null;
  try {
    const r = await withTimeout(
      db.batch([
        db.prepare("INSERT INTO sync_errors (at, collection, docId, phase, message) VALUES (?, ?, ?, ?, ?)").bind(at, collection, docId, "write-through-deferred", message.slice(0, 1000)),
        db
          .prepare(
            "INSERT INTO write_through_state (collection, deferred, lastDeferredAt, lastDeferredError) VALUES (?, 1, ?, ?) " +
              "ON CONFLICT(collection) DO UPDATE SET deferred = deferred + 1, lastDeferredAt = excluded.lastDeferredAt, lastDeferredError = excluded.lastDeferredError"
          )
          .bind(collection, at, message.slice(0, 500)),
      ]),
      cfg.logTimeoutMs
    );
    if (r === TIMED_OUT) console.warn(`d1 write-through ${collection} ${docId ?? ""}: ${message} (logging it timed out)`);
  } catch (e) {
    console.warn(`d1 write-through ${collection} ${docId ?? ""}: ${message} (and logging it failed: ${errText(e)})`);
  }
}

/** Too many documents for one request: the copy job copies the whole collection again (lib/d1/sync.ts full copy). */
async function markFullRecopy(db: D1DatabaseLike, collection: string, reason: string) {
  const at = nowIso();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO sync_state (collection) VALUES (?)").bind(collection),
    db.prepare("UPDATE sync_state SET fullCopyStartedAt = NULL, fullCopyLastId = NULL, fullCopyDoneAt = NULL WHERE collection = ?").bind(collection),
    db
      .prepare(
        "INSERT INTO write_through_state (collection, fullRecopyMarks, lastFullRecopyMarkAt) VALUES (?, 1, ?) " +
          "ON CONFLICT(collection) DO UPDATE SET fullRecopyMarks = fullRecopyMarks + 1, lastFullRecopyMarkAt = excluded.lastFullRecopyMarkAt"
      )
      .bind(collection, at),
    db.prepare("INSERT INTO sync_errors (at, collection, docId, phase, message) VALUES (?, ?, NULL, ?, ?)").bind(at, collection, "write-through", `marked for a full re-copy: ${reason}`.slice(0, 1000)),
  ]);
}

/** Statements per D1 batch (a batch is one transaction; keep each small and quick). */
const STATEMENTS_PER_BATCH = 200;

/**
 * Makes D1 hold the current Mongo state of these documents (write, then verify against a fresh read, repeat).
 * Returns the ids still not matching after maxRounds (normally none) and the rounds used.
 */
async function mirrorIds(coll: any, spec: MasterSpec, db: D1DatabaseLike, rawIds: unknown[]): Promise<{ left: string[]; rounds: number; latest: Map<string, any> }> {
  const rawById = new Map<string, unknown[]>();
  for (const v of rawIds) {
    const t = idText(v);
    rawById.set(t, [...(rawById.get(t) || []), v]);
  }
  let pending = [...rawById.keys()];
  const rawOf = (ids: string[]) => ids.flatMap((t) => rawById.get(t) || [t]);
  let docs = await readDocs(coll, rawOf(pending));

  for (let round = 1; round <= cfg.maxRounds; round++) {
    const syncedAt = nowIso();
    const mapped: MappedDoc[] = [];
    const gone: string[] = [];
    for (const id of pending) {
      const doc = docs.get(id);
      if (!doc) {
        gone.push(id);
        continue;
      }
      try {
        mapped.push(await mapDoc(spec, doc, syncedAt));
      } catch (e) {
        await logFailure(db, spec.collection, [id], `mapping failed: ${errText(e)}`);
      }
    }
    const writes: D1PreparedStatementLike[][] = mapped.map((m) => statementsFor(db, spec, m, { guarded: true }));
    if (gone.length) writes.push(deleteStatements(db, spec, gone));
    if (round === 1) writes.push([metricStatement(db, spec.collection, pending.length)]);
    const hashes = hashStatements(db, spec.table, pending);

    // As few batches as possible: everything in one unless it is large; the hash read always goes last.
    const batches: D1PreparedStatementLike[][] = [[]];
    for (const group of writes) {
      const cur = batches[batches.length - 1];
      if (cur.length && cur.length + group.length > STATEMENTS_PER_BATCH) batches.push([...group]);
      else cur.push(...group);
    }
    batches[batches.length - 1].push(...hashes);
    if (cfg.beforeD1Write) await cfg.beforeD1Write({ collection: spec.collection, ids: pending, round });
    let results: D1Result[] = [];
    for (const b of batches) results = await db.batch(b);
    const inD1 = new Map<string, string>();
    for (const r of results.slice(results.length - hashes.length)) {
      for (const row of (r.results || []) as any[]) inD1.set(String(row.id), String(row.docHash));
    }

    // Verify against Mongo as it is NOW: a write that landed meanwhile (and whose own copy we may just have
    // overwritten, or that the guard kept out) shows up as a different hash.
    docs = await readDocs(coll, rawOf(pending));
    const next: string[] = [];
    for (const id of pending) {
      const doc = docs.get(id);
      const want = doc ? await docHash(doc) : undefined;
      if (want !== inD1.get(id)) next.push(id);
    }
    pending = next;
    if (!pending.length) return { left: [], rounds: round, latest: docs };
  }
  return { left: pending, rounds: cfg.maxRounds, latest: docs };
}

async function afterWrite(coll: any, spec: MasterSpec, db: D1DatabaseLike, method: WriteMethod, args: any[], plan: Plan, result: any, error: any) {
  const started = Date.now();
  const report: WriteThroughReport = { collection: spec.collection, method, ids: 0, outcome: "nothing", ms: 0, rounds: 0 };
  let ids: string[] = [];
  const work = (async () => {
    if (plan.tooMany) {
      report.outcome = "full-recopy";
      await markFullRecopy(db, spec.collection, `${method} matched more than ${cfg.cap} documents`);
      return;
    }
    const raw = await touchedIds(coll, method, args, plan, result, error);
    ids = uniqueTexts(raw);
    report.ids = ids.length;
    if (!ids.length) return;
    if (ids.length > cfg.cap) {
      report.outcome = "full-recopy";
      await markFullRecopy(db, spec.collection, `${method} wrote more than ${cfg.cap} documents`);
      return;
    }
    const { left, rounds, latest } = await mirrorIds(coll, spec, db, raw);
    report.rounds = rounds;
    report.outcome = left.length ? "deferred" : "mirrored";
    if (!left.length) return;
    // Deferred only when the copy job will really pick the document up by itself: its incremental pass copies
    // what has updatedAt after (watermark - 2 min), so Mongo's updatedAt must be that recent and not older than
    // the one D1 holds. Anything else (the document is gone from Mongo, or its updatedAt went back in time) would
    // wait for the nightly repair: that stays a real failure.
    const inD1 = new Map<string, string>();
    for (const part of chunk(left, 90)) {
      const res = await db.prepare(`SELECT id, updatedAt FROM ${spec.table} WHERE id IN (${part.map(() => "?").join(", ")})`).bind(...part).all<any>();
      for (const r of res.results || []) inD1.set(String(r.id), String(r.updatedAt ?? ""));
    }
    const recentFrom = Date.now() - OVERLAP_MS;
    const copyJobWill = (id: string) => {
      const doc = latest.get(id);
      const mongoUpdated = doc ? toDate(doc.updatedAt) : null;
      const t = mongoUpdated ? Date.parse(mongoUpdated) : NaN;
      return Number.isFinite(t) && t >= recentFrom && (inD1.get(id) ?? "") <= mongoUpdated!;
    };
    const deferred = left.filter(copyJobWill);
    const stuck = left.filter((id) => !copyJobWill(id));
    if (deferred.length) await logDeferred(db, spec.collection, deferred, `still changing in Mongo after ${rounds} rounds (deferred to the copy job)`);
    if (stuck.length) {
      report.outcome = "error";
      await logFailure(db, spec.collection, stuck, `still differs from Mongo after ${rounds} rounds, and the copy job would not pick it up by itself (left for the nightly repair)`);
    }
  })();
  try {
    const r = await withTimeout(work, cfg.timeoutMs);
    if (r === TIMED_OUT) {
      report.outcome = "timeout";
      await logFailure(db, spec.collection, ids, `${method}: D1 did not answer within ${cfg.timeoutMs} ms (left for the copy job)`);
    }
  } catch (e) {
    report.outcome = "error";
    await logFailure(db, spec.collection, ids, `${method}: ${errText(e)}`);
  }
  // A late failure of the abandoned work must not surface as an unhandled rejection.
  work.catch(() => {});
  report.ms = Date.now() - started;
  lastWriteThrough = report;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

async function writeThrough(coll: any, spec: MasterSpec, db: D1DatabaseLike, method: WriteMethod, orig: (...a: any[]) => any, args: any[]) {
  if (!(await flagOn(db))) return orig.apply(coll, args);
  // Stage D: D1 is the source of truth for this collection right now; this MongoDB write is not copied back.
  if (await cfg.d1Owns(spec.collection).catch(() => false)) return orig.apply(coll, args);
  let plan: Plan;
  let planError: unknown = null;
  try {
    plan = await planBefore(coll, method, args);
  } catch (e) {
    // The ids could not be read; never hold the write back for that. The copy job re-copies the collection.
    plan = { ids: [], tooMany: true, preRead: true };
    planError = e;
  }
  let result: any;
  let error: any;
  let failed = false;
  try {
    result = await inWrite.run(true, () => orig.apply(coll, args));
  } catch (e) {
    failed = true;
    error = e;
  }
  if (planError) await logFailure(db, spec.collection, [], `reading the ids before ${method} failed: ${errText(planError)}`);
  await afterWrite(coll, spec, db, method, args, plan, result, error);
  if (failed) throw error;
  return result;
}

function wrap(method: WriteMethod, orig: (...a: any[]) => any) {
  return function d1WriteThrough(this: any, ...args: any[]) {
    // Fast exits stay synchronous, so an untouched write behaves exactly as before.
    if (inWrite.getStore()) return orig.apply(this, args);
    // The reverse mirror copying a document FROM D1 into MongoDB: never copied back.
    if (mirrorWriteContext.getStore()) return orig.apply(this, args);
    const spec = SPECS.get(String(this?.collectionName ?? ""));
    if (!spec) return orig.apply(this, args);
    let db: D1DatabaseLike | null = null;
    try {
      db = cfg.envOff() ? null : cfg.resolveD1();
    } catch {
      db = null;
    }
    if (!db) return orig.apply(this, args);
    return writeThrough(this, spec, db, method, orig, args);
  };
}

/**
 * Installs the hook once per process (later calls only change the settings). Safe everywhere: without a D1
 * binding (local dev, scripts, tests that do not ask for it) every write goes straight to the original method.
 */
export function installWriteThrough(settings: Partial<WriteThroughConfig> = {}) {
  Object.assign(cfg, settings);
  const proto = (mongoose as any).mongo.Collection.prototype;
  if (proto[PATCHED]) return;
  for (const m of WRITE_METHODS) {
    const orig = proto[m];
    if (typeof orig !== "function") continue;
    proto[m] = wrap(m, orig);
  }
  Object.defineProperty(proto, PATCHED, { value: true });
}

/** Tests: back to the default settings (the hook itself stays installed). */
export function resetWriteThroughConfig() {
  for (const k of Object.keys(cfg)) delete (cfg as any)[k];
  Object.assign(cfg, DEFAULTS);
  resetWriteThroughFlagCache();
  lastWriteThrough = null;
}
