/**
 * Stage B2 of docs/D1_MIGRATION_PLAN.md: SHADOW READS. A read path runs through
 *
 *   const rows = await readWithShadow("masters", "units.list", mongoFn, d1Fn, { compare: {...} });
 *
 * and, depending on the area's switch (lib/d1/read-source.ts):
 *  - mongo  -> mongoFn() only. Exactly the old behaviour.
 *  - shadow -> the user gets mongoFn()'s answer, untouched. AFTER the response is sent (worker.ts runs the queued
 *              work in ctx.waitUntil), d1Fn(db) runs, the two answers are compared (lib/d1/compare.ts) and the
 *              outcome is written to `shadow_results` and the daily totals `shadow_daily`. At most one shadow run
 *              per read path every 10 s per isolate, so the extra cost stays small.
 *  - d1     -> the user gets d1Fn(db)'s answer. If d1Fn THROWS, mongoFn() answers instead and the fallback is
 *              recorded. Stage C: with the same sampling as shadow, AFTER the response mongoFn() also runs and the
 *              two answers are compared and recorded exactly like shadow ("reverse" shadow, kind 'reverse'), so a
 *              difference keeps being caught after the switch (lib/d1/stage-c.ts demotes the area on one).
 *              A read marked `mongoOnlyInD1` (its answer decides a write: next document number, cash balance for a
 *              payout, serials offered for a sale) is served from MongoDB even here and D1 is compared, as in shadow.
 * The mode is the EFFECTIVE one (lib/d1/read-source.ts): an area set to 'd1' whose D1 is not known fresh reads as
 * 'shadow'.
 *
 * GUARANTEES for the user's request: shadow work never runs before the response is ready, its errors are caught
 * and only logged, and nothing it does can change the value returned. The caller must not change the returned
 * value in place (build new objects from it, as the routes do), because the comparison reads it later.
 *
 * WHAT IS STORED: area, name, time, match yes/no, both timings, the number of differences and the first 3
 * differences as {path, short masked summary of each side}. Never a full payload, never a secret field's value.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1DatabaseLike } from "./types";
import { getReadMode, getReadSourceConfig, type ReadMode } from "./read-source";
import { compareResults, type CompareOptions, type CompareResult } from "./compare";

export { compareResults, canonicalize } from "./compare";
export type { CompareOptions, CompareResult, DiffSample } from "./compare";
export type { ReadMode } from "./read-source";

export interface ShadowOptions {
  /** How the two answers are compared (ignored paths, unordered arrays, sort ties). */
  compare?: CompareOptions;
  /**
   * In 'd1' mode, still answer from MongoDB (and compare D1 after the response, as in 'shadow'). For reads whose
   * answer decides a write, where even a few seconds of D1 lag could cause a wrong write (a duplicate document
   * number, a payout above the real cash balance, a serial that was just sold). Mark it in the area's registry.
   */
  mongoOnlyInD1?: boolean;
}

export interface ShadowConfig {
  /** At most one shadow comparison per (area, name) per this many ms, per isolate. */
  sampleIntervalMs: number;
  /** Longest a shadow D1 read may take before it is counted as an error. */
  d1TimeoutMs: number;
  /** shadow_results rows older than this are deleted (checked at most once an hour per isolate). */
  keepDays: number;
  /**
   * Where work that must happen after the response goes. Default: on Workers, a per-request queue that worker.ts
   * runs in ctx.waitUntil once the response is ready; elsewhere (next dev, tests) a timer.
   */
  defer?: (task: () => Promise<void>) => void;
  /** Clock (tests). */
  now: () => number;
}

const DEFAULTS: ShadowConfig = {
  sampleIntervalMs: 10_000,
  d1TimeoutMs: 10_000,
  keepDays: 14,
  now: () => Date.now(),
};

let cfg: ShadowConfig = { ...DEFAULTS };

export function configureShadow(settings: Partial<ShadowConfig>) {
  cfg = { ...cfg, ...settings };
}

export function resetShadowConfig() {
  cfg = { ...DEFAULTS };
  lastSample.clear();
  lastPrune = 0;
}

/** Forget the sampling clock (tests: the next shadow read always runs). */
export function resetShadowSampling() {
  lastSample.clear();
}

/** What the last finished shadow / fallback run found (tests and diagnostics). */
export interface ShadowRun {
  area: string;
  name: string;
  /** shadow: Mongo answered, D1 compared. reverse: D1 answered (d1 mode), Mongo compared. fallback: D1 threw. */
  kind: "shadow" | "reverse" | "fallback";
  match: boolean;
  mongoMs: number | null;
  d1Ms: number | null;
  diffCount: number;
  diffs: CompareResult["diffs"];
  error: string | null;
  recorded: boolean;
}
let lastRun: ShadowRun | null = null;
export function getLastShadowRun(): ShadowRun | null {
  return lastRun;
}

