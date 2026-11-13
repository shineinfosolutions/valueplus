import { istToday } from "@/lib/ist";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import { salesRead } from "@/lib/repo/sales/shadow";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const staff = searchParams.get("staff") || searchParams.get("salesExecutive");

    const type = searchParams.get("type");
    // Bookings and invoices (or one type), optionally of one salesman by his full or first name, newest first
    // (lib/repo/sales/invoices.ts mongoOrderList), through the sales read switch.
    const orders = await salesRead("orders.list", type, staff);
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
      date: body.date || istToday(),
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
