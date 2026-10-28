import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import Item from "@/models/Item";

export async function GET() {
  try {
    await connectToDatabase();
    const items = await Item.find({ name: { $regex: /iphone/i } });
    if (!items.length) {
      return NextResponse.json({ success: true, message: "No iPhone items found." });
    }
    const codes = items.map(i => i.code);
    
    const invoices = await Invoice.find({ "items.itemCode": { $in: codes } });
    let totalQty = 0;
    let totalAmount = 0;
    invoices.forEach((inv: any) => {
      inv.items.forEach((item: any) => {
        if (codes.includes(item.itemCode)) {
          totalQty += item.quantity;
          totalAmount += item.amount;
        }
      });
    });
    
    return NextResponse.json({
      success: true,
      data: {
        itemsFound: items.map(i => `${i.name} (${i.code})`),
        totalQtySold: totalQty,
        totalAmountSold: totalAmount
      }
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
