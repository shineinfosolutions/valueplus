import connectToDatabase from "@/lib/db";
import ScheduledRun from "@/models/ScheduledRun";
import { notifyRoles } from "@/lib/notify";

/** Everyone who works at the store (not the Admin, not outside suppliers). */
const STAFF_ROLES = ["salesman", "sales", "cashier", "manager", "warehouse", "accounts", "hr", "driver"];

const istParts = (d = new Date()) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
};

/**
 * "Office time has started" for all staff, once a day at 10:00 (India time).
 * The Cloudflare cron (worker.ts) calls this at 10:00. As a back-up it is also tried when someone's
 * app asks for notifications between 10:00 and 12:00, so a missed cron still sends it; the day's row
 * in `scheduled_runs` makes sure it only ever goes once.
 */
export async function sendOfficeStartReminder(options: { fromCron?: boolean } = {}): Promise<{ sent: boolean; reason?: string }> {
  try {
    await connectToDatabase();
    const now = istParts();
    if (!options.fromCron && !(now.hour >= 10 && now.hour < 12)) return { sent: false, reason: "outside the 10:00-12:00 window" };

    // Claim today's slot: the first caller inserts the row (and goes on to send); anyone later finds it there.
    const earlier = await ScheduledRun.findOneAndUpdate(
      { key: `office-start:${now.day}` },
      { $setOnInsert: { ranAt: new Date() } },
      { upsert: true, new: false }
    );
    if (earlier) return { sent: false, reason: "already sent today" };
    const count = await notifyRoles(STAFF_ROLES, {
      type: "general",
      title: "Office time has started",
      message: "It is 10:00 AM. Please check in and start your day.",
      link: "/dashboard",
      createdBy: "System",
    });
    return { sent: count > 0, reason: count > 0 ? undefined : "no staff to notify" };
  } catch (e) {
    console.warn("Notice: office-start reminder failed:", e);
    return { sent: false, reason: "error" };
  }
}
