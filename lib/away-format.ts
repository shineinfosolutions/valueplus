/** Display helpers for the geofence's time-outside-the-store records (Attendance.awayPeriods). Client-safe. */

export interface AwayPeriodView {
  kind: "away" | "break" | "unknown";
  leftAt: string | Date;
  backAt?: string | Date;
  minutes?: number;
  maxDistanceM?: number;
  endUncertain?: boolean;
}

export const timeIst = (d: string | Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(d));

/** Minutes from `from` until now (for a period still open). */
export const minutesSince = (from: string | Date, now = Date.now()) => Math.max(0, Math.round((now - new Date(from).getTime()) / 60000));

/** "3× · 47 min" for a day's record; "" when they never left. Breaks and app-closed time are not counted. */
export function awaySummary(rec: { awayPeriods?: AwayPeriodView[]; totalAwayMinutes?: number } | null | undefined): string {
  const away = (rec?.awayPeriods || []).filter((p) => p.kind === "away");
  if (away.length === 0) return "";
  const open = away.find((p) => !p.backAt);
  const mins = (rec?.totalAwayMinutes || 0) + (open ? minutesSince(open.leftAt) : 0);
  return `${away.length}× · ${mins} min${open ? " (out now)" : ""}`;
}

/** One line per period: "12:10 PM – 12:55 PM · 45 min · ~650 m". */
export function periodLine(p: AwayPeriodView): string {
  const end = p.backAt ? timeIst(p.backAt) : "now";
  const mins = p.backAt ? p.minutes || 0 : minutesSince(p.leftAt);
  const label = p.kind === "break" ? "on break" : p.kind === "unknown" ? "app closed, location unknown" : "outside";
  const dist = p.kind !== "unknown" && p.maxDistanceM ? ` · ~${p.maxDistanceM} m` : "";
  return `${timeIst(p.leftAt)} – ${end} · ${p.endUncertain ? "at least " : ""}${mins} min ${label}${dist}`;
}
