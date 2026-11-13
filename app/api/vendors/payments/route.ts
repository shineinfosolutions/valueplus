import { istToday } from "@/lib/ist";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Vendor from "@/models/Vendor";
import VendorBill from "@/models/VendorBill";
import VendorPayment from "@/models/VendorPayment";
import { requirePermission } from "@/lib/requirePermission";
import { readStock } from "@/lib/repo/stock/shadow-read";

export async function GET(req: Request) {
  const gate = await requirePermission("ledger.vendor.view");
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(req.url);
    const vendorId = searchParams.get("vendorId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // Through the read:stock switch (lib/repo/stock/shadow-read.ts): MongoDB, MongoDB compared with D1, or D1.
    // One vendor if asked, payment date within from..to if given; newest first.
    const payments = await readStock("vendorPayments.list", { vendorId, from, to });
    return NextResponse.json({ success: true, data: payments });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requirePermission("payment.record");
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    await connectToDatabase();

    const vendor = await Vendor.findById(body.vendorId);
    if (!vendor) {
      return NextResponse.json({ success: false, error: "Vendor not found" }, { status: 404 });
    }

    const amount = Number(body.amount);
    if (!(amount > 0)) {
      return NextResponse.json({ success: false, error: "Enter a payment amount greater than zero" }, { status: 400 });
    }

    if (body.againstBillNo) {
      const bill = await VendorBill.findOne({ billNo: body.againstBillNo, vendorId: String(vendor._id) });
      if (!bill) {
        return NextResponse.json(
          { success: false, error: `Bill ${body.againstBillNo} does not belong to this vendor.` },
          { status: 400 }
        );
      }
    }

    const payment = await VendorPayment.create({
      paymentId: `VP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      vendorId: String(vendor._id),
      vendorName: vendor.name,
      date: body.date || istToday(),
      amount,
      mode: body.mode || "Cash",
      refNo: body.refNo || "",
      againstBillNo: body.againstBillNo || "",
      receivedBy: body.receivedBy || gate.actor.name,
      notes: body.notes || "",
      type: body.type === "paid" ? "paid" : "received",
      createdBy: gate.actor.name,
      createdByRole: gate.actor.role,
    });

    return NextResponse.json({ success: true, data: payment });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requirePermission("payment.record");
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "Payment id is required" }, { status: 400 });
    }

    await connectToDatabase();
    const removed = await VendorPayment.findByIdAndDelete(id);
    if (!removed) {
      return NextResponse.json({ success: false, error: "Payment not found" }, { status: 404 });
    }

    // The ledger is derived from these rows, so removing one is enough — there is
    // no denormalised balance to unwind.
    return NextResponse.json({ success: true, message: "Payment removed" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
