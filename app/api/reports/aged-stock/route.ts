import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import PurchaseEntry from "@/models/PurchaseEntry";
import { buildAgedStock } from "@/lib/agedStock";

/** Products still in stock whose last purchase was 6+ months or 1+ year ago. */
export async function GET() {
  try {
    await connectToDatabase();

    const [items, purchaseEntries] = await Promise.all([
      Item.find(
        { currentStock: { $gt: 0 } },
        { name: 1, code: 1, vpCode: 1, brand: 1, category: 1, currentStock: 1, sellingPrice: 1, purchasePrice: 1, createdAt: 1 }
      ).lean(),
      PurchaseEntry.find({}, { billDate: 1, date: 1, createdAt: 1, status: 1, type: 1, "items.itemId": 1, "items.name": 1 }).lean(),
    ]);

    return NextResponse.json({ success: true, data: buildAgedStock(items, purchaseEntries) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
