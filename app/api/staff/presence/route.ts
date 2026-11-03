import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Attendance from "@/models/Attendance";
import { getActor } from "@/lib/requirePermission";
import { recordPresence } from "@/lib/presence";
import { GEOFENCE_ROLES } from "@/lib/store-location";
import { todayInIndia } from "@/lib/today";

export const dynamic = "force-dynamic";

/** Who may see everyone's time outside the store. */
const VIEW_ROLES = ["admin", "superadmin", "manager", "hr"];

/**
 * POST: the signed-in person's phone reports a position (GeofenceWatcher) — when it crosses the store
 * boundary, or when the app comes back after being closed. The name always comes from the login.
 * Body: { event: "move" | "resume", lat, lng, accuracy, hiddenMs? }
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const skip = { headers: { "x-realtime-skip": "1" } };
    if (!GEOFENCE_ROLES.includes(actor.role)) return NextResponse.json({ success: true, data: { tracking: false, reason: "role not tracked" } }, skip);

    const body = await req.json().catch(() => ({}));
    const event = body?.event === "resume" ? "resume" : "move";

    await connectToDatabase();
    const record = await Attendance.findOne({ staffName: actor.name, date: todayInIndia() });
    if (!record) return NextResponse.json({ success: true, data: { tracking: false, reason: "not checked in" } }, skip);

    const result = await recordPresence(record, {
      event,
      lat: Number(body.lat),
      lng: Number(body.lng),
      accuracy: body.accuracy == null ? undefined : Number(body.accuracy),
      hiddenMs: Number(body.hiddenMs) || 0,
    });
    // Only a change in someone's in/out is announced to the open apps (worker.ts reads this header).
    const changed = result.tracking && result.changed;
    return NextResponse.json({ success: true, data: result }, changed ? undefined : skip);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * GET ?date=YYYY-MM-DD&staff=<name>: each person's time outside the store that day (Admin / Manager / HR).
 * `outsideNow` lists the people outside at this moment.
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!VIEW_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin, Store Manager or HR can see this." }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || todayInIndia();
    const staff = searchParams.get("staff");

    await connectToDatabase();
    const filter: any = { date };
    if (staff) filter.staffName = staff;
    const rows: any[] = await Attendance.find(filter)
      .select("staffName staffRole date checkInTime checkOutTime awayPeriods totalAwayMinutes unknownMinutes lastPresence")
      .sort({ staffName: 1 })
      .lean();

    const outsideNow = rows
      .map((r) => {
        const open = (r.awayPeriods || []).find((p: any) => !p.backAt && p.kind !== "unknown");
        return open ? { staffName: r.staffName, staffRole: r.staffRole, kind: open.kind, leftAt: open.leftAt, maxDistanceM: open.maxDistanceM, breakEndsAt: open.breakEndsAt } : null;
      })
      .filter(Boolean);

    return NextResponse.json({ success: true, data: { date, rows, outsideNow } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
