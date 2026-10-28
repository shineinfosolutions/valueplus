import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import StockRequest from "@/models/StockRequest";

export async function GET() {
  try {
    await connectToDatabase();
    const requests = await StockRequest.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: requests });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.requestNumber) {
      const count = await StockRequest.countDocuments();
      body.requestNumber = `SRQ-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
    }
    
    // Fix Cast to ObjectId error for empty strings
    if (body.requestingWarehouseId === "") delete body.requestingWarehouseId;
    if (body.supplyingWarehouseId === "") delete body.supplyingWarehouseId;
    
    const request = await StockRequest.create(body);
    return NextResponse.json({ success: true, data: request });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
