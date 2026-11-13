/**
 * The shadow-read report (GET /api/admin/d1-shadow-status): per area / read path, from the daily totals
 * (shadow_daily) and the latest mismatch row (shadow_results). Only counts, timings and the masked samples the
 * shadow already stored are returned: never a payload.
 */
import type { D1DatabaseLike } from "./types";
import { readModesUncached, type ReadMode } from "./read-source";
import { istDay } from "./shadow";

export interface ShadowDay {
  day: string;
  runs: number;
  matches: number;
  mismatches: number;
  errors: number;
  fallbacks: number;
}

export interface ShadowPathStatus {
  area: string;
  name: string;
  /** The area's read mode right now (feature_flags, not cached). */
  mode: ReadMode;
  runs: number;
  matches: number;
  mismatches: number;
  errors: number;
  fallbacks: number;
  /** matches / (matches + mismatches), in %; null when nothing was compared in the window. */
  matchPct: number | null;
  avgMongoMs: number | null;
  avgD1Ms: number | null;
  /** India days in a row, up to the latest day with runs, with comparisons and no mismatch / error / fallback. */
  cleanDays: number;
  lastRunAt: string | null;
  lastMismatch: { at: string; kind: string; diffCount: number; diffs: unknown; error: string | null } | null;
  days: ShadowDay[];
}

export interface ShadowStatus {
  generatedAt: string;
  windowDays: number;
  since: string;
  modes: Record<string, { value: string; mode: ReadMode; updatedAt: string | null }>;
  paths: ShadowPathStatus[];
}

const round = (n: number) => Math.round(n * 10) / 10;

export async function getShadowStatus(db: D1DatabaseLike, opts: { days?: number; now?: number } = {}): Promise<ShadowStatus> {
  const windowDays = opts.days ?? 7;
  const now = opts.now ?? Date.now();
  const today = istDay(now);
  const since = istDay(now - (windowDays - 1) * 86400_000);

  const [modes, dailyRes, lastRes] = await Promise.all([
    readModesUncached(db),
    db.prepare("SELECT * FROM shadow_daily WHERE day >= ? ORDER BY area, name, day").bind(since).all<any>(),
    db
      .prepare(
        `SELECT area, name, at, kind, diffCount, diffs, error FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY area, name ORDER BY at DESC, id DESC) AS rn FROM shadow_results WHERE match = 0
         ) WHERE rn = 1`
      )
      .all<any>(),
  ]);

  const byPath = new Map<string, ShadowPathStatus>();
  const keyOf = (area: string, name: string) => `${area}\u0000${name}`;
  const mongoTotals = new Map<string, number>();
  const d1Totals = new Map<string, number>();
  for (const r of dailyRes.results || []) {
    const key = keyOf(r.area, r.name);
    let s = byPath.get(key);
    if (!s) {
      s = {
        area: r.area,
        name: r.name,
        mode: modes[r.area]?.mode ?? "mongo",
        runs: 0,
        matches: 0,
        mismatches: 0,
        errors: 0,
        fallbacks: 0,
        matchPct: null,
        avgMongoMs: null,
        avgD1Ms: null,
        cleanDays: 0,
        lastRunAt: null,
        lastMismatch: null,
        days: [],
      };
      byPath.set(key, s);
    }
    const day: ShadowDay = { day: r.day, runs: Number(r.runs), matches: Number(r.matches), mismatches: Number(r.mismatches), errors: Number(r.errors), fallbacks: Number(r.fallbacks) };
    s.days.push(day);
    s.runs += day.runs;
    s.matches += day.matches;
    s.mismatches += day.mismatches;
    s.errors += day.errors;
    s.fallbacks += day.fallbacks;
    mongoTotals.set(key, (mongoTotals.get(key) ?? 0) + Number(r.mongoMsTotal));
    d1Totals.set(key, (d1Totals.get(key) ?? 0) + Number(r.d1MsTotal));
    if (r.lastAt && (!s.lastRunAt || r.lastAt > s.lastRunAt)) s.lastRunAt = r.lastAt;
  }

  for (const r of lastRes.results || []) {
    const s = byPath.get(keyOf(r.area, r.name));
    if (!s) continue; // its days are outside the window
    let diffs: unknown = null;
    try {
      diffs = r.diffs ? JSON.parse(r.diffs) : [];
    } catch {
      diffs = null;
    }
    s.lastMismatch = { at: r.at, kind: r.kind, diffCount: Number(r.diffCount), diffs, error: r.error ?? null };
  }

  for (const [key, s] of Array.from(byPath)) {
    const compared = s.matches + s.mismatches;
    s.matchPct = compared ? round((s.matches / compared) * 100) : null;
    s.avgMongoMs = s.runs ? round((mongoTotals.get(key) ?? 0) / s.runs) : null;
    s.avgD1Ms = s.runs ? round((d1Totals.get(key) ?? 0) / s.runs) : null;
    // Clean days: walk back from the latest day (today may simply have no runs yet); a gap ends the streak.
    const byDay = new Map(s.days.map((d) => [d.day, d]));
    let clean = 0;
    for (let i = 0; i < windowDays; i++) {
      const day = istDay(now - i * 86400_000);
      const d = byDay.get(day);
      if (!d || d.runs === 0) {
        if (day === today) continue;
        break;
      }
      if (d.mismatches || d.errors || d.fallbacks || d.matches === 0) break;
      clean++;
    }
    s.cleanDays = clean;
  }

  return {
    generatedAt: new Date(now).toISOString(),
    windowDays,
    since,
    modes,
    paths: Array.from(byPath.values()).sort((a, b) => (a.area === b.area ? (a.name < b.name ? -1 : 1) : a.area < b.area ? -1 : 1)),
  };
}
