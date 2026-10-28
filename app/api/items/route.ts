import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import Invoice from "@/models/Invoice";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const brand = searchParams.get("brand");
    const category = searchParams.get("category");
    const warehouse = searchParams.get("warehouse") || searchParams.get("location");

    await connectToDatabase();

    const filter: any = {};
    if (brand && brand !== "all") {
      filter.brand = { $regex: new RegExp(`^${brand.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") };
    }
    if (category && category !== "all") {
      filter.category = { $regex: new RegExp(`^${category.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") };
    }

    // A real warehouse id (the normal case now) matches the actual
    // stockByWarehouse entry. Anything else falls back to the old
    // keyword/name matching against the free-text `warehouse` field, for
    // callers that predate this and still send "godown"/"showroom"/a name.
    if (warehouse && warehouse !== "all") {
      if (mongoose.isValidObjectId(warehouse)) {
        filter["stockByWarehouse.warehouseId"] = warehouse;
      } else {
        const lowerWh = warehouse.toLowerCase().trim();
        if (lowerWh === "godown" || lowerWh === "warehouse") {
          filter.warehouse = { $regex: /godown/i };
        } else if (lowerWh === "showroom" || lowerWh.includes("ashoka") || lowerWh.includes("kunraghat") || lowerWh === "vp-kun") {
          filter.$or = [
            { warehouse: { $exists: false } },
            { warehouse: "" },
            { warehouse: null },
            { warehouse: { $regex: /showroom|ashoka|kunraghat|vp-kun|main\s*store/i } },
            { warehouse: { $not: /godown/i } }
          ];
        } else {
          const cleanWh = warehouse.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filter.warehouse = { $regex: new RegExp(cleanWh, "i") };
        }
      }
    }

    const items = await Item.find(filter).sort({ currentStock: -1, name: 1 }).lean();

    // When filtered to one real warehouse, also surface how much of each
    // item sits specifically there — callers that only read `currentStock`
    // keep working unchanged.
    const data = mongoose.isValidObjectId(warehouse)
      ? items.map((it: any) => ({
          ...it,
          stockAtWarehouse:
            (it.stockByWarehouse || []).find((e: any) => String(e.warehouseId) === warehouse)?.qty || 0,
        }))
      : items;

    // Units already sold on a bill whose goods are kept aside for a later
    // delivery: off stock, but still physically in the store. Shown on the
    // product so they are not sold to someone else.
    const pendingDelivery: any[] = await Invoice.aggregate([
      {
        $match: {
          dispatchType: "delayed_delivery",
          deliveryStatus: { $in: ["pending_dispatch", "packed"] },
          status: { $ne: "cancelled" },
          type: { $nin: ["proforma", "credit-note"] },
        },
      },
      { $unwind: "$items" },
      { $group: { _id: "$items.itemId", qty: { $sum: "$items.quantity" }, bills: { $addToSet: "$invoiceNumber" } } },
    ]).catch(() => []);
    const awaiting = new Map(pendingDelivery.map((p) => [String(p._id), p]));
    const withAwaiting = (data as any[]).map((it) => {
      const p = awaiting.get(String(it._id));
      return p ? { ...it, awaitingDeliveryQty: p.qty, awaitingDeliveryBills: p.bills } : it;
    });

    return NextResponse.json({ success: true, data: withAwaiting });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}


export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    const payload = {
      ...body,
      hsnCode: body.hsn || body.hsnCode,
    };

    // Check if item exists by exact name (case-insensitive)
    // Escape regex characters in payload.name just in case
    const escapedName = payload.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingItem = await Item.findOne({ name: { $regex: new RegExp(`^${escapedName}$`, "i") } });

    if (existingItem) {
      // Update existing item
      existingItem.currentStock = (existingItem.currentStock || 0) + (Number(payload.currentStock) || 0);
      if (payload.hsnCode) {
        existingItem.hsnCode = payload.hsnCode;
      }
      await existingItem.save();
      return NextResponse.json({ success: true, data: existingItem, message: "Existing item stock and HSN updated" });
    } else {
      // Create new item
      const item = await Item.create(payload);
      return NextResponse.json({ success: true, data: item });
    }
  } catch (error: any) {
    if (error.code === 11000) {
       return NextResponse.json({ success: false, error: "Item code already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    
    if (!code) {
      return NextResponse.json({ success: false, error: "Item code is required" }, { status: 400 });
    }

    await connectToDatabase();
    await Item.findOneAndDelete({ code });

    return NextResponse.json({ success: true, message: "Item deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    const payload: any = {
      ...body,
      hsnCode: body.hsn || body.hsnCode,
    };

    // currentStock/showroomStock/godownStock are derived from stockByWarehouse
    // by lib/stock.ts on every real stock movement (purchase, sale, transfer,
    // adjustment) — writing them directly from an edit form here would silently
    // desync them from stockByWarehouse until the next movement recomputes and
    // overwrites whatever was typed in. Stock corrections belong in Inventory
    // Adjustment, which goes through that same helper.
    delete payload.currentStock;
    delete payload.showroomStock;
    delete payload.godownStock;

    if (!payload.code) {
      return NextResponse.json({ success: false, error: "Item code is required for update" }, { status: 400 });
    }

    const updatedItem = await Item.findOneAndUpdate({ code: payload.code }, payload, { new: true });
    
    if (!updatedItem) {
      return NextResponse.json({ success: false, error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Item updated successfully", data: updatedItem });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
