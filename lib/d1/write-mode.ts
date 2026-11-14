/**
 * Stage D of docs/D1_MIGRATION_PLAN.md (§6.6, §6.8, §6.8a): WHERE AN AREA WRITES TO. One switch per write area
 * (lib/d1/write-areas.ts), feature_flags `write:<area>`:
 *
 *   'mongo' (default; a missing row, an unknown value, no D1 binding all mean 'mongo') - today's behaviour;
 *   'fence'  - the area's writes WAIT (poll every 250 ms, up to 30 s, then 503 "try again") while the switch moves;
 *   'd1'     - the area's writes go to D1 (one guarded batch with mirror_outbox rows, lib/d1/write-batch.ts).
 *
 * Unlike the read switches, this one is NOT cached for a minute: the fence protocol needs every isolate to see a
 * flip within about a second, so the row is re-read when older than 1 s (one tiny indexed read per write).
 *
 * 'd1' is only HONOURED while every read area serving the write area's collections (readAreasOfWriteArea) answers
 * from D1 right now (getReadMode, i.e. after the freshness guard). Otherwise the area writes MongoDB as before and
 * that is logged: a save on D1 followed by a read from MongoDB's older copy would look like a lost save. Before
 * such a fallback, whatever the outbox still holds for the area is copied into MongoDB first (best effort, 3 s), so
 * the MongoDB write starts from the newest data.
 *
 * Emergency switch with no D1 at all: env D1_WRITES=mongo (everything writes MongoDB).
 */
import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1DatabaseLike } from "./types";
import { getD1 } from "./client";
import { getReadMode, type ReadMode } from "./read-source";
import { WRITE_AREA_COLLECTIONS, readAreasOfWriteArea, writeAreaOfCollection } from "./write-areas";

export type WriteSwitch = "mongo" | "fence" | "d1";
export const WRITE_SWITCHES: WriteSwitch[] = ["mongo", "fence", "d1"];
export const WRITE_FLAG_PREFIX = "write:";
/** What a write route does now: write MongoDB, write D1, or answer 503 (the fence did not lift in time). */
export type WriteDecision = "mongo" | "d1" | "busy";

