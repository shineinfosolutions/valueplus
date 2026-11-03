import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import { getActor } from "@/lib/requirePermission";
import { brandSalesFor } from "@/lib/staff-brand-sales";

export const dynamic = "force-dynamic";

const VIEW_ROLES = ["admin", "superadmin", "manager"];
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/**
 * A salesman's sales of his own brand against other brands.
 *   GET ?range=month|all            -> the signed-in person's own; pieces only (no amounts)
 *   GET ?id=<user>&range=month|all  -> Admin / Store Manager: any staff member, with brands and amounts
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const url = new URL(req.url);
    const range = url.searchParams.get("range") === "all" ? "all" : "month";
    const month = todayIst().slice(0, 7);
    const from = range === "month" ? `${month}-01` : undefined;
    const to = range === "month" ? `${month}-31` : undefined;
    await connectToDatabase();

    const id = url.searchParams.get("id");
    if (id) {
      if (!VIEW_ROLES.includes(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin or Store Manager can see this." }, { status: 403 });
      if (!mongoose.isValidObjectId(id)) return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 400 });
      const user: any = await User.findById(id).select("name assignedBrand").lean();
      if (!user) return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
      return NextResponse.json({ success: true, data: { range, ...(await brandSalesFor(user.name, user.assignedBrand || "", from, to)) } });
    }

    // A person's own figures: pieces only, no amounts, and the name comes from the login.
    const me: any = await User.findById(actor.id).select("assignedBrand").lean();
    const full = await brandSalesFor(actor.name, me?.assignedBrand || "", from, to);
    return NextResponse.json({
      success: true,
      data: {
        range,
        assignedBrand: full.assignedBrand,
        own: { quantity: full.own.quantity },
        other: { quantity: full.other.quantity },
        otherBrands: full.otherBrands.map((r) => ({ brand: r.brand, quantity: r.quantity })),
        bills: full.bills,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
