/**
 * Stage C of docs/D1_MIGRATION_PLAN.md: the read switches move to D1 BY THEMSELVES, one area at a time, and move
 * back on their own at the first sign of trouble. Nobody has to watch it.
 *
 * `runStageC(db, now)` runs at the end of every /api/cron/d1-sync (every 5 min, 08:30–00:25 India time). Each run:
 *
 *  1. WRITE-THROUGH GUARD (any time). A write-through failure recorded since the switch was last turned on (at most
 *     24 h back) turns `writeThrough` off, as the one-off external guard of 14 Nov did. Logged.
 *  2. DEMOTION d1 -> shadow (any time), for each area set to 'd1', when in the last 60 minutes D1 and MongoDB
 *     disagreed even once (shadow_results: the reverse comparison of lib/d1/shadow.ts), or D1 failed / fell back
 *     more than 3 times; or the write-through is not 'on'. MongoDB answers again from the next minute on.
 *  3. PROMOTION shadow -> d1 (night only, ONE area per night, in the order masters -> crm -> staff -> stock -> sales)
 *     when ALL of these hold:
 *      - stageC = 'auto';
 *      - India time is 22:00–00:25 (the shop, open 10:00–22:00, is closed: nobody notices the switch);
 *      - the write-through is 'on', has copied at least one write, and recorded no failure in the last 24 h;
 *      - the area's D1 copy is fresh right now (lib/d1/read-source.ts freshness guard);
 *      - the area's last N shop days (PROMOTION_RULES) each have shadow runs, with at least MIN runs in total and
 *        no mismatch, D1 error or fallback in them (nor since), all of them after the area's last demotion;
 *      - the area before it in the order has been 'd1' for at least one full shop day (10:00–22:00) since its last
 *        change, and no area was promoted earlier tonight.
 *
 * NEVER TOUCHED: an area whose switch is 'mongo' (or missing) — a manual override wins; it also holds back the areas
 * after it in the order. Every change is a guarded UPDATE (only from the value that was read) plus a stage_c_log
 * row with a plain reason, so a run is idempotent and two runs at once cannot do the same change twice.
 *
 * The job's own switch: feature_flags `stageC` = 'auto' | 'demote-only' (no promotions; demotions and the
 * write-through guard still run) | 'off' (nothing at all). Missing or unknown = 'off'.
 *
 * NEVER THROWS: every problem ends up in the returned report; the copy job that called it is never affected.
 * The clock is a parameter (tests); all day / time rules are in India time (UTC+5:30, no daylight saving).
 */
import type { D1DatabaseLike } from "./types";
import { READ_FLAG_PREFIX, readFreshnessUncached, type Freshness, type ReadMode } from "./read-source";
import { addDaysIst, istDateOf } from "@/lib/ist";

// ---------------------------------------------------------------------------
// The rules (documented in docs/D1_MIGRATION_PLAN.md, "Stage C")
// ---------------------------------------------------------------------------

/** Promotion order: master data first (no money), sales & money last. */
export const STAGE_C_ORDER = ["masters", "crm", "staff", "stock", "sales"] as const;
export type StageCArea = (typeof STAGE_C_ORDER)[number];

/**
 * Clean shop days and comparisons an area needs before it may answer from D1. More for the areas whose mistakes
 * would cost more: sales & money needs three clean days and 100 comparisons.
 */
export const PROMOTION_RULES: Record<StageCArea, { days: number; minRuns: number }> = {
  masters: { days: 1, minRuns: 30 },
  crm: { days: 2, minRuns: 30 },
  staff: { days: 2, minRuns: 50 },
  stock: { days: 2, minRuns: 50 },
  sales: { days: 3, minRuns: 100 },
};

/** Promotions only between 22:00 and 00:25 India time (minutes after midnight): the shop is closed then. */
export const PROMOTION_WINDOW = { fromMin: 22 * 60, toMin: 25 };
/** The shop's opening hours (India time), for "a full shop day in d1". */
export const SHOP_HOURS = { openMin: 10 * 60, closeMin: 22 * 60 };
/** Demotion looks at the last hour of comparisons. */
export const DEMOTION_LOOKBACK_MS = 60 * 60_000;
/** More D1 errors / fallbacks than this in the last hour demotes (a single one may be a passing D1 hiccup). */
export const DEMOTION_MAX_PROBLEMS = 3;
/** Write-through health for a promotion: no failure in this long. Also the furthest back the guard looks. */
export const WRITE_THROUGH_LOOKBACK_MS = 24 * 3600_000;
/** The night window belongs to the shop day that just closed: India time minus 3 h is still that day at 00:25. */
const SHOP_DAY_SHIFT_MS = 3 * 3600_000;

