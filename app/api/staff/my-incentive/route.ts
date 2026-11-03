import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import { getActor } from "@/lib/requirePermission";
import { loadIncentiveBook, normName, summarise } from "@/lib/staff-incentive";
import IncentivePayout from "@/models/IncentivePayout";

export const dynamic = "force-dynamic";

/**
 * The signed-in salesman's incentive: earned on his own bills (product incentive + 10% of Onsitego plans),
 * and received (payouts the Admin recorded plus the incentive in his paid salary records). Everything comes
 * from the login, never from the request. `?detail=1` adds the bills and the payouts behind the numbers.
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    await connectToDatabase();
    const book = await loadIncentiveBook();
    const s = summarise(book, actor.id, actor.name);
    const data: any = { earned: s.earned, received: s.received, pending: s.balance };

    if (new URL(req.url).searchParams.get("detail") === "1") {
      const bills = (book.bills.get(normName(actor.name)) || []).filter((b) => b.incentive > 0);
      const payouts: any[] = await IncentivePayout.find({ userId: actor.id }).sort({ date: -1, createdAt: -1 }).lean();
      data.paidByPayout = s.paidByPayout;
      data.paidInSalary = s.paidInSalary;
      data.onsitego = Math.round(bills.reduce((t, b) => t + (b.onsitegoIncentive || 0), 0) * 100) / 100;
      data.product = Math.round(bills.reduce((t, b) => t + (b.productIncentive || 0), 0) * 100) / 100;
      data.bills = bills;
      data.payouts = payouts.map((p) => ({ date: p.date, amount: Number(p.amount) || 0, paymentMode: p.paymentMode || "", note: p.note || "" }));
    }
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
