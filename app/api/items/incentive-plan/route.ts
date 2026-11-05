import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import { getActor } from "@/lib/requirePermission";
import { lineIncentive, liveRulesOf, todayIST } from "@/lib/incentive-rules";

export const dynamic = "force-dynamic";

/**
 * The incentive plan: every active product that has an incentive running today, with its rules and what one piece
 * earns at the selling price. Shown to the salesman (and anyone signed in) on the dashboard. No purchase prices.
 */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    await connectToDatabase();

    const items: any[] = await Item.find(
      {
        status: { $ne: "inactive" },
        $or: [{ "incentives.0": { $exists: true } }, { incentiveType: { $in: ["fixed", "percentage"] } }],
      },
      {
        name: 1, code: 1, vpCode: 1, brand: 1, category: 1, sellingPrice: 1, gstRate: 1, currentStock: 1,
        incentives: 1, incentiveType: 1, incentiveValue: 1, incentiveAmount: 1, incentiveTargetAmount: 1,
      }
    ).lean();

    const today = todayIST();
    const data = items
      .map((it) => {
        const rules = liveRulesOf(it, today);
        if (rules.length === 0) return null;
        const sellingPrice = Number(it.sellingPrice) || 0;
        const gstRate = Number(it.gstRate) || 0;
        const atSellingPrice = sellingPrice > 0 ? lineIncentive(rules, { rate: sellingPrice, qty: 1, gstRate }, today) : 0;
        // A rule with a minimum price above the selling price pays only when sold at that price: show what one piece
        // earns at the best price the rules ask for, so such a product does not read as ₹0.
        const bestPrice = Math.max(sellingPrice, ...rules.map((r) => r.minPrice || 0));
        const atBestPrice = bestPrice > 0 ? lineIncentive(rules, { rate: bestPrice, qty: 1, gstRate }, today) : 0;
        return {
          _id: String(it._id),
          name: it.name,
          code: it.vpCode || it.code || "",
          brand: it.brand || "",
          category: it.category || "",
          sellingPrice,
          inStock: (Number(it.currentStock) || 0) > 0,
          rules,
          atSellingPrice,
          bestPrice,
          atBestPrice,
          percentOfPrice: bestPrice > 0 ? Math.round((atBestPrice / bestPrice) * 10000) / 100 : 0,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.atBestPrice - a.atBestPrice);

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
