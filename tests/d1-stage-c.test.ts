/**
 * Stage C of the D1 migration: the automatic switch of the read areas from 'shadow' to 'd1' and back.
 *  - lib/d1/stage-c.ts: promotion only 22:00–00:25 India time, one area per night, in order, only with enough clean
 *    days / comparisons; demotion on a mismatch, on > 3 D1 failures, on the write-through being off; the
 *    write-through guard; 'mongo' never touched; stageC = 'off' / 'demote-only'; idempotent;
 *  - lib/d1/read-source.ts freshness guard: 'd1' reads MongoDB while D1 is not known fresh;
 *  - lib/d1/shadow.ts: the reverse comparison in d1 mode (D1 answers, MongoDB compared and recorded) and
 *    mongoOnlyInD1 reads (MongoDB answers even in d1 mode), on the real registries and the next-number route;
 *  - the after-response work keeps the request's async context (worker.ts runs it outside the handler);
 *  - /api/cron/d1-sync: a failing Stage C never breaks the copy; /api/admin/d1-shadow-status shows Stage C.
 * Local D1 (Miniflare) and mongodb-memory-server; the clock is passed in, never the real one.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import { faulty } from "./helpers/d1-faults";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { runD1Sync } from "@/lib/d1/sync";
import { configureReadSource, getConfiguredReadMode, getReadMode, resetReadModeCache, resetReadSourceConfig } from "@/lib/d1/read-source";
import { configureShadow, flushShadowWork, readWithShadow, resetShadowConfig, resetShadowSampling } from "@/lib/d1/shadow";
import { PROMOTION_RULES, STAGE_C_ORDER, evaluateStageC, inPromotionWindow, runStageC, runStageCSafely, shopDayOf } from "@/lib/d1/stage-c";
import { SALES_READS } from "@/lib/repo/sales/registry";
import { STOCK_READS } from "@/lib/repo/stock";
import { isMongoOnlyInD1 } from "@/lib/repo/stock/types";
import { readStock } from "@/lib/repo/stock/shadow-read";
import { deferredContext } from "@/lib/deferred-context";
import { GET as nextNumberGET } from "@/app/api/invoices/next-number/route";
import { GET as d1SyncGET } from "@/app/api/cron/d1-sync/route";
import { GET as shadowStatusGET } from "@/app/api/admin/d1-shadow-status/route";

/** An India wall-clock time as epoch ms: at("2026-11-20T22:05"). */
const at = (s: string) => Date.parse(`${s}:00+05:30`);
const iso = (ms: number) => new Date(ms).toISOString();
const OLD = "2026-11-01T00:00:00.000Z";

