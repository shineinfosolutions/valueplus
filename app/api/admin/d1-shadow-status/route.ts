import { NextResponse } from "next/server";
import { getActor } from "@/lib/requirePermission";
import { getReadSourceConfig } from "@/lib/d1/read-source";
import { getShadowStatus } from "@/lib/d1/shadow-status";
import { getStageCStatus } from "@/lib/d1/stage-c";
import { getStageDStatus } from "@/lib/d1/stage-d";

export const dynamic = "force-dynamic";

/**
 * How the D1 shadow reads are doing (stage B2 of docs/D1_MIGRATION_PLAN.md): per area and read path, over the last
 * `?days=N` India days (1-60, default 7): runs, match %, D1 errors, fallbacks, average MongoDB vs D1 time, how many
 * days in a row it has been clean, the latest mismatch sample (paths and masked short values only), and the area's
 * current read mode. Admin / Super Admin only.
 *
 * `stageC` (lib/d1/stage-c.ts): per area the switch, the EFFECTIVE mode (a 'd1' area whose D1 is not known fresh
 * reads MongoDB), the freshness and why not, clean shop days against the area's rule, the next promotion with what
 * still blocks it and its earliest time, and the last 20 automatic changes (stage_c_log). Shown as
 * `{ error }` when migration 0009 is not applied yet, without failing the rest of the report.
 *
 * `stageD` (lib/d1/stage-d.ts): the Stage D switch, per write area its write mode, its read areas (switch,
 * freshness, shop days on D1), the reverse-mirror outbox (pending rows, oldest, lag), drain failures in the last
 * hour, the reconciliation facts, what still blocks a promotion and what would roll it back; the drainer's last run;
 * the last 20 stage_d_log rows. `{ error }` when migration 0011 is not applied yet.
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
    let stageC: unknown;
    try {
      stageC = await getStageCStatus(db, Date.now());
    } catch (e: any) {
      stageC = { error: e?.message || String(e) };
    }
    let stageD: unknown;
    try {
      stageD = await getStageDStatus(db, Date.now());
    } catch (e: any) {
      stageD = { error: e?.message || String(e) };
    }
    return NextResponse.json({ success: true, ...status, stageC, stageD });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || String(e) }, { status: 500 });
  }
}
