import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

const NEW_RATE = 18;
const MISSING = { $or: [{ gstRate: 0 }, { gstRate: null }, { gstRate: { $exists: false } }] };

/**
 * Products with a GST of 0 (or none saved) in the Item Master. Every product the showroom sells carries GST, so a 0 here
 * makes each bill for it show the whole amount as "sales before GST" and throws Profit & Loss off.
 *
 * GET  -> the products that would be set to 18% (nothing is changed).
 * POST { ids?: string[] } -> sets 18% on them (all found when no list is sent). Admin only; audit log.
 * Fix the bills that were already made with 0% afterwards (GST > Reports banner), so they pick up this rate.
 */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!["admin", "superadmin"].includes(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin can do this." }, { status: 403 });
    await connectToDatabase();
    const rows: any[] = await Item.find({ status: { $ne: "inactive" }, ...MISSING }).select("name vpCode code category brand hsnCode gstRate currentStock").sort({ name: 1 }).lean();
    return NextResponse.json({
      success: true,
      data: {
        count: rows.length,
        newRate: NEW_RATE,
        items: rows.map((r) => ({ id: String(r._id), name: r.name, vpCode: r.vpCode || r.code || "", category: r.category || "", brand: r.brand || "", hsn: r.hsnCode || "", was: r.gstRate ?? null, stock: Number(r.currentStock) || 0 })),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!["admin", "superadmin"].includes(actor.role)) return NextResponse.json({ success: false, error: "Only the Admin can do this." }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const ids: string[] | undefined = Array.isArray(body.ids) && body.ids.length > 0 ? body.ids.map(String) : undefined;
    await connectToDatabase();
    const filter: any = { status: { $ne: "inactive" }, ...MISSING };
    if (ids) filter._id = { $in: ids };
    const rows: any[] = await Item.find(filter).select("name vpCode code gstRate").lean();
    if (rows.length === 0) return NextResponse.json({ success: true, data: { updated: 0 }, message: "Nothing to change." });

    // Only products that still have no GST are touched: a real rate is never overwritten here.
    const res = await Item.updateMany({ _id: { $in: rows.map((r) => r._id) }, ...MISSING }, { $set: { gstRate: NEW_RATE } });
    try {
      await AuditLog.create({
        action: "item.gst.fix",
        entityType: "Item",
        entityRef: `${rows.length} products`,
        amount: 0,
        reason: `GST set to ${NEW_RATE}% on ${rows.length} product(s) that had none (0 or blank)`,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        metadata: { items: rows.map((r) => ({ id: String(r._id), name: r.name, vpCode: r.vpCode || r.code || "", was: r.gstRate ?? null })) },
      });
    } catch (e) {
      console.warn("Notice: audit log for item gst fix:", e);
    }
    return NextResponse.json({ success: true, data: { updated: res.modifiedCount ?? rows.length }, message: `${res.modifiedCount ?? rows.length} product(s) set to ${NEW_RATE}% GST.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