async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any[]> {
  return ((await db.prepare(sql).bind(...args).all()).results || []) as any[];
}
async function one(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any> {
  return db.prepare(sql).bind(...args).first();
}
async function run(db: D1DatabaseLike, sql: string, ...args: unknown[]) {
  await db.prepare(sql).bind(...args).run();
}
async function flag(db: D1DatabaseLike, key: string): Promise<string | null> {
  return (await one(db, "SELECT value FROM feature_flags WHERE key = ?", key))?.value ?? null;
}
async function setFlag(db: D1DatabaseLike, key: string, value: string, updatedAt = OLD) {
  await run(db, "INSERT INTO feature_flags (key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt", key, value, updatedAt);
  resetReadModeCache();
}

/** A clean slate: every area 'shadow', write-through on with 25 copied writes, Stage C 'auto', no history. */
async function reset(db: D1DatabaseLike) {
  for (const t of ["stage_c_log", "shadow_results", "shadow_daily", "sync_errors", "write_through_state"]) await run(db, `DELETE FROM ${t}`);
  for (const a of STAGE_C_ORDER) await setFlag(db, `read:${a}`, "shadow");
  await setFlag(db, "writeThrough", "on");
  await setFlag(db, "stageC", "auto");
  await run(db, "INSERT INTO write_through_state (collection, lastWriteAt, writes, docs) VALUES ('invoices', '2026-11-19T10:00:00.000Z', 25, 25)");
  resetShadowSampling();
}

/** One day of shadow totals for an area. */
async function day(db: D1DatabaseLike, area: string, d: string, runs: number, bad: { mismatches?: number; errors?: number; fallbacks?: number } = {}) {
  const mm = bad.mismatches ?? 0;
  await run(
    db,
    `INSERT INTO shadow_daily (area, name, day, runs, matches, mismatches, errors, fallbacks, mongoMsTotal, d1MsTotal, lastAt)
     VALUES (?, 'x.list', ?, ?, ?, ?, ?, ?, 0, 0, ?)
     ON CONFLICT(area, name, day) DO UPDATE SET runs = excluded.runs, matches = excluded.matches, mismatches = excluded.mismatches, errors = excluded.errors, fallbacks = excluded.fallbacks`,
    area, d, runs, runs - mm, mm, bad.errors ?? 0, bad.fallbacks ?? 0, `${d}T12:00:00.000Z`
  );
}

/** One comparison row (what lib/d1/shadow.ts writes). */
async function result(db: D1DatabaseLike, area: string, atMs: number, kind: string, match: boolean, error: string | null = null) {
  await run(
    db,
    "INSERT INTO shadow_results (area, name, at, kind, match, mongoMs, d1Ms, diffCount, diffs, error) VALUES (?, 'x.list', ?, ?, ?, 1, 1, ?, NULL, ?)",
    area, iso(atMs), kind, match ? 1 : 0, match ? 0 : 1, error
  );
}

async function logRows(db: D1DatabaseLike) {
  return all(db, "SELECT * FROM stage_c_log ORDER BY id");
}

// ---------------------------------------------------------------------------

async function windowTests(db: D1DatabaseLike) {
  console.log("\npromotion window (22:00–00:25 India time)");
  check(!inPromotionWindow(at("2026-11-20T21:59")) && inPromotionWindow(at("2026-11-20T22:00")), "21:59 outside, 22:00 inside");
  check(inPromotionWindow(at("2026-11-21T00:25")) && !inPromotionWindow(at("2026-11-21T00:26")), "00:25 inside, 00:26 outside");
  check(shopDayOf(at("2026-11-21T00:20")) === "2026-11-20" && shopDayOf(at("2026-11-20T22:30")) === "2026-11-20", "the night belongs to the shop day that just closed");

  for (const t of ["2026-11-20T15:00", "2026-11-20T21:59", "2026-11-21T00:26", "2026-11-21T09:00"]) {
    await reset(db);
    await day(db, "masters", "2026-11-20", 40);
    await day(db, "masters", "2026-11-21", 5);
    const r = await runStageC(db, at(t));
    check(r.ok && r.changes.length === 0 && (await flag(db, "read:masters")) === "shadow", `${t}: masters clean, still not promoted (shop hours / outside the window)`);
    if (t === "2026-11-20T15:00") check(!!r.nextPromotion?.blockers.some((b) => /22:00 and 00:25/.test(b)) && r.nextPromotion?.earliestAt === iso(at("2026-11-20T22:00")), "the report says why and when");
  }

  await reset(db);
  await day(db, "masters", "2026-11-20", 40);
  let r = await runStageC(db, at("2026-11-20T22:05"));
  const log = await logRows(db);
  check(r.ok && (await flag(db, "read:masters")) === "d1", "22:05: masters (1 clean day, 40 runs) is promoted to d1");
  check(log.length === 1 && log[0].area === "masters" && log[0].fromMode === "shadow" && log[0].toMode === "d1" && /clean for 1 shop day/.test(log[0].reason), "logged in stage_c_log with a plain reason");
  check((await one(db, "SELECT updatedAt FROM feature_flags WHERE key = 'read:masters'"))?.updatedAt === iso(at("2026-11-20T22:05")), "updatedAt is the job's clock");
  r = await runStageC(db, at("2026-11-20T22:05"));
  check(r.changes.length === 0 && (await logRows(db)).length === 1, "running again at the same moment changes nothing (idempotent)");

  await reset(db);
  await day(db, "masters", "2026-11-20", 40);
  await runStageC(db, at("2026-11-21T00:20"));
  check((await flag(db, "read:masters")) === "d1", "00:20 the next calendar day still counts the shop day that just closed");
}

async function orderTests(db: D1DatabaseLike) {
  console.log("\none area per night, in order");
  await reset(db);
  for (const a of STAGE_C_ORDER) for (const d of ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]) await day(db, a, d, 200);
  await runStageC(db, at("2026-11-20T22:05"));
  await runStageC(db, at("2026-11-20T22:10"));
  const r = await runStageC(db, at("2026-11-21T00:20"));
  const modes = await Promise.all(STAGE_C_ORDER.map((a) => flag(db, `read:${a}`)));
  check(modes.join(",") === "d1,shadow,shadow,shadow,shadow", `night 1: only masters, although every area is clean (${modes.join(",")})`);
  check(!!r.nextPromotion && r.nextPromotion.area === "crm" && r.nextPromotion.blockers.some((b) => /one area per night/.test(b)), "crm waits: one area per night");

  await runStageC(db, at("2026-11-21T21:55"));
  check((await flag(db, "read:crm")) === "shadow", "21:55 next day: not yet (window)");
  await runStageC(db, at("2026-11-21T22:00"));
  check((await flag(db, "read:crm")) === "d1", "night 2 at 22:00: crm, after masters answered from D1 for the full shop day 10:00–22:00");
  await runStageC(db, at("2026-11-21T22:30"));
  check((await flag(db, "read:staff")) === "shadow", "night 2: staff waits");
  await runStageC(db, at("2026-11-22T22:05"));
  check((await flag(db, "read:staff")) === "d1" && (await flag(db, "read:stock")) === "shadow", "night 3: staff");

  // Order: an area later in the list never jumps ahead.
  await reset(db);
  await day(db, "masters", "2026-11-20", 40);
  await setFlag(db, "read:masters", "d1", iso(at("2026-11-19T09:00")));
  for (const d of ["2026-11-19", "2026-11-20"]) await day(db, "staff", d, 100);
  const r2 = await runStageC(db, at("2026-11-20T22:05"));
  check((await flag(db, "read:staff")) === "shadow" && r2.nextPromotion?.area === "crm", "staff clean but crm (before it) is not: nothing promoted, crm is next");

  // The previous area must have been d1 for a full shop day (10:00–22:00).
  await reset(db);
  for (const d of ["2026-11-19", "2026-11-20"]) await day(db, "crm", d, 100);
  await setFlag(db, "read:masters", "d1", iso(at("2026-11-20T10:30")));
  let r3 = await runStageC(db, at("2026-11-20T22:05"));
  check((await flag(db, "read:crm")) === "shadow" && !!r3.nextPromotion?.blockers.some((b) => /full shop day/.test(b)), "masters on d1 only since 10:30 today: crm waits");
  check(r3.nextPromotion?.earliestAt === iso(at("2026-11-21T22:00")), "earliest: after the next full shop day");
  await setFlag(db, "read:masters", "d1", iso(at("2026-11-20T09:59")));
  r3 = await runStageC(db, at("2026-11-20T22:05"));
  check((await flag(db, "read:crm")) === "d1", "masters on d1 since before 10:00 today: crm promoted");
}

