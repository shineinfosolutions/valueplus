import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { getActor } from "@/lib/requirePermission";
import { pushToUsers } from "@/lib/push";
import { pushConfigured } from "@/lib/web-push";

/** Sends a test notification to the signed-in person's own devices. */
export async function POST() {
  try {
    const actor = await getActor();
    if (!actor?.id) return NextResponse.json({ success: false, error: "You must be signed in." }, { status: 401 });
    if (!pushConfigured()) {
      return NextResponse.json({ success: false, error: "Push notifications are not set up on the server." }, { status: 503 });
    }
    await connectToDatabase();
    const result = await pushToUsers([actor.id], {
      title: "Test notification",
      body: `Notifications are working on this device, ${actor.name}.`,
      link: "/dashboard",
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
