import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import LeaveRequest from "@/models/LeaveRequest";
import Attendance from "@/models/Attendance";
import { getActor } from "@/lib/requirePermission";
import { notifyRoles, notifyAssignee } from "@/lib/notify";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { weekly_off: "Weekly off", leave: "Leave", break: "Break", emergency: "Emergency leave" };
const ADMINS = ["admin", "superadmin"];
const MANAGERS = ["manager"];
const VIEWERS = [...ADMINS, ...MANAGERS, "hr"];
const MAX_LEAVE_DAYS = 60;

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());
const addDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
/** Monday of the week a date falls in. */
const weekStart = (d: string) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));

/** Who may decide a request of this kind: a break goes to the Store Manager (Admin too); leave and emergency leave to the Admin. */
const canDecide = (role: string, kind: string) => (kind === "break" ? [...MANAGERS, ...ADMINS] : ADMINS).includes(role);

const describe = (r: any) =>
  r.kind === "break"
    ? `${r.breakMinutes} min break on ${r.fromDate}`
    : r.fromDate === r.toDate
      ? `${r.fromDate}`
      : `${r.fromDate} to ${r.toDate} (${r.days} days)`;

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "";
    const mine = url.searchParams.get("mine") === "1";
    await connectToDatabase();
    const query: any = {};
    if (status) query.status = status;
    if (mine || !VIEWERS.includes(actor.role)) {
      query.$or = [{ staffId: actor.id }, { staffName: actor.name }];
    } else if (url.searchParams.get("decidable") === "1") {
      query.kind = { $in: ["break", "leave", "emergency", "weekly_off"].filter((k) => canDecide(actor.role, k)) };
    }
    const rows = await LeaveRequest.find(query).sort({ createdAt: -1 }).limit(1000).lean();
    return NextResponse.json({ success: true, data: rows, role: actor.role });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    const kind = String(body.kind || "");
    if (!KIND_LABEL[kind]) return NextResponse.json({ success: false, error: "Choose Weekly Off, Leave, Break or Emergency Leave." }, { status: 400 });
    const today = todayIst();
    const reason = String(body.reason || "").trim().slice(0, 500);
    let fromDate = String(body.fromDate || "");
    let toDate = String(body.toDate || fromDate);
    let breakMinutes: number | undefined;

    await connectToDatabase();

    if (kind === "break") {
      breakMinutes = Number(body.breakMinutes);
      if (![10, 20, 30].includes(breakMinutes)) return NextResponse.json({ success: false, error: "A break can be 10, 20 or 30 minutes." }, { status: 400 });
      fromDate = toDate = today;
      const open = await LeaveRequest.findOne({ kind: "break", status: "pending", $or: [{ staffId: actor.id }, { staffName: actor.name }] });
      if (open) return NextResponse.json({ success: false, error: "Your earlier break request is still waiting for approval." }, { status: 409 });
    } else {
      if (!isDate(fromDate) || !isDate(toDate)) return NextResponse.json({ success: false, error: "Choose the date(s) from the calendar." }, { status: 400 });
      if (kind === "weekly_off") toDate = fromDate;
      if (fromDate < today) return NextResponse.json({ success: false, error: "Past dates cannot be applied for." }, { status: 400 });
      if (toDate < fromDate) return NextResponse.json({ success: false, error: "The last day cannot be before the first day." }, { status: 400 });
      if (diffDays(fromDate, toDate) + 1 > MAX_LEAVE_DAYS) return NextResponse.json({ success: false, error: `At most ${MAX_LEAVE_DAYS} days at a time.` }, { status: 400 });
      if ((kind === "leave" || kind === "emergency") && reason.length < 5) {
        return NextResponse.json({ success: false, error: "Write the reason for the leave." }, { status: 400 });
      }
    }
    const days = kind === "break" ? 0 : diffDays(fromDate, toDate) + 1;
    const mineQuery = { $or: [{ staffId: actor.id }, { staffName: actor.name }], status: { $in: ["pending", "approved"] } };

    if (kind !== "break") {
      const clash: any = await LeaveRequest.findOne({ ...mineQuery, kind: { $ne: "break" }, fromDate: { $lte: toDate }, toDate: { $gte: fromDate } });
      if (clash) {
        return NextResponse.json({ success: false, error: `You already have a ${KIND_LABEL[clash.kind].toLowerCase()} request for ${describe(clash)}.` }, { status: 409 });
      }
    }
    if (kind === "weekly_off") {
      // One weekly off in a week (Monday to Sunday); after that only a Leave.
      const ws = weekStart(fromDate);
      const we = addDays(ws, 6);
      const used: any = await LeaveRequest.findOne({ ...mineQuery, kind: "weekly_off", fromDate: { $gte: ws, $lte: we } });
      if (used) {
        return NextResponse.json(
          { success: false, error: `You already have your weekly off this week (${used.fromDate}). Apply for a Leave instead.` },
          { status: 409 }
        );
      }
    }

    // A weekly off is allowed straight away (the Admin and Manager are told); the others wait for a decision.
    // A Store Manager's weekly off also waits for the Admin.
    const autoApprove = kind === "weekly_off" && actor.role !== "manager";
    const doc: any = await LeaveRequest.create({
      kind,
      staffName: actor.name,
      staffId: actor.id,
      staffRole: actor.role,
      fromDate,
      toDate,
      days,
      breakMinutes,
      reason,
      status: autoApprove ? "approved" : "pending",
      reviewedBy: autoApprove ? "Automatic" : "",
      reviewedAt: autoApprove ? new Date() : undefined,
    });
    if (autoApprove) await markAttendance(doc);

    const people = kind === "break" ? [...MANAGERS, ...ADMINS] : [...ADMINS, ...MANAGERS];
    await notifyRoles(
      people,
      {
        type: autoApprove ? "general" : "approval_request",
        title: `${KIND_LABEL[kind]}: ${actor.name}`,
        message: `${describe(doc)}${reason ? ` - ${reason}` : ""}${autoApprove ? " (weekly off, approved automatically)" : " - waiting for approval"}`,
        link: "/staff/leave-requests",
        createdBy: actor.name,
      },
      actor.id
    );
    return NextResponse.json({
      success: true,
      data: doc,
      message: autoApprove ? "Your weekly off is booked." : kind === "break" ? "Break request sent to the Store Manager." : "Request sent for approval.",
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Approve / reject (the person who decides) or cancel (the requester, while pending). Body: { id, decision, note? } */
export async function PATCH(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    const decision = String(body.decision || "");
    await connectToDatabase();
    const doc: any = await LeaveRequest.findById(String(body.id || "")).catch(() => null);
    if (!doc) return NextResponse.json({ success: false, error: "Request not found." }, { status: 404 });

    if (decision === "cancel") {
      const own = doc.staffId === actor.id || doc.staffName === actor.name;
      if (!own) return NextResponse.json({ success: false, error: "Only the person who applied can cancel it." }, { status: 403 });
      if (doc.status !== "pending") return NextResponse.json({ success: false, error: "Only a request that is still waiting can be cancelled." }, { status: 409 });
      doc.status = "cancelled";
      await doc.save();
      return NextResponse.json({ success: true, data: doc, message: "Request cancelled." });
    }
    if (decision !== "approve" && decision !== "reject") return NextResponse.json({ success: false, error: "Choose approve or reject." }, { status: 400 });
    if (!canDecide(actor.role, doc.kind)) {
      return NextResponse.json(
        { success: false, error: doc.kind === "break" ? "Only the Store Manager or Admin can decide a break." : "Only the Admin can decide a leave." },
        { status: 403 }
      );
    }
    if (doc.status !== "pending") return NextResponse.json({ success: false, error: `This request is already ${doc.status}.` }, { status: 409 });
    if (doc.staffId && doc.staffId === actor.id) return NextResponse.json({ success: false, error: "You cannot decide your own request." }, { status: 403 });

    doc.status = decision === "approve" ? "approved" : "rejected";
    doc.reviewedBy = actor.name;
    doc.reviewedAt = new Date();
    doc.reviewNote = String(body.note || "").trim().slice(0, 300);
    await doc.save();
    if (doc.status === "approved") await markAttendance(doc);

    await notifyAssignee(doc.staffName, doc.staffId, {
      type: "approval_result",
      title: `${KIND_LABEL[doc.kind]} ${doc.status}`,
      message: `${describe(doc)} was ${doc.status} by ${actor.name}${doc.reviewNote ? ` - ${doc.reviewNote}` : ""}`,
      link: "/staff/leave-requests",
      createdBy: actor.name,
    });
    return NextResponse.json({ success: true, data: doc, message: `Request ${doc.status}.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Approved days off show on the attendance sheet as "On Leave" (a day the person already punched in on stays as it is). */
async function markAttendance(doc: any) {
  if (doc.kind === "break") return;
  const leaveType = doc.kind === "weekly_off" ? "Weekly Off" : doc.kind === "emergency" ? "Emergency" : "Casual";
  for (let i = 0; i < doc.days; i++) {
    const date = addDays(doc.fromDate, i);
    const have: any = await Attendance.findOne({ staffName: doc.staffName, date });
    if (have) {
      if (have.checkInTime && have.checkInTime !== "--") continue;
      have.status = "On Leave";
      have.leaveType = leaveType;
      have.leaveStatus = "Approved";
      have.leaveReason = doc.reason || KIND_LABEL[doc.kind];
      await have.save();
    } else {
      await Attendance.create({
        staffName: doc.staffName,
        staffId: doc.staffId,
        staffRole: doc.staffRole || "salesman",
        userId: doc.staffId,
        date,
        checkInTime: "--",
        checkOutTime: "--",
        workingDurationMinutes: 0,
        status: "On Leave",
        leaveType,
        leaveStatus: "Approved",
        leaveReason: doc.reason || KIND_LABEL[doc.kind],
      });
    }
  }
}