async function blockTests(db: D1DatabaseLike) {
  console.log("\nwhat blocks a promotion");
  const now = at("2026-11-20T22:05");
  const attempt = async (label: string, setup: () => Promise<void>, area = "masters", expect: RegExp) => {
    await reset(db);
    await setup();
    const r = await runStageC(db, now);
    check((await flag(db, `read:${area}`)) === "shadow" && !!r.nextPromotion?.blockers.some((b) => expect.test(b)), `${label} (${r.nextPromotion?.blockers.join(" | ")})`);
  };
  await attempt("masters: 29 runs < 30", () => day(db, "masters", "2026-11-20", 29), "masters", /only 29 comparisons/);
  await attempt("masters: no runs on the shop day", () => day(db, "masters", "2026-11-19", 300), "masters", /no shadow comparisons on 2026-11-20/);
  await attempt("masters: one mismatch", () => day(db, "masters", "2026-11-20", 40, { mismatches: 1 }), "masters", /mismatch/);
  await attempt("masters: one D1 error", () => day(db, "masters", "2026-11-20", 40, { errors: 1 }), "masters", /mismatch \/ D1 error/);
  await attempt("masters: a mismatch after midnight (after the window days) still blocks", async () => {
    await day(db, "masters", "2026-11-20", 40);
    await day(db, "masters", "2026-11-21", 2, { mismatches: 1 });
  }, "masters", /2026-11-21/);
  await attempt(
    "crm: only 1 of the 2 shop days",
    async () => {
      await setFlag(db, "read:masters", "d1", iso(at("2026-11-18T09:00")));
      await day(db, "crm", "2026-11-20", 100);
    },
    "crm",
    /no shadow comparisons on 2026-11-19/
  );
  await attempt(
    "sales: needs 3 days and 100 runs",
    async () => {
      for (const a of ["masters", "crm", "staff", "stock"]) await setFlag(db, `read:${a}`, "d1", iso(at("2026-11-10T09:00")));
      for (const d of ["2026-11-18", "2026-11-19", "2026-11-20"]) await day(db, "sales", d, 33);
    },
    "sales",
    /only 99 comparisons/
  );
  await attempt("write-through never copied a write", () => run(db, "UPDATE write_through_state SET writes = 0").then(() => day(db, "masters", "2026-11-20", 40)), "masters", /not copied a single write/);
  await attempt("write-through off", () => setFlag(db, "writeThrough", "off").then(() => day(db, "masters", "2026-11-20", 40)), "masters", /write-through is not on/);
  await attempt(
    "D1 not fresh (a copy error on items 5 min ago)",
    async () => {
      await day(db, "masters", "2026-11-20", 40);
      await run(db, "INSERT INTO sync_errors (at, collection, docId, phase, message) VALUES (?, 'items', NULL, 'incremental', 'x')", iso(now - 5 * 60_000));
    },
    "masters",
    /not known fresh/
  );
  await attempt("stageC = 'demote-only' pauses promotions", () => setFlag(db, "stageC", "demote-only").then(() => day(db, "masters", "2026-11-20", 40)), "masters", /paused/);
  check(PROMOTION_RULES.sales.days === 3 && PROMOTION_RULES.masters.minRuns === 30, "rules as documented");

  console.log("\nmanual 'mongo' is never touched");
  await reset(db);
  await setFlag(db, "read:masters", "mongo");
  for (const a of STAGE_C_ORDER) await day(db, a, "2026-11-20", 500);
  for (const a of STAGE_C_ORDER) await day(db, a, "2026-11-19", 500);
  const r = await runStageC(db, now);
  check((await flag(db, "read:masters")) === "mongo" && (await flag(db, "read:crm")) === "shadow" && r.changes.length === 0, "masters 'mongo' stays, and the later areas wait for it");
  await setFlag(db, "read:masters", "d1", OLD);
  await setFlag(db, "read:crm", "mongo");
  await result(db, "crm", now - 60_000, "shadow", false);
  await runStageC(db, now);
  check((await flag(db, "read:crm")) === "mongo", "a 'mongo' area with mismatches is not touched either");
}

