import DayClose from "@/models/DayClose";

/**
 * The earliest past business day with no DayClose record yet, or null if everything up to
 * yesterday is already closed — the same rule as getPendingDate in app/api/day-close/route.ts
 * (kept identical; that route can import this one).
 *
 * Here so GET /api/me/summary can tell the DayCloseGate whether a count is pending without
 * also loading the 60-day history and the pending day's cash summary that GET /api/day-close
 * sends for the banking page.
 */
const toDateStr = (d: Date) => d.toISOString().split("T")[0];
const addDays = (dateStr: string, days: number) => {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
};

export async function getPendingDayCloseDate(): Promise<string | null> {
  const todayStr = toDateStr(new Date());
  const yesterdayStr = addDays(todayStr, -1);

  const latest: any = await DayClose.findOne({}, { date: 1 }).sort({ date: -1 }).lean();
  if (!latest) return yesterdayStr;
  if (latest.date >= yesterdayStr) return null;
  return addDays(latest.date, 1);
}
