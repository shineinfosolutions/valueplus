import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { getD1 } from "@/lib/d1/client";
import { runD1Sync } from "@/lib/d1/sync";
import { runStageCSafely } from "@/lib/d1/stage-c";
import { runStageDSafely } from "@/lib/d1/stage-d";
import { collectionsNotOwnedByMongo } from "@/lib/d1/write-mode";
import { drainOutbox, outboxPending } from "@/lib/d1/reverse-mirror";

export const dynamic = "force-dynamic";

/**
 * Called every 5 minutes by the Cloudflare cron (worker.ts): copies the master data (items, customers, suppliers,
 * brands, categories, units, warehouses) from MongoDB into D1 — Phase 1 of docs/D1_MIGRATION_PLAN.md. MongoDB stays
 * the only thing the app reads and writes; this only fills the copy. A run spends at most about 18 s and carries on
 * where the previous one stopped. Outside the sign-in check, it proves itself with the server's own secret.
 *
 * Stage D (§6.8a), dormant by default: collections whose write switch is 'fence' or 'd1' are left out of the copy
 * (D1 is their source of truth); the reverse-mirror outbox is drained into MongoDB when it holds anything; and the
 * Stage D job runs last (it does nothing while feature_flags stageD = 'off').
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
    // Nothing to copy from; the next run tries again. Not an error for anyone using the app. Stage C still runs:
    // it reads only D1, and its safety half (write-through guard, demotions) must not wait for MongoDB to be back.
    // Stage D too: a rollback can at least fence the area (its drain then waits for MongoDB).
    const stageC = await runStageCSafely(db, Date.now()).catch((err) => ({ ok: false, error: String(err) }));
    const stageD = await runStageDSafely(db, Date.now()).catch((err) => ({ ok: false, error: String(err) }));
    return NextResponse.json({ success: false, error: `MongoDB not reachable: ${e instanceof Error ? e.message : String(e)}`, stageC, stageD });
  }
  // Collections D1 owns (or is taking over) are not copied over from MongoDB. Cannot tell -> copy everything, as
  // before Stage D (with no write switch set, this list is always empty).
  const skipCollections = await collectionsNotOwnedByMongo(db).catch(() => [] as string[]);
  const result = await runD1Sync(db, skipCollections.length ? { skipCollections } : {});
  // Stage C (lib/d1/stage-c.ts): move the read switches between 'shadow' and 'd1' when the rules say so. After the
  // copy, never instead of it: runStageCSafely never throws and is capped in time, and the catch is a second net,
  // so nothing here can change the copy's result or status.
  let stageC: unknown;
  try {
    stageC = await runStageCSafely(db, Date.now());
  } catch (e) {
    stageC = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // Stage D: the reverse mirror catches up on anything the after-response drains left (one cheap COUNT when the
  // outbox is empty), then the write-cutover job. Same rule: never changes the copy's result.
  let reverseMirror: unknown;
  let stageD: unknown;
  try {
    const pending = await outboxPending(db).catch(() => ({ pending: 0, oldestAt: null }));
    reverseMirror = pending.pending > 0 ? await drainOutbox(db, { budgetMs: 10_000 }) : { pending: 0 };
  } catch (e) {
    reverseMirror = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    stageD = await runStageDSafely(db, Date.now());
  } catch (e) {
    stageD = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return NextResponse.json({ success: result.ok, ...result, stageC, reverseMirror, stageD });
}
