import Attendance, { IAwayPeriod } from "@/models/Attendance";
import LeaveRequest from "@/models/LeaveRequest";
import { notifyRoles } from "@/lib/notify";
import { publishChange } from "@/lib/realtime";
import {
  AWAY_ALERT_MINUTES,
  GEOFENCE_ENTER_M,
  GEOFENCE_EXIT_M,
  GEOFENCE_MIN_HIDDEN_MS,
  MAX_GPS_ERROR_M,
  STORE,
  distanceM,
} from "@/lib/store-location";

/**
 * Geofence bookkeeping: the times a staff member was outside the store during the shift.
 *
 * The phone (components/shared/GeofenceWatcher.tsx) reports only when the person crosses the store boundary,
 * and when the app comes back after being closed. The server decides from the reported position itself
 * (never from the phone's "I left" claim) and keeps `Attendance.awayPeriods`:
 *  - away    outside the store, counted in `totalAwayMinutes`;
 *  - break   outside during an approved break (not counted; time past the break's end is split off as away);
 *  - unknown the app was closed / in the background, so nobody knows (counted in `unknownMinutes`).
 * A web app cannot read the location while it is closed, so "unknown" is recorded instead of guessing.
 */

const MAX_SPEED_MPS = 60; // a jump faster than this between two readings is a bad fix, not a person

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

/** Close a period at `at`; a break that ran past its end is split into the break part and an away part. */
function closePeriod(record: any, period: IAwayPeriod, at: Date, endUncertain = false) {
  const end = at.getTime() < new Date(period.leftAt).getTime() ? new Date(period.leftAt) : at;
  if (period.kind === "break" && period.breakEndsAt && end > new Date(period.breakEndsAt)) {
    const breakEnd = new Date(period.breakEndsAt);
    period.backAt = breakEnd;
    period.minutes = minutesBetween(new Date(period.leftAt), breakEnd);
    record.awayPeriods.push({
      kind: "away",
      leftAt: breakEnd,
      backAt: end,
      minutes: minutesBetween(breakEnd, end),
      leftDistanceM: period.maxDistanceM,
      maxDistanceM: period.maxDistanceM,
      endUncertain: endUncertain || undefined,
    });
  } else {
    period.backAt = end;
    period.minutes = minutesBetween(new Date(period.leftAt), end);
    if (endUncertain) period.endUncertain = true;
  }
}

function openPeriod(record: any): IAwayPeriod | undefined {
  return (record.awayPeriods || []).find((p: IAwayPeriod) => !p.backAt && p.kind !== "unknown");
}

function recomputeTotals(record: any) {
  const periods: IAwayPeriod[] = record.awayPeriods || [];
  record.totalAwayMinutes = periods.filter((p) => p.kind === "away" && p.backAt).reduce((t, p) => t + (p.minutes || 0), 0);
  record.unknownMinutes = periods.filter((p) => p.kind === "unknown" && p.backAt).reduce((t, p) => t + (p.minutes || 0), 0);
}

/** Close whatever is still open at check-out (by hand or the automatic one at the shift end). */
export function closeAwayAtCheckout(record: any, at: Date) {
  const open = openPeriod(record);
  if (!open) return;
  closePeriod(record, open, at);
  recomputeTotals(record);
  record.markModified("awayPeriods");
}

/** The approved break running for this person right now, if any. */
async function runningBreak(staffName: string, now: Date) {
  return LeaveRequest.findOne({
    staffName,
    kind: "break",
    status: "approved",
    breakStartedAt: { $lte: now },
    breakEndsAt: { $gte: now },
    breakReturnedAt: { $exists: false },
  })
    .select("breakEndsAt")
    .lean<{ breakEndsAt?: Date } | null>();
}

export interface PresenceReport {
  /** "move": a position while the app is open; "resume": the app is back after `hiddenMs` closed. */
  event: "move" | "resume";
  lat: number;
  lng: number;
  accuracy?: number;
  hiddenMs?: number;
}

export type PresenceResult =
  | { tracking: false; reason: string }
  | { tracking: true; state: "in" | "out" | "unchanged"; distanceM: number; changed: boolean };

