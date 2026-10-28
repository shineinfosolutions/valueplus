import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StockJournal from "@/models/StockJournal";
import { applyStockMovement } from "@/lib/stock";

export async function GET() {
  try {
    await connectToDatabase();
    const journals = await StockJournal.find({}).sort({ createdAt: -1 }).lean();
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
      body.journalNumber = `SJ-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
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
