import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const staff = searchParams.get("staff") || searchParams.get("salesExecutive");

    await connectToDatabase();

    const type = searchParams.get("type");
    const filter: any = type ? { type } : { type: { $in: ["sales-order", "tax-invoice"] } };

    if (staff && staff !== "all") {
      const firstName = staff.trim().split(" ")[0];
      filter.$or = [
        { salesExecutive: { $regex: new RegExp(staff, "i") } },
        { salesExecutive: { $regex: new RegExp(firstName, "i") } },
        { createdBy: { $regex: new RegExp(staff, "i") } },
        { createdBy: { $regex: new RegExp(firstName, "i") } },
        { salesperson: { $regex: new RegExp(staff, "i") } },
        { salesperson: { $regex: new RegExp(firstName, "i") } },
      ];
    }

    const orders = await Invoice.find(filter).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: orders });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const body = await request.json();

    const newOrder = await Invoice.create({
      invoiceNumber: body.orderNo || `SO-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      type: "sales-order",
      customerId: body.customerId || "CUST-000",
      customerName: body.customerName,
      salesExecutive: body.salesExecutive || body.staffName || "Admin",
      createdBy: body.createdBy || body.salesExecutive || "Admin",
      date: body.date || new Date().toISOString().split("T")[0],
      dueDate: body.deliveryDate || body.date,
      status: body.orderStatus || "sent",
      items: [
        {
          itemId: "ITM-000",
          itemName: "Order Items",
          itemCode: "MISC",
          quantity: Number(body.itemsCount) || 1,
          unit: "Pcs",
          rate: Number(body.totalAmount) || 0,
          taxableAmount: Number(body.totalAmount) || 0,
          gstRate: 0,
          amount: Number(body.totalAmount) || 0,
        }
      ],
      subtotal: Number(body.totalAmount) || 0,
      taxableAmount: Number(body.totalAmount) || 0,
      totalGST: 0,
      total: Number(body.totalAmount) || 0,
      balanceAmount: body.paymentStatus === "Paid" ? 0 : Number(body.totalAmount) || 0,
      paidAmount: body.paymentStatus === "Paid" ? Number(body.totalAmount) || 0 : 0,
      notes: `Payment Status: ${body.paymentStatus}`,
    });

    if (newOrder.paidAmount > 0) {
      const PaymentTransaction = (await import("@/models/PaymentTransaction")).default;
      await PaymentTransaction.create({
        transactionId: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        partyId: newOrder.customerId,
        partyType: "Customer",
        partyName: newOrder.customerName,
        amount: newOrder.paidAmount,
        paymentMode: body.paymentMode || "Unclassified",
        date: newOrder.date,
        referenceId: newOrder.invoiceNumber,
        notes: `Initial payment for sales order ${newOrder.invoiceNumber}`,
        type: "received"
      });
    }

    return NextResponse.json({ success: true, message: "Sales Order added successfully!", data: newOrder });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
