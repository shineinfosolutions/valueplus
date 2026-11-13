import { istYear } from "@/lib/ist";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StockJournal from "@/models/StockJournal";
import { applyStockMovement } from "@/lib/stock";
import { readStock } from "@/lib/repo/stock/shadow-read";

export async function GET() {
  try {
    // Read through the read:stock switch (lib/repo/stock/shadow-read.ts): MongoDB, MongoDB compared with D1, or D1.
    const journals = await readStock("stockJournals.list", {});
    return NextResponse.json({ success: true, data: journals });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.journalNumber) {
      const count = await StockJournal.countDocuments();
      body.journalNumber = `SJ-${istYear()}-${String(count + 1).padStart(4, '0')}`;
    }
    
    const journal = await StockJournal.create(body);

    // Auto-update stock, scoped to each line's own warehouse where given.
    for (const line of body.items) {
      if (!line.itemId || !line.quantity) continue;
      const delta = line.type === "in" ? Number(line.quantity) : -Number(line.quantity);
      await applyStockMovement(line.itemId, line.warehouseId || null, delta);
    }

    return NextResponse.json({ success: true, data: journal });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
