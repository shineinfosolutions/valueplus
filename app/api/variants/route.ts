import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Variant from "@/models/Variant";
import { readStock } from "@/lib/repo/stock/shadow-read";

export async function GET() {
  try {
    // Read through the read:stock switch (lib/repo/stock/shadow-read.ts): MongoDB, MongoDB compared with D1, or D1.
    const variants = await readStock("variants.list", {});
    return NextResponse.json({ success: true, data: variants });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const body = await request.json();

    const newVariant = await Variant.create({
      name: body.name,
      values: body.values || [],
      status: body.status || "active",
    });

    return NextResponse.json({ success: true, message: "Variant added successfully!", data: newVariant });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "Variant name already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    
    if (!id) {
      return NextResponse.json({ success: false, error: "ID is required" }, { status: 400 });
    }
    
    await connectToDatabase();
    const deletedVariant = await Variant.findByIdAndDelete(id);
    
    if (!deletedVariant) {
      return NextResponse.json({ success: false, error: "Variant not found" }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, message: "Variant deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
