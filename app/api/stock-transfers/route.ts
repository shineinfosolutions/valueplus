import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StockTransfer from "@/models/StockTransfer";
import Warehouse from "@/models/Warehouse";
import Item from "@/models/Item";
import { applyStockMovement } from "@/lib/stock";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveWarehouseId(name: string): Promise<string | null> {
  if (!name) return null;
  const escaped = escapeRegex(name);
  const warehouse = await Warehouse.findOne({ name: { $regex: new RegExp(`^${escaped}$`, "i") } }).lean();
  return warehouse ? String((warehouse as any)._id) : null;
}

export async function GET() {
  try {
    await connectToDatabase();
    const transfers = await StockTransfer.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: transfers });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    const fromWarehouseId = body.fromWarehouseId || (await resolveWarehouseId(body.fromWarehouse));
    const toWarehouseId = body.toWarehouseId || (await resolveWarehouseId(body.toWarehouse));

    // Snapshot each item's cost price at transfer time — this is an internal
    // stock move, not a sale, so it's priced at cost, never at a selling price.
    const itemIds = (body.items || []).map((i: any) => i.itemId).filter(Boolean);
    const catalogItems = itemIds.length ? await Item.find({ _id: { $in: itemIds } }).lean() : [];
    const costById = new Map(catalogItems.map((it: any) => [String(it._id), Number(it.purchasePrice) || 0]));

    const itemsWithCost = (body.items || []).map((i: any) => ({
      ...i,
      costPrice: costById.get(String(i.itemId)) || 0,
    }));
    const totalValue = itemsWithCost.reduce((sum: number, i: any) => sum + i.costPrice * (Number(i.quantity) || 0), 0);

    const payload = {
      ...body,
      items: itemsWithCost,
      totalValue,
      fromWarehouseId: fromWarehouseId || undefined,
      toWarehouseId: toWarehouseId || undefined,
      transferNo: body.transferNo || `STR-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`,
      status: body.status || "in-transit",
    };

    const transfer = await StockTransfer.create(payload);

    // Deduct stock from the source warehouse's own entry on the same item —
    // no duplicate Item document is created for the destination; receipt
    // below credits the same item's entry for the destination warehouse.
    if (body.items && Array.isArray(body.items)) {
      for (const item of body.items) {
        if (item.itemId && item.quantity) {
          await applyStockMovement(item.itemId, fromWarehouseId, -Number(item.quantity));
        }
      }
    }

    return NextResponse.json({ success: true, data: transfer, message: `Stock transfer ${transfer.transferNo} dispatched from ${transfer.fromWarehouse} to ${transfer.toWarehouse}` });
  } catch (error: any) {
    if (error.code === 11000) {
       return NextResponse.json({ success: false, error: "Transfer number already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const transferNo = searchParams.get("transferNo");

    if (!transferNo) {
      return NextResponse.json({ success: false, error: "transferNo is required" }, { status: 400 });
    }

    const body = await req.json();
    await connectToDatabase();

    const existingTransfer = await StockTransfer.findOne({ transferNo });
    if (!existingTransfer) {
      return NextResponse.json({ success: false, error: "Stock Transfer not found" }, { status: 404 });
    }

    // If status changed to 'received' or 'completed', credit the destination
    // warehouse's entry on the SAME item that was debited at dispatch.
    if (body.status === "received" && existingTransfer.status !== "received") {
      const toWarehouseId =
        (existingTransfer as any).toWarehouseId
          ? String((existingTransfer as any).toWarehouseId)
          : await resolveWarehouseId(existingTransfer.toWarehouse);

      for (const item of existingTransfer.items) {
        if (item.itemId && item.quantity) {
          await applyStockMovement(item.itemId, toWarehouseId, Number(item.quantity));
        }
      }
    }

    const updatedTransfer = await StockTransfer.findOneAndUpdate({ transferNo }, body, { new: true });
    return NextResponse.json({ success: true, data: updatedTransfer, message: `Transfer status updated to ${body.status}` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const transferNo = searchParams.get("transferNo");

    if (!transferNo) {
      return NextResponse.json({ success: false, error: "transferNo is required" }, { status: 400 });
    }

    await connectToDatabase();
    const deletedTransfer = await StockTransfer.findOneAndDelete({ transferNo });

    if (!deletedTransfer) {
      return NextResponse.json({ success: false, error: "Stock Transfer not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: {} });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
