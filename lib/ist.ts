/**
 * India time (IST, UTC+5:30) helpers — one place for "today", "this hour", "this year" in India.
 *
 * Value Plus works in India, but the server (Cloudflare) runs on UTC. `new Date().toISOString()`, `getHours()`,
 * `getFullYear()` and `setHours(0,0,0,0)` all read the machine's zone, so between 00:00 and 05:30 IST they give
 * yesterday's date (or last year's on the night of 1 January), and the hour is always 5:30 h early.
 *
 * India has had a fixed +05:30 offset (no daylight saving) since 1945, so these helpers shift by that offset and
 * read the UTC fields. They never use the machine's own zone, so they give the same answer on the server, in tests
 * and in the browser. Safe to import from client code (no imports at all).
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

type DateInput = Date | number | string;

/** A Date whose UTC fields read as the wall clock in India at that instant. Internal only. */
function shifted(at: DateInput = Date.now()): Date {
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return new Date(t + IST_OFFSET_MS);
}

/** The India date (YYYY-MM-DD) of an instant. */
export function istDateOf(at: DateInput): string {
  return shifted(at).toISOString().slice(0, 10);
}

/** Today's date (YYYY-MM-DD) in India. */
export function istToday(): string {
  return istDateOf(Date.now());
}

/** The year in India (on the night of 1 January the UTC year is still the old one until 05:30). */
export function istYear(at: DateInput = Date.now()): number {
  return shifted(at).getUTCFullYear();
}

/** The hour (0–23) in India of an instant. */
export function istHour(at: DateInput = Date.now()): number {
  return shifted(at).getUTCHours();
}

/** "hh:mm AM/PM" in India, e.g. "09:05 PM". */
export function istTimeLabel(at: DateInput = Date.now()): string {
  const d = shifted(at);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The first moment of an India day (YYYY-MM-DD) — 18:30 UTC of the day before. */
export function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

/** The last moment of an India day (YYYY-MM-DD). */
export function istDayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999+05:30`);
}

/** The first day (YYYY-MM-01) of the India month an instant falls in (default: now). */
export function istMonthStart(at: DateInput = Date.now()): string {
  return `${istDateOf(at).slice(0, 7)}-01`;
}

/** A YYYY-MM-DD date moved by n days (calendar arithmetic, no zone involved). */
export function addDaysIst(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
