/**
 * Stage D of docs/D1_MIGRATION_PLAN.md (§6.8, §6.8a): the automatic WRITE cutover. DORMANT: its switch
 * feature_flags `stageD` is seeded 'off' by migration 0011, and with 'off' a run reads one row and does nothing.
 *
 * `runStageD(db, now)` runs at the end of every /api/cron/d1-sync (every 5 min). With stageD = 'auto':
 *
 *  1. ROLLBACK d1 -> fence -> mongo (any time), for a write area set to 'd1', when
 *      - the oldest reverse-mirror outbox row still pending is more than 10 minutes old (MongoDB falling behind), or
 *      - more than 3 documents failed to copy into MongoDB in the last hour (mirror_failures), or
 *      - one of its read areas is no longer set to 'd1' (Stage C demoted it: D1 is not trusted for reads now).
 *     Per §6.8: set 'fence' (writes wait), drain the outbox to zero, THEN set 'mongo' (MongoDB is the source of
 *     truth again, the write-through copies every write into D1 as before). If the outbox cannot be emptied in this
 *     run, the area stays fenced and the next run carries on draining; nothing is lost either way.
 *  2. PROMOTION mongo -> fence -> d1, only 22:00-00:25 India time (the shop is closed), one area per night, when ALL
 *     of these hold:
 *      - every read area of the write area (lib/d1/write-areas.ts) is set to 'd1', answers from D1 right now
 *        (fresh), and has been 'd1' for at least 7 shop days without a change (so without a demotion);
 *      - the write-through is 'on' and recorded no failure in the last 7 days;
 *      - the reverse-mirror outbox of the area is empty;
 *      - the nightly reconciliation of each of its collections ran in the last 48 h and repaired / deleted nothing;
 *      - no rollback of this area in the last 7 shop days.
 *     The fence protocol then runs inside the same run: 'fence', wait 35 s for writes already under way, check the
 *     outbox is still empty and that every MongoDB document changed since 5 minutes before the fence is exactly what
 *     D1 holds (docHash), then 'd1'. If a check fails the promotion is ABORTED back to 'mongo'.
 *  'demote-only' runs only the rollbacks; 'off' (or a missing / unknown value) does nothing.
 *
 * A fence left behind by an interrupted run is finished by the next one: a rollback's fence drains and goes to
 * 'mongo'; a promotion's fence is re-checked (promoted when everything still holds in the window, else aborted).
 * A fence set by hand (no Stage D log row for it) is never touched.
 *
 * Every change is a guarded UPDATE (only from the value read) plus a stage_d_log row with a plain reason. Never
 * throws: problems end up in the returned report.
 */
import mongoose from "mongoose";
import type { D1DatabaseLike } from "./types";
import { READ_FLAG_PREFIX, readFreshnessUncached } from "./read-source";
import { WRITE_FLAG_PREFIX, parseWriteSwitch, type WriteSwitch } from "./write-mode";
import { WRITE_AREAS, WRITE_AREA_COLLECTIONS, readAreasOfWriteArea } from "./write-areas";
import { drainOutbox, outboxPending, type DrainReport } from "./reverse-mirror";
import { PROMOTION_WINDOW, inPromotionWindow, shopDayOf } from "./stage-c";
import { docHash } from "./masters-map";
import { specOf } from "./stored-docs";

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

export const STAGE_D_ORDER = WRITE_AREAS;

export const STAGE_D_RULES = {
  /** Shop days each read area must have answered from D1, unchanged, before its writes may move. */
  readD1ShopDays: 7,
  /** No write-through failure in this long. */
  writeThroughCleanMs: 7 * 24 * 3600_000,
  /** The nightly reconciliation must be this recent (and clean) for every collection of the area. */
  reconcileMaxAgeMs: 48 * 3600_000,
  /** Shop days after a rollback before the area may be promoted again. */
  afterRollbackShopDays: 7,
  /** Rollback when the oldest pending outbox row is older than this. */
  maxOutboxLagMs: 10 * 60_000,
  /** Rollback when more documents than this failed to copy into MongoDB in the last hour. */
  maxDrainFailuresPerHour: 3,
  /** Fence: wait this long for writes that started before it (§6.8: a 35 s ceiling). */
  fenceSettleMs: 35_000,
  /** Fence: the targeted reconciliation looks at MongoDB documents changed since this long before the fence. */
  reconcileBeforeFenceMs: 5 * 60_000,
  /** Rollback: the outbox drain may take this long per run. */
  rollbackDrainMs: 20_000,
};

