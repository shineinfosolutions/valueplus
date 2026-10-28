import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import BillOfMaterial from "@/models/BillOfMaterial";

export async function GET() {
  try {
    await connectToDatabase();
    const boms = await BillOfMaterial.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: boms });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.bomNumber) {
      const count = await BillOfMaterial.countDocuments();
      body.bomNumber = `BOM-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;
    }
    
    const bom = await BillOfMaterial.create(body);
    return NextResponse.json({ success: true, data: bom });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "BOM number already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
