import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import LeaveRequest from "@/models/LeaveRequest";
import { getActor } from "@/lib/requirePermission";
import { checkAtStore } from "@/lib/store-location";
import { notifyRoles } from "@/lib/notify";

export const dynamic = "force-dynamic";

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/**
 * The person's own approved break for today.
 * Body: { id, action: "start" | "return", lat?, lng?, accuracy? }
 *  start  -> the break begins now and ends after its minutes (the person may be anywhere meanwhile)
 *  return -> "I am back": only accepted from inside the store (checked from the phone's location)
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const body = await req.json();
    await connectToDatabase();
    const doc: any = await LeaveRequest.findById(String(body.id || "")).catch(() => null);
    if (!doc || doc.kind !== "break") return NextResponse.json({ success: false, error: "Break not found." }, { status: 404 });
    if (doc.staffId !== actor.id && doc.staffName !== actor.name) return NextResponse.json({ success: false, error: "This is not your break." }, { status: 403 });
    if (doc.status !== "approved") return NextResponse.json({ success: false, error: "This break is not approved." }, { status: 409 });
    if (doc.fromDate !== todayIst()) return NextResponse.json({ success: false, error: "This break was for another day." }, { status: 409 });

    if (body.action === "start") {
      if (doc.breakStartedAt) return NextResponse.json({ success: false, error: "This break has already started." }, { status: 409 });
      const now = new Date();
      doc.breakStartedAt = now;
      doc.breakEndsAt = new Date(now.getTime() + (Number(doc.breakMinutes) || 10) * 60000);
      await doc.save();
      await notifyRoles(["manager", "admin", "superadmin"], {
        type: "general",
        title: `Break started: ${doc.staffName}`,
        message: `${doc.breakMinutes} minute break, ends at ${doc.breakEndsAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}.`,
        link: "/staff/directory",
        createdBy: doc.staffName,
      }, actor.id);
      return NextResponse.json({ success: true, data: doc, message: `Break started. Be back at the store in ${doc.breakMinutes} minutes.` });
    }

    if (body.action === "return") {
      if (!doc.breakStartedAt) return NextResponse.json({ success: false, error: "The break has not started." }, { status: 409 });
      if (doc.breakReturnedAt) return NextResponse.json({ success: true, data: doc, message: "You are already marked back." });
      const at = checkAtStore(body);
      if (!at.ok) return NextResponse.json({ success: false, error: at.error }, { status: 400 });
      doc.breakReturnedAt = new Date();
      await doc.save();
      return NextResponse.json({ success: true, data: doc, message: "Welcome back. Break closed." });
    }
    return NextResponse.json({ success: false, error: "Choose start or return." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