// ---------------------------------------------------------------------------
// After-the-response queue
// ---------------------------------------------------------------------------

/** Shared with worker.ts by name (it does not import app code): WeakMap<ctx, Array<() => Promise<void>>>. */
export const AFTER_RESPONSE = Symbol.for("valueplus.afterResponse");

const pending = new Set<Promise<void>>();

/** Wait for every shadow task started in this process (tests; local dev). */
export async function flushShadowWork(): Promise<void> {
  while (pending.size) await Promise.allSettled(Array.from(pending));
}

function track(p: Promise<void>) {
  pending.add(p);
  p.finally(() => pending.delete(p)).catch(() => {});
}

function runSafely(task: () => Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(task)
    .catch((e) => console.warn(`d1 shadow: background task failed (${errText(e)})`));
}

/**
 * Keep the request's async context for the deferred task. worker.ts runs the queue OUTSIDE the request handler, where
 * getCloudflareContext() (the D1 binding of the staff reads, the per-request MongoDB client of lib/db.ts) would not
 * be found; AsyncLocalStorage.snapshot() restores it, so the work runs as part of the very same request.
 */
function bindToRequest(task: () => Promise<void>): () => Promise<void> {
  const snapshot = (AsyncLocalStorage as any).snapshot;
  if (typeof snapshot !== "function") return task;
  try {
    const runInContext: (fn: () => Promise<void>) => Promise<void> = snapshot();
    return () => runInContext(task);
  } catch {
    return task;
  }
}

