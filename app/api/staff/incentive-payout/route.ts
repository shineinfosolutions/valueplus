import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import IncentivePayout from "@/models/IncentivePayout";
import AuditLog from "@/models/AuditLog";
import Expense from "@/models/Expense";
import { getActor } from "@/lib/requirePermission";
import { loadIncentiveBook, summarise } from "@/lib/staff-incentive";
import { notifyAssignee } from "@/lib/notify";

const istDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** Record an incentive payment to a staff member. Admin only; never more than what is still to be paid. */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (actor.role !== "admin" && actor.role !== "superadmin") {
      return NextResponse.json({ success: false, error: "Only the Admin can record an incentive payment." }, { status: 403 });
    }
    const body = await req.json();
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!mongoose.isValidObjectId(body.userId) || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: "Choose the staff member and enter an amount greater than 0." }, { status: 400 });
    }
    const date = String(body.date || istDay()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > istDay()) {
      return NextResponse.json({ success: false, error: "The date cannot be in the future." }, { status: 400 });
    }
    await connectToDatabase();
    const user: any = await User.findById(body.userId).select("name").lean();
    if (!user) return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });

    const book = await loadIncentiveBook();
    const s = summarise(book, String(user._id), user.name);
    if (amount > s.balance + 0.005) {
      return NextResponse.json(
        { success: false, error: `Only ₹${s.balance.toLocaleString("en-IN")} of incentive is left to pay to ${user.name}.` },
        { status: 400 }
      );
    }

    const payout = await IncentivePayout.create({
      userId: String(user._id),
      employeeName: user.name,
      amount,
      date,
      paymentMode: String(body.paymentMode || "Cash").slice(0, 40),
      note: String(body.note || "").trim().slice(0, 300),
      paidBy: actor.name,
      paidByUserId: actor.id,
    });
    // The payout is a company expense under the "Incentive" head (Expenses page, P&L, cash out when paid in cash).
    let expenseNo = "";
    try {
      expenseNo = `EXP-INC-${String(payout._id).slice(-8).toUpperCase()}`;
      await Expense.create({
        expenseNo,
        category: "Incentive",
        description: `Incentive paid to ${user.name}${payout.note ? ` — ${payout.note}` : ""}`,
        amount,
        date,
        paymentMode: payout.paymentMode || "Cash",
        status: "paid",
      });
    } catch (e) {
      expenseNo = "";
      console.warn("Notice: could not add the incentive payout as an expense:", e);
    }
    try {
      await AuditLog.create({
        action: "incentive.payout",
        entityType: "IncentivePayout",
        entityRef: user.name,
        entityId: String(payout._id),
        partyName: user.name,
        amount,
        reason: `Incentive ₹${amount} paid to ${user.name}`,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        metadata: { date, mode: payout.paymentMode, balanceBefore: s.balance, expenseNo },
      });
    } catch (e) {
      console.warn("Notice: audit log for incentive payout:", e);
    }
    await notifyAssignee(user.name, String(user._id), {
      type: "general",
      title: "Incentive paid",
      message: `₹${amount.toLocaleString("en-IN")} incentive was paid to you (${payout.paymentMode}).`,
      link: "/dashboard",
      createdBy: actor.name,
    });
    return NextResponse.json({ success: true, data: payout, expenseNo });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
