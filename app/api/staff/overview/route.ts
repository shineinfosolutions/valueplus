import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import Lead from "@/models/Lead";
import StaffTask from "@/models/StaffTask";
import IncentivePayout from "@/models/IncentivePayout";
import { getActor } from "@/lib/requirePermission";
import { loadIncentiveBook, normName, summarise } from "@/lib/staff-incentive";

export const dynamic = "force-dynamic";

const VIEW_ROLES = ["admin", "superadmin", "manager"];

/**
 * Staff Directory (Admin and Store Manager).
 *   GET            -> every staff member with incentive earned / received / balance
 *   GET ?id=<user> -> one person's full data: profile, incentive, payouts, bills, leads, tasks
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!VIEW_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin or Store Manager can see the staff directory." }, { status: 403 });
    }
    await connectToDatabase();
    const id = new URL(req.url).searchParams.get("id");
    const book = await loadIncentiveBook();

    if (!id) {
      const users: any[] = await User.find({ role: { $nin: ["supplier", "vendor"] } })
        .select("name email role mobile designation status joiningDate assignedBrand")
        .sort({ name: 1 })
        .lean();
      const data = users.map((u) => {
        const inc = summarise(book, String(u._id), u.name);
        return {
          _id: String(u._id),
          name: u.name,
          email: u.email,
          role: u.role,
          mobile: u.mobile || "",
          designation: u.designation || "",
          status: u.status || "active",
          assignedBrand: u.assignedBrand || "",
          bills: book.billCount.get(normName(u.name)) || 0,
          ...inc,
        };
      });
      return NextResponse.json({ success: true, data });
    }

    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 400 });
    const user: any = await User.findById(id).select("name email role mobile designation status joiningDate assignedBrand address").lean();
    if (!user) return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });

    const k = normName(user.name);
    const bills = (book.bills.get(k) || []).slice(0, 100);
    const allBills = book.bills.get(k) || [];
    const month = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
    const monthBills = allBills.filter((b) => b.date.slice(0, 7) === month);

    const leads: any[] = await Lead.find({}, { customerName: 1, status: 1, assignedStaff: 1, estimatedValue: 1 }).lean();
    const myLeads = leads.filter((l) => normName(l.assignedStaff) === k);
    const tasks: any[] = await StaffTask.find({}, { assignedStaff: 1, assignedStaffId: 1, status: 1 }).lean();
    const myTasks = tasks.filter((t) => String(t.assignedStaffId || "") === String(user._id) || normName(t.assignedStaff) === k);

    const payouts = await IncentivePayout.find({ userId: String(user._id) }).sort({ date: -1, createdAt: -1 }).limit(200).lean();
    const sum = (list: any[], f: (x: any) => number) => list.reduce((t, x) => t + f(x), 0);

    return NextResponse.json({
      success: true,
      data: {
        profile: {
          _id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
          mobile: user.mobile || "",
          designation: user.designation || "",
          status: user.status || "active",
          assignedBrand: user.assignedBrand || "",
          joiningDate: user.joiningDate || "",
          address: user.address || "",
        },
        incentive: summarise(book, String(user._id), user.name),
        payouts,
        bills,
        sales: {
          billsAllTime: allBills.length,
          revenueAllTime: Math.round(sum(allBills, (b) => b.total)),
          billsThisMonth: monthBills.length,
          revenueThisMonth: Math.round(sum(monthBills, (b) => b.total)),
        },
        leads: {
          total: myLeads.length,
          open: myLeads.filter((l) => !["Converted", "Lost"].includes(l.status)).length,
          converted: myLeads.filter((l) => l.status === "Converted").length,
          lost: myLeads.filter((l) => l.status === "Lost").length,
        },
        tasks: {
          total: myTasks.length,
          completed: myTasks.filter((t) => t.status === "Completed").length,
          pending: myTasks.filter((t) => t.status !== "Completed").length,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
