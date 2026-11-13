/**
 * Stage B2 of docs/D1_MIGRATION_PLAN.md: WHERE AN AREA READS FROM. One switch per area (masters, sales, ...), so
 * D1 reads can be turned on, compared, and turned back off area by area, with one SQL command and no deploy:
 *
 *   UPDATE feature_flags SET value = 'shadow', updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = 'read:masters'
 *
 * Values: 'mongo' (only MongoDB), 'shadow' (MongoDB answers, D1 is compared after the response), 'd1' (D1 answers,
 * MongoDB is the fallback when D1 throws). A missing row, an unknown value, no D1 binding (local `next dev`, scripts)
 * or a D1 that cannot be read all mean 'mongo': reading MongoDB is always the safe answer.
 *
 * The flags are read with ONE query for all areas and kept for 60 s per Worker isolate (as the write-through flag),
 * so a switch reaches every isolate within a minute and costs at most one D1 read a minute per isolate.
 * The env var D1_READS=mongo forces 'mongo' everywhere (emergency switch that needs no D1 at all).
 *
 * Stage C adds the FRESHNESS GUARD below: 'd1' is only honoured while D1 is known to be current. The same
 * once-a-minute read (one D1 batch) fetches the facts it needs. The switches themselves are moved by
 * lib/d1/stage-c.ts.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1DatabaseLike } from "./types";
import { getD1 } from "./client";
import { readAreaOfCollection } from "./registry";

export type ReadMode = "mongo" | "shadow" | "d1";
export const READ_MODES: ReadMode[] = ["mongo", "shadow", "d1"];
export const READ_FLAG_PREFIX = "read:";

export interface ReadSourceConfig {
  /** The D1 database, or null when there is none (then every area reads MongoDB). */
  resolveD1: () => D1DatabaseLike | null;
  /** The D1_READS env var ("" when unset). Only "mongo" has a meaning: it forces MongoDB everywhere. */
  envValue: () => string;
  /** How long the flag values are trusted before they are read again. */
  flagTtlMs: number;
  /** Longest the flag read may take; slower counts as "cannot read" (-> mongo for this TTL). */
  flagTimeoutMs: number;
  /** Stage C freshness guard: a failure this recent makes a 'd1' area read MongoDB (behave as 'shadow'). */
  freshnessWindowMs: number;
  /** Clock for the freshness window (tests). */
  now: () => number;
}

function envReads(): string {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const fromProcess = norm(typeof process !== "undefined" ? process.env?.D1_READS : "");
  if (fromProcess) return fromProcess;
  try {
    return norm((getCloudflareContext().env as any)?.D1_READS);
  } catch {
    return "";
  }
}

const DEFAULTS: ReadSourceConfig = {
  resolveD1: getD1,
  envValue: envReads,
  flagTtlMs: 60_000,
  flagTimeoutMs: 1000,
  freshnessWindowMs: 15 * 60_000,
  now: () => Date.now(),
};

let cfg: ReadSourceConfig = { ...DEFAULTS };

/** Tests (and nothing else) change where the flags come from. */
export function configureReadSource(settings: Partial<ReadSourceConfig>) {
  cfg = { ...cfg, ...settings };
  resetReadModeCache();
}

export function resetReadSourceConfig() {
  cfg = { ...DEFAULTS };
  resetReadModeCache();
}

export function getReadSourceConfig(): ReadSourceConfig {
  return cfg;
}

/**
 * STAGE C FRESHNESS GUARD. An area switched to 'd1' only really answers from D1 while D1 is known to be current:
 *  - the write-through is on (feature_flags writeThrough = 'on'), so every MongoDB write is copied in the request;
 *  - no write-through failure was recorded in the last `freshnessWindowMs` (15 min) on any collection;
 *  - no sync_errors row newer than that for one of the AREA's collections (lib/d1/registry.ts READ_AREA_COLLECTIONS;
 *    a row with no collection, or an unknown one, counts against every area). Write-through failures and "too big
 *    to copy inline, re-copy the whole collection" marks are written to sync_errors too.
 * Otherwise the area behaves as 'shadow': MongoDB answers and D1 is only compared. Why: a failed or skipped copy
 * (D1 down for a moment, a write too big to copy inline) leaves D1 behind until the copy job catches up, and a
 * user must never be shown that older answer. Cannot tell (tables missing, D1 slow or down) = not fresh.
 */
