import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");

    if (!code) {
      return NextResponse.json({ success: false, error: "Item code is required" }, { status: 400 });
    }

    await connectToDatabase();

    // Find all invoices/orders that contain this item code
    // Sales history only — an estimate that quoted this item did not sell it.
    const invoices = await Invoice.find({
      "items.itemCode": code,
      type: { $ne: "proforma" },
    }).sort({ createdAt: -1 });

    // Format the response to return a flattened list of sales history
    const history = [];
    for (const inv of invoices) {
      // Find the specific item in the invoice items array
      const itemSold = inv.items.find((i: any) => i.itemCode === code);
      if (itemSold) {
        history.push({
          invoiceId: inv._id,
          invoiceNumber: inv.invoiceNumber,
          type: inv.type,
          date: inv.date,
          customerName: inv.customerName,
          quantity: itemSold.quantity,
          rate: itemSold.rate,
          amount: itemSold.amount
        });
      }
    }

    // Sort by date descending (assuming date is YYYY-MM-DD)
    history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ success: true, data: history });
  } catch (error: any) {
    console.error("Error fetching item history:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
