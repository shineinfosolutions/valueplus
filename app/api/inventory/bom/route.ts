import { istYear } from "@/lib/ist";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import BillOfMaterial from "@/models/BillOfMaterial";
import { readStock } from "@/lib/repo/stock/shadow-read";

export async function GET() {
  try {
    // Read through the read:stock switch (lib/repo/stock/shadow-read.ts): MongoDB, MongoDB compared with D1, or D1.
    const boms = await readStock("billOfMaterials.list", {});
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
      body.bomNumber = `BOM-${istYear()}-${String(count + 1).padStart(4, '0')}`;
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
