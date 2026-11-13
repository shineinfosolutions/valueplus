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
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1DatabaseLike } from "./types";
import { getD1 } from "./client";

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

let cache: { modes: Map<string, ReadMode>; at: number } | null = null;
let loading: Promise<Map<string, ReadMode>> | null = null;

/** Forget the cached flags: the next read asks D1 again. */
export function resetReadModeCache() {
  cache = null;
  loading = null;
}

function parseMode(v: unknown): ReadMode | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (READ_MODES as string[]).includes(s) ? (s as ReadMode) : null;
}

async function loadModes(db: D1DatabaseLike): Promise<Map<string, ReadMode>> {
  const modes = new Map<string, ReadMode>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = db.prepare("SELECT key, value FROM feature_flags WHERE key LIKE 'read:%'").all<{ key: string; value: string }>();
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), cfg.flagTimeoutMs);
    });
    const res = await Promise.race([query, timeout]);
    if (res) {
      for (const r of res.results || []) {
        const mode = parseMode(r.value);
        if (mode) modes.set(String(r.key).slice(READ_FLAG_PREFIX.length), mode);
      }
    } else {
      console.warn("d1 reads: feature_flags read timed out; every area reads MongoDB for now");
    }
  } catch (e) {
    // Most likely the 0007 migration is not applied yet, or D1 is down: MongoDB for this minute.
    console.warn(`d1 reads: cannot read feature_flags (${e instanceof Error ? e.message : String(e)}); every area reads MongoDB for now`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return modes;
}

/**
 * Where `area` reads from now: 'mongo' | 'shadow' | 'd1'. Never throws. Cached ≤ flagTtlMs per isolate; concurrent
 * callers share one D1 read.
 */
export async function getReadMode(area: string): Promise<ReadMode> {
  if (cfg.envValue() === "mongo") return "mongo";
  const db = cfg.resolveD1();
  if (!db) return "mongo";
  if (!cache || Date.now() - cache.at >= cfg.flagTtlMs) {
    if (!loading) {
      loading = loadModes(db).then((modes) => {
        cache = { modes, at: Date.now() };
        loading = null;
        return modes;
      });
    }
    await loading;
  }
  return cache?.modes.get(area) ?? "mongo";
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
