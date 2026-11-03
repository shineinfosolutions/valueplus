import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import { getActor } from "@/lib/requirePermission";
import { normName } from "@/lib/staff-incentive";

export const dynamic = "force-dynamic";

/**
 * The signed-in person's own sales of one product: the date and the units on each of the bills that carry their name
 * as Sales Executive. GET ?code=<item code>&vp=<VP code>&name=<product name>. The name comes from the login.
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const url = new URL(req.url);
    const keys = [url.searchParams.get("code"), url.searchParams.get("vp")].map((s) => String(s || "").trim().toLowerCase()).filter(Boolean);
    const name = String(url.searchParams.get("name") || "").trim().toLowerCase();
    if (keys.length === 0 && !name) return NextResponse.json({ success: false, error: "Which product?" }, { status: 400 });
    await connectToDatabase();

    const mine = normName(actor.name);
    const bills: any[] = await Invoice.find(
      { type: { $nin: ["proforma", "sales-order", "credit-note"] }, status: { $ne: "cancelled" } },
      { invoiceNumber: 1, date: 1, salesExecutive: 1, items: 1 }
    )
      .sort({ date: -1 })
      .limit(5000)
      .lean();

    const rows: { date: string; invoiceNumber: string; quantity: number }[] = [];
    for (const b of bills) {
      if (normName(b.salesExecutive) !== mine) continue;
      let qty = 0;
      for (const l of b.items || []) {
        const hit =
          keys.includes(String(l.itemCode || "").toLowerCase()) ||
          keys.includes(String(l.vpCode || "").toLowerCase()) ||
          (name && String(l.itemName || "").trim().toLowerCase() === name);
        if (hit) qty += Number(l.quantity) || 0;
      }
      if (qty > 0) rows.push({ date: String(b.date).slice(0, 10), invoiceNumber: b.invoiceNumber, quantity: qty });
    }
    return NextResponse.json({ success: true, data: { rows: rows.slice(0, 60), totalUnits: rows.reduce((t, r) => t + r.quantity, 0), bills: rows.length } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