export type StageCSetting = "auto" | "demote-only" | "off";

export interface StageCChange {
  area: string;
  fromMode: string;
  toMode: string;
  reason: string;
  applied: boolean;
}

export interface AreaStageC {
  area: StageCArea;
  /** The switch as written ('d1', 'shadow', 'mongo'; null when the row is missing). */
  value: string | null;
  mode: ReadMode;
  /** When the switch last changed (feature_flags.updatedAt or the latest stage_c_log row, the later). */
  since: string | null;
  /** What reads really do now: 'd1' only when fresh. */
  effectiveMode: ReadMode;
  freshness: Freshness;
  /** Shop days in a row, back from the current one, with comparisons and nothing wrong, after the last demotion. */
  cleanDays: number;
  rule: { days: number; minRuns: number };
  lastDemotionAt: string | null;
  lastHour: { mismatches: number; problems: number; example: string | null };
}

export interface NextPromotion {
  area: StageCArea;
  /** True when every condition holds right now (the job promotes it on this run). */
  eligibleNow: boolean;
  /** What still stands in the way, in plain words (empty when eligible). */
  blockers: string[];
  /** Earliest time the time-based conditions allow (the other blockers must clear too), ISO. */
  earliestAt: string | null;
}

export interface StageCEvaluation {
  now: string;
  setting: StageCSetting;
  shopDay: string;
  inPromotionWindow: boolean;
  writeThrough: { value: string | null; updatedAt: string | null; on: boolean; writes: number; lastWriteAt: string | null; failures24h: { collection: string; lastFailureAt: string; lastError: string | null }[] };
  areas: AreaStageC[];
  nextPromotion: NextPromotion | null;
  promotedTonight: { area: string; at: string } | null;
}

