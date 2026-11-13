/**
 * Freezes "now" and Math.random for the whole test process, so a route that reads the current date (the dashboard's
 * default "this month" range, "today") or rolls a random number (the dashboard's "growth" badges) gives the same JSON
 * on every run and every day. Import this FIRST in a test file, before anything that might capture Date.
 *
 * Only `new Date()` with no arguments and `Date.now()` are frozen; `new Date(x)` behaves as usual. Timers and the
 * MongoDB driver's own timeouts use the monotonic clock, so they keep working.
 */
const RealDate = Date;

export const FIXED_NOW_ISO = "2026-11-13T15:30:00+05:30";
let FIXED_NOW = RealDate.parse(FIXED_NOW_ISO);

/** Move the frozen clock (e.g. to run the cron "at" a given time). */
export function setNow(iso: string) {
  FIXED_NOW = RealDate.parse(iso);
}

class FrozenDate extends RealDate {
  constructor(...args: any[]) {
    if (args.length === 0) super(FIXED_NOW);
    else super(...(args as [any]));
  }
  static now() {
    return FIXED_NOW;
  }
  // A Date made before the swap (or by a library holding the original) is still a Date.
  static [Symbol.hasInstance](value: unknown) {
    return value instanceof RealDate;
  }
}

// Libraries recognise Date by name (mongoose: `{ type: Date }` in a schema).
Object.defineProperty(FrozenDate, "name", { value: "Date" });
(globalThis as any).Date = FrozenDate;
Math.random = () => 0.5;

export { RealDate };
