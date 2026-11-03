import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { canManagePriceLock } from "@/lib/priceLock";

/** Products with their locked minimum price. Admin / Manager only. */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!canManagePriceLock(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin or Manager can see price locks." }, { status: 403 });
    }
    await connectToDatabase();
    const items = await Item.find({}, { name: 1, brand: 1, vpCode: 1, sellingPrice: 1, minSellingPrice: 1, lockedMinPrice: 1, priceLockedBy: 1, priceLockedAt: 1 })
      .sort({ name: 1 })
      .lean();
    return NextResponse.json({ success: true, data: items });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Lock (amount > 0) or unlock (amount 0) a product's minimum price. Admin / Manager only. */
export async function PUT(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!canManagePriceLock(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin or Manager can lock a price." }, { status: 403 });
    }
    const body = await req.json();
    const amount = Number(body.amount);
    if (!mongoose.isValidObjectId(body.itemId) || !Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ success: false, error: "Choose a product and enter a valid amount (0 removes the lock)." }, { status: 400 });
    }
    await connectToDatabase();
    const before: any = await Item.findById(body.itemId, { name: 1, lockedMinPrice: 1 }).lean();
    if (!before) return NextResponse.json({ success: false, error: "Product not found" }, { status: 404 });

    const updated: any = await Item.findByIdAndUpdate(
      body.itemId,
      { $set: { lockedMinPrice: amount, priceLockedBy: actor.name, priceLockedAt: new Date() } },
      { new: true, projection: { name: 1, lockedMinPrice: 1, priceLockedBy: 1, priceLockedAt: 1 } }
    ).lean();

    try {
      await AuditLog.create({
        action: "pricelock.set",
        entityType: "Item",
        entityRef: before.name,
        entityId: String(before._id),
        amount,
        reason: amount > 0 ? `Minimum price locked at ₹${amount}` : "Minimum price lock removed",
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        pinVerified: false,
        metadata: { was: Number(before.lockedMinPrice) || 0, now: amount },
      });
    } catch (e) {
      console.warn("Notice: audit log for price lock:", e);
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