export interface StageCReport {
  ok: boolean;
  setting: StageCSetting | null;
  changes: StageCChange[];
  nextPromotion: NextPromotion | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// India time helpers
// ---------------------------------------------------------------------------

const IST_OFFSET_MS = 330 * 60_000;

function istMinutes(ms: number): number {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The instant of hh:mm India time on an India date. */
function istAt(day: string, minutes: number): number {
  return Date.parse(`${day}T00:00:00+05:30`) + minutes * 60_000;
}

export function inPromotionWindow(ms: number): boolean {
  const m = istMinutes(ms);
  return m >= PROMOTION_WINDOW.fromMin || m <= PROMOTION_WINDOW.toMin;
}

/** The shop day an instant belongs to for Stage C (at 00:10 it is still the day that just closed). */
export function shopDayOf(ms: number): string {
  return istDateOf(ms - SHOP_DAY_SHIFT_MS);
}

/** The start (22:00 India time) of the promotion night `ms` falls in or last fell in. */
function nightStart(ms: number): number {
  return istAt(shopDayOf(ms), PROMOTION_WINDOW.fromMin);
}

/** The next time the promotion window opens at or after `ms`. */
function nextWindowOpen(ms: number): number {
  if (inPromotionWindow(ms)) return ms;
  const today = istDateOf(ms);
  return istAt(today, PROMOTION_WINDOW.fromMin);
}

/** The end (22:00) of the first FULL shop day that starts (10:00) at or after `sinceMs`. */
function firstFullShopDayEnd(sinceMs: number): number {
  let day = istDateOf(sinceMs);
  if (istAt(day, SHOP_HOURS.openMin) < sinceMs) day = addDaysIst(day, 1);
  return istAt(day, SHOP_HOURS.closeMin);
}

function parseIso(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

const iso = (ms: number) => new Date(ms).toISOString();

function parseMode(v: unknown): ReadMode | null {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "mongo" || s === "shadow" || s === "d1" ? s : null;
}

function parseSetting(v: unknown): StageCSetting {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "auto" || s === "demote-only" ? s : "off";
}

function errText(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300);
}

// ---------------------------------------------------------------------------
// Reading the facts
// ---------------------------------------------------------------------------

async function rows<T = any>(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<T[]> {
  const stmt = args.length ? db.prepare(sql).bind(...args) : db.prepare(sql);
  return ((await stmt.all<T>()).results || []) as T[];
}

/**
 * Everything the decisions need, judged at `now`. Reads only. Throws when a table is missing (the caller turns
 * that into an error report).
 */
export async function evaluateStageC(db: D1DatabaseLike, now: number): Promise<StageCEvaluation> {
  const flags = await rows<{ key: string; value: string; updatedAt: string | null }>(
    db,
    "SELECT key, value, updatedAt FROM feature_flags WHERE key LIKE 'read:%' OR key IN ('writeThrough', 'stageC')"
  );
  const flag = new Map(flags.map((f) => [String(f.key), f]));
  const setting = parseSetting(flag.get("stageC")?.value);
  const wtRow = flag.get("writeThrough");
  const wtOn = String(wtRow?.value ?? "").trim().toLowerCase() === "on";

  const shopDay = shopDayOf(now);
  // Old enough for the longest rule, plus the days after (the night window can be past midnight).
  const maxDays = Math.max(...Object.values(PROMOTION_RULES).map((r) => r.days));
  const firstDay = addDaysIst(shopDay, -(maxDays + 7));

  const [wtTotals, wtFailures, lastHour, daily, logFacts] = await Promise.all([
    rows<{ writes: number; lastWriteAt: string | null }>(db, "SELECT COALESCE(SUM(writes), 0) AS writes, MAX(lastWriteAt) AS lastWriteAt FROM write_through_state"),
    rows<{ collection: string; lastFailureAt: string; lastError: string | null }>(
      db,
      "SELECT collection, lastFailureAt, lastError FROM write_through_state WHERE lastFailureAt >= ? ORDER BY lastFailureAt DESC",
      iso(now - WRITE_THROUGH_LOOKBACK_MS)
    ),
    rows<{ area: string; mismatches: number; problems: number; example: string | null }>(
      db,
      `SELECT area,
              SUM(CASE WHEN kind IN ('shadow', 'reverse') AND match = 0 AND error IS NULL THEN 1 ELSE 0 END) AS mismatches,
              SUM(CASE WHEN kind = 'fallback' OR error IS NOT NULL THEN 1 ELSE 0 END) AS problems,
              MAX(CASE WHEN match = 0 THEN name END) AS example
         FROM shadow_results WHERE at >= ? AND at <= ? GROUP BY area`,
      iso(now - DEMOTION_LOOKBACK_MS),
      iso(now)
    ),
    rows<{ area: string; day: string; runs: number; mismatches: number; errors: number; fallbacks: number }>(
      db,
      `SELECT area, day, SUM(runs) AS runs, SUM(mismatches) AS mismatches, SUM(errors) AS errors, SUM(fallbacks) AS fallbacks
         FROM shadow_daily WHERE day >= ? GROUP BY area, day`,
      firstDay
    ),
    rows<{ area: string; lastChange: string | null; lastDemotion: string | null; lastPromotion: string | null }>(
      db,
      `SELECT area, MAX(at) AS lastChange,
              MAX(CASE WHEN fromMode = 'd1' AND toMode = 'shadow' THEN at END) AS lastDemotion,
              MAX(CASE WHEN fromMode = 'shadow' AND toMode = 'd1' THEN at END) AS lastPromotion
         FROM stage_c_log WHERE at <= ? GROUP BY area`,
      iso(now)
    ),
  ]);
  const freshness = await readFreshnessUncached(db, [...STAGE_C_ORDER], now);

  const hourBy = new Map(lastHour.map((r) => [r.area, r]));
  const logBy = new Map(logFacts.map((r) => [r.area, r]));
  const dayBy = new Map<string, Map<string, { runs: number; bad: number }>>();
  for (const r of daily) {
    const m = dayBy.get(r.area) || new Map();
    m.set(r.day, { runs: Number(r.runs) || 0, bad: (Number(r.mismatches) || 0) + (Number(r.errors) || 0) + (Number(r.fallbacks) || 0) });
    dayBy.set(r.area, m);
  }

  // A promotion already made tonight (one area per night).
  const tonight = nightStart(now);
  let promotedTonight: { area: string; at: string } | null = null;
  for (const r of logFacts) {
    const t = parseIso(r.lastPromotion);
    if (t !== null && t >= tonight && t <= now && (!promotedTonight || r.lastPromotion! > promotedTonight.at)) promotedTonight = { area: r.area, at: r.lastPromotion! };
  }

  const areas: AreaStageC[] = STAGE_C_ORDER.map((area) => {
    const row = flag.get(`${READ_FLAG_PREFIX}${area}`);
    const value = row ? String(row.value) : null;
    const mode = parseMode(value) ?? "mongo";
    const log = logBy.get(area);
    const sinceMs = Math.max(parseIso(row?.updatedAt) ?? -Infinity, parseIso(log?.lastChange) ?? -Infinity);
    const fresh = freshness[area] ?? { fresh: false, reason: "unknown" };
    const lastDemotionAt = log?.lastDemotion ?? null;
    const demotionDay = lastDemotionAt ? istDateOf(Date.parse(lastDemotionAt)) : null;
    const days = dayBy.get(area) || new Map();
    let cleanDays = 0;
    for (let i = 0; i < maxDays + 7; i++) {
      const d = addDaysIst(shopDay, -i);
      if (demotionDay && d <= demotionDay) break;
      const s = days.get(d);
      if (!s || s.runs === 0) {
        if (i === 0) continue; // the current shop day may simply have no runs yet
        break;
      }
      if (s.bad) break;
      cleanDays++;
    }
    const h = hourBy.get(area);
    return {
      area,
      value,
      mode,
      since: Number.isFinite(sinceMs) ? iso(sinceMs) : null,
      effectiveMode: mode === "d1" && !fresh.fresh ? "shadow" : mode,
      freshness: fresh,
      cleanDays,
      rule: PROMOTION_RULES[area],
      lastDemotionAt,
      lastHour: { mismatches: Number(h?.mismatches) || 0, problems: Number(h?.problems) || 0, example: h?.example ?? null },
    };
  });

  const writes = Number(wtTotals[0]?.writes) || 0;
  const evaluation: StageCEvaluation = {
    now: iso(now),
    setting,
    shopDay,
    inPromotionWindow: inPromotionWindow(now),
    writeThrough: { value: wtRow ? String(wtRow.value) : null, updatedAt: wtRow?.updatedAt ?? null, on: wtOn, writes, lastWriteAt: wtTotals[0]?.lastWriteAt ?? null, failures24h: wtFailures },
    areas,
    nextPromotion: null,
    promotedTonight,
  };
  evaluation.nextPromotion = nextPromotion(evaluation, dayBy, now);
  return evaluation;
}

/** The one area that could be promoted next, and what still stands in its way. */
function nextPromotion(ev: StageCEvaluation, dayBy: Map<string, Map<string, { runs: number; bad: number }>>, now: number): NextPromotion | null {
  let prev: AreaStageC | null = null;
  for (const a of ev.areas) {
    if (a.mode === "d1") {
      prev = a;
      continue;
    }
    const blockers: string[] = [];
    let earliest = now;
    if (a.mode === "mongo") {
      blockers.push(`${a.area} is set to '${a.value ?? "(no row)"}' by hand; Stage C never touches it (and waits for it before the later areas)`);
    }
    if (ev.setting !== "auto") blockers.push(`Stage C promotions are paused (stageC = '${ev.setting}')`);
    if (!ev.inPromotionWindow) {
      blockers.push("promotions happen only between 22:00 and 00:25 India time, when the shop is closed");
      earliest = Math.max(earliest, nextWindowOpen(now));
    }
    if (ev.promotedTonight) {
      blockers.push(`one area per night: ${ev.promotedTonight.area} was promoted at ${ev.promotedTonight.at}`);
      earliest = Math.max(earliest, istAt(addDaysIst(ev.shopDay, 1), PROMOTION_WINDOW.fromMin));
    }
    if (!ev.writeThrough.on) blockers.push(`the write-through is not on (writeThrough = '${ev.writeThrough.value ?? "(no row)"}')`);
    if (ev.writeThrough.writes < 1) blockers.push("the write-through has not copied a single write yet");
    if (ev.writeThrough.failures24h.length) {
      blockers.push(`the write-through failed in the last 24 h (${ev.writeThrough.failures24h.map((f) => f.collection).slice(0, 3).join(", ")})`);
    }
    if (!a.freshness.fresh) blockers.push(`D1 is not known fresh for ${a.area}: ${a.freshness.reason}`);
    if (prev) {
      const sinceMs = parseIso(prev.since);
      if (sinceMs === null) {
        blockers.push(`cannot tell since when ${prev.area} has been on d1 (no valid updatedAt)`);
      } else {
        const fullDayEnd = firstFullShopDayEnd(sinceMs);
        if (now < fullDayEnd) {
          blockers.push(`${prev.area} must first answer from D1 for one full shop day (10:00–22:00), until ${iso(fullDayEnd)}`);
          earliest = Math.max(earliest, fullDayEnd);
        }
      }
    }
    // Clean shop days: the last N, each with comparisons, nothing wrong in them nor since, after the last demotion.
    const rule = PROMOTION_RULES[a.area];
    const days = dayBy.get(a.area) || new Map();
    const demotionDay = a.lastDemotionAt ? istDateOf(Date.parse(a.lastDemotionAt)) : null;
    let runs = 0;
    const missing: string[] = [];
    const beforeDemotion: string[] = [];
    for (let i = 0; i < rule.days; i++) {
      const d = addDaysIst(ev.shopDay, -i);
      if (demotionDay && d <= demotionDay) beforeDemotion.push(d);
      const s = days.get(d);
      if (!s || s.runs === 0) missing.push(d);
      else runs += s.runs;
    }
    let bad = 0;
    const badDays: string[] = [];
    for (const [d, s] of Array.from(days)) {
      if (d >= addDaysIst(ev.shopDay, -(rule.days - 1)) && s.bad) {
        bad += s.bad;
        badDays.push(d);
      }
    }
    if (beforeDemotion.length) blockers.push(`it was demoted on ${demotionDay}; only shop days after that count (${beforeDemotion.join(", ")} do not)`);
    if (missing.length) blockers.push(`no shadow comparisons on ${missing.sort().join(", ")} (needs ${rule.days} shop day${rule.days === 1 ? "" : "s"} in a row)`);
    if (runs < rule.minRuns) blockers.push(`only ${runs} comparisons in the last ${rule.days} shop day${rule.days === 1 ? "" : "s"} (needs ${rule.minRuns})`);
    if (bad) blockers.push(`${bad} mismatch / D1 error / fallback on ${badDays.sort().join(", ")}`);
    if (a.lastHour.mismatches || a.lastHour.problems) {
      blockers.push(`${a.lastHour.mismatches} mismatch(es) and ${a.lastHour.problems} D1 error(s) in the last hour`);
    }
    return { area: a.area, eligibleNow: blockers.length === 0, blockers, earliestAt: iso(earliest) };
  }
  return null; // every area is on d1
}

// ---------------------------------------------------------------------------
// Changing a switch
// ---------------------------------------------------------------------------

/**
 * Sets feature_flags[key] from `from` to `to` and logs it, in one D1 batch. The UPDATE only applies while the row
 * still holds `from` (someone may have changed it by hand a moment ago), and the log row is only written when the
 * row now holds exactly our new value and timestamp, so a change that did not happen is never logged.
 */
async function changeFlag(db: D1DatabaseLike, key: string, area: string, from: string, to: string, reason: string, now: number): Promise<boolean> {
  const at = iso(now);
  await db.batch([
    db.prepare("UPDATE feature_flags SET value = ?, updatedAt = ? WHERE key = ? AND lower(trim(value)) = ?").bind(to, at, key, from),
    db
      .prepare(
        "INSERT INTO stage_c_log (at, area, fromMode, toMode, reason) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM feature_flags WHERE key = ? AND value = ? AND updatedAt = ?)"
      )
      .bind(at, area, from, to, reason.slice(0, 1000), key, to, at),
  ]);
  const row = await db.prepare("SELECT value, updatedAt FROM feature_flags WHERE key = ?").bind(key).first<{ value: string; updatedAt: string }>();
  return !!row && row.value === to && row.updatedAt === at;
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

/** One run of Stage C at `now` (ms). Never throws. */
export async function runStageC(db: D1DatabaseLike, now: number = Date.now()): Promise<StageCReport> {
  const report: StageCReport = { ok: true, setting: null, changes: [], nextPromotion: null };
  try {
    let ev = await evaluateStageC(db, now);
    report.setting = ev.setting;
    if (ev.setting === "off") {
      report.nextPromotion = ev.nextPromotion;
      return report;
    }

    // 1. Write-through guard: failures since it was last switched on (at most 24 h back) switch it off.
    if (ev.writeThrough.on) {
      // Only failures after the switch was last turned on: an Admin who fixed the cause and switched it back on is
      // not overruled by the old failure.
      const wtSince = Math.max(now - WRITE_THROUGH_LOOKBACK_MS, parseIso(ev.writeThrough.updatedAt) ?? -Infinity);
      const failed = ev.writeThrough.failures24h.filter((f) => (parseIso(f.lastFailureAt) ?? 0) >= wtSince);
      if (failed.length) {
        const what = failed
          .slice(0, 3)
          .map((f) => `${f.collection} at ${f.lastFailureAt}${f.lastError ? ` (${String(f.lastError).slice(0, 120)})` : ""}`)
          .join("; ");
        const reason = `write-through failures recorded: ${what}. Switched off so D1 is no longer trusted; every 'd1' area reads MongoDB.`;
        const applied = await changeFlag(db, "writeThrough", "writeThrough", "on", "off", reason, now);
        report.changes.push({ area: "writeThrough", fromMode: "on", toMode: "off", reason, applied });
        if (applied) ev = { ...ev, writeThrough: { ...ev.writeThrough, on: false, value: "off" } };
      }
    }

    // 2. Demotions (any time).
    for (const a of ev.areas) {
      if (a.mode !== "d1") continue;
      let reason: string | null = null;
      if (!ev.writeThrough.on) {
        reason = `the write-through is not on (writeThrough = '${ev.writeThrough.value ?? "(no row)"}'), so D1 may miss writes`;
      } else if (a.lastHour.mismatches > 0) {
        reason = `${a.lastHour.mismatches} mismatch(es) between D1 and MongoDB in the last 60 minutes${a.lastHour.example ? ` (e.g. ${a.lastHour.example})` : ""}`;
      } else if (a.lastHour.problems > DEMOTION_MAX_PROBLEMS) {
        reason = `${a.lastHour.problems} D1 errors / fallbacks in the last 60 minutes (more than ${DEMOTION_MAX_PROBLEMS})`;
      }
      if (!reason) continue;
      reason += ". Back to shadow: MongoDB answers; clean days count again from tomorrow.";
      const applied = await changeFlag(db, `${READ_FLAG_PREFIX}${a.area}`, a.area, "d1", "shadow", reason, now);
      report.changes.push({ area: a.area, fromMode: "d1", toMode: "shadow", reason, applied });
    }

    // 3. At most one promotion, only in 'auto', only when nothing changed in this run (a demotion or the
    //    write-through guard firing is no moment to move anything forward).
    if (report.changes.length === 0) {
      const next = ev.nextPromotion;
      if (ev.setting === "auto" && next?.eligibleNow) {
        const a = ev.areas.find((x) => x.area === next.area)!;
        const rule = PROMOTION_RULES[a.area];
        const reason =
          `clean for ${rule.days} shop day${rule.days === 1 ? "" : "s"} up to ${ev.shopDay} (at least ${rule.minRuns} comparisons, ` +
          `0 mismatches, 0 D1 errors); write-through on with ${ev.writeThrough.writes} writes and no failure in 24 h; D1 fresh; ` +
          `shop closed. D1 answers from now on, MongoDB is still compared after each answer.`;
        const applied = await changeFlag(db, `${READ_FLAG_PREFIX}${a.area}`, a.area, "shadow", "d1", reason, now);
        report.changes.push({ area: a.area, fromMode: "shadow", toMode: "d1", reason, applied });
      }
    }
    // What the next promotion waits for, after this run's changes.
    report.nextPromotion = report.changes.length ? (await evaluateStageC(db, now)).nextPromotion : ev.nextPromotion;
  } catch (e) {
    report.ok = false;
    report.error = errText(e);
    console.warn(`d1 stage C: did not run (${report.error})`);
  }
  return report;
}

/**
 * runStageC for the copy job: also capped in time, so a slow D1 cannot hold the cron request. Never throws.
 */
export async function runStageCSafely(db: D1DatabaseLike, now: number = Date.now(), timeoutMs = 8000): Promise<StageCReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<StageCReport>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, setting: null, changes: [], nextPromotion: null, error: `timed out after ${timeoutMs} ms` }), timeoutMs);
    });
    return await Promise.race([Promise.resolve().then(() => runStageC(db, now)), timeout]);
  } catch (e) {
    return { ok: false, setting: null, changes: [], nextPromotion: null, error: errText(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The admin view: the evaluation plus the last 20 changes. Throws when the tables are missing. */
export async function getStageCStatus(db: D1DatabaseLike, now: number = Date.now()) {
  const ev = await evaluateStageC(db, now);
  const log = await rows(db, "SELECT id, at, area, fromMode, toMode, reason FROM stage_c_log ORDER BY at DESC, id DESC LIMIT 20");
  return { ...ev, log };
}