async function demotionTests(db: D1DatabaseLike) {
  console.log("\ndemotion (any time)");
  const noon = at("2026-11-21T13:00");
  await reset(db);
  await setFlag(db, "read:masters", "d1", iso(at("2026-11-20T22:05")));
  await result(db, "masters", noon - 2 * 3600_000, "reverse", false); // 2 h ago: outside the hour
  let r = await runStageC(db, noon);
  check((await flag(db, "read:masters")) === "d1" && r.changes.length === 0, "a mismatch 2 hours ago does not demote");
  await result(db, "masters", noon - 10 * 60_000, "reverse", false);
  r = await runStageC(db, noon);
  const log = await logRows(db);
  check((await flag(db, "read:masters")) === "shadow", "one reverse-shadow mismatch in the last hour demotes masters at 13:00 (shop open)");
  check(log.length === 1 && log[0].fromMode === "d1" && log[0].toMode === "shadow" && /1 mismatch/.test(log[0].reason), `logged: ${log[0]?.reason}`);

  // Clean days count again only after the demotion's day.
  await day(db, "masters", "2026-11-21", 100);
  await runStageC(db, at("2026-11-21T22:10"));
  check((await flag(db, "read:masters")) === "shadow", "the night of the demotion: that day does not count");
  const ev = await evaluateStageC(db, at("2026-11-21T22:10"));
  check(ev.areas[0].cleanDays === 0 && !!ev.nextPromotion?.blockers.some((b) => /demoted on 2026-11-21/.test(b)), "clean-day count reset by the demotion");
  await day(db, "masters", "2026-11-22", 100);
  await runStageC(db, at("2026-11-22T22:10"));
  check((await flag(db, "read:masters")) === "d1", "a clean day after the demotion: promoted again");

  await reset(db);
  await setFlag(db, "read:masters", "d1");
  for (let i = 0; i < 3; i++) await result(db, "masters", noon - (i + 1) * 60_000, "fallback", false, "D1_ERROR: x");
  await runStageC(db, noon);
  check((await flag(db, "read:masters")) === "d1", "3 fallbacks in the hour: stays (a passing hiccup)");
  await result(db, "masters", noon - 5 * 60_000, "fallback", false, "D1_ERROR: x");
  await runStageC(db, noon);
  check((await flag(db, "read:masters")) === "shadow" && /4 D1 errors/.test((await logRows(db))[0]?.reason || ""), "4 fallbacks in the hour: demoted");

  await reset(db);
  await setFlag(db, "read:masters", "d1");
  await setFlag(db, "read:crm", "d1");
  await setFlag(db, "writeThrough", "off");
  r = await runStageC(db, noon);
  check((await flag(db, "read:masters")) === "shadow" && (await flag(db, "read:crm")) === "shadow" && r.changes.length === 2, "write-through off: every d1 area is demoted");

  await reset(db);
  await setFlag(db, "read:masters", "d1");
  await setFlag(db, "stageC", "off");
  await result(db, "masters", noon - 60_000, "reverse", false);
  r = await runStageC(db, noon);
  check((await flag(db, "read:masters")) === "d1" && r.changes.length === 0 && r.setting === "off", "stageC = 'off': the job does nothing at all");
  await setFlag(db, "stageC", "demote-only");
  await runStageC(db, noon);
  check((await flag(db, "read:masters")) === "shadow", "stageC = 'demote-only': safety demotions still run");
  await setFlag(db, "stageC", "bogus");
  check((await runStageC(db, noon)).setting === "off", "an unknown stageC value means 'off'");
}

