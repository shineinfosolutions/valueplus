import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { runStockOrderHousekeeping } from "@/lib/stock-order-retention";

export const dynamic = "force-dynamic";

/**
 * Called by the Cloudflare cron (worker.ts) at 10:00 India time: deletes GIDA warehouse orders older than 7 days and
 * reminds the Admin about requests still waiting. Proves itself with the server's own secret, like the other crons.
 */
export async function GET(req: Request) {
  const key = req.headers.get("x-cron-key") || "";
  const secret = process.env.NEXTAUTH_SECRET || "";
  if (!secret || key !== secret) return NextResponse.json({ success: false, error: "Not allowed" }, { status: 401 });
  await connectToDatabase();
  const result = await runStockOrderHousekeeping();
  return NextResponse.json({ success: true, ...result });
}
