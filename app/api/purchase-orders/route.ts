import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import PurchaseOrder from "@/models/PurchaseOrder";
import Supplier from "@/models/Supplier";
import Item from "@/models/Item";
import StaffTask from "@/models/StaffTask";

/**
 * A Purchase Order alone never updates stock — only a Purchase Entry
 * (the actual received bill) does. Without a nudge, a sent PO is easy to
 * forget about once the goods physically arrive, silently leaving stock
 * short. This drops a task on the shared board (visible on both the admin
 * and staff dashboards) reminding someone to record the entry.
 */
async function createEntryReminderTask(po: any) {
  try {
    const dueDate = po.expectedDate
      ? new Date(po.expectedDate).toISOString().split("T")[0]
      : new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    await StaffTask.create({
      taskTitle: `Record Purchase Entry for PO ${po.poNo}`,
      assignedStaff: "All Staff",
      dueDate,
      priority: "Medium",
      taskType: "general",
      description: `Purchase Order ${po.poNo} was sent to ${po.supplierName} for ${formatINR(po.totalAmount)}. Once the goods arrive, record a Purchase Entry (Supplier Bill) linked to this PO so stock updates — a PO alone does not add stock.`,
      createdBy: "System (Purchase Order Auto-Reminder)",
    });
  } catch (err) {
    console.warn("Notice: purchase entry reminder task:", err);
  }
}

function formatINR(amount: number) {
  return `₹${Math.round(Number(amount) || 0).toLocaleString("en-IN")}`;
}

/**
 * Placing (or editing) a Purchase Order updates the catalog's purchase price
 * immediately, the same rate a Purchase Entry would set — so Profit & Loss
 * reflects what was actually negotiated as soon as it's recorded, without
 * waiting for the supplier's bill. This never touches stock quantities: a PO
 * is an order, not received goods, so only cost basis moves here.
 */
async function syncPurchasePricesFromOrder(items: any[] | undefined) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const rate = Number(item.rate) || 0;
    if (rate <= 0) continue;
    try {
      let existingItem = null;
      if (item.itemId && mongoose.isValidObjectId(item.itemId)) {
        existingItem = await Item.findById(item.itemId);
      }
      if (!existingItem && item.name) {
        existingItem = await Item.findOne({ name: { $regex: new RegExp(`^${String(item.name).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } });
      }
      if (existingItem) {
        await Item.findByIdAndUpdate(existingItem._id, { $set: { purchasePrice: rate } });
      }
    } catch (err) {
      console.warn("Notice: purchase price sync from PO item:", err);
    }
  }
}

export async function GET() {
  try {
    await connectToDatabase();
    const pos = await PurchaseOrder.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: pos });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
    await connectToDatabase();

    // 1. Auto-create Supplier in Master if doesn't exist
    if (body.supplierName) {
      try {
        const supName = body.supplierName.trim();
        const supPhone = body.supplierPhone?.trim() || "";
        let existingSupplier = null;
        if (supPhone) {
          existingSupplier = await Supplier.findOne({ phone: supPhone });
        }
        if (!existingSupplier) {
          existingSupplier = await Supplier.findOne({ name: { $regex: new RegExp(`^${supName}$`, "i") } });
        }

        if (!existingSupplier) {
          const count = await Supplier.countDocuments();
          const suppCode = `SUPP-${String(count + 1).padStart(3, "0")}`;
          await Supplier.create({
            code: suppCode,
            name: supName,
            phone: supPhone || "0000000000",
            email: body.supplierEmail || "",
            gstNumber: body.supplierGstin || "",
            address: {
              line1: "Commercial Trade Hub / Store Outlet",
              city: "Mumbai",
              state: "Maharashtra",
              pincode: "400001",
              country: "India",
            },
            creditLimit: 100000,
            creditDays: 45,
            outstandingBalance: 0,
            status: "active",
          });
        }
      } catch (supErr) {
        console.warn("Supplier auto-create note:", supErr);
      }
    }

    let targetPoNo = body.poNo?.trim();
    if (!targetPoNo) {
      const count = await PurchaseOrder.countDocuments();
      targetPoNo = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
    }

    // Check if poNo already exists in DB
    let existing = await PurchaseOrder.findOne({ poNo: targetPoNo });
    if (existing) {
      // Auto-increment to next available number
      const count = await PurchaseOrder.countDocuments();
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      targetPoNo = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}-${randomSuffix}`;
    }

    const payload = {
      ...body,
      poNo: targetPoNo,
    };

    const po = await PurchaseOrder.create(payload);
    await syncPurchasePricesFromOrder(body.items);
    await createEntryReminderTask(po);
    return NextResponse.json({ success: true, data: po });
  } catch (error: any) {
    if (error.code === 11000) {
      // Fallback in case of race condition
      try {
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        const fallbackPoNo = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}-${randomSuffix}`;
        const fallbackPayload = { ...body, poNo: fallbackPoNo };
        const po = await PurchaseOrder.create(fallbackPayload);
        await syncPurchasePricesFromOrder(body.items);
        await createEntryReminderTask(po);
        return NextResponse.json({ success: true, data: po });
      } catch (retryErr: any) {
        return NextResponse.json({ success: false, error: "Failed to allocate unique PO number. Please try again." }, { status: 400 });
      }
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const poNo = searchParams.get("poNo");
    
    if (!poNo) {
      return NextResponse.json({ success: false, error: "poNo is required" }, { status: 400 });
    }

    const body = await req.json();
    await connectToDatabase();
    
    const updatedPO = await PurchaseOrder.findOneAndUpdate({ poNo }, body, { new: true });

    if (!updatedPO) {
      return NextResponse.json({ success: false, error: "Purchase Order not found" }, { status: 404 });
    }

    await syncPurchasePricesFromOrder(body.items);

    return NextResponse.json({ success: true, data: updatedPO });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const poNo = searchParams.get("poNo");
    
    if (!poNo) {
      return NextResponse.json({ success: false, error: "poNo is required" }, { status: 400 });
    }

    await connectToDatabase();
    const deletedPO = await PurchaseOrder.findOneAndDelete({ poNo });
    
    if (!deletedPO) {
      return NextResponse.json({ success: false, error: "Purchase Order not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: {} });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
