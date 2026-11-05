import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import { getActor } from "@/lib/requirePermission";
import { renameStaffEverywhere } from "@/lib/staff-rename";

export const dynamic = "force-dynamic";

/**
 * Records saved under a wrong spelling of a staff member's name (e.g. "DHANAJAY PANDEY") are moved to that staff
 * member's real name, so they stop showing as a second person in incentives and the leaderboard.
 *
 * GET  ?wrongName=…&userId=…  -> how many records would change (Admin / Store Manager)
 * POST { wrongName, userId }  -> changes them (Admin only)
 */
async function target(userId: any) {
  if (!mongoose.isValidObjectId(userId)) return null;
  return (await User.findById(userId, { name: 1 }).lean()) as any;
}

export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor || !["admin", "superadmin", "manager"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin or Store Manager can see this." }, { status: 403 });
    }
    const url = new URL(req.url);
    await connectToDatabase();
    const user = await target(url.searchParams.get("userId"));
    if (!user) return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
    const counts = await renameStaffEverywhere(String(url.searchParams.get("wrongName") || ""), user.name, true);
    return NextResponse.json({ success: true, data: { to: user.name, counts } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor || !["admin", "superadmin"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin can do this." }, { status: 403 });
    }
    const body = await req.json();
    await connectToDatabase();
    const user = await target(body.userId);
    if (!user) return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
    const wrong = String(body.wrongName || "").trim();
    if (!wrong || wrong.toLowerCase() === String(user.name).trim().toLowerCase()) {
      return NextResponse.json({ success: false, error: "Write the wrong spelling to fix." }, { status: 400 });
    }
    // Never fold one real staff member into another.
    const clash = await User.findOne({ name: new RegExp(`^\\s*${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i") }, { _id: 1 }).lean();
    if (clash) return NextResponse.json({ success: false, error: `"${wrong}" is another staff member's name.` }, { status: 400 });
    const counts = await renameStaffEverywhere(wrong, user.name);
    return NextResponse.json({ success: true, data: { to: user.name, counts } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
