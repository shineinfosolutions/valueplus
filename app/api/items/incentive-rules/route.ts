import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import { getActor } from "@/lib/requirePermission";
import { INCENTIVE_SETTER_ROLES, cleanRules, flatFieldsFor } from "@/lib/incentive-rules";

export const dynamic = "force-dynamic";

/**
 * PUT { itemId, rules: [{ type, value, minPrice, label, startDate, endDate, active }] }
 * Replaces one product's incentive rules. Applied at once (an incentive scheme is not a stock or price change, so the
 * Store Manager's edit does not wait for the Admin here).
 */
export async function PUT(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!INCENTIVE_SETTER_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin, Store Manager or Cashier can set incentives." }, { status: 403 });
    }
    const body = await req.json();
    if (!mongoose.isValidObjectId(body.itemId)) {
      return NextResponse.json({ success: false, error: "Choose a product." }, { status: 400 });
    }
    const raw = Array.isArray(body.rules) ? body.rules : [];
    const rules = cleanRules(raw);
    if (rules.length !== raw.length) {
      return NextResponse.json(
        { success: false, error: "Every rule needs a value above 0 (and a % rule at most 100)." },
        { status: 400 }
      );
    }
    await connectToDatabase();
    const item = await Item.findByIdAndUpdate(
      body.itemId,
      { $set: { incentives: rules, ...flatFieldsFor(rules) } },
      { new: true, projection: { name: 1, incentives: 1, incentiveType: 1, incentiveValue: 1 } }
    ).lean();
    if (!item) return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });
    return NextResponse.json({ success: true, data: item });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
