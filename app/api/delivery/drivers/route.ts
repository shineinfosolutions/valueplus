import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

/** Delivery staff (name, phone, vehicle) for the driver / vehicle drop-down on a bill. */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    await connectToDatabase();
    const rows: any[] = await User.find({ role: { $in: ["driver", "courier", "delivery"] } }).select("name mobile vehicleNumber").sort({ name: 1 }).lean();
    const data = rows.map((u) => ({ id: String(u._id), name: u.name || "", phone: u.mobile || "", vehicleNumber: String(u.vehicleNumber || "").toUpperCase() }));
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
