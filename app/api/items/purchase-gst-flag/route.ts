import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

/**
 * Products whose purchase price already has GST in it (checked against the stock sheet: price = sheet rate + 18%).
 * Profit adds GST to every other product's cost, so these are marked and left as they are.
 *
 * GET  -> the products that would be marked (nothing is changed).
 * POST -> marks them. Admin only; audit log.
 */
const INCLUDES_GST_CODES = [
  "VP-JY7KJK8570", // LLOYD 55PS850G (QLED)
  "VP-Q5TWGA4431", // DFB532FP.APZPEIL- LG
  "VP-IKMSH67496", // HFC-320DPW4- HAIER
  "VP-WEJV426836", // HIH-G1600-IN- HAIER
  "VP-ICOUQ19698", // HTW85-178BBKN (HAIER WASHING MACHINE)
  "VP-1QOPWH2077", // MS2043DB.DB1QILN- LG
  "VP-QXZG4F5954", // T90V4OB1S.ANBQEIL- LG
  "VP-UGNAPB6619", // HIC-Q27426-IN- HAIER
];

async function guard() {
  const actor = await getActor();
  if (!actor) return { error: NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 }) };
  if (!["admin", "superadmin"].includes(actor.role)) return { error: NextResponse.json({ success: false, error: "Only the Admin can do this." }, { status: 403 }) };
  return { actor };
}

export async function GET() {
  try {
    const g = await guard();
    if (g.error) return g.error;
    await connectToDatabase();
    const rows: any[] = await Item.find({ vpCode: { $in: INCLUDES_GST_CODES } }).select("name vpCode purchasePrice purchaseIncludesGst").lean();
    return NextResponse.json({
      success: true,
      data: { count: rows.length, items: rows.map((r) => ({ id: String(r._id), name: r.name, vpCode: r.vpCode, purchasePrice: r.purchasePrice, marked: !!r.purchaseIncludesGst })) },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const g = await guard();
    if (g.error) return g.error;
    await connectToDatabase();
    const res = await Item.updateMany({ vpCode: { $in: INCLUDES_GST_CODES }, purchaseIncludesGst: { $ne: true } }, { $set: { purchaseIncludesGst: true } });
    try {
      await AuditLog.create({
        action: "item.purchase-gst-flag",
        entityType: "Item",
        entityRef: `${res.modifiedCount} products`,
        amount: 0,
        reason: "Products whose purchase price already includes GST were marked, so profit does not add GST to their cost again",
        performedBy: g.actor!.name,
        performedByUserId: g.actor!.id,
        performedByRole: g.actor!.role,
        metadata: { vpCodes: INCLUDES_GST_CODES },
      });
    } catch (e) {
      console.warn("Notice: audit log for purchase gst flag:", e);
    }
    return NextResponse.json({ success: true, data: { marked: res.modifiedCount }, message: `${res.modifiedCount} product(s) marked.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
