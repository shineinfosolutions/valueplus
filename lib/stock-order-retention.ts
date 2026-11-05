import StockOrderRequest from "@/models/StockOrderRequest";
import ScheduledRun from "@/models/ScheduledRun";
import { notifyRoles } from "@/lib/notify";
import { todayInIndia } from "@/lib/today";

/** GIDA warehouse orders are kept for this many days, then deleted (whatever their status). */
export const STOCK_ORDER_KEEP_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

/** The day an order is cleared: its creation + 7 days. */
export const clearsOn = (createdAt: any) => new Date(new Date(createdAt).getTime() + STOCK_ORDER_KEEP_DAYS * DAY_MS);

/**
 * Once a day (called from the 10:00 cron):
 *  - orders older than 7 days are deleted;
 *  - if requests are still waiting, the Admin (and Store Manager) are reminded to approve or reject them, with the
 *    day each one will be cleared.
 * Runs at most once per day, however often it is triggered.
 */
export async function runStockOrderHousekeeping(): Promise<{ ran: boolean; deleted?: number; pending?: number }> {
  const key = `stock-orders-daily:${todayInIndia()}`;
  const earlier = await ScheduledRun.findOneAndUpdate({ key }, { $setOnInsert: { ranAt: new Date() } }, { upsert: true, new: false });
  if (earlier) return { ran: false };

  const cutoff = new Date(Date.now() - STOCK_ORDER_KEEP_DAYS * DAY_MS);
  const del = await StockOrderRequest.deleteMany({ createdAt: { $lt: cutoff } });

  const pending: any[] = await StockOrderRequest.find({ status: "pending" }, { requestNumber: 1, salesperson: 1, createdAt: 1 })
    .sort({ createdAt: 1 })
    .lean();
  if (pending.length > 0) {
    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    const list = pending
      .slice(0, 8)
      .map((p) => `${p.requestNumber} (${p.salesperson}, cleared ${fmt(clearsOn(p.createdAt))})`)
      .join(", ");
    await notifyRoles(["admin", "superadmin", "manager"], {
      type: "approval_request",
      title: `${pending.length} GIDA order${pending.length === 1 ? "" : "s"} waiting`,
      message: `Approve or reject: ${list}${pending.length > 8 ? ` and ${pending.length - 8} more` : ""}. Orders are cleared ${STOCK_ORDER_KEEP_DAYS} days after they are placed.`,
      link: "/sales/new-stock?tab=requests",
      createdBy: "System",
    });
  }
  return { ran: true, deleted: del.deletedCount || 0, pending: pending.length };
}
