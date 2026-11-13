import { NextResponse } from "next/server";
import { getActor } from "@/lib/requirePermission";
import { getReadSourceConfig } from "@/lib/d1/read-source";
import { getShadowStatus } from "@/lib/d1/shadow-status";

export const dynamic = "force-dynamic";

/**
 * How the D1 shadow reads are doing (stage B2 of docs/D1_MIGRATION_PLAN.md): per area and read path, over the last
 * `?days=N` India days (1-60, default 7): runs, match %, D1 errors, fallbacks, average MongoDB vs D1 time, how many
 * days in a row it has been clean, the latest mismatch sample (paths and masked short values only), and the area's
 * current read mode. Admin / Super Admin only.
 */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (actor.role !== "admin" && actor.role !== "superadmin") {
    return NextResponse.json({ success: false, error: "Only Admin can see this" }, { status: 403 });
  }
  // The same D1 the read switch uses (the binding `DB`; tests point it at a local D1).
  const db = getReadSourceConfig().resolveD1();
  if (!db) return NextResponse.json({ success: false, error: "No D1 binding (DB) here" }, { status: 503 });

  const param = new URL(req.url).searchParams.get("days");
  const raw = param === null || param === "" ? NaN : Number(param);
  const days = Number.isFinite(raw) && raw >= 1 ? Math.min(60, Math.floor(raw)) : 7;
  try {
    const status = await getShadowStatus(db, { days });
    return NextResponse.json({ success: true, ...status });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
