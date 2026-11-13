import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import PurchaseEntry from "@/models/PurchaseEntry";
import { buildAgedStock } from "@/lib/agedStock";
import { readStock } from "@/lib/repo/stock/shadow-read";

/** Products still in stock whose last purchase was 6+ months or 1+ year ago. */
export async function GET() {
  try {
    await connectToDatabase();

    const [items, purchaseEntries] = await Promise.all([
      Item.find(
        { currentStock: { $gt: 0 } },
        { name: 1, code: 1, vpCode: 1, brand: 1, category: 1, currentStock: 1, sellingPrice: 1, purchasePrice: 1, createdAt: 1 }
      ).lean(),
      // Purchase bills through the read:stock switch (lib/repo/stock/shadow-read.ts); the items above stay on MongoDB.
      readStock<any[]>("purchaseEntries.agedStock", {}),
    ]);

    return NextResponse.json({ success: true, data: buildAgedStock(items, purchaseEntries) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