export interface Freshness {
  fresh: boolean;
  /** Why not, in plain words (null when fresh). */
  reason: string | null;
}

interface Snapshot {
  /** The configured value per area (what the 'read:<area>' row says). */
  modes: Map<string, ReadMode>;
  writeThroughOn: boolean;
  /** False when the freshness part could not be read at all: then no area is fresh. */
  freshnessKnown: boolean;
  /** Collections with a write-through failure inside the window (any of them makes every area stale). */
  wtFailures: string[];
  /** Areas with a copy error inside the window -> the first collection named, for the reason text. "*" = all. */
  staleAreas: Map<string, string>;
}

const EMPTY: Snapshot = { modes: new Map(), writeThroughOn: false, freshnessKnown: false, wtFailures: [], staleAreas: new Map() };

let cache: { snap: Snapshot; at: number } | null = null;
let loading: Promise<Snapshot> | null = null;

/** Forget the cached flags: the next read asks D1 again. */
export function resetReadModeCache() {
  cache = null;
  loading = null;
}

function parseMode(v: unknown): ReadMode | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (READ_MODES as string[]).includes(s) ? (s as ReadMode) : null;
}

const FLAGS_SQL = "SELECT key, value FROM feature_flags WHERE key LIKE 'read:%' OR key = 'writeThrough'";

function snapshotFrom(
  flagRows: { key: string; value: string }[],
  wtRows: { collection: string }[] | null,
  errRows: { collection: string | null }[] | null
): Snapshot {
  const snap: Snapshot = { modes: new Map(), writeThroughOn: false, freshnessKnown: !!(wtRows && errRows), wtFailures: [], staleAreas: new Map() };
  for (const r of flagRows) {
    const key = String(r.key);
    if (key === "writeThrough") {
      snap.writeThroughOn = String(r.value ?? "").trim().toLowerCase() === "on";
      continue;
    }
    const mode = parseMode(r.value);
    if (mode) snap.modes.set(key.slice(READ_FLAG_PREFIX.length), mode);
  }
  for (const r of wtRows || []) snap.wtFailures.push(String(r.collection));
  for (const r of errRows || []) {
    const key = readAreaOfCollection(r.collection) ?? "*";
    if (!snap.staleAreas.has(key)) snap.staleAreas.set(key, r.collection ? String(r.collection) : "(no collection)");
  }
  return snap;
}

/**
 * The flags and the freshness facts in ONE D1 batch (three small SELECTs). If the batch fails (an old database
 * without write_through_state, D1 trouble), the flags alone are read again and no area counts as fresh.
 */
async function readSnapshot(db: D1DatabaseLike, nowMs: number): Promise<Snapshot> {
  const cutoff = new Date(nowMs - cfg.freshnessWindowMs).toISOString();
  try {
    const [flags, wt, errs] = await db.batch([
      db.prepare(FLAGS_SQL),
      db.prepare("SELECT collection FROM write_through_state WHERE lastFailureAt >= ?").bind(cutoff),
      db.prepare("SELECT DISTINCT collection FROM sync_errors WHERE at >= ?").bind(cutoff),
    ]);
    return snapshotFrom((flags?.results || []) as any[], (wt?.results || []) as any[], (errs?.results || []) as any[]);
  } catch (e) {
    console.warn(`d1 reads: cannot read the freshness facts (${e instanceof Error ? e.message : String(e)}); 'd1' areas read MongoDB for now`);
  }
  const res = await db.prepare(FLAGS_SQL).all<{ key: string; value: string }>();
  return snapshotFrom(res.results || [], null, null);
}

