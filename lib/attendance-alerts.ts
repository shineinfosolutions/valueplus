import connectToDatabase from "@/lib/db";
import ScheduledRun from "@/models/ScheduledRun";
import User from "@/models/User";
import Attendance from "@/models/Attendance";
import LeaveRequest from "@/models/LeaveRequest";
import { notifyRoles } from "@/lib/notify";
import { normName } from "@/lib/staff-incentive";
import { getShift } from "@/lib/shift-settings";
import { publishChange } from "@/lib/realtime";

/** Everyone who works at the store (not the Admin, not outside suppliers). */
const STAFF_ROLES = ["salesman", "sales", "cashier", "manager", "warehouse", "accounts", "hr", "driver"];
const SHIFT_START_MIN = 10 * 60;
const OVER_REPEAT_MS = 5 * 60000;

const istNow = (d = new Date()) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { day: `${p.year}-${p.month}-${p.day}`, hour, minute: Number(p.minute), minutes: hour * 60 + Number(p.minute) };
};

/** Run a job once for a key: the first caller inserts the row and goes on; anyone later finds it there. */
async function claim(key: string): Promise<boolean> {
  const earlier = await ScheduledRun.findOneAndUpdate({ key }, { $setOnInsert: { ranAt: new Date() } }, { upsert: true, new: false });
  return !earlier;
}

/**
 * From 10:00 sharp (then every 15 minutes until 12:00) the Store Manager and Admin are told who has not checked
 * in yet and how many minutes late they are, with a sound on the phone. Staff on approved leave / weekly off are left out.
 */
async function notLateCheckedInAlert(now: ReturnType<typeof istNow>): Promise<number> {
  if (now.minutes < SHIFT_START_MIN || now.minutes > 12 * 60 || now.minute % 15 !== 0) return 0;
  if (!(await claim(`late-check:${now.day}:${now.hour}${String(now.minute).padStart(2, "0")}`))) return 0;

  const staff: any[] = await User.find({ role: { $in: STAFF_ROLES }, status: { $nin: ["inactive", "terminated", "suspended"] } }).select("name role").lean();
  const todays: any[] = await Attendance.find({ date: now.day }, { staffName: 1, checkInTime: 1, status: 1 }).lean();
  const here = new Set(todays.filter((a) => (a.checkInTime && a.checkInTime !== "--") || a.status === "On Leave").map((a) => normName(a.staffName)));
  const away: any[] = await LeaveRequest.find({ status: "approved", kind: { $ne: "break" }, fromDate: { $lte: now.day }, toDate: { $gte: now.day } }, { staffName: 1 }).lean();
  for (const l of away) here.add(normName(l.staffName));

  const late = staff.filter((u) => !here.has(normName(u.name)));
  if (late.length === 0) return 0;
  const lateBy = now.minutes - SHIFT_START_MIN;
  // One notification for each person (not one for everybody), so each can be opened and dealt with on its own.
  // A late Manager is not told about themselves.
  for (const u of late) {
    const name = String(u.name).replace(/\s*\(.*\)\s*$/, "");
    await notifyRoles(
      ["manager", "admin", "superadmin"],
      {
        type: "general",
        title: lateBy === 0 ? `${name} has not checked in` : `${name} is ${lateBy} min late`,
        message: `${name} (${u.role}) has not checked in yet${lateBy > 0 ? ` — ${lateBy} minutes after 10:00` : ""}.`,
        link: "/staff/directory",
        createdBy: "System",
        refType: "late-checkin",
        refId: `${now.day}:${String(u._id)}`,
      },
      String(u._id)
    );
  }
  return late.length;
}

/** A break that is over and the person is not back at the store: told to the Store Manager and Admin, again every 5 minutes. */
async function breakOverAlerts(): Promise<number> {
  const now = new Date();
  const rows: any[] = await LeaveRequest.find({
    kind: "break",
    status: "approved",
    breakStartedAt: { $exists: true },
    breakEndsAt: { $lte: now },
    breakReturnedAt: { $exists: false },
  });
  let sent = 0;
  for (const r of rows) {
    if (r.lastOverAlertAt && now.getTime() - r.lastOverAlertAt.getTime() < OVER_REPEAT_MS) continue;
    r.lastOverAlertAt = now;
    await r.save();
    const over = Math.max(0, Math.round((now.getTime() - r.breakEndsAt.getTime()) / 60000));
    await notifyRoles(["manager", "admin", "superadmin"], {
      type: "general",
      title: `Break over: ${r.staffName} is not at the store`,
      message: `${r.breakMinutes} minute break ended ${over} minute${over === 1 ? "" : "s"} ago and ${r.staffName} is not back at the store.`,
      link: "/staff/directory",
      createdBy: "System",
    });
    sent++;
  }
  return sent;
}

const toMinutes = (t: string): number => {
  const m = String(t || "").match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  const mer = m[3]?.toUpperCase();
  if (mer === "PM" && h < 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return h * 60 + parseInt(m[2], 10);
};
const label12 = (mins: number): string => {
  const h24 = Math.floor(mins / 60) % 24;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
};

/**
 * When the shift ends (09:00 PM) everyone still checked in is checked out at the shift end time: the hours worked are
 * counted up to then, a short day becomes a Half-Day, and a Late mark stays. Anyone left open from an earlier day is closed the
 * same way. Runs every 5 minutes, so a missed run is picked up on the next one.
 */
async function autoCheckOut(now: ReturnType<typeof istNow>): Promise<number> {
  const shift: any = await getShift();
  const endMin = toMinutes(shift.endTime);
  if (now.minutes < endMin && now.hour >= 3) return 0; // before the shift ends (only early-morning clean-up of old days runs)
  const open: any[] = await Attendance.find({
    checkInTime: { $nin: [null, "", "--"] },
    $or: [{ checkOutTime: { $exists: false } }, { checkOutTime: "" }, { checkOutTime: "--" }],
    status: { $ne: "On Leave" },
    date: { $lte: now.day },
  });
  let closed = 0;
  for (const rec of open) {
    if (rec.date === now.day && now.minutes < endMin) continue;
    const inMin = toMinutes(rec.checkInTime);
    const worked = Math.max(0, endMin - inMin);
    const hours = worked / 60;
    rec.checkOutTime = label12(endMin);
    rec.workingDurationMinutes = worked;
    rec.isEarlyCheckout = false;
    if (hours < (Number(shift.minHoursForFullDay) || 7.5)) rec.status = "Half-Day";
    else if (rec.status !== "Late") rec.status = "Present";
    rec.notes = (rec.notes ? rec.notes + " | " : "") + `Checked out automatically at ${label12(endMin)} (shift end, ${hours.toFixed(1)} hrs)`;
    await rec.save();
    closed++;
  }
  return closed;
}

/** Called every 5 minutes by the Cloudflare cron (worker.ts). */
export async function runAttendanceChecks(): Promise<{ late: number; breaks: number; autoCheckedOut: number }> {
  await connectToDatabase();
  const now = istNow();
  const late = await notLateCheckedInAlert(now);
  // Breaks only matter in working hours.
  const breaks = now.hour >= 9 && now.hour < 22 ? await breakOverAlerts() : 0;
  const autoCheckedOut = await autoCheckOut(now);
  // The cron is not a write through the API, so worker.ts does not announce it.
  if (autoCheckedOut > 0) publishChange(["/api/staff/attendance"]);
  return { late, breaks, autoCheckedOut };
}
