import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Vendor from "@/models/Vendor";
import VendorBill from "@/models/VendorBill";
import { requirePermission } from "@/lib/requirePermission";

async function nextBillNo(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `VB-${year}-`;
  const bills = await VendorBill.find({ billNo: { $regex: `^${prefix}` } }, { billNo: 1 }).lean();
  let max = 0;
  for (const b of bills as any[]) {
    const n = parseInt(String(b.billNo).slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export async function GET(req: Request) {
  const gate = await requirePermission("ledger.vendor.view");
  if (!gate.ok) return gate.response;

  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const vendorId = searchParams.get("vendorId");

    const filter: any = {};
    if (vendorId) filter.vendorId = vendorId;

    const bills = await VendorBill.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: bills });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requirePermission("vendor.manage");
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    await connectToDatabase();

    const vendor = await Vendor.findById(body.vendorId);
    if (!vendor) {
      return NextResponse.json({ success: false, error: "Vendor not found" }, { status: 404 });
    }

    const items = Array.isArray(body.items) ? body.items : [];
    const subtotal = items.length
      ? items.reduce((sum: number, it: any) => sum + (Number(it.amount) || Number(it.quantity) * Number(it.rate) || 0), 0)
      : Number(body.subtotal) || 0;

    const gstRate = Number(body.gstRate) || 0;
    const gstAmount = body.gstAmount !== undefined ? Number(body.gstAmount) : (subtotal * gstRate) / 100;
    const total = body.total !== undefined ? Number(body.total) : subtotal + gstAmount;

    if (!(total > 0)) {
      return NextResponse.json({ success: false, error: "Bill total must be greater than zero" }, { status: 400 });
    }

    const date = body.date || new Date().toISOString().split("T")[0];
    let dueDate = body.dueDate;
    if (!dueDate) {
      const d = new Date(date);
      d.setDate(d.getDate() + (Number(vendor.creditDays) || 30));
      dueDate = d.toISOString().split("T")[0];
    }

    const billNo = String(body.billNo || "").trim() || (await nextBillNo());
    const clash = await VendorBill.findOne({ billNo });
    if (clash) {
      return NextResponse.json(
        { success: false, error: `Bill number ${billNo} is already used by ${clash.vendorName}.` },
        { status: 400 }
      );
    }

    const bill = await VendorBill.create({
      billNo,
      vendorId: String(vendor._id),
      vendorName: vendor.name,
      date,
      dueDate,
      items: items.map((it: any) => ({
        name: it.name || "",
        description: it.description || "",
        quantity: Number(it.quantity) || 1,
        rate: Number(it.rate) || 0,
        amount: Number(it.amount) || (Number(it.quantity) || 1) * (Number(it.rate) || 0),
      })),
      subtotal,
      gstRate,
      gstAmount,
      total,
      notes: body.notes || "",
      reference: body.reference || "",
      status: "open",
      createdBy: gate.actor.name,
    });

    return NextResponse.json({ success: true, data: bill });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "This bill number already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const gate = await requirePermission("vendor.manage");
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    await connectToDatabase();

    if (!body.billNo) {
      return NextResponse.json({ success: false, error: "Bill number is required" }, { status: 400 });
    }

    // Cancelling keeps the row so the ledger still shows what happened; the ledger
    // engine simply stops counting a cancelled bill towards the balance.
    if (body.action === "cancel") {
      if (!String(body.reason || "").trim()) {
        return NextResponse.json({ success: false, error: "A reason is required to cancel a bill" }, { status: 400 });
      }
      const cancelled = await VendorBill.findOneAndUpdate(
        { billNo: body.billNo },
        {
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
          cancelledBy: gate.actor.name,
          cancelReason: String(body.reason).trim(),
        },
        { new: true }
      );
      if (!cancelled) {
        return NextResponse.json({ success: false, error: "Bill not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: cancelled });
    }

    const { _id, billNo, vendorId, createdAt, updatedAt, ...updatable } = body;
    const updated = await VendorBill.findOneAndUpdate({ billNo: body.billNo }, updatable, { new: true });
    if (!updated) {
      return NextResponse.json({ success: false, error: "Bill not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