async function writeThroughGuardTests(db: D1DatabaseLike) {
  console.log("\nwrite-through guard");
  const now = at("2026-11-21T11:00");
  await reset(db);
  await setFlag(db, "read:masters", "d1");
  await run(db, "UPDATE write_through_state SET failures = 1, lastFailureAt = ?, lastError = 'D1_ERROR: boom' WHERE collection = 'invoices'", iso(now - 5 * 60_000));
  const r = await runStageC(db, now);
  const log = await logRows(db);
  check((await flag(db, "writeThrough")) === "off", "a write-through failure switches writeThrough off");
  check(log[0]?.area === "writeThrough" && log[0].toMode === "off" && /invoices/.test(log[0].reason), "logged with the collection and the error");
  check((await flag(db, "read:masters")) === "shadow" && log[1]?.area === "masters", "and the d1 area is demoted in the same run");
  check(r.changes.length === 2, "two changes reported");

  // A failure from before the switch was turned back on is not acted on again.
  await reset(db);
  await run(db, "UPDATE write_through_state SET failures = 1, lastFailureAt = ? WHERE collection = 'invoices'", iso(now - 3 * 3600_000));
  await setFlag(db, "writeThrough", "on", iso(now - 3600_000));
  await runStageC(db, now);
  check((await flag(db, "writeThrough")) === "on", "an old failure (before the Admin switched it back on) is ignored");
  await day(db, "masters", "2026-11-21", 40);
  const r2 = await runStageC(db, at("2026-11-21T22:05"));
  check((await flag(db, "read:masters")) === "shadow" && !!r2.nextPromotion?.blockers.some((b) => /failed in the last 24 h/.test(b)), "but it still blocks promotions for 24 h");
}

async function freshnessTests(db: D1DatabaseLike) {
  console.log("\nfreshness guard (read-source)");
  await reset(db);
  let clock = at("2026-11-21T12:00");
  configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0, now: () => clock });
  await setFlag(db, "read:masters", "d1");
  await setFlag(db, "read:sales", "d1");
  check((await getReadMode("masters")) === "d1", "d1 and fresh: d1");
  await run(db, "INSERT INTO sync_errors (at, collection, docId, phase, message) VALUES (?, 'items', NULL, 'incremental', 'x')", iso(clock - 10 * 60_000));
  resetReadModeCache();
  check((await getReadMode("masters")) === "shadow" && (await getConfiguredReadMode("masters")) === "d1", "a copy error on items 10 min ago: masters behaves as shadow (still set to d1)");
  check((await getReadMode("sales")) === "d1", "the same error does not touch sales (not its collection)");
  clock = at("2026-11-21T12:20");
  resetReadModeCache();
  check((await getReadMode("masters")) === "d1", "16 min later: fresh again");
  await run(db, "INSERT INTO sync_errors (at, collection, docId, phase, message) VALUES (?, NULL, NULL, 'run', 'x')", iso(clock - 60_000));
  resetReadModeCache();
  check((await getReadMode("masters")) === "shadow" && (await getReadMode("sales")) === "shadow", "an error with no collection: every area");
  await run(db, "DELETE FROM sync_errors");
  await run(db, "UPDATE write_through_state SET failures = 1, lastFailureAt = ? WHERE collection = 'invoices'", iso(clock - 60_000));
  resetReadModeCache();
  check((await getReadMode("masters")) === "shadow", "a write-through failure in the last 15 min: shadow");
  await run(db, "UPDATE write_through_state SET failures = 0, lastFailureAt = NULL");
  await setFlag(db, "writeThrough", "off");
  check((await getReadMode("masters")) === "shadow", "write-through off: shadow");
  await setFlag(db, "writeThrough", "on");
  configureReadSource({ resolveD1: () => faulty(db, { fail: (sql) => /write_through_state/.test(sql) }) });
  check((await getReadMode("masters")) === "shadow" && (await getReadMode("crm")) === "shadow", "freshness facts unreadable: shadow (flags still read)");
  configureReadSource({ resolveD1: () => db });
  check((await getReadMode("masters")) === "d1", "readable again: d1");

  // readWithShadow in a stale d1 area answers from MongoDB.
  await run(db, "INSERT INTO sync_errors (at, collection, docId, phase, message) VALUES (?, 'items', NULL, 'incremental', 'x')", iso(clock - 60_000));
  resetReadModeCache();
  const got = await readWithShadow("masters", "t.stale", async () => "from mongo", async () => "from d1");
  await flushShadowWork();
  check(got === "from mongo", "a read in a stale d1 area gets MongoDB's answer");
  resetReadSourceConfig();
}

