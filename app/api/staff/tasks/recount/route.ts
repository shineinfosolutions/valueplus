import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StaffTask from "@/models/StaffTask";
import Invoice from "@/models/Invoice";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { billCountsForTarget, billIsForAssignee } from "@/lib/target-progress";

export const dynamic = "force-dynamic";

const RECOUNT_ROLES = ["admin", "superadmin", "manager", "hr"];

/**
 * "Recount from date" for a Sales Target task. Body: { id, from: "YYYY-MM-DD" }
 *
 * Counts again, from scratch, every tax invoice of the task's salesman dated `from` up to the task's due date
 * (cancelled bills and credit notes are not counted), with the same rules as the live count
 * (lib/target-progress.ts). The units / amount are replaced, the status follows (Completed when every set target is
 * met), and the run is written to the audit log. New bills keep adding to it as before.
 *
 * Reads bills from MongoDB directly: the result is written back, so it must not come from the D1 copy.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!RECOUNT_ROLES.includes(String(actor.role || "").toLowerCase())) {
      return NextResponse.json({ success: false, error: "Only the Admin, Manager or HR can recount a target." }, { status: 403 });
    }
    const body = await req.json();
    const from = String(body.from || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return NextResponse.json({ success: false, error: "Choose the date to count from." }, { status: 400 });
    }
    await connectToDatabase();
    const task: any = await StaffTask.findById(String(body.id || "")).catch(() => null);
    if (!task) return NextResponse.json({ success: false, error: "Task not found." }, { status: 404 });
    if (task.taskType !== "sales_target") {
      return NextResponse.json({ success: false, error: "Only a Sales Target task can be recounted." }, { status: 400 });
    }
    const to = String(task.dueDate || "");
    if (to && from > to) {
      return NextResponse.json({ success: false, error: `The date must be on or before the due date (${to}).` }, { status: 400 });
    }

    const bills: any[] = await Invoice.find(
      {
        type: "tax-invoice",
        status: { $ne: "cancelled" },
        date: to ? { $gte: from, $lte: to } : { $gte: from },
      },
      { invoiceNumber: 1, date: 1, salesExecutive: 1, items: 1, total: 1, netAmount: 1 }
    )
      .sort({ date: 1, createdAt: 1 })
      .lean();

    let qty = 0;
    let amount = 0;
    let lastBill = "";
    let billCount = 0;
    for (const bill of bills) {
      if (!billIsForAssignee(bill.salesExecutive, task.assignedStaff)) continue;
      const c = billCountsForTarget(task, bill);
      if (!c.matched) continue;
      // Same as the live count: a matched bill adds at least one unit.
      qty += c.qty || 1;
      amount += c.amount;
      lastBill = bill.invoiceNumber;
      billCount++;
    }
    amount = Math.round(amount * 100) / 100;

    const before = { currentQty: Number(task.currentQty) || 0, currentAmount: Number(task.currentAmount) || 0, status: task.status };
    task.currentQty = qty;
    task.currentAmount = amount;
    task.countFrom = from;
    task.recountedAt = new Date();
    task.recountedBy = actor.name;
    if (lastBill) task.linkedInvoiceNumber = lastBill;
    const qtyMet = task.targetQty ? qty >= task.targetQty : true;
    const amountMet = task.targetAmount ? amount >= task.targetAmount : true;
    if (billCount > 0 && qtyMet && amountMet) {
      if (task.status !== "Completed") {
        task.status = "Completed";
        task.completedAt = new Date();
        task.completionRemarks = `Completed on recount from ${from} (${billCount} bills)`;
      }
    } else if (task.status !== "Overdue") {
      task.status = billCount > 0 ? "In Progress" : "Pending";
      task.completedAt = undefined;
    }
    await task.save();

    try {
      await AuditLog.create({
        action: "task.target.recount",
        entityType: "StaffTask",
        entityRef: `${task.taskTitle} (${task.assignedStaff})`,
        entityId: String(task._id),
        amount,
        reason: `Target recounted from ${from}${to ? ` to ${to}` : ""}: ${qty} units, ₹${amount.toLocaleString("en-IN")} from ${billCount} bills`,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        pinVerified: false,
        metadata: { from, to, before, after: { currentQty: qty, currentAmount: amount, status: task.status }, bills: billCount },
      });
    } catch (e) {
      console.warn("Notice: audit log for target recount:", e);
    }

    return NextResponse.json({
      success: true,
      data: task,
      message: `Recounted from ${from}: ${qty} units, ₹${amount.toLocaleString("en-IN")} (${billCount} bills).`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
