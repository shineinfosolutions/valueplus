import { deferIfManager } from "@/lib/deferred-actions";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StockAdjustment from "@/models/StockAdjustment";
import { applyStockMovement } from "@/lib/stock";

export async function GET() {
  try {
    await connectToDatabase();
    const adjustments = await StockAdjustment.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: adjustments });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const waiting = await deferIfManager(req, {
      title: "Stock adjustment",
      description: `Stock adjustment (${body.type || "adjust"}) of ${(body.items || []).length} product(s)${body.reason ? `: ${body.reason}` : ""}.`,
      target: `stock.adjust:${JSON.stringify(body.items || []).slice(0, 200)}`,
      reason: body.reason,
      body,
    });
    if (waiting) return waiting;
    if (!body.warehouseId) {
      return NextResponse.json({ success: false, error: "Select which warehouse this adjustment applies to." }, { status: 400 });
    }

    await connectToDatabase();

    const adjustmentNo = body.adjustmentNo || `ADJ-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
    const payload = { ...body, adjustmentNo };

    const adjustment = await StockAdjustment.create(payload);

    // Update stock for each item based on type, scoped to the adjustment's warehouse.
    if (body.items && Array.isArray(body.items)) {
      for (const item of body.items) {
        if (item.itemId && item.quantity) {
          const qty = Number(item.quantity);
          const delta = item.type === "in" ? qty : -qty;
          await applyStockMovement(item.itemId, body.warehouseId, delta);
        }
      }
    }

    return NextResponse.json({ success: true, data: adjustment });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "Adjustment number already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const adjustmentNo = searchParams.get("adjustmentNo");

    if (!adjustmentNo) {
      return NextResponse.json({ success: false, error: "adjustmentNo is required" }, { status: 400 });
    }
    const waiting = await deferIfManager(req, { title: `Delete stock adjustment ${adjustmentNo}`, description: `Delete the stock adjustment ${adjustmentNo}.`, target: `stock.adjust.delete:${adjustmentNo}` });
    if (waiting) return waiting;

    await connectToDatabase();
    const deletedAdjustment = await StockAdjustment.findOneAndDelete({ adjustmentNo });

    if (!deletedAdjustment) {
      return NextResponse.json({ success: false, error: "Stock Adjustment not found" }, { status: 404 });
    }

    // Reverse the stock impact, against the same warehouse it was applied to —
    // older adjustments made before warehouseId existed fall back to the
    // untargeted adjustment applyStockMovement already supports.
    const warehouseId = (deletedAdjustment as any).warehouseId ? String((deletedAdjustment as any).warehouseId) : null;
    if (deletedAdjustment.items && Array.isArray(deletedAdjustment.items)) {
      for (const item of deletedAdjustment.items) {
        if (item.itemId && item.quantity) {
          const qty = Number(item.quantity);
          const delta = item.type === "in" ? -qty : qty; // Reversing the original operation
          await applyStockMovement(item.itemId, warehouseId, delta);
        }
      }
    }

    return NextResponse.json({ success: true, data: {} });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
