import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import { getActor } from "@/lib/requirePermission";
import { isRealVpCode, realCodeFromSupplierCodes } from "@/lib/vp-code";

export const dynamic = "force-dynamic";

/**
 * One-time fix: products that learned their real VP code from a purchase invoice (supplierCodes) but still show a
 * made-up code get that real code as their VP code. The old code stays in `code`, so bills and searches still find it.
 *
 * GET  -> the preview: every product that would change, the code it shows now and the one it would get.
 * POST -> applies it (Admin only). A VP code already shown by another product is skipped and reported.
 */
async function plan() {
  const items: any[] = await Item.find(
    { supplierCodes: { $exists: true, $ne: [] } },
    { name: 1, code: 1, vpCode: 1, supplierCodes: 1 }
  ).lean();
  const taken = new Map<string, string>();
  const withVp: any[] = await Item.find({ vpCode: { $exists: true, $ne: "" } }, { vpCode: 1 }).lean();
  for (const i of withVp) if (i.vpCode) taken.set(String(i.vpCode).toUpperCase(), String(i._id));

  const rows: any[] = [];
  for (const it of items) {
    if (isRealVpCode(it.vpCode)) continue;
    const next = realCodeFromSupplierCodes(it.supplierCodes);
    if (!next) continue;
    const holder = taken.get(next);
    rows.push({
      id: String(it._id),
      name: it.name,
      shownNow: it.vpCode || it.code || "",
      newVpCode: next,
      otherCodes: (it.supplierCodes || []).filter((c: string) => isRealVpCode(c) && c.toUpperCase() !== next),
      conflict: holder && holder !== String(it._id) ? "Another product already shows this VP code" : "",
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  try {
    const actor = await getActor();
    if (!actor || !["admin", "superadmin", "manager"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin or Store Manager can see this." }, { status: 403 });
    }
    await connectToDatabase();
    const rows = await plan();
    return NextResponse.json({ success: true, data: rows });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const actor = await getActor();
    if (!actor || !["admin", "superadmin"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin can apply this fix." }, { status: 403 });
    }
    await connectToDatabase();
    const rows = (await plan()).filter((r) => !r.conflict);
    if (rows.length === 0) return NextResponse.json({ success: true, updated: 0 });
    const res = await Item.bulkWrite(
      rows.map((r) => ({ updateOne: { filter: { _id: r.id }, update: { $set: { vpCode: r.newVpCode } } } })),
      { ordered: false }
    );
    return NextResponse.json({ success: true, updated: res.modifiedCount || 0, codes: rows.map((r) => ({ name: r.name, vpCode: r.newVpCode })) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
