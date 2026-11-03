import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import PushSubscription from "@/models/PushSubscription";
import { getActor } from "@/lib/requirePermission";
import { b64u, isAllowedPushEndpoint } from "@/lib/web-push";

const MAX_DEVICES_PER_USER = 10;

/** Registers this device for the signed-in user (and takes it over from anyone who used it before). */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor?.id) return NextResponse.json({ success: false, error: "You must be signed in." }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const endpoint = String(body?.endpoint || "");
    const p256dh = String(body?.keys?.p256dh || "");
    const auth = String(body?.keys?.auth || "");

    if (endpoint.length > 700 || !isAllowedPushEndpoint(endpoint)) {
      return NextResponse.json({ success: false, error: "This device's push address is not accepted." }, { status: 400 });
    }
    let keyOk = false;
    try {
      const k = b64u.decode(p256dh);
      keyOk = k.length === 65 && k[0] === 4 && b64u.decode(auth).length === 16;
    } catch {
      keyOk = false;
    }
    if (!keyOk) return NextResponse.json({ success: false, error: "This device's keys are not valid." }, { status: 400 });

    await connectToDatabase();
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { $set: { userId: actor.id, p256dh, auth, userAgent: String(req.headers.get("user-agent") || "").slice(0, 200), failCount: 0 } },
      { upsert: true, new: true }
    );

    // Keep the newest few devices per person.
    const mine = await PushSubscription.find({ userId: actor.id }).sort({ updatedAt: -1 }).select("_id").lean();
    if (mine.length > MAX_DEVICES_PER_USER) {
      await PushSubscription.deleteMany({ _id: { $in: mine.slice(MAX_DEVICES_PER_USER).map((m: any) => m._id) } });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Stops notifications to this device (done on log out). Only the person it is registered to can do it. */
export async function DELETE(req: Request) {
  try {
    const actor = await getActor();
    if (!actor?.id) return NextResponse.json({ success: false, error: "You must be signed in." }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const endpoint = String(body?.endpoint || "");
    if (!endpoint) return NextResponse.json({ success: false, error: "endpoint is required" }, { status: 400 });
    await connectToDatabase();
    await PushSubscription.deleteOne({ endpoint, userId: actor.id });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
