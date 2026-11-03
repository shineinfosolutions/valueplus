import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import CashRegisterSetting from "@/models/CashRegisterSetting";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { getCashRegisterSummary } from "@/lib/cashRegister";

export const dynamic = "force-dynamic";

/**
 * Set the register to the cash that is really in the drawer. The Admin enters the
 * counted cash; the starting figure becomes (counted - cash in + cash out recorded
 * so far), so the register shows exactly the counted amount now and moves with every
 * cash entry after it. Admin only; without `apply` it only shows the result.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (actor.role !== "admin" && actor.role !== "superadmin") {
      return NextResponse.json({ success: false, error: "Only the Admin can set the cash in hand." }, { status: 403 });
    }
    const body = await req.json();
    const counted = Number(body.countedCash);
    if (!Number.isFinite(counted) || counted < 0) {
      return NextResponse.json({ success: false, error: "Enter the cash that is in the drawer (0 or more)." }, { status: 400 });
    }

    await connectToDatabase();
    const summary = await getCashRegisterSummary();
    const net = summary.totalInflow - summary.totalOutflow; // recorded movements, without any opening figure
    const openingCash = Math.round((counted - net) * 100) / 100;

    if (body.apply === true) {
      const before = summary.baseOpening;
      await CashRegisterSetting.findOneAndUpdate(
        { key: "cash-register" },
        { $set: { openingCash, countedCash: counted, calibratedBy: actor.name, calibratedAt: new Date().toISOString() } },
        { upsert: true, setDefaultsOnInsert: true }
      );
      try {
        await AuditLog.create({
          action: "cashregister.calibrate",
          entityType: "CashRegister",
          entityRef: "main-showroom",
          amount: counted,
          reason: `Cash in hand set to ₹${counted} (register showed ₹${summary.currentBalance})`,
          performedBy: actor.name,
          performedByUserId: actor.id,
          performedByRole: actor.role,
          metadata: { registerBefore: summary.currentBalance, openingBefore: before, openingAfter: openingCash },
        });
      } catch (e) {
        console.warn("Notice: audit log for cash calibration:", e);
      }
    }

    return NextResponse.json({
      success: true,
      applied: body.apply === true,
      data: { registerNow: summary.currentBalance, counted, openingCash, recordedNet: Math.round(net * 100) / 100 },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