export type StageDSetting = "auto" | "demote-only" | "off";

export interface StageDChange {
  area: string;
  fromMode: string;
  toMode: string;
  kind: "promote" | "rollback" | "abort";
  reason: string;
  applied: boolean;
}

export interface StageDReport {
  ok: boolean;
  setting: StageDSetting | null;
  changes: StageDChange[];
  drains: Record<string, DrainReport>;
  error?: string;
}

export interface StageDDeps {
  sleep: (ms: number) => Promise<void>;
  /** The reverse-mirror drain (tests can make it fail). */
  drain: (db: D1DatabaseLike, collections: string[], budgetMs: number) => Promise<DrainReport>;
  /** MongoDB database for the targeted reconciliation (default: mongoose's connection). */
  mongo: () => any;
  fenceSettleMs: number;
}

const DEFAULT_DEPS: StageDDeps = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  drain: (db, collections, budgetMs) => drainOutbox(db, { collections, budgetMs }),
  mongo: () => mongoose.connection.db,
  fenceSettleMs: STAGE_D_RULES.fenceSettleMs,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString();

function parseIso(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function parseSetting(v: unknown): StageDSetting {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "auto" || s === "demote-only" ? s : "off";
}

function errText(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300);
}

async function rows<T = any>(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<T[]> {
  const stmt = args.length ? db.prepare(sql).bind(...args) : db.prepare(sql);
  return ((await stmt.all<T>()).results || []) as T[];
}

/** Whole shop days from the shop day of `since` to the shop day of `now` (India dates). */
function shopDaysBetween(sinceMs: number, nowMs: number): number {
  const a = Date.parse(`${shopDayOf(sinceMs)}T00:00:00Z`);
  const b = Date.parse(`${shopDayOf(nowMs)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** 22:00 India time of the promotion night `ms` falls in (or last fell in). */
function nightStart(ms: number): number {
  return Date.parse(`${shopDayOf(ms)}T00:00:00+05:30`) + PROMOTION_WINDOW.fromMin * 60_000;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

export interface ReadAreaFacts {
  area: string;
  value: string | null;
  /** When the read switch last changed (its updatedAt or its latest stage_c_log row, the later). */
  since: string | null;
  fresh: boolean;
  freshReason: string | null;
  shopDaysOnD1: number;
}

export interface AreaStageD {
  area: string;
  value: string | null;
  mode: WriteSwitch;
  since: string | null;
  collections: string[];
  readAreas: ReadAreaFacts[];
  outbox: { pending: number; oldestAt: string | null; lagMs: number | null };
  failuresLastHour: number;
  reconcile: { collection: string; lastReconcileAt: string | null; repaired: number | null; deleted: number | null }[];
  lastChange: { at: string; fromMode: string | null; toMode: string | null; kind: string; reason: string } | null;
  lastRollbackAt: string | null;
  /** Why the area may not be promoted now (empty = it may). */
  blockers: string[];
  /** Why a 'd1' area must be rolled back now (empty = it may stay). */
  rollbackReasons: string[];
}

export interface StageDEvaluation {
  now: string;
  setting: StageDSetting;
  inPromotionWindow: boolean;
  writeThrough: { on: boolean; lastFailureAt: string | null };
  promotedTonight: { area: string; at: string } | null;
  areas: AreaStageD[];
}

/** Everything the decisions need, judged at `now`. Reads only; throws when a table is missing. */
export async function evaluateStageD(db: D1DatabaseLike, now: number): Promise<StageDEvaluation> {
  const flags = await rows<{ key: string; value: string; updatedAt: string | null }>(
    db,
    "SELECT key, value, updatedAt FROM feature_flags WHERE key LIKE 'read:%' OR key LIKE 'write:%' OR key IN ('writeThrough', 'stageD')"
  );
  const flag = new Map(flags.map((f) => [String(f.key), f]));
  const setting = parseSetting(flag.get("stageD")?.value);
  const wtOn = String(flag.get("writeThrough")?.value ?? "").trim().toLowerCase() === "on";
  const [wtFail] = await rows<{ last: string | null }>(db, "SELECT MAX(lastFailureAt) AS last FROM write_through_state");
  const promotedRows = await rows<{ area: string; at: string }>(
    db,
    "SELECT area, at FROM stage_d_log WHERE kind = 'promote' AND toMode = 'd1' AND at >= ? ORDER BY at DESC LIMIT 1",
    iso(nightStart(now))
  );

  const allReadAreas = Array.from(new Set(STAGE_D_ORDER.flatMap(readAreasOfWriteArea)));
  const freshness = await readFreshnessUncached(db, allReadAreas, now);
  const readFacts = new Map<string, ReadAreaFacts>();
  for (const ra of allReadAreas) {
    const f = flag.get(`${READ_FLAG_PREFIX}${ra}`);
    const [log] = await rows<{ at: string }>(db, "SELECT at FROM stage_c_log WHERE area = ? ORDER BY at DESC, id DESC LIMIT 1", ra);
    const sinceMs = Math.max(parseIso(f?.updatedAt) ?? -Infinity, parseIso(log?.at) ?? -Infinity);
    const since = Number.isFinite(sinceMs) ? iso(sinceMs) : null;
    readFacts.set(ra, {
      area: ra,
      value: f?.value ?? null,
      since,
      fresh: freshness[ra]?.fresh ?? false,
      freshReason: freshness[ra]?.reason ?? null,
      shopDaysOnD1: String(f?.value ?? "").trim().toLowerCase() === "d1" && since ? shopDaysBetween(sinceMs, now) : 0,
    });
  }

  const areas: AreaStageD[] = [];
  for (const area of STAGE_D_ORDER) {
    const collections = WRITE_AREA_COLLECTIONS[area] || [];
    const f = flag.get(`${WRITE_FLAG_PREFIX}${area}`);
    const mode = parseWriteSwitch(f?.value) ?? "mongo";
    const pending = await outboxPending(db, collections);
    const [fails] = await rows<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM mirror_failures WHERE at >= ? AND collection IN (SELECT value FROM json_each(?))",
      iso(now - 3600_000),
      JSON.stringify(collections)
    );
    const rec = await rows<{ collection: string; lastReconcileAt: string | null; lastReconcileRepaired: number | null; lastReconcileDeleted: number | null }>(
      db,
      "SELECT collection, lastReconcileAt, lastReconcileRepaired, lastReconcileDeleted FROM sync_state WHERE collection IN (SELECT value FROM json_each(?))",
      JSON.stringify(collections)
    );
    const recBy = new Map(rec.map((r) => [String(r.collection), r]));
    const [lastChange] = await rows<any>(db, "SELECT at, fromMode, toMode, kind, reason FROM stage_d_log WHERE area = ? ORDER BY at DESC, id DESC LIMIT 1", area);
    const [lastRollback] = await rows<{ at: string }>(db, "SELECT at FROM stage_d_log WHERE area = ? AND kind = 'rollback' ORDER BY at DESC LIMIT 1", area);
    const sinceMs = Math.max(parseIso(f?.updatedAt) ?? -Infinity, parseIso(lastChange?.at) ?? -Infinity);
    const oldestMs = parseIso(pending.oldestAt);

    const a: AreaStageD = {
      area,
      value: f?.value ?? null,
      mode,
      since: Number.isFinite(sinceMs) ? iso(sinceMs) : null,
      collections,
      readAreas: readAreasOfWriteArea(area).map((ra) => readFacts.get(ra)!),
      outbox: { pending: pending.pending, oldestAt: pending.oldestAt, lagMs: oldestMs === null ? null : Math.max(0, now - oldestMs) },
      failuresLastHour: Number(fails?.n ?? 0),
      reconcile: collections.map((c) => {
        const r = recBy.get(c);
        return { collection: c, lastReconcileAt: r?.lastReconcileAt ?? null, repaired: r?.lastReconcileRepaired ?? null, deleted: r?.lastReconcileDeleted ?? null };
      }),
      lastChange: lastChange || null,
      lastRollbackAt: lastRollback?.at ?? null,
      blockers: [],
      rollbackReasons: [],
    };

    // Why a 'd1' area must go back.
    if (a.outbox.lagMs !== null && a.outbox.lagMs > STAGE_D_RULES.maxOutboxLagMs) {
      a.rollbackReasons.push(`the oldest reverse-mirror row has waited ${Math.round(a.outbox.lagMs / 60_000)} min (more than ${STAGE_D_RULES.maxOutboxLagMs / 60_000})`);
    }
    if (a.failuresLastHour > STAGE_D_RULES.maxDrainFailuresPerHour) {
      a.rollbackReasons.push(`${a.failuresLastHour} documents failed to copy into MongoDB in the last hour (more than ${STAGE_D_RULES.maxDrainFailuresPerHour})`);
    }
    for (const ra of a.readAreas) {
      if (String(ra.value ?? "").trim().toLowerCase() !== "d1") a.rollbackReasons.push(`read:${ra.area} is '${ra.value ?? "(no row)"}', not 'd1'`);
    }

    // What stands in the way of a promotion.
    if (mode !== "mongo") a.blockers.push(`write:${area} is '${mode}', not 'mongo'`);
    for (const ra of a.readAreas) {
      if (String(ra.value ?? "").trim().toLowerCase() !== "d1") a.blockers.push(`read:${ra.area} is '${ra.value ?? "(no row)"}', not 'd1'`);
      else if (!ra.fresh) a.blockers.push(`read:${ra.area} does not answer from D1 right now: ${ra.freshReason}`);
      else if (ra.shopDaysOnD1 < STAGE_D_RULES.readD1ShopDays) {
        a.blockers.push(`read:${ra.area} has answered from D1 for ${ra.shopDaysOnD1} shop day(s) since ${ra.since}; needs ${STAGE_D_RULES.readD1ShopDays}`);
      }
    }
    if (!wtOn) a.blockers.push("the write-through is not on");
    const wtLast = parseIso(wtFail?.last);
    if (wtLast !== null && wtLast >= now - STAGE_D_RULES.writeThroughCleanMs) a.blockers.push(`a write-through failure was recorded at ${wtFail!.last} (none allowed in 7 days)`);
    if (a.outbox.pending > 0) a.blockers.push(`${a.outbox.pending} reverse-mirror row(s) still pending`);
    for (const r of a.reconcile) {
      const t = parseIso(r.lastReconcileAt);
      if (t === null || t < now - STAGE_D_RULES.reconcileMaxAgeMs) a.blockers.push(`${r.collection}: no nightly reconciliation in the last 48 h`);
      else if (Number(r.repaired ?? 0) > 0 || Number(r.deleted ?? 0) > 0) {
        a.blockers.push(`${r.collection}: the last reconciliation repaired ${r.repaired ?? 0} and deleted ${r.deleted ?? 0} row(s)`);
      }
    }
    const rb = parseIso(a.lastRollbackAt);
    if (rb !== null && shopDaysBetween(rb, now) < STAGE_D_RULES.afterRollbackShopDays) {
      a.blockers.push(`rolled back at ${a.lastRollbackAt}; waits ${STAGE_D_RULES.afterRollbackShopDays} shop days`);
    }
    if (!inPromotionWindow(now)) a.blockers.push("outside 22:00-00:25 India time");
    if (promotedRows.length) a.blockers.push(`${promotedRows[0].area} was already promoted tonight`);
    if (setting !== "auto") a.blockers.push(`stageD is '${setting}', not 'auto'`);
    areas.push(a);
  }

  return {
    now: iso(now),
    setting,
    inPromotionWindow: inPromotionWindow(now),
    writeThrough: { on: wtOn, lastFailureAt: wtFail?.last ?? null },
    promotedTonight: promotedRows[0] ?? null,
    areas,
  };
}

// ---------------------------------------------------------------------------
// Changing a switch
// ---------------------------------------------------------------------------

/**
 * write:<area> from `from` to `to`, logged, in one batch. The change only applies while the switch still holds
 * `from` (a missing row counts as 'mongo'), and the log row only when the switch now holds exactly our value and
 * time, so a change that did not happen is never logged.
 */
async function changeWriteFlag(db: D1DatabaseLike, area: string, from: WriteSwitch, to: WriteSwitch, kind: StageDChange["kind"], reason: string, at: string): Promise<boolean> {
  const key = `${WRITE_FLAG_PREFIX}${area}`;
  const stmts = [
    db.prepare("UPDATE feature_flags SET value = ?, updatedAt = ? WHERE key = ? AND lower(trim(value)) = ?").bind(to, at, key, from),
  ];
  if (from === "mongo") {
    stmts.push(db.prepare("INSERT INTO feature_flags (key, value, updatedAt) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = ?)").bind(key, to, at, key));
  }
  stmts.push(
    db
      .prepare(
        "INSERT INTO stage_d_log (at, area, fromMode, toMode, kind, reason) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM feature_flags WHERE key = ? AND value = ? AND updatedAt = ?)"
      )
      .bind(at, area, from, to, kind, reason.slice(0, 1000), key, to, at)
  );
  await db.batch(stmts);
  const row = await db.prepare("SELECT value, updatedAt FROM feature_flags WHERE key = ?").bind(key).first<{ value: string; updatedAt: string }>();
  return !!row && row.value === to && row.updatedAt === at;
}

/**
 * §6.8 step 3(c): every MongoDB document of the area changed since `sinceMs` must be exactly what D1 holds.
 * Returns the differences found (collection:id), or throws when MongoDB cannot be read.
 */
async function targetedReconcile(db: D1DatabaseLike, mongo: any, collections: string[], sinceMs: number): Promise<string[]> {
  if (!mongo) throw new Error("MongoDB is not connected");
  const diffs: string[] = [];
  for (const c of collections) {
    const docs: any[] = await mongo.collection(c).find({ updatedAt: { $gte: new Date(sinceMs) } }).limit(1000).toArray();
    if (!docs.length) continue;
    const ids = docs.map((d) => String(d._id));
    const res = await db.prepare(`SELECT id, docHash FROM ${specOf(c).table} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<{ id: string; docHash: string }>();
    const inD1 = new Map((res.results || []).map((r) => [String(r.id), String(r.docHash)]));
    for (const d of docs) if (inD1.get(String(d._id)) !== (await docHash(d))) diffs.push(`${c}:${String(d._id)}`);
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

async function rollback(db: D1DatabaseLike, a: AreaStageD, reason: string, now: number, deps: StageDDeps, report: StageDReport, fromFence: boolean) {
  if (!fromFence) {
    const r = `${reason}. Fenced: writes wait while the reverse mirror copies everything into MongoDB.`;
    const applied = await changeWriteFlag(db, a.area, "d1", "fence", "rollback", r, iso(now));
    report.changes.push({ area: a.area, fromMode: "d1", toMode: "fence", kind: "rollback", reason: r, applied });
    if (!applied) return;
  }
  const drain = await deps.drain(db, a.collections, STAGE_D_RULES.rollbackDrainMs);
  report.drains[a.area] = drain;
  const left = (await outboxPending(db, a.collections)).pending;
  if (left > 0) return; // stays fenced; the next run keeps draining
  const r = "outbox drained to zero: MongoDB holds every D1 write. Back to MongoDB as the source of truth; the write-through copies every write into D1 again.";
  // Its own timestamp, so the two log rows of one run keep their order.
  const applied = await changeWriteFlag(db, a.area, "fence", "mongo", "rollback", r, iso(now + 1));
  report.changes.push({ area: a.area, fromMode: "fence", toMode: "mongo", kind: "rollback", reason: r, applied });
}

async function promote(db: D1DatabaseLike, a: AreaStageD, now: number, deps: StageDDeps, report: StageDReport, fromFence: boolean) {
  const t0 = fromFence ? parseIso(a.since) ?? now : now;
  if (!fromFence) {
    const r =
      `every read area on D1 for ${STAGE_D_RULES.readD1ShopDays}+ shop days, write-through clean for 7 days, outbox empty, ` +
      `reconciliation clean, shop closed. Fenced: writes wait for ${Math.round(deps.fenceSettleMs / 1000)} s while writes already under way finish.`;
    const applied = await changeWriteFlag(db, a.area, "mongo", "fence", "promote", r, iso(now));
    report.changes.push({ area: a.area, fromMode: "mongo", toMode: "fence", kind: "promote", reason: r, applied });
    if (!applied) return;
    await deps.sleep(deps.fenceSettleMs);
  }
  const at = iso(Math.max(now, t0) + deps.fenceSettleMs + 1);
  const abort = async (why: string) => {
    const r = `promotion given up: ${why}. Back to MongoDB; nothing was written to D1 meanwhile.`;
    const applied = await changeWriteFlag(db, a.area, "fence", "mongo", "abort", r, at);
    report.changes.push({ area: a.area, fromMode: "fence", toMode: "mongo", kind: "abort", reason: r, applied });
  };
  const pending = (await outboxPending(db, a.collections)).pending;
  if (pending > 0) return abort(`${pending} reverse-mirror row(s) pending`);
  let diffs: string[];
  try {
    diffs = await targetedReconcile(db, deps.mongo(), a.collections, t0 - STAGE_D_RULES.reconcileBeforeFenceMs);
  } catch (e) {
    return abort(`the targeted reconciliation could not run (${errText(e)})`);
  }
  if (diffs.length) return abort(`${diffs.length} document(s) changed since the fence differ between MongoDB and D1 (${diffs.slice(0, 3).join(", ")})`);
  const r = "fence settled, outbox empty, every document changed since 5 minutes before the fence is identical in MongoDB and D1. Writes go to D1 now; the reverse mirror keeps MongoDB current.";
  const applied = await changeWriteFlag(db, a.area, "fence", "d1", "promote", r, at);
  report.changes.push({ area: a.area, fromMode: "fence", toMode: "d1", kind: "promote", reason: r, applied });
}

/** One run of Stage D at `now` (ms). Never throws. */
export async function runStageD(db: D1DatabaseLike, now: number = Date.now(), deps: Partial<StageDDeps> = {}): Promise<StageDReport> {
  const d: StageDDeps = { ...DEFAULT_DEPS, ...deps };
  const report: StageDReport = { ok: true, setting: null, changes: [], drains: {} };
  try {
    const setting = parseSetting((await db.prepare("SELECT value FROM feature_flags WHERE key = 'stageD'").first<{ value: string }>())?.value);
    report.setting = setting;
    if (setting === "off") return report;
    const ev = await evaluateStageD(db, now);

    for (const a of ev.areas) {
      if (a.mode === "d1" && a.rollbackReasons.length) {
        await rollback(db, a, a.rollbackReasons.join("; "), now, d, report, false);
      } else if (a.mode === "fence") {
        // Only a fence Stage D itself set is finished here; a fence set by hand is the Admin's.
        const last = a.lastChange;
        if (!last || last.toMode !== "fence") continue;
        if (last.kind === "rollback") await rollback(db, a, "", now, d, report, true);
        else if (last.kind === "promote") {
          // Every promotion condition except "the switch is 'mongo'" (it is our own fence) must still hold.
          const stillOk = a.blockers.filter((b) => !b.startsWith(`write:${a.area} `)).length === 0;
          if (stillOk) await promote(db, a, now, d, report, true);
          else {
            const r = "a promotion's fence was left behind and the promotion no longer qualifies. Back to MongoDB.";
            const applied = await changeWriteFlag(db, a.area, "fence", "mongo", "abort", r, iso(now));
            report.changes.push({ area: a.area, fromMode: "fence", toMode: "mongo", kind: "abort", reason: r, applied });
          }
        }
      }
    }

    // At most one promotion, only in 'auto', only when nothing else changed in this run.
    if (setting === "auto" && report.changes.length === 0) {
      const next = ev.areas.find((a) => a.mode === "mongo");
      if (next && next.blockers.length === 0) await promote(db, next, now, d, report, false);
    }
  } catch (e) {
    report.ok = false;
    report.error = errText(e);
    console.warn(`d1 stage D: did not run (${report.error})`);
  }
  return report;
}

/** runStageD for the cron: capped in time (the fence wait is part of a promotion), never throws. */
export async function runStageDSafely(db: D1DatabaseLike, now: number = Date.now(), timeoutMs = 90_000, deps: Partial<StageDDeps> = {}): Promise<StageDReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<StageDReport>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, setting: null, changes: [], drains: {}, error: `timed out after ${timeoutMs} ms` }), timeoutMs);
    });
    return await Promise.race([Promise.resolve().then(() => runStageD(db, now, deps)), timeout]);
  } catch (e) {
    return { ok: false, setting: null, changes: [], drains: {}, error: errText(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The admin view: the evaluation, the drainer's heartbeat and the last 20 Stage D changes. */
export async function getStageDStatus(db: D1DatabaseLike, now: number = Date.now()) {
  const ev = await evaluateStageD(db, now);
  const lastDrain = await db.prepare("SELECT lastRunAt, lastResult, lastOkAt, lastDrained, lastFailed, lastError, runs FROM mirror_drain_state WHERE id = 1").first();
  const log = await rows(db, "SELECT id, at, area, fromMode, toMode, kind, reason FROM stage_d_log ORDER BY at DESC, id DESC LIMIT 20");
  return { ...ev, lastDrain: lastDrain || null, log };
}