async function loadSnapshot(db: D1DatabaseLike): Promise<Snapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), cfg.flagTimeoutMs);
    });
    const res = await Promise.race([readSnapshot(db, cfg.now()), timeout]);
    if (res) return res;
    console.warn("d1 reads: feature_flags read timed out; every area reads MongoDB for now");
  } catch (e) {
    // Most likely the 0007 migration is not applied yet, or D1 is down: MongoDB for this minute.
    console.warn(`d1 reads: cannot read feature_flags (${e instanceof Error ? e.message : String(e)}); every area reads MongoDB for now`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return EMPTY;
}

/** Is D1 fresh enough for `area` to answer from it, according to this snapshot. */
function freshnessOf(snap: Snapshot, area: string): Freshness {
  const mins = Math.round(cfg.freshnessWindowMs / 60_000);
  if (!snap.freshnessKnown) return { fresh: false, reason: "cannot tell whether D1 is current (the freshness facts could not be read)" };
  if (!snap.writeThroughOn) return { fresh: false, reason: "the write-through is off, so D1 may miss recent writes" };
  if (snap.wtFailures.length) {
    return { fresh: false, reason: `a write-through copy failed in the last ${mins} min (${snap.wtFailures.slice(0, 3).join(", ")})` };
  }
  const own = snap.staleAreas.get(area) ?? snap.staleAreas.get("*");
  if (own) return { fresh: false, reason: `a D1 copy error in the last ${mins} min (${own})` };
  return { fresh: true, reason: null };
}

async function currentSnapshot(): Promise<Snapshot> {
  const db = cfg.resolveD1();
  if (!db) return EMPTY;
  if (cache && Date.now() - cache.at < cfg.flagTtlMs) return cache.snap;
  if (!loading) {
    loading = loadSnapshot(db).then((snap) => {
      cache = { snap, at: Date.now() };
      loading = null;
      // Once per load (not per read): say why a 'd1' area is reading MongoDB for now.
      for (const [area, mode] of Array.from(snap.modes)) {
        if (mode !== "d1") continue;
        const f = freshnessOf(snap, area);
        if (!f.fresh) console.warn(`d1 reads: ${area} is set to d1 but reads MongoDB for now: ${f.reason}`);
      }
      return snap;
    });
  }
  return loading;
}

/**
 * Where `area` reads from now: 'mongo' | 'shadow' | 'd1', AFTER the freshness guard (an area set to 'd1' whose D1
 * is not known fresh gives 'shadow'). Never throws. Cached ≤ flagTtlMs per isolate; concurrent callers share one
 * D1 read.
 */
export async function getReadMode(area: string): Promise<ReadMode> {
  if (cfg.envValue() === "mongo") return "mongo";
  if (!cfg.resolveD1()) return "mongo";
  const snap = await currentSnapshot();
  const configured = snap.modes.get(area) ?? "mongo";
  if (configured !== "d1") return configured;
  return freshnessOf(snap, area).fresh ? "d1" : "shadow";
}

/** The same as getReadMode; the name says that the freshness guard is included. */
export const getEffectiveReadMode = getReadMode;

/** What the 'read:<area>' row says, before the freshness guard (cached like getReadMode). */
export async function getConfiguredReadMode(area: string): Promise<ReadMode> {
  if (cfg.envValue() === "mongo") return "mongo";
  if (!cfg.resolveD1()) return "mongo";
  return (await currentSnapshot()).modes.get(area) ?? "mongo";
}

/** Whether `area`'s D1 copy counts as fresh right now (cached like getReadMode). */
export async function getAreaFreshness(area: string): Promise<Freshness> {
  if (!cfg.resolveD1()) return { fresh: false, reason: "no D1 binding" };
  return freshnessOf(await currentSnapshot(), area);
}

/**
 * The freshness of each area straight from D1 (no cache), for the admin report and the Stage C job; `now` lets
 * the job judge by its own clock. Never throws.
 */
export async function readFreshnessUncached(db: D1DatabaseLike, areas: string[], now = Date.now()): Promise<Record<string, Freshness>> {
  let snap: Snapshot = EMPTY;
  try {
    snap = await readSnapshot(db, now);
  } catch {
    snap = EMPTY;
  }
  const out: Record<string, Freshness> = {};
  for (const a of areas) out[a] = freshnessOf(snap, a);
  return out;
}

/** Every area's current value straight from D1 (no cache), for the admin report. Missing rows are not listed. */
export async function readModesUncached(db: D1DatabaseLike): Promise<Record<string, { value: string; mode: ReadMode; updatedAt: string | null }>> {
  const out: Record<string, { value: string; mode: ReadMode; updatedAt: string | null }> = {};
  const res = await db.prepare("SELECT key, value, updatedAt FROM feature_flags WHERE key LIKE 'read:%'").all<{ key: string; value: string; updatedAt: string | null }>();
  for (const r of res.results || []) {
    out[String(r.key).slice(READ_FLAG_PREFIX.length)] = { value: String(r.value), mode: parseMode(r.value) ?? "mongo", updatedAt: r.updatedAt ?? null };
  }
  return out;
}
