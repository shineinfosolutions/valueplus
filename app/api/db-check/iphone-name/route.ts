import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";

export async function GET() {
  try {
    await connectToDatabase();
    
    // Find all invoices where any item's itemName matches 'iphone'
    const invoices = await Invoice.find({ "items.itemName": { $regex: /iphone/i } });
    
    let itemsFound: any[] = [];
    invoices.forEach((inv: any) => {
      inv.items.forEach((item: any) => {
        if (/iphone/i.test(item.itemName)) {
          itemsFound.push({
            itemName: item.itemName,
            itemCode: item.itemCode,
            quantity: item.quantity,
            amount: item.amount,
            invoiceId: inv.invoiceNumber
          });
        }
      });
    });
    
    return NextResponse.json({
      success: true,
      data: itemsFound
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