async function reverseShadowTests(db: D1DatabaseLike) {
  console.log("\nreverse shadow in d1 mode");
  await reset(db);
  let clock = at("2026-11-21T12:00");
  configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0, now: () => clock });
  configureShadow({ now: () => clock });
  await setFlag(db, "read:masters", "d1");
  let mongoCalls = 0;
  const mongoFn = async () => {
    mongoCalls++;
    return { rows: [{ name: "Fan", qty: 3 }] };
  };
  const d1Fn = async () => ({ rows: [{ name: "Fan", qty: 2 }] });
  const got: any = await readWithShadow("masters", "t.reverse", mongoFn, d1Fn);
  check(got.rows[0].qty === 2 && mongoCalls === 0, "D1's answer is returned; MongoDB not read before it");
  await flushShadowWork();
  const row = await one(db, "SELECT * FROM shadow_results WHERE name = 't.reverse'");
  const daily = await one(db, "SELECT * FROM shadow_daily WHERE name = 't.reverse'");
  check(mongoCalls === 1 && row?.kind === "reverse" && row.match === 0 && row.diffCount === 1, "after the answer MongoDB is read, compared, and the mismatch recorded");
  check(daily?.runs === 1 && daily.mismatches === 1 && daily.errors === 0, "counted in shadow_daily like a shadow run");
  await readWithShadow("masters", "t.reverse", mongoFn, d1Fn);
  await flushShadowWork();
  check(mongoCalls === 1, "sampling: at most one comparison per read per 10 s");
  clock += 11_000;
  await readWithShadow("masters", "t.reverse", mongoFn, d1Fn);
  await flushShadowWork();
  check(mongoCalls === 2, "after 10 s compared again");
  await readWithShadow("masters", "t.mongoFails", async () => {
    throw new Error("Mongo down");
  }, d1Fn);
  await flushShadowWork();
  check(!(await one(db, "SELECT id FROM shadow_results WHERE name = 't.mongoFails'")), "a MongoDB failure in the comparison is not recorded against D1");
  const r = await runStageC(db, clock);
  check((await flag(db, "read:masters")) === "shadow" && r.changes[0]?.area === "masters", "the job demotes the area on that reverse mismatch");

  console.log("\nmongoOnlyInD1");
  await setFlag(db, "read:masters", "d1");
  await run(db, "DELETE FROM shadow_results");
  resetShadowSampling();
  const m: any = await readWithShadow("masters", "t.mongoOnly", mongoFn, d1Fn, { mongoOnlyInD1: true });
  await flushShadowWork();
  const mo = await one(db, "SELECT * FROM shadow_results WHERE name = 't.mongoOnly'");
  check(m.rows[0].qty === 3, "a mongoOnlyInD1 read in d1 mode gets MongoDB's answer");
  check(mo?.kind === "shadow" && mo.match === 0, "and D1 is still compared after it (recorded as shadow)");

  const salesMarked = Object.keys(SALES_READS).filter((k) => SALES_READS[k].mongoOnlyInD1).sort();
  check(
    salesMarked.join(",") ===
      "cashRegister.cashInvoices,cashRegister.cashReceipts,cashRegister.dueCashBills,cashRegister.financeLinkedInvoices,cashRegister.financeRecords,nextNumber.deletedNumbers,nextNumber.estimateNumbers,nextNumber.invoiceNumbers,nextNumber.proformaNumbers",
    `sales registry: next numbers and the cash register are mongo-only (${salesMarked.join(", ")})`
  );
  const stockMarked = Object.keys(STOCK_READS).filter((k) => isMongoOnlyInD1(STOCK_READS[k] as any, {})).sort();
  check(
    stockMarked.join(",") === "adminCashEntries.book,cashRegisterSetting.get,cashTransactions.all,dayCloses.allAsc,expenses.cash,serialNumbers.list",
    `stock registry: cash book / register and the AVAILABLE serials are mongo-only (${stockMarked.join(", ")})`
  );
  check(!isMongoOnlyInD1(STOCK_READS["serialNumbers.list"] as any, { status: "ALL" }) && isMongoOnlyInD1(STOCK_READS["serialNumbers.list"] as any, { status: "AVAILABLE" }), "serials: only the AVAILABLE list");
  resetReadSourceConfig();
  resetShadowConfig();
}

