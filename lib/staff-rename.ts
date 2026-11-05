import Invoice from "@/models/Invoice";
import Estimate from "@/models/Estimate";
import Lead from "@/models/Lead";
import Attendance from "@/models/Attendance";
import LeaveRequest from "@/models/LeaveRequest";
import Salary from "@/models/Salary";
import StockOrderRequest from "@/models/StockOrderRequest";
import DiscountApproval from "@/models/DiscountApproval";

/**
 * Many records keep a staff member by name (a bill's Sales Executive, a lead's salesman, attendance, salary …), and
 * incentives, the leaderboard and the reports group by that name. When a staff member's name is changed (or a record
 * was saved under a misspelt name) the old records have to follow, or the same person shows twice.
 *
 * `renameStaffEverywhere("DHANAJAY PANDEY", "DHANANJAY PANDEY")` rewrites every record that has exactly the old
 * name (ignoring case and spaces at the ends). `dryRun` only counts.
 */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function renameStaffEverywhere(oldName: string, newName: string, dryRun = false): Promise<Record<string, number>> {
  const from = String(oldName || "").trim();
  const to = String(newName || "").trim();
  if (!from || !to || from === to) return {};
  const re = new RegExp(`^\\s*${esc(from)}\\s*$`, "i");
  const counts: Record<string, number> = {};

  const run = async (label: string, model: any, filter: any, update: any, options: any = {}) => {
    if (dryRun) {
      counts[label] = await model.countDocuments(filter);
      return;
    }
    try {
      const res = await model.updateMany(filter, update, { strict: false, ...options });
      counts[label] = res.modifiedCount || 0;
    } catch (e: any) {
      // Attendance is unique per name and day: a day both names have is left as it is. Any other failure is
      // reported for this kind of record only, so the rest still get the new name.
      if (e?.code !== 11000) {
        console.warn(`Notice: could not rename ${label}:`, e);
        counts[label] = -1;
        return;
      }
      let n = 0;
      const docs: any[] = await model.find(filter, { _id: 1 }).lean();
      for (const d of docs) {
        try {
          const r = await model.updateOne({ _id: d._id }, update);
          n += r.modifiedCount || 0;
        } catch (err: any) {
          if (err?.code !== 11000) throw err;
        }
      }
      counts[label] = n;
    }
  };

  await run("bills", Invoice, { salesExecutive: re }, { $set: { salesExecutive: to } });
  await run("bill lines", Invoice, { "items.salesExecutive": re }, { $set: { "items.$[l].salesExecutive": to } }, { arrayFilters: [{ "l.salesExecutive": re }] });
  await run("estimates (salesperson)", Estimate, { salesperson: re }, { $set: { salesperson: to } });
  await run("estimates (sales executive)", Estimate, { salesExecutive: re }, { $set: { salesExecutive: to } });
  await run("leads", Lead, { assignedStaff: re }, { $set: { assignedStaff: to } });
  await run("lead shares", Lead, { "sharedWith.staff": re }, { $set: { "sharedWith.$[s].staff": to } }, { arrayFilters: [{ "s.staff": re }] });
  await run("attendance", Attendance, { staffName: re }, { $set: { staffName: to } });
  await run("leave requests", LeaveRequest, { staffName: re }, { $set: { staffName: to } });
  await run("salary", Salary, { employeeName: re }, { $set: { employeeName: to } });
  await run("stock orders", StockOrderRequest, { salesperson: re }, { $set: { salesperson: to } });
  await run("discount requests", DiscountApproval, { requestedBy: re }, { $set: { requestedBy: to } });
  return counts;
}