function deferAfterResponse(rawTask: () => Promise<void>) {
  const task = bindToRequest(rawTask);
  if (cfg.defer) {
    cfg.defer(() => runSafely(task));
    return;
  }
  try {
    const { ctx } = getCloudflareContext();
    if (ctx) {
      const g = globalThis as any;
      const queues: WeakMap<object, Array<() => Promise<void>>> = g[AFTER_RESPONSE] || (g[AFTER_RESPONSE] = new WeakMap());
      const list = queues.get(ctx) || [];
      list.push(task);
      queues.set(ctx, list);
      return;
    }
  } catch {
    // Not on Workers.
  }
  // next dev / tests: a timer, so the work still starts only after the current request has moved on.
  track(new Promise<void>((resolve) => setTimeout(() => runSafely(task).then(resolve), 0)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errText(e: unknown): string {
  // The error text only: D1 / driver messages carry no bound values. Shortened in case a message quotes data.
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.slice(0, 300);
}

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

const IST_OFFSET_MS = 330 * 60 * 1000;
/** The India date (YYYY-MM-DD) of an instant: the shop's day, which the "clean for N days" check counts in. */
export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const lastSample = new Map<string, number>();
let lastPrune = 0;

function sampleAllowed(key: string): boolean {
  const now = cfg.now();
  const last = lastSample.get(key);
  if (last !== undefined && now - last < cfg.sampleIntervalMs) return false;
  lastSample.set(key, now);
  return true;
}

function resolveDb(): D1DatabaseLike | null {
  try {
    return getReadSourceConfig().resolveD1();
  } catch {
    return null;
  }
}

/** Write one outcome into shadow_results + shadow_daily (one D1 batch). Never throws. */
async function record(db: D1DatabaseLike, run: ShadowRun): Promise<boolean> {
  try {
    const nowMs = cfg.now();
    const at = new Date(nowMs).toISOString();
    const day = istDay(nowMs);
    // A reverse run (d1 mode) is a comparison like a shadow run and is counted the same way.
    const compared = run.kind === "shadow" || run.kind === "reverse";
    const mismatch = compared && !run.match ? 1 : 0;
    const isError = run.error ? 1 : 0;
    const fallback = run.kind === "fallback" ? 1 : 0;
    await db.batch([
      db
        .prepare("INSERT INTO shadow_results (area, name, at, kind, match, mongoMs, d1Ms, diffCount, diffs, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(run.area, run.name, at, run.kind, run.match ? 1 : 0, run.mongoMs, run.d1Ms, run.diffCount, run.diffs.length ? JSON.stringify(run.diffs) : null, run.error),
      db
        .prepare(
          `INSERT INTO shadow_daily (area, name, day, runs, matches, mismatches, errors, fallbacks, mongoMsTotal, d1MsTotal, lastAt)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(area, name, day) DO UPDATE SET
             runs = runs + 1,
             matches = matches + excluded.matches,
             mismatches = mismatches + excluded.mismatches,
             errors = errors + excluded.errors,
             fallbacks = fallbacks + excluded.fallbacks,
             mongoMsTotal = mongoMsTotal + excluded.mongoMsTotal,
             d1MsTotal = d1MsTotal + excluded.d1MsTotal,
             lastAt = excluded.lastAt`
        )
        .bind(run.area, run.name, day, compared && run.match ? 1 : 0, mismatch, isError, fallback, run.mongoMs ?? 0, run.d1Ms ?? 0, at),
    ]);
    if (nowMs - lastPrune > 3600_000) {
      lastPrune = nowMs;
      const cutoff = new Date(nowMs - cfg.keepDays * 86400_000).toISOString();
      await db.prepare("DELETE FROM shadow_results WHERE at < ?").bind(cutoff).run();
    }
    return true;
  } catch (e) {
    console.warn(`d1 shadow: cannot record ${run.area}/${run.name} (${errText(e)})`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Read through the area's switch. `name` identifies the read path in the report (e.g. "items.list").
 * `mongoFn` is the existing MongoDB read, unchanged; `d1Fn` must return the SAME shape (lib/repo/<area>/*).
 * The returned value is whatever the serving side returned.
 */
export async function readWithShadow<T>(
  area: string,
  name: string,
  mongoFn: () => Promise<T>,
  d1Fn: (db: D1DatabaseLike) => Promise<T>,
  opts: ShadowOptions = {}
): Promise<T> {
  let mode: ReadMode = "mongo";
  try {
    mode = await getReadMode(area);
  } catch {
    mode = "mongo";
  }
  const db = mode === "mongo" ? null : resolveDb();
  if (!db) return mongoFn();

  // A read whose answer decides a write never answers from D1: it runs as in shadow mode (MongoDB answers).
  if (mode === "d1" && opts.mongoOnlyInD1) mode = "shadow";

  if (mode === "d1") {
    const t0 = performance.now();
    try {
      const d1Result = await d1Fn(db);
      const d1Ms = performance.now() - t0;
      // Reverse shadow: D1 answered; after the response MongoDB is read too and compared, with the same sampling.
      if (sampleAllowed(`${area}\u0000${name}`)) {
        deferAfterResponse(async () => {
          const t1 = performance.now();
          let mongoResult!: T;
          try {
            const r = await withTimeout(mongoFn(), cfg.d1TimeoutMs);
            if (r === TIMED_OUT) {
              console.warn(`d1 reverse shadow: ${area}/${name} MongoDB timed out after ${cfg.d1TimeoutMs} ms; not recorded`);
              return;
            }
            mongoResult = r;
          } catch (e) {
            // A MongoDB failure says nothing about D1, so it is not recorded against it (that would demote the area).
            console.warn(`d1 reverse shadow: ${area}/${name} MongoDB failed (${errText(e)}); not recorded`);
            return;
          }
          const mongoMs = performance.now() - t1;
          const cmp = compareResults(mongoResult, d1Result, opts.compare);
          const run: ShadowRun = { area, name, kind: "reverse", match: cmp.equal, mongoMs, d1Ms, diffCount: cmp.diffCount, diffs: cmp.diffs, error: null, recorded: false };
          run.recorded = await record(db, run);
          lastRun = run;
        });
      }
      return d1Result;
    } catch (e) {
      const d1Ms = performance.now() - t0;
      const error = errText(e);
      console.warn(`d1 reads: ${area}/${name} failed on D1, serving MongoDB (${error})`);
      const t1 = performance.now();
      const result = await mongoFn();
      const mongoMs = performance.now() - t1;
      const run: ShadowRun = { area, name, kind: "fallback", match: false, mongoMs, d1Ms, diffCount: 0, diffs: [], error, recorded: false };
      deferAfterResponse(async () => {
        run.recorded = await record(db, run);
        lastRun = run;
      });
      return result;
    }
  }

  // shadow
  const t0 = performance.now();
  const result = await mongoFn();
  const mongoMs = performance.now() - t0;
  if (sampleAllowed(`${area}\u0000${name}`)) {
    deferAfterResponse(async () => {
      const t1 = performance.now();
      let d1Result: T | undefined;
      let error: string | null = null;
      try {
        const r = await withTimeout(d1Fn(db), cfg.d1TimeoutMs);
        if (r === TIMED_OUT) error = `timed out after ${cfg.d1TimeoutMs} ms`;
        else d1Result = r;
      } catch (e) {
        error = errText(e);
      }
      const d1Ms = performance.now() - t1;
      const cmp: CompareResult = error ? { equal: false, diffCount: 0, diffs: [] } : compareResults(result, d1Result, opts.compare);
      const run: ShadowRun = { area, name, kind: "shadow", match: cmp.equal, mongoMs, d1Ms, diffCount: cmp.diffCount, diffs: cmp.diffs, error, recorded: false };
      run.recorded = await record(db, run);
      lastRun = run;
    });
  }
  return result;
}
