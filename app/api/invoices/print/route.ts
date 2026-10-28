import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";

export async function POST(req: Request) {
  try {
    const { invoiceNumber, printedBy = "Store User" } = await req.json();

    if (!invoiceNumber) {
      return NextResponse.json({ success: false, error: "Invoice Number is required" }, { status: 400 });
    }

    await connectToDatabase();

    const updated = await Invoice.findOneAndUpdate(
      { invoiceNumber },
      {
        $inc: { reprintCount: 1 },
        $set: { lastPrintedAt: new Date().toISOString(), lastModifiedReason: "reprint" },
        $push: {
          printLogs: {
            printedAt: new Date().toISOString(),
            printedBy,
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Reprint logged successfully",
      reprintCount: updated.reprintCount || 1,
      lastPrintedAt: updated.lastPrintedAt,
    });
  } catch (error: any) {
    console.error("Error logging reprint count:", error);
    return NextResponse.json({ success: false, error: error.message || "Failed to log reprint" }, { status: 500 });
  }
}
