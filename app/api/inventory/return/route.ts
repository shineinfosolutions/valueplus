import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import StockReturn from "@/models/StockReturn";
import Item from "@/models/Item";

export async function GET() {
  try {
    await connectToDatabase();
    const returns = await StockReturn.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: returns });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.returnNumber) {
      const count = await StockReturn.countDocuments();
      body.returnNumber = `SRT-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
    }
    
    const stockReturn = await StockReturn.create(body);
    
    // Auto-update stock
    if (body.status === "Completed") {
      for (const line of body.items) {
        if (mongoose.Types.ObjectId.isValid(line.itemId)) {
          const item = await Item.findById(line.itemId);
          if (item) {
            // If Customer Return, stock increases. If Supplier Return, stock decreases.
            if (body.returnType === "Customer Return") {
              item.currentStock = (item.currentStock || 0) + Number(line.quantity);
            } else if (body.returnType === "Supplier Return") {
              item.currentStock = (item.currentStock || 0) - Number(line.quantity);
            }
            await item.save();
          }
        }
      }
    }

    return NextResponse.json({ success: true, data: stockReturn });
  } catch (error: any) {
    console.error("Stock Return Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error?.message || String(error) || "Unknown server error occurred" 
    }, { status: 400 });
  }
}