export interface WriteModeConfig {
  resolveD1: () => D1DatabaseLike | null;
  /** The D1_WRITES env var ("" when unset). Only "mongo" has a meaning. */
  envValue: () => string;
  /** How long a read of the switch is trusted (the plan says: not cached, or at most 1 s). */
  flagTtlMs: number;
  /** Fence: how often the switch is read again while waiting, and how long to wait before answering 503. */
  fencePollMs: number;
  fenceTimeoutMs: number;
  /** Before falling back to MongoDB from a 'd1' switch, copy the outbox into MongoDB for at most this long. */
  fallbackDrainMs: number;
  /** The effective read mode of a read area (tests can replace it). */
  readMode: (area: string) => Promise<ReadMode>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

function envWrites(): string {
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const fromProcess = norm(typeof process !== "undefined" ? process.env?.D1_WRITES : "");
  if (fromProcess) return fromProcess;
  try {
    return norm((getCloudflareContext().env as any)?.D1_WRITES);
  } catch {
    return "";
  }
}

const DEFAULTS: WriteModeConfig = {
  resolveD1: getD1,
  envValue: envWrites,
  flagTtlMs: 1000,
  fencePollMs: 250,
  fenceTimeoutMs: 30_000,
  fallbackDrainMs: 3000,
  readMode: getReadMode,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

let cfg: WriteModeConfig = { ...DEFAULTS };

export function configureWriteMode(settings: Partial<WriteModeConfig>) {
  cfg = { ...cfg, ...settings };
  resetWriteModeCache();
}

export function resetWriteModeConfig() {
  cfg = { ...DEFAULTS };
  resetWriteModeCache();
}

export function getWriteModeConfig(): WriteModeConfig {
  return cfg;
}

export function parseWriteSwitch(v: unknown): WriteSwitch | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (WRITE_SWITCHES as string[]).includes(s) ? (s as WriteSwitch) : null;
}

// ---------------------------------------------------------------------------
// The switch itself
// ---------------------------------------------------------------------------

const cache = new Map<string, { value: WriteSwitch; at: number }>();
/** Last value actually read per area: used when D1 cannot be read for a moment (never invent 'mongo' for a d1 area). */
const lastKnown = new Map<string, { value: WriteSwitch; at: number }>();
const LAST_KNOWN_MAX_AGE_MS = 60_000;

export function resetWriteModeCache() {
  cache.clear();
  lastKnown.clear();
  lastFallbackLog.clear();
}

/**
 * What the `write:<area>` row says ('mongo' when missing / unknown), cached at most flagTtlMs. When the row cannot
 * be read, the last value read in the past minute is kept (a D1 hiccup must not send a 'd1' area's writes to
 * MongoDB behind D1's back); with nothing known, 'mongo' (today's behaviour).
 */
export async function getConfiguredWriteMode(area: string, opts: { fresh?: boolean } = {}): Promise<WriteSwitch> {
  if (cfg.envValue() === "mongo") return "mongo";
  const db = cfg.resolveD1();
  if (!db) return "mongo";
  const now = cfg.now();
  const hit = cache.get(area);
  if (!opts.fresh && hit && now - hit.at < cfg.flagTtlMs) return hit.value;
  try {
    const row = await db.prepare("SELECT value FROM feature_flags WHERE key = ?").bind(`${WRITE_FLAG_PREFIX}${area}`).first<{ value: string }>();
    const value = parseWriteSwitch(row?.value) ?? "mongo";
    cache.set(area, { value, at: now });
    lastKnown.set(area, { value, at: now });
    return value;
  } catch (e) {
    const known = lastKnown.get(area);
    const value = known && now - known.at < LAST_KNOWN_MAX_AGE_MS ? known.value : "mongo";
    console.warn(`d1 writes: cannot read write:${area} (${e instanceof Error ? e.message : String(e)}); using '${value}'`);
    return value;
  }
}

/** True when every read area serving the write area answers from D1 right now. */
async function readsOnD1(area: string): Promise<{ ok: boolean; notD1: string[] }> {
  const notD1: string[] = [];
  for (const r of readAreasOfWriteArea(area)) {
    if ((await cfg.readMode(r)) !== "d1") notD1.push(r);
  }
  return { ok: notD1.length === 0, notD1 };
}

const lastFallbackLog = new Map<string, number>();

/**
 * 'd1' is set but cannot be honoured (a read area is not on D1): copy what the outbox still holds into MongoDB
 * first, so the MongoDB write starts from the newest data. Best effort and capped; never throws.
 */
async function drainBeforeFallback(db: D1DatabaseLike, area: string, notD1: string[]) {
  const now = cfg.now();
  if (now - (lastFallbackLog.get(area) ?? 0) > 60_000) {
    lastFallbackLog.set(area, now);
    console.warn(`d1 writes: write:${area} is 'd1' but read area(s) ${notD1.join(", ")} do not answer from D1; writing MongoDB`);
  }
  try {
    const { drainOutbox } = await import("./reverse-mirror");
    await drainOutbox(db, { collections: WRITE_AREA_COLLECTIONS[area] || [], budgetMs: cfg.fallbackDrainMs });
  } catch (e) {
    console.warn(`d1 writes: draining the outbox before writing MongoDB failed (${e instanceof Error ? e.message : String(e)})`);
  }
}

/**
 * Where a write of `area` goes now. Never throws.
 *  - 'mongo': run the existing MongoDB code, unchanged;
 *  - 'd1':    run the D1 path (lib/repo/<area>/writes.ts);
 *  - 'busy':  the fence did not lift within fenceTimeoutMs: answer 503 (writeBusyResponse), nothing was written.
 */
export async function getWriteMode(area: string): Promise<WriteDecision> {
  try {
    if (cfg.envValue() === "mongo") return "mongo";
    const db = cfg.resolveD1();
    if (!db) return "mongo";
    const started = cfg.now();
    let fresh = false;
    for (;;) {
      const sw = await getConfiguredWriteMode(area, { fresh });
      if (sw === "mongo") return "mongo";
      if (sw === "d1") {
        const reads = await readsOnD1(area);
        if (reads.ok) return "d1";
        await drainBeforeFallback(db, area, reads.notD1);
        return "mongo";
      }
      // fence: wait for the switch to move on, re-reading it each time.
      if (cfg.now() - started >= cfg.fenceTimeoutMs) return "busy";
      await cfg.sleep(cfg.fencePollMs);
      fresh = true;
    }
  } catch (e) {
    console.warn(`d1 writes: cannot decide where ${area} writes (${e instanceof Error ? e.message : String(e)}); writing MongoDB`);
    return "mongo";
  }
}

/**
 * For the write-through (lib/d1/write-through.ts): does D1 own this collection's writes right now? Exactly when
 * getWriteMode would answer 'd1' for its area (switch 'd1' and every read area on D1). Then a MongoDB write of it
 * can only be the reverse mirror's (or an unwired script's), and copying it back into D1 must be skipped.
 * In 'fence' the write-through keeps running: writes that started in MongoDB before the fence must still reach D1.
 */
export async function isD1OwnedCollection(collection: string): Promise<boolean> {
  const area = writeAreaOfCollection(collection);
  if (!area) return false;
  try {
    if ((await getConfiguredWriteMode(area)) !== "d1") return false;
    return (await readsOnD1(area)).ok;
  } catch {
    return false;
  }
}

/** The answer to a write that waited through the fence for too long. Nothing was saved. */
export function writeBusyResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: "This data is being moved to the new database right now. Nothing was saved. Please try again in a minute.",
    },
    { status: 503, headers: { "Retry-After": "30" } }
  );
}

/** Every write switch straight from D1 (no cache), for the admin report and the Stage D job. */
export async function readWriteSwitchesUncached(db: D1DatabaseLike): Promise<Record<string, { value: string; mode: WriteSwitch; updatedAt: string | null }>> {
  const out: Record<string, { value: string; mode: WriteSwitch; updatedAt: string | null }> = {};
  const res = await db.prepare("SELECT key, value, updatedAt FROM feature_flags WHERE key LIKE 'write:%'").all<{ key: string; value: string; updatedAt: string | null }>();
  for (const r of res.results || []) {
    out[String(r.key).slice(WRITE_FLAG_PREFIX.length)] = { value: String(r.value), mode: parseWriteSwitch(r.value) ?? "mongo", updatedAt: r.updatedAt ?? null };
  }
  return out;
}

/** Collections whose write switch is 'fence' or 'd1' (configured, uncached): the copy job leaves them alone. */
export async function collectionsNotOwnedByMongo(db: D1DatabaseLike): Promise<string[]> {
  if (cfg.envValue() === "mongo") return [];
  const switches = await readWriteSwitchesUncached(db);
  const out: string[] = [];
  for (const [area, s] of Object.entries(switches)) {
    if (s.mode !== "mongo") out.push(...(WRITE_AREA_COLLECTIONS[area] || []));
  }
  return out;
}