export async function recordPresence(record: any, report: PresenceReport, now = new Date()): Promise<PresenceResult> {
  if (!record.checkInTime || record.checkInTime === "--") return { tracking: false, reason: "not checked in" };
  if (record.checkOutTime && record.checkOutTime !== "--") return { tracking: false, reason: "checked out" };

  const lat = Number(report.lat);
  const lng = Number(report.lng);
  const accuracy = Number(report.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return { tracking: false, reason: "bad position" };
  }
  if (Number.isFinite(accuracy) && accuracy > MAX_GPS_ERROR_M) return { tracking: false, reason: "position too vague" };

  const distance = Math.round(distanceM(lat, lng, STORE.lat, STORE.lng));
  const last = record.lastPresence;
  // A fix that would mean travelling faster than a vehicle since the last one is GPS noise.
  if (last?.at && Number.isFinite(last.lat) && Number.isFinite(last.lng) && report.event === "move") {
    const secs = Math.max(1, (now.getTime() - new Date(last.at).getTime()) / 1000);
    if (distanceM(lat, lng, last.lat, last.lng) / secs > MAX_SPEED_MPS) return { tracking: false, reason: "position jump" };
  }

  if (!record.awayPeriods) record.awayPeriods = [];
  let changed = false;

  // The app was closed for a while: that stretch is "unknown". Someone who was outside when it closed is
  // counted outside only up to that moment (the least it can have been).
  const hiddenMs = Math.min(Number(report.hiddenMs) || 0, 16 * 3600 * 1000);
  if (report.event === "resume" && hiddenMs >= GEOFENCE_MIN_HIDDEN_MS) {
    const checkedInAt = (record as any).createdAt ? new Date((record as any).createdAt) : null;
    let hiddenFrom = new Date(now.getTime() - hiddenMs);
    if (checkedInAt && hiddenFrom < checkedInAt) hiddenFrom = checkedInAt;
    const open = openPeriod(record);
    if (open) closePeriod(record, open, hiddenFrom, true);
    record.awayPeriods.push({ kind: "unknown", leftAt: hiddenFrom, backAt: now, minutes: minutesBetween(hiddenFrom, now) });
    changed = true;
  }

  const open = openPeriod(record);
  let state: "in" | "out" | "unchanged" = "unchanged";
  if (distance <= GEOFENCE_ENTER_M) {
    state = "in";
    if (open) {
      closePeriod(record, open, now);
      changed = true;
    }
  } else if (distance > GEOFENCE_EXIT_M) {
    state = "out";
    if (open) {
      if (distance > (open.maxDistanceM || 0)) {
        open.maxDistanceM = distance;
        changed = true;
      }
    } else {
      const brk = await runningBreak(record.staffName, now);
      record.awayPeriods.push({
        kind: brk ? "break" : "away",
        leftAt: now,
        leftDistanceM: distance,
        maxDistanceM: distance,
        breakEndsAt: brk?.breakEndsAt,
      });
      changed = true;
    }
  }

  if (state !== "unchanged") record.lastPresence = { state, at: now, distanceM: distance, lat, lng };
  if (changed) {
    recomputeTotals(record);
    record.markModified("awayPeriods");
  }
  if (changed || state !== "unchanged") await record.save();
  return { tracking: true, state, distanceM: distance, changed };
}

const label = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(d);

/**
 * Cron (every 5 minutes, lib/attendance-alerts.ts): someone outside the store for AWAY_ALERT_MINUTES or more
 * (not on an approved break) → bell + phone alert to the Store Manager and Admin, repeated every
 * AWAY_ALERT_MINUTES while they stay out.
 */
export async function awayTooLongAlerts(today: string, now = new Date()): Promise<number> {
  const rows: any[] = await Attendance.find({
    date: today,
    awayPeriods: { $elemMatch: { backAt: { $exists: false }, kind: { $in: ["away", "break"] } } },
  });
  const limitMs = AWAY_ALERT_MINUTES * 60000;
  let sent = 0;
  for (const r of rows) {
    const open: IAwayPeriod | undefined = openPeriod(r);
    if (!open) continue;
    // During an approved break nobody is alerted; once it is over the break-over alert takes care of it.
    if (open.kind === "break") continue;
    const outMs = now.getTime() - new Date(open.leftAt).getTime();
    if (outMs < limitMs) continue;
    if (open.lastAlertAt && now.getTime() - new Date(open.lastAlertAt).getTime() < limitMs) continue;
    open.lastAlertAt = now;
    r.markModified("awayPeriods");
    await r.save();
    const name = String(r.staffName).replace(/\s*\(.*\)\s*$/, "");
    const mins = Math.round(outMs / 60000);
    await notifyRoles(["manager", "admin", "superadmin"], {
      type: "general",
      title: `${name} is outside the store (${mins} min)`,
      message: `${name} left the store at ${label(new Date(open.leftAt))}${open.maxDistanceM ? `, about ${open.maxDistanceM} m away` : ""}, and has not come back yet.`,
      link: "/staff/directory",
      createdBy: "System",
      refType: "away-alert",
      refId: `${today}:${r._id}:${new Date(open.leftAt).getTime()}`,
    });
    sent++;
  }
  if (sent > 0) publishChange(["/api/staff/presence"]);
  return sent;
}
