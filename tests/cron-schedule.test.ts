/**
 * The cron now runs only from 03:00 to 18:55 UTC (08:30 to 00:25 India time), wrangler.jsonc. Checks that every
 * job still has a run when it needs one, and runs lib/attendance-alerts.ts at those times against a test database:
 *  - 10:00 IST office-start (worker.ts) and the 10:15-12:00 late reminders are inside the window;
 *  - 22:00 IST automatic check-out closes today's open days (the store is open till 10 PM);
 *  - a day left open (e.g. every evening run failed) is closed by the 00:00-00:25 IST runs, as the old 00:00-02:55
 *    "early-morning clean-up" did; the 08:30 morning run leaves it alone, as it always has;
 *  - the one-time index job runs from the same cron.
 */
import { setNow } from "./helpers/fixed-clock";
import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { runAttendanceChecks } from "@/lib/attendance-alerts";
import { ENSURE_INDEXES_JOB } from "@/lib/ensure-indexes";

/** UTC times (minutes after midnight) a "m h * * *" cron with step/range fields fires at. */
function fireTimes(expr: string): number[] {
  const [min, hour] = expr.split(/\s+/);
  const expand = (field: string, max: number) => {
    const [range, stepStr] = field.split("/");
    const step = Number(stepStr || 1);
    const [lo, hi] = range === "*" ? [0, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), Number(range)];
    const out: number[] = [];
    for (let v = lo; v <= hi; v += step) out.push(v);
    return out;
  };
  return expand(hour, 23).flatMap((h) => expand(min, 59).map((m) => h * 60 + m));
}
const ist = (utcMinutes: number) => (utcMinutes + 330) % 1440;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

async function main() {
  // ── the schedule itself ──
  const wrangler = readFileSync(path.join(process.cwd(), "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const crons: string[] = JSON.parse(wrangler).triggers.crons;
  check(JSON.stringify(crons) === JSON.stringify(["*/5 3-18 * * *"]), `wrangler cron is ${JSON.stringify(crons)}`);
  const runsIst = new Set(fireTimes(crons[0]).map(ist));
  check(runsIst.size === 192, `${runsIst.size} runs a day (was 288)`);
  check(runsIst.has(10 * 60), "10:00 IST run (office-start + GIDA housekeeping in worker.ts)");
  check([15, 30, 45, 60, 75, 90, 105, 120].every((m) => runsIst.has(600 + m)), "10:15-12:00 IST late check-in reminders");
  check(runsIst.has(22 * 60), "22:00 IST run (automatic check-out at shift end)");
  check([0, 5, 10, 15, 20, 25].every((m) => runsIst.has(m)), "00:00-00:25 IST runs (clean-up of days left open)");
  check(Math.min(...Array.from(runsIst).filter((m) => m > 60)) === 8 * 60 + 30, "first morning run at 08:30 IST");
  check(!Array.from(runsIst).some((m) => m > 25 && m < 8 * 60 + 30), "no runs from 00:30 to 08:25 IST");
  check(runsIst.has(9 * 60) && runsIst.has(22 * 60 - 5), "break / away alerts window (09:00-22:00 IST) covered");

  // ── attendance-alerts at those times ──
  await startMemoryMongo("cron_test");
  const att = mongoose.connection.collection("attendance");
  const open = (staffName: string, date: string) => ({ staffName, staffRole: "salesman", date, checkInTime: "10:05 AM", checkOutTime: "", status: "Present", notes: "" });
  await att.insertMany([open("Ravi", "2026-11-11"), open("Sita", "2026-11-12")]);
  const closedDays = async () => (await att.find({ checkOutTime: { $nin: ["", "--", null] } }).toArray()).map((r: any) => `${r.staffName}@${r.date}`).sort();

  // 12 Nov 08:30 IST: Ravi's 11 Nov is still open; the morning run leaves it (unchanged behaviour).
  setNow("2026-11-12T08:30:00+05:30");
  const morning = await runAttendanceChecks();
  check(morning.autoCheckedOut === 0, "08:30 IST run closes nothing (as before)");
  check(!!(await mongoose.connection.collection("scheduled_runs").findOne({ key: ENSURE_INDEXES_JOB })), "index job ran from the cron and is marked done");

  // 12 Nov 21:00 IST: the store is still open (shift ends 10 PM), so nobody is checked out yet.
  setNow("2026-11-12T21:00:00+05:30");
  const beforeClose = await runAttendanceChecks();
  check(beforeClose.autoCheckedOut === 0, `21:00 IST run closes nothing, shift ends at 22:00 (${beforeClose.autoCheckedOut})`);

  // 12 Nov 22:00 IST: shift end closes today's Sita and the leftover Ravi from 11 Nov.
  setNow("2026-11-12T22:00:00+05:30");
  const evening = await runAttendanceChecks();
  check(evening.autoCheckedOut === 2, `22:00 IST run closes today's open day and the leftover one (${evening.autoCheckedOut})`);
  check(JSON.stringify(await closedDays()) === JSON.stringify(["Ravi@2026-11-11", "Sita@2026-11-12"]), "both days now have a check-out");

  // A day left open past all the evening runs is closed by the 00:05 IST run, not left until the next evening.
  await att.insertOne(open("Mohan", "2026-11-12"));
  setNow("2026-11-13T00:05:00+05:30");
  const midnight = await runAttendanceChecks();
  check(midnight.autoCheckedOut === 1, `00:05 IST run closes the previous day's leftover (${midnight.autoCheckedOut})`);
  const mohan: any = await att.findOne({ staffName: "Mohan" });
  check(mohan.checkOutTime === "10:00 PM", `checked out at the shift end time (${mohan.checkOutTime})`);

  await stopMemoryMongo();
  return summary("cron-schedule");
}

main().then(
  (failures) => process.exit(failures ? 1 : 0),
  async (e) => {
    console.error(e);
    await stopMemoryMongo().catch(() => {});
    process.exit(1);
  }
);