async function realRegistryTests(db: D1DatabaseLike) {
  console.log("\nmongo-only reads on the real registries (MongoDB + D1 copy)");
  await reset(db);
  configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0 });
  const raw = mongoose.connection.db!;
  const now = new Date("2026-11-20T06:00:00.000Z");
  await raw.collection("invoices").insertOne({ invoiceNumber: "SVAK2026RI00007", type: "tax-invoice", customerName: "A", createdAt: now, updatedAt: now });
  await raw.collection("serial_numbers").insertOne({ serialNumber: "SN-1", status: "AVAILABLE", itemName: "TV", createdAt: now, updatedAt: now });
  await raw.collection("admin_cash_entries").insertOne({ type: "OPENING", amount: 100, date: "2026-11-10", time: "10:00", description: "opening", createdAt: now, updatedAt: now });
  const sync = await runD1Sync(db, { collections: ["invoices", "deleted_invoices", "serial_numbers", "admin_cash_entries"], reconcile: "skip" });
  check(sync.errors === 0, `copied into D1 (${sync.errors} errors)`);
  // D1 behind / different: the bill number moved on in D1 only, the serial was sold in MongoDB only, the book differs.
  await run(db, "UPDATE invoices SET invoiceNumber = 'SVAK2026RI00099'");
  await raw.collection("serial_numbers").updateOne({ serialNumber: "SN-1" }, { $set: { status: "SOLD" } });
  await run(db, "UPDATE adminCashEntries SET amount = 999");

  await setFlag(db, "read:sales", "d1");
  await setFlag(db, "read:stock", "d1");
  resetShadowSampling();
  const res = await nextNumberGET(new Request("http://localhost/api/invoices/next-number"));
  const body: any = await res.json();
  await flushShadowWork();
  check(body.success && body.next === 8, `next bill number comes from MongoDB in d1 mode (next ${body.next}; D1 would say 100)`);
  const nn = await one(db, "SELECT kind, match FROM shadow_results WHERE name = 'nextNumber.invoiceNumbers'");
  check(nn?.kind === "shadow" && nn.match === 0, "and D1's different list is caught by the comparison");
  const avail: any[] = await readStock("serialNumbers.list", { status: "AVAILABLE" });
  const everything: any[] = await readStock("serialNumbers.list", { status: "ALL" });
  check(avail.length === 0, "AVAILABLE serials from MongoDB: the sold one is not offered");
  check(everything.length === 1 && everything[0].status === "AVAILABLE", "the ALL list is a plain read: it comes from D1 (still AVAILABLE there)");
  const book: any[] = await readStock("adminCashEntries.book", {});
  check(book.length === 1 && book[0].amount === 100, "the Admin cash book (payout check) comes from MongoDB");
  await flushShadowWork();
  resetReadSourceConfig();
}

async function contextTestsOnDb(db: D1DatabaseLike) {
  console.log("\nafter-response work keeps the request context");
  await reset(db);
  configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0 });
  await setFlag(db, "read:masters", "d1");
  const als = new AsyncLocalStorage<{ req: string }>();
  const queued: Array<() => Promise<void>> = [];
  configureShadow({ defer: (t) => queued.push(t) });
  resetShadowSampling();
  let seen: string | undefined = "not run";
  await als.run({ req: "R1" }, () =>
    readWithShadow(
      "masters",
      "t.context",
      async () => {
        seen = als.getStore()?.req;
        return 1;
      },
      async () => 1
    )
  );
  check(queued.length === 1 && seen === "not run", "the comparison is queued, not run");
  await Promise.all(queued.map((t) => t())); // run OUTSIDE als.run, as worker.ts does after the response
  check(seen === "R1", `the queued MongoDB read still sees the request's context (${seen})`);
  resetShadowConfig();
  resetReadSourceConfig();
}

