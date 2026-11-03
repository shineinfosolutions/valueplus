import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { isUnbrandedValue, looksLikeCategory, needsBrand, proposeBrand } from "@/lib/brand-names";

export const dynamic = "force-dynamic";

const ADMIN = ["admin", "superadmin"];

/**
 * Products with no brand, each with a brand worked out from its name when the name says one.
 * GET  -> { items: [{ id, vpCode, name, category, qty, proposal, source }], brands: [known brand names] }
 * POST { assignments: [{ id, brand }] } -> sets the brand on those products (Admin only; the Admin has reviewed each one).
 */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!ADMIN.includes(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin can do this." }, { status: 403 });
    await connectToDatabase();
    const all: any[] = await Item.find({ status: "active" }).select("name vpCode code category brand currentStock").lean();

    // Known brands: the brand values already on products, merged by capitals, without category-like labels.
    const counts = new Map<string, { name: string; n: number }>();
    for (const it of all) {
      if (isUnbrandedValue(it.brand) || looksLikeCategory(String(it.brand))) continue;
      const b = String(it.brand).trim();
      const e = counts.get(b.toLowerCase()) || { name: b, n: 0 };
      e.n++;
      counts.set(b.toLowerCase(), e);
    }
    const brands = Array.from(counts.values()).sort((a, b) => b.n - a.n).map((b) => b.name);

    const missing = all.filter((it) => needsBrand(it.brand));
    // Brands that other products' names spell out ("... - OPPO") also help the products that only start with it ("OPPO F33 PRO").
    const fromNames = new Set<string>();
    for (const it of missing) {
      const p = proposeBrand(String(it.name || ""), String(it.category || ""), brands);
      if (p?.source === "suffix") fromNames.add(p.brand);
    }
    const lookup = [...brands, ...Array.from(fromNames)];
    const items = missing
      .map((it) => {
        const p = proposeBrand(String(it.name || ""), String(it.category || ""), lookup);
        return {
          id: String(it._id),
          vpCode: it.vpCode || it.code || "",
          name: it.name,
          category: it.category || "",
          qty: Number(it.currentStock) || 0,
          current: isUnbrandedValue(it.brand) ? "" : String(it.brand),
          proposal: p?.brand || "",
          source: p?.source || "",
        };
      })
      .sort((a, b) => (a.proposal ? 0 : 1) - (b.proposal ? 0 : 1) || String(a.name).localeCompare(String(b.name)));
    return NextResponse.json({ success: true, data: { items, brands } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!ADMIN.includes(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin can do this." }, { status: 403 });
    const body = await req.json();
    const list: { id: string; brand: string }[] = (Array.isArray(body.assignments) ? body.assignments : [])
      .map((a: any) => ({ id: String(a?.id || ""), brand: String(a?.brand || "").trim().slice(0, 40) }))
      .filter((a: any) => mongoose.isValidObjectId(a.id) && a.brand && !needsBrand(a.brand));
    if (list.length === 0) return NextResponse.json({ success: false, error: "Choose a brand for at least one product." }, { status: 400 });
    await connectToDatabase();

    const done: { id: string; name: string; was: string; brand: string }[] = [];
    for (const a of list) {
      const it: any = await Item.findById(a.id).select("name brand status");
      // Only a product that still has no real brand (empty, a placeholder, or a category label) is changed: a real brand is never overwritten here.
      if (!it || !needsBrand(it.brand)) continue;
      const was = String(it.brand || "");
      it.brand = a.brand;
      await it.save();
      done.push({ id: a.id, name: it.name, was, brand: a.brand });
    }
    try {
      await AuditLog.create({
        action: "item.brand.assign",
        entityType: "Item",
        entityRef: `${done.length} products`,
        amount: 0,
        reason: `Brand set on ${done.length} product(s) that had none`,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        metadata: { items: done },
      });
    } catch (e) {
      console.warn("Notice: audit log for brand assign:", e);
    }
    return NextResponse.json({ success: true, data: { updated: done.length, items: done }, message: `${done.length} product(s) updated.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
