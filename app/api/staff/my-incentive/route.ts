import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { getActor } from "@/lib/requirePermission";
import { loadIncentiveBook, summarise } from "@/lib/staff-incentive";

export const dynamic = "force-dynamic";

/**
 * The signed-in salesman's incentive: earned on his own bills, and received (payouts the Admin recorded plus
 * the incentive in his paid salary records). Everything comes from the login, never from the request.
 */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    await connectToDatabase();
    const s = summarise(await loadIncentiveBook(), actor.id, actor.name);
    return NextResponse.json({ success: true, data: { earned: s.earned, received: s.received, pending: s.balance } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
