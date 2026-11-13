import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { getD1 } from "@/lib/d1/client";
import { runD1Sync } from "@/lib/d1/sync";
import { runStageCSafely } from "@/lib/d1/stage-c";

export const dynamic = "force-dynamic";

/**
 * Called every 5 minutes by the Cloudflare cron (worker.ts): copies the master data (items, customers, suppliers,
 * brands, categories, units, warehouses) from MongoDB into D1 — Phase 1 of docs/D1_MIGRATION_PLAN.md. MongoDB stays
 * the only thing the app reads and writes; this only fills the copy. A run spends at most about 18 s and carries on
 * where the previous one stopped. Outside the sign-in check, it proves itself with the server's own secret.
 */
export async function GET(req: Request) {
  const key = req.headers.get("x-cron-key") || "";
  const secret = process.env.NEXTAUTH_SECRET || "";
  if (!secret || key !== secret) return NextResponse.json({ success: false, error: "Not allowed" }, { status: 401 });

  const db = getD1();
  if (!db) return NextResponse.json({ success: false, error: "No D1 binding (DB) here" });
  try {
    await connectToDatabase();
  } catch (e) {
    // Nothing to copy from; the next run tries again. Not an error for anyone using the app.
    return NextResponse.json({ success: false, error: `MongoDB not reachable: ${e instanceof Error ? e.message : String(e)}` });
  }
  const result = await runD1Sync(db);
  // Stage C (lib/d1/stage-c.ts): move the read switches between 'shadow' and 'd1' when the rules say so. After the
  // copy, never instead of it: runStageCSafely never throws and is capped in time, and the catch is a second net,
  // so nothing here can change the copy's result or status.
  let stageC: unknown;
  try {
    stageC = await runStageCSafely(db, Date.now());
  } catch (e) {
    stageC = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return NextResponse.json({ success: result.ok, ...result, stageC });
}
