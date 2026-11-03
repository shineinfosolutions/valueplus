import { NextResponse } from "next/server";
import { sendOfficeStartReminder } from "@/lib/office-reminder";

export const dynamic = "force-dynamic";

/**
 * Called by the Cloudflare cron at 10:00 India time (worker.ts). It is outside the sign-in check, so it
 * proves itself with the server's own secret, which only the Worker holds.
 */
export async function GET(req: Request) {
  const key = req.headers.get("x-cron-key") || "";
  const secret = process.env.NEXTAUTH_SECRET || "";
  if (!secret || key !== secret) return NextResponse.json({ success: false, error: "Not allowed" }, { status: 401 });
  const result = await sendOfficeStartReminder({ fromCron: true });
  return NextResponse.json({ success: true, ...result });
}
