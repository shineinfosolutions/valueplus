import { istToday } from "./ist";

/** Today's date (YYYY-MM-DD) in India time. `new Date().toISOString()` is UTC,
 *  so between midnight and 5:30 am IST it gives yesterday's date.
 *  Same as `istToday()` in lib/ist.ts (kept under this name for its existing callers). */
export const todayInIndia = (): string => istToday();
