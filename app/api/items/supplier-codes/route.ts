import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import { getActor } from "@/lib/requirePermission";
import { REAL_VP_CODE } from "@/lib/vp-code";

/**
 * Remember which supplier item code (e.g. "VP0012023" on a Value Plus Retail
 * invoice) a product is billed under. Called from the purchase import once the
 * rows are confirmed, so the next invoice with that code is linked to the same
 * product by code, not guessed from its name.
 *
 * Body: { links: [{ itemId, code }] }. Adding a code a product already has is a
 * no-op. A code already remembered on a different product is moved to this one,
 * since the person confirming the purchase has just said this is the product.
 *
 * A real VP code (VP + digits, lib/vp-code.ts) also becomes the product's VP code when the product has none yet (or
 * only a made-up one), so the app shows the same code as the supplier's invoice.
 */

const ALLOWED_ROLES = ["admin", "superadmin", "manager", "accounts", "warehouse", "cashier"];
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "You are not allowed to change products." }, { status: 403 });
    }

    const body = await req.json();
    const links = (Array.isArray(body?.links) ? body.links : [])
      .map((l: any) => ({ itemId: String(l?.itemId || ""), code: String(l?.code || "").trim().toUpperCase() }))
      .filter((l: any) => mongoose.isValidObjectId(l.itemId) && CODE_PATTERN.test(l.code));
    if (links.length === 0) {
      return NextResponse.json({ success: true, linked: 0 });
    }

    await connectToDatabase();
    const ops: any[] = [];
    for (const { itemId, code } of links) {
      ops.push({ updateMany: { filter: { _id: { $ne: itemId }, supplierCodes: code }, update: { $pull: { supplierCodes: code } } } });
      ops.push({ updateOne: { filter: { _id: itemId }, update: { $addToSet: { supplierCodes: code } } } });
      if (REAL_VP_CODE.test(code)) {
        // One product per VP code: another product showing it gives it up, then this one takes it if it has no real one.
        ops.push({ updateMany: { filter: { _id: { $ne: itemId }, vpCode: code }, update: { $set: { vpCode: "" } } } });
        ops.push({
          updateOne: {
            filter: { _id: itemId, $or: [{ vpCode: { $exists: false } }, { vpCode: null }, { vpCode: { $not: REAL_VP_CODE } }] },
            update: { $set: { vpCode: code } },
          },
        });
      }
    }
    const res = await Item.bulkWrite(ops, { ordered: true });
    return NextResponse.json({ success: true, linked: res.modifiedCount || 0 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
