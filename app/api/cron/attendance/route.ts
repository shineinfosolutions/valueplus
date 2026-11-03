import { NextResponse } from "next/server";
import { runAttendanceChecks } from "@/lib/attendance-alerts";

export const dynamic = "force-dynamic";

/**
 * Called every 5 minutes by the Cloudflare cron (worker.ts): "not checked in" alerts from 10:00 and
 * "break over, not at the store" alerts. Outside the sign-in check, it proves itself with the server's own secret.
 */
export async function GET(req: Request) {
  const key = req.headers.get("x-cron-key") || "";
  const secret = process.env.NEXTAUTH_SECRET || "";
  if (!secret || key !== secret) return NextResponse.json({ success: false, error: "Not allowed" }, { status: 401 });
  const result = await runAttendanceChecks();
  return NextResponse.json({ success: true, ...result });
}
