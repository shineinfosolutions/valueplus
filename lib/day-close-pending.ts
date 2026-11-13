import { istToday } from "@/lib/ist";
import { readStock } from "@/lib/repo/stock/shadow-read";

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
  // Today in India: on the UTC server, between midnight and 05:30 IST the UTC date is still yesterday, so the day
  // that just ended could not be closed (and the Sales / Cash lock waited until 05:30).
  const todayStr = istToday();
  const yesterdayStr = addDays(todayStr, -1);

  // Through the read:stock switch (lib/repo/stock/shadow-read.ts): the latest close's date.
  const latest: any = await readStock("dayCloses.latestDate", {});
  if (!latest) return yesterdayStr;
  if (latest.date >= yesterdayStr) return null;
  return addDays(latest.date, 1);
}
