import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Invoice from "@/models/Invoice";
import DeliveryChallan from "@/models/DeliveryChallan";

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();
    const { action, invoiceNumber, challanNo, otp, driverName, driverPhone, vehicleNo } = body;

    if (!invoiceNumber && !challanNo) {
      return NextResponse.json({ success: false, error: "Invoice Number or Challan Number is required" }, { status: 400 });
    }

    // 1. Find matching invoice and challan
    const invoiceQuery = invoiceNumber ? { invoiceNumber } : { deliveryChallanNo: challanNo };
    const invoice = await Invoice.findOne(invoiceQuery);

    const challanQuery = challanNo ? { challanNo } : { invoiceNumber };
    const challan = await DeliveryChallan.findOne(challanQuery);

    // ─── ACTION: OUT FOR DELIVERY ─────────────────────────────────────
    if (action === "out_for_delivery") {
      const generatedOtp = invoice?.deliveryOtp || challan?.deliveryOtp || Math.floor(1000 + Math.random() * 9000).toString();
      
      if (invoice) {
        invoice.deliveryStatus = "out_for_delivery";
        invoice.deliveryOtp = generatedOtp;
        if (driverName) invoice.driverName = driverName;
        if (driverPhone) invoice.driverPhone = driverPhone;
        if (vehicleNo) invoice.driverVehicleNo = vehicleNo;
        await invoice.save();
      }

      if (challan) {
        challan.status = "in-transit";
        challan.deliveryOtp = generatedOtp;
        if (driverName) challan.driverName = driverName;
        if (driverPhone) challan.driverPhone = driverPhone;
        if (vehicleNo) challan.vehicleNo = vehicleNo;
        await challan.save();
      }

      const invNo = invoice?.invoiceNumber || challan?.invoiceNumber || challanNo;
      const trackingUrl = `/track/${invNo}`;

      return NextResponse.json({
        success: true,
        message: "Status updated to Out For Delivery",
        data: {
          invoiceNumber: invNo,
          deliveryStatus: "out_for_delivery",
          otp: generatedOtp,
          driverName: driverName || invoice?.driverName || "Delivery Boy",
          driverPhone: driverPhone || invoice?.driverPhone || "",
          vehicleNo: vehicleNo || invoice?.driverVehicleNo || "",
          customerPhone: invoice?.customerPhone || challan?.customerPhone || "",
          customerName: invoice?.customerName || challan?.destinationParty || "Customer",
          trackingUrl,
        }
      });
    }

    // ─── ACTION: VERIFY OTP & COMPLETE DELIVERY ───────────────────────
    if (action === "verify_otp") {
      if (!otp) {
        return NextResponse.json({ success: false, error: "Please enter the 4-digit Delivery OTP provided by customer" }, { status: 400 });
      }

      const actualOtp = invoice?.deliveryOtp || challan?.deliveryOtp;
      
      // Strict or fallback match
      if (!actualOtp || actualOtp.trim() !== String(otp).trim()) {
        return NextResponse.json({ 
          success: false, 
          error: "❌ Invalid OTP! Please request the correct 4-digit OTP from the customer." 
        }, { status: 400 });
      }

      const now = new Date();

      if (invoice) {
        invoice.deliveryStatus = "delivered";
        invoice.deliveredAt = now;
        await invoice.save();
      }

      if (challan) {
        challan.status = "delivered";
        challan.deliveredAt = now;
        await challan.save();
      }

      return NextResponse.json({
        success: true,
        message: "✅ Delivery Verified & Completed Successfully!",
        data: {
          invoiceNumber: invoice?.invoiceNumber || challan?.invoiceNumber,
          deliveryStatus: "delivered",
          deliveredAt: now,
          customerName: invoice?.customerName || challan?.destinationParty,
        }
      });
    }

    return NextResponse.json({ success: false, error: "Invalid action specified" }, { status: 400 });
  } catch (error: any) {
    console.error("Delivery OTP Route Error:", error);
    return NextResponse.json({ success: false, error: error.message || "Failed to process delivery action" }, { status: 500 });
  }
}
