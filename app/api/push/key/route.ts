import { NextResponse } from "next/server";
import { pushConfigured, vapidPublicKey } from "@/lib/web-push";

/** The public key a device needs to sign up for notifications from this server. */
export async function GET() {
  if (!pushConfigured()) {
    return NextResponse.json({ success: false, error: "Push notifications are not set up on the server." }, { status: 503 });
  }
  return NextResponse.json({ success: true, publicKey: vapidPublicKey() });
}
