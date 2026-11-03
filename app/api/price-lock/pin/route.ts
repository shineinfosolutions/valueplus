import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import PriceUnlockSetting from "@/models/PriceUnlockSetting";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { isUnlockPinSet, setUnlockPin } from "@/lib/priceLock";

/** Whether a price-unlock PIN exists (never the PIN itself). */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    const isSet = await isUnlockPinSet();
    let updatedAt = null;
    let updatedBy = "";
    if (actor.role === "admin" || actor.role === "superadmin") {
      const doc: any = await PriceUnlockSetting.findOne({ key: "price-unlock" }).lean();
      updatedAt = doc?.updatedAt || null;
      updatedBy = doc?.updatedBy || "";
    }
    return NextResponse.json({ success: true, data: { isSet, updatedAt, updatedBy } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Set or change the price-unlock PIN. Admin only, and the admin's account password is asked each time. */
export async function PUT(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "Not signed in" }, { status: 401 });
    if (actor.role !== "admin" && actor.role !== "superadmin") {
      return NextResponse.json({ success: false, error: "Only the Admin can set the price unlock PIN." }, { status: 403 });
    }

    const body = await req.json();
    await connectToDatabase();
    const admin = await User.findById(actor.id).select("+password");
    const passwordOk = admin?.password ? await bcrypt.compare(String(body.password || ""), admin.password) : false;
    if (!passwordOk) {
      return NextResponse.json({ success: false, error: "Enter your account password to change the price unlock PIN." }, { status: 400 });
    }

    const result = await setUnlockPin(body.newPin, actor.name);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });

    try {
      await AuditLog.create({
        action: "pricelock.pin.set",
        entityType: "PriceUnlockPin",
        entityRef: "price-unlock",
        reason: "Price unlock PIN set or changed",
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        pinVerified: true,
        ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
        userAgent: req.headers.get("user-agent") || "",
      });
    } catch (e) {
      console.warn("Notice: audit log for price unlock PIN:", e);
    }
    return NextResponse.json({ success: true, message: "Price unlock PIN saved" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
