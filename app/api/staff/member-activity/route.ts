import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import Attendance from "@/models/Attendance";
import LeaveRequest from "@/models/LeaveRequest";
import { getActor } from "@/lib/requirePermission";
import { normName } from "@/lib/staff-incentive";

export const dynamic = "force-dynamic";

const VIEW_ROLES = ["admin", "superadmin", "manager", "hr"];

/**
 * One staff member's attendance and time off for a month (Admin, Store Manager, HR).
 *   GET ?id=<user>&month=YYYY-MM -> profile, attendance days (with the selfie id), leave / weekly off / emergency / breaks
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!VIEW_ROLES.includes(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin, Store Manager or HR can see this." }, { status: 403 });
    const url = new URL(req.url);
    const id = url.searchParams.get("id") || "";
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? String(url.searchParams.get("month")) : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()).slice(0, 7);
    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 400 });
    await connectToDatabase();
    const user: any = await User.findById(id).select("name email role mobile designation status joiningDate assignedBrand address").lean();
    if (!user) return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });

    const from = `${month}-01`;
    const to = `${month}-31`;
    const key = normName(user.name);
    const attAll: any[] = await Attendance.find({ date: { $gte: from, $lte: to } }).sort({ date: -1 }).lean();
    const attendance = attAll
      .filter((a) => String(a.userId || a.staffId || "") === String(user._id) || normName(a.staffName) === key)
      .map((a) => ({
        _id: String(a._id),
        date: a.date,
        status: a.status,
        checkInTime: a.checkInTime,
        checkOutTime: a.checkOutTime,
        workingDurationMinutes: a.workingDurationMinutes || 0,
        lateMinutes: a.lateMinutes || 0,
        isLate: !!a.isLate,
        leaveType: a.leaveType,
        hasPhoto: !!a.checkInPhotoKey,
        distanceM: a.checkInDistanceM ?? null,
        notes: a.notes || "",
      }));

    const reqAll: any[] = await LeaveRequest.find({ fromDate: { $lte: to }, toDate: { $gte: from }, $or: [{ staffId: String(user._id) }, { staffName: user.name }] }).sort({ fromDate: -1 }).lean();
    const timeOff = reqAll.filter((r) => r.status !== "cancelled");

    const count = (f: (a: any) => boolean) => attendance.filter(f).length;
    const summary = {
      present: count((a) => ["Present", "Late", "Half-Day"].includes(a.status)),
      late: count((a) => a.isLate),
      lateMinutes: attendance.reduce((t, a) => t + (a.lateMinutes || 0), 0),
      halfDay: count((a) => a.status === "Half-Day"),
      absent: count((a) => a.status === "Absent"),
      onLeave: count((a) => a.status === "On Leave"),
    };
    return NextResponse.json({
      success: true,
      data: {
        month,
        profile: {
          _id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
          mobile: user.mobile || "",
          designation: user.designation || "",
          status: user.status || "active",
          joiningDate: user.joiningDate || null,
          assignedBrand: user.assignedBrand || "",
          address: user.address || "",
        },
        summary,
        attendance,
        timeOff,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
