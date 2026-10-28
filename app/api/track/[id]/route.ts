import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Invoice from "@/models/Invoice";
import DeliveryChallan from "@/models/DeliveryChallan";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ success: false, error: "Tracking ID / Invoice Number required" }, { status: 400 });
    }

    const decodedId = decodeURIComponent(id).trim();

    // 1. Search in Invoices
    const invoice = await Invoice.findOne({
      $or: [
        { invoiceNumber: decodedId },
        { invoiceNumber: { $regex: new RegExp(`^${decodedId}$`, "i") } },
        { deliveryChallanNo: decodedId },
      ]
    }).lean();

    // 2. Search in DeliveryChallan
    const challan = await DeliveryChallan.findOne({
      $or: [
        { challanNo: decodedId },
        { invoiceNumber: decodedId },
      ]
    }).lean();

    if (!invoice && !challan) {
      return NextResponse.json({ success: false, error: "Order not found with provided tracking code" }, { status: 404 });
    }

    const invoiceData: any = invoice || {};
    const challanData: any = challan || {};

    const deliveryStatus = invoiceData.deliveryStatus || (challanData.status === "delivered" ? "delivered" : (challanData.status === "in-transit" ? "out_for_delivery" : "pending_dispatch"));

    const trackingInfo = {
      invoiceNumber: invoiceData.invoiceNumber || challanData.invoiceNumber || decodedId,
      challanNo: invoiceData.deliveryChallanNo || challanData.challanNo || "",
      date: invoiceData.date || challanData.date || new Date().toISOString(),
      customerName: invoiceData.customerName || challanData.destinationParty || "Valued Customer",
      customerPhone: invoiceData.customerPhone || challanData.customerPhone || "",
      shippingAddress: invoiceData.shippingAddress || invoiceData.customerAddress || challanData.destinationAddress || "Gorakhpur, Uttar Pradesh",
      billingAddress: invoiceData.customerAddress || "",
      deliveryStatus,
      dispatchType: invoiceData.dispatchType || "delayed_delivery",
      deliveryOtp: invoiceData.deliveryOtp || challanData.deliveryOtp || "",
      driverName: invoiceData.driverName || challanData.driverName || "Value Plus Logistics",
      driverPhone: invoiceData.driverPhone || challanData.driverPhone || "7985803562",
      vehicleNo: invoiceData.driverVehicleNo || invoiceData.vehicleNumber || challanData.vehicleNo || "UP53",
      deliveredAt: invoiceData.deliveredAt || challanData.deliveredAt || null,
      items: invoiceData.items?.map((it: any) => ({
        name: it.itemName,
        quantity: it.quantity,
        rate: it.rate,
        amount: it.amount,
      })) || [{
        name: challanData.itemName || "Electronics Appliance",
        quantity: challanData.quantity || 1,
        rate: challanData.itemPrice || 0,
        amount: challanData.itemPrice || 0,
      }],
      total: invoiceData.total || challanData.itemPrice || 0,
    };

    return NextResponse.json({ success: true, data: trackingInfo });
  } catch (error: any) {
    console.error("Public Track GET Error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch tracking details" }, { status: 500 });
  }
}
