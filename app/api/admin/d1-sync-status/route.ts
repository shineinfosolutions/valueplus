import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { getActor } from "@/lib/requirePermission";
import { getD1 } from "@/lib/d1/client";
import { getD1SyncStatus } from "@/lib/d1/sync";

export const dynamic = "force-dynamic";

/**
 * How far the D1 copy of the master data has got (Phase 1 of docs/D1_MIGRATION_PLAN.md): per collection the Mongo
 * and D1 row counts, the copy cursors, a hash comparison of a random sample of documents, and the latest copy
 * errors. Admin / Super Admin only. `?sample=N` (0-200, default 25) sets the sample size.
 */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (actor.role !== "admin" && actor.role !== "superadmin") {
    return NextResponse.json({ success: false, error: "Only Admin can see this" }, { status: 403 });
  }
  const db = getD1();
  if (!db) return NextResponse.json({ success: false, error: "No D1 binding (DB) here" }, { status: 503 });

  const param = new URL(req.url).searchParams.get("sample");
  const raw = param === null || param === "" ? NaN : Number(param);
  const sampleSize = Number.isFinite(raw) && raw >= 0 ? Math.min(200, Math.floor(raw)) : 25;
  await connectToDatabase();
  const status = await getD1SyncStatus(db, { sampleSize });
  return NextResponse.json({ success: true, ...status });
}
