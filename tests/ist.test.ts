/**
 * lib/ist.ts at the instants where India and UTC disagree.
 *
 * The process is switched to UTC first (Node re-reads process.env.TZ when it is assigned), as on Cloudflare, so a
 * helper that quietly used the machine's zone would fail here. The other half runs the same checks with the zone set
 * to America/Los_Angeles, to show the answers never depend on the machine's zone.
 *
 *   node tests/run-tests.mjs ist.test
 */
process.env.TZ = "UTC";
import { setNow } from "./helpers/fixed-clock";
import { check, summary } from "./helpers/assert";
import { istToday, istDateOf, istYear, istHour, istTimeLabel, istDayStart, istDayEnd, istMonthStart, addDaysIst } from "@/lib/ist";
import { todayInIndia } from "@/lib/today";

function runChecks(zone: string) {
  process.env.TZ = zone;
  console.log(`\n-- machine zone ${zone}`);

  // 18:45 UTC on the 13th = 00:15 IST on the 14th.
  setNow("2026-11-13T18:45:00Z");
  check(istToday() === "2026-11-14", "00:15 IST on the 14th: today is the 14th");
  check(todayInIndia() === "2026-11-14", "todayInIndia agrees");
  check(istDateOf(new Date("2026-11-13T18:45:00Z")) === "2026-11-14", "istDateOf(Date)");
  check(istDateOf(Date.parse("2026-11-13T18:45:00Z")) === "2026-11-14", "istDateOf(timestamp)");
  check(istDateOf("2026-11-13T18:45:00Z") === "2026-11-14", "istDateOf(ISO string)");
  check(istHour() === 0, "hour is 0 (midnight hour), not 18");
  check(istTimeLabel() === "12:15 AM", `time label 12:15 AM (got ${istTimeLabel()})`);
  check(istMonthStart() === "2026-11-01", "month start 1 Nov");

  // 19:00 UTC on 30 Nov = 00:30 IST on 1 Dec: a new month in India.
  setNow("2026-11-30T19:00:00Z");
  check(istToday() === "2026-12-01", "00:30 IST on 1 Dec: today is 1 Dec");
  check(istMonthStart() === "2026-12-01", "month start is 1 Dec, not 1 Nov");
  check(istHour() === 0, "hour 0");
  check(istTimeLabel() === "12:30 AM", "time label 12:30 AM");

  // 19:00 UTC on 31 Dec = 00:30 IST on 1 Jan 2027: a new year in India.
  setNow("2026-12-31T19:00:00Z");
  check(istToday() === "2027-01-01", "00:30 IST on 1 Jan 2027: today is 1 Jan 2027");
  check(istYear() === 2027, "year 2027 (document number prefix)");
  check(istYear(new Date("2026-12-31T18:29:59.999Z")) === 2026, "one ms before midnight IST is still 2026");
  check(istMonthStart() === "2027-01-01", "month start 1 Jan 2027");

  // The 05:29 / 05:30 UTC boundary: 10:59 / 11:00 IST, same India day.
  check(istHour(new Date("2026-11-14T05:29:00Z")) === 10, "05:29 UTC = 10 IST");
  check(istHour(new Date("2026-11-14T05:30:00Z")) === 11, "05:30 UTC = 11 IST");
  check(istTimeLabel(new Date("2026-11-14T05:29:00Z")) === "10:59 AM", "05:29 UTC label 10:59 AM");
  check(istTimeLabel(new Date("2026-11-14T05:30:00Z")) === "11:00 AM", "05:30 UTC label 11:00 AM");
  // ... and the 18:29 / 18:30 UTC boundary, where the India day changes.
  check(istDateOf(new Date("2026-11-13T18:29:59.999Z")) === "2026-11-13", "18:29:59.999 UTC is still the 13th in India");
  check(istDateOf(new Date("2026-11-13T18:30:00Z")) === "2026-11-14", "18:30 UTC is the 14th in India");
  check(istHour(new Date("2026-11-13T18:30:00Z")) === 0, "18:30 UTC = hour 0 IST");

  // A normal daytime instant (15:30 IST): every helper agrees with the plain UTC-day answer.
  setNow("2026-11-13T15:30:00+05:30");
  check(istToday() === "2026-11-13", "daytime: today 13 Nov");
  check(istHour() === 15, "daytime: hour 15");
  check(istTimeLabel() === "03:30 PM", "daytime: label 03:30 PM");
  check(istYear() === 2026, "daytime: year 2026");
  check(istTimeLabel(new Date("2026-11-13T06:30:00Z")) === "12:00 PM", "noon label 12:00 PM");

  // Day bounds.
  check(istDayStart("2026-11-14").toISOString() === "2026-11-13T18:30:00.000Z", "day start = 18:30 UTC the day before");
  check(istDayEnd("2026-11-14").toISOString() === "2026-11-14T18:29:59.999Z", "day end = 18:29:59.999 UTC");
  check(istDayStart("2026-11-14") <= new Date("2026-11-13T18:45:00Z") && new Date("2026-11-13T18:45:00Z") <= istDayEnd("2026-11-14"),
    "00:15 IST on the 14th falls inside the 14th");

  // Calendar arithmetic.
  check(addDaysIst("2026-11-30", 1) === "2026-12-01", "30 Nov + 1 = 1 Dec");
  check(addDaysIst("2027-01-01", -1) === "2026-12-31", "1 Jan - 1 = 31 Dec");
  check(addDaysIst("2028-02-28", 1) === "2028-02-29", "leap day");
  check(addDaysIst("2026-11-13", 0) === "2026-11-13", "+0");
  check(addDaysIst("2026-11-13", 10) === "2026-11-23", "+10");
}

runChecks("UTC");
runChecks("America/Los_Angeles");
runChecks("Asia/Kolkata");

process.exit(summary("ist") ? 1 : 0);
