import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import PurchaseEntry from "@/models/PurchaseEntry";
import SerialNumber from "@/models/SerialNumber";
import Item from "@/models/Item";
import AuditLog from "@/models/AuditLog";
import Supplier from "@/models/Supplier";
import { purchasePaymentState } from "@/lib/purchase-payments";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["admin", "superadmin", "manager", "warehouse"];

/**
 * Add serial / IMEI numbers to a purchase bill that was saved without all of them.
 * Only a bill line that still has room (serials so far < quantity) takes more; a number already registered
 * anywhere is refused. Stock is not touched: the pieces were counted when the bill was entered.
 *
 * With `replace: true` the numbers already on the line are taken out first (only if they are still available stock
 * from this bill: one that was sold or moved is refused) and the new ones put in their place; the line can then
 * hold up to its full quantity.
 *
 * Body: { billNo, itemIndex, serials: string[], replace?: boolean }
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!ALLOWED_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin, Store Manager or Warehouse can add serial numbers to a purchase bill." }, { status: 403 });
    }
    const body = await req.json();
    const billNo = String(body.billNo || "").trim();
    const itemIndex = Number(body.itemIndex);
    const asked: string[] = (Array.isArray(body.serials) ? body.serials : []).map((s: any) => String(s || "").trim()).filter(Boolean);
    const hasRate = body.rate !== undefined && body.rate !== null && body.rate !== "";
    if (!billNo || !Number.isInteger(itemIndex) || itemIndex < 0 || (asked.length === 0 && !hasRate)) {
      return NextResponse.json({ success: false, error: "Choose the bill line and enter at least one serial number." }, { status: 400 });
    }
    const serials = Array.from(new Set(asked));
    if (serials.length !== asked.length) {
      return NextResponse.json({ success: false, error: "The same serial number is entered twice." }, { status: 400 });
    }

    await connectToDatabase();
    const entry: any = await PurchaseEntry.findOne({ billNo });
    if (!entry) return NextResponse.json({ success: false, error: "Purchase bill not found." }, { status: 404 });
    if (entry.status === "cancelled") return NextResponse.json({ success: false, error: "This bill is cancelled." }, { status: 400 });
    if (entry.type === "debit-note") return NextResponse.json({ success: false, error: "Serial numbers cannot be added to a debit note." }, { status: 400 });
    const line = entry.items?.[itemIndex];
    if (!line) return NextResponse.json({ success: false, error: "That bill line does not exist." }, { status: 404 });

    const replace = body.replace === true;
    const old: string[] = Array.isArray(line.serialNumbers) ? line.serialNumbers : [];
    const have: string[] = replace ? [] : old;
    const room = Math.max(0, Number(line.quantity) - have.length);
    if (serials.length > room) {
      return NextResponse.json(
        { success: false, error: `${line.name}: quantity is ${line.quantity} and ${have.length} serial number${have.length === 1 ? " is" : "s are"} already recorded, so only ${room} more can be added.` },
        { status: 400 }
      );
    }
    // Replacing: the old numbers must still be plain available stock of this bill, otherwise they stay.
    if (replace && old.length > 0 && serials.length > 0) {
      const oldDocs: any[] = await SerialNumber.find({ serialNumber: { $in: old } }, { serialNumber: 1, status: 1, purchaseEntryId: 1 }).lean();
      const locked = oldDocs.filter((d) => d.status !== "AVAILABLE" || (d.purchaseEntryId && d.purchaseEntryId !== String(entry._id)));
      if (locked.length > 0) {
        return NextResponse.json(
          { success: false, error: `These cannot be replaced (sold, returned or from another bill): ${locked.map((d) => d.serialNumber).join(", ")}.` },
          { status: 409 }
        );
      }
    }
    const taken = (await SerialNumber.find({ serialNumber: { $in: serials } }, { serialNumber: 1 }).lean()).filter(
      (t: any) => !(replace && old.includes(t.serialNumber))
    );
    if (taken.length > 0) {
      return NextResponse.json({ success: false, error: `Already registered: ${taken.map((t: any) => t.serialNumber).join(", ")}.` }, { status: 409 });
    }

    // The catalog product behind the bill line (for the serial's own record).
    const product: any =
      (line.itemId && (await Item.findById(line.itemId).select("name vpCode code").lean().catch(() => null))) ||
      (await Item.findOne({ name: line.name }).select("name vpCode code").lean());

    const now = new Date();
    if (replace && old.length > 0 && serials.length > 0) {
      await SerialNumber.deleteMany({ serialNumber: { $in: old }, status: "AVAILABLE" });
    }
    for (const sn of serials) {
      await SerialNumber.create({
        serialNumber: sn,
        itemId: product ? String(product._id) : String(line.itemId || ""),
        vpCode: product?.vpCode || product?.code || "VP-GEN",
        itemName: product?.name || line.name || "",
        status: "AVAILABLE",
        purchaseEntryId: String(entry._id),
        price: Number(line.rate) || 0,
        warehouse: entry.warehouse || "",
        history: [
          {
            action: `Inward Purchase Bill #${entry.billNo}`,
            date: now,
            performedBy: actor.name,
            details: `Serial added to the bill afterwards by ${actor.name} | Supplier: ${entry.supplierName} | Rate: ₹${Number(line.rate) || 0}`,
          },
        ],
      });
    }
    line.serialNumbers = serials.length > 0 ? [...have, ...serials] : old;

    // Admin only: a new rate for this line. The bill's totals, balance and the supplier's outstanding move by the difference.
    let rateChange: { from: number; to: number; delta: number } | null = null;
    if (body.rate !== undefined && body.rate !== null && body.rate !== "") {
      if (!["admin", "superadmin"].includes(actor.role)) {
        return NextResponse.json({ success: false, error: "Only the Admin can change the amount of a purchase bill." }, { status: 403 });
      }
      const newRate = Number(body.rate);
      if (!Number.isFinite(newRate) || newRate < 0) {
        return NextResponse.json({ success: false, error: "Enter a valid rate." }, { status: 400 });
      }
      const oldRate = Number(line.rate) || 0;
      if (Math.round(newRate * 100) !== Math.round(oldRate * 100)) {
        const qty = Number(line.quantity) || 0;
        const gstFactor = 1 + (Number(line.gstRate) || 0) / 100;
        const deltaBase = (newRate - oldRate) * qty;
        const delta = Math.round(deltaBase * gstFactor * 100) / 100;
        line.rate = newRate;
        entry.subtotal = Math.round(((Number(entry.subtotal) || 0) + deltaBase) * 100) / 100;
        entry.gst = Math.round(((Number(entry.gst) || 0) + (delta - deltaBase)) * 100) / 100;
        entry.total = Math.round(((Number(entry.total) || 0) + delta) * 100) / 100;
        const state = purchasePaymentState(entry.total, Number(entry.paid) || 0);
        entry.total = state.total;
        entry.balance = state.balance;
        entry.status = state.status;
        rateChange = { from: oldRate, to: newRate, delta };
        await SerialNumber.updateMany({ purchaseEntryId: String(entry._id), itemName: product?.name || line.name }, { $set: { price: newRate } });
        if (entry.supplierName && delta !== 0) {
          await Supplier.findOneAndUpdate({ name: entry.supplierName }, { $inc: { outstandingBalance: delta } });
        }
      }
    }
    entry.markModified("items");
    await entry.save();

    try {
      await AuditLog.create({
        action: "purchase-entry.serials.add",
        entityType: "PurchaseEntry",
        entityRef: entry.billNo,
        entityId: String(entry._id),
        partyName: entry.supplierName,
        amount: 0,
        reason: replace ? `Serial numbers replaced on ${line.name}: ${old.join(", ")} -> ${serials.join(", ")}` : `Serial numbers added to ${line.name}: ${serials.join(", ")}`,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        metadata: { rateChange, itemIndex, item: line.name, added: serials, removed: replace ? old : [], totalNow: line.serialNumbers.length, quantity: line.quantity },
      });
    } catch (e) {
      console.warn("Notice: audit log for serial add:", e);
    }
    return NextResponse.json({ success: true, data: { billNo: entry.billNo, item: line.name, serialNumbers: line.serialNumbers } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