async function cronAndAdminTests(db: D1DatabaseLike) {
  console.log("\n/api/cron/d1-sync: Stage C can never break the copy");
  await reset(db);
  process.env.NEXTAUTH_SECRET = "test-secret";
  const sym = Symbol.for("__cloudflare-context__");
  const setDb = (d: D1DatabaseLike) => Object.defineProperty(globalThis, sym, { value: { env: { DB: d } }, configurable: true, writable: true });
  try {
    setDb(faulty(db, { fail: (sql) => /stage_c_log/.test(sql) }));
    const res = await d1SyncGET(new Request("http://localhost/api/cron/d1-sync", { headers: { "x-cron-key": "test-secret" } }));
    const body: any = await res.json();
    check(res.status === 200 && body.success === true && body.errors === 0, `the copy ran and succeeded (status ${res.status}, success ${body.success})`);
    check(body.stageC?.ok === false && /stage_c_log|simulated/.test(body.stageC.error || ""), `Stage C's failure is only reported (${body.stageC?.error})`);
    setDb(db);
    const ok: any = await (await d1SyncGET(new Request("http://localhost/api/cron/d1-sync", { headers: { "x-cron-key": "test-secret" } }))).json();
    check(ok.success === true && ok.stageC?.ok === true && Array.isArray(ok.stageC.changes), "with a healthy D1 Stage C runs after the copy");
  } finally {
    delete (globalThis as any)[sym];
  }
  const thrown = await runStageCSafely({ prepare: () => { throw new Error("D1 is down"); }, batch: async () => { throw new Error("D1 is down"); } } as any, Date.now());
  check(thrown.ok === false && /down/.test(thrown.error || ""), "runStageCSafely: D1 down -> a report, no throw");
  const slow = await runStageCSafely(faulty(db, { slow: () => true, delayMs: 300 }), Date.now(), 50);
  check(slow.ok === false && /timed out/.test(slow.error || ""), "runStageCSafely: a slow D1 is given up on");

  console.log("\nadmin report");
  await reset(db);
  await day(db, "masters", "2026-11-20", 40);
  await runStageC(db, at("2026-11-20T22:05"));
  configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0 });
  const admin = { id: "a1", name: "Admin", email: "a@x", role: "admin", permissions: [] };
  const call = (actor: any) => deferredContext.run({ approver: actor }, () => (shadowStatusGET as any)(new Request("http://localhost/api/admin/d1-shadow-status")) as Promise<Response>);
  check((await call({ ...admin, role: "salesman" })).status === 403, "salesman: 403");
  const body: any = await (await call(admin)).json();
  const sc = body.stageC;
  check(body.success && Array.isArray(sc?.areas) && sc.areas.length === 5, "admin: Stage C per area");
  const m = sc.areas.find((a: any) => a.area === "masters");
  check(m.mode === "d1" && typeof m.effectiveMode === "string" && typeof m.freshness?.fresh === "boolean" && typeof m.cleanDays === "number", "each area: switch, effective mode, freshness, clean days");
  check(sc.nextPromotion?.area === "crm" && Array.isArray(sc.nextPromotion.blockers), "the next promotion with its blockers");
  check(Array.isArray(sc.log) && sc.log.length === 1 && sc.log[0].area === "masters", "the latest stage_c_log rows");
  await run(db, "DROP TABLE stage_c_log");
  const noTable: any = await (await call(admin)).json();
  check(noTable.success === true && !!noTable.stageC?.error, "without migration 0009 the rest of the report still works");
  resetReadSourceConfig();
}

async function main() {
  const local = await startLocalD1();
  await startMemoryMongo("d1_stage_c_test");
  try {
    const files = await applyMigrations(local.db);
    check(files.includes("0009_stage_c.sql"), `migrations applied (${files.join(", ")})`);
    check((await flag(local.db, "stageC")) === "auto", "0009 seeds stageC = 'auto'");
    await windowTests(local.db);
    await orderTests(local.db);
    await blockTests(local.db);
    await demotionTests(local.db);
    await writeThroughGuardTests(local.db);
    await freshnessTests(local.db);
    await reverseShadowTests(local.db);
    await contextTestsOnDb(local.db);
    await realRegistryTests(local.db);
    await cronAndAdminTests(local.db);
  } finally {
    resetReadSourceConfig();
    resetShadowConfig();
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-stage-c") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
