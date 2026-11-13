import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Unit from "@/models/Unit";
import { readWithShadow } from "@/lib/d1/shadow";
import { listUnits } from "@/lib/repo/masters/lists";
import { MASTER_COMPARE } from "@/lib/repo/masters/compare";

export async function GET() {
  try {
    // Master-data read through the D1 switch (lib/d1/shadow.ts): MongoDB, MongoDB compared with D1, or D1.
    const units = await readWithShadow(
      "masters",
      "units.list",
      async () => {
        await connectToDatabase();
        return Unit.find({}).sort({ createdAt: -1 }).lean();
      },
      (db) => listUnits(db),
      { compare: MASTER_COMPARE["units.list"] }
    );
    return NextResponse.json({ success: true, data: units });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const body = await request.json();

    const newUnit = await Unit.create({
      name: body.name,
      shortName: body.shortName,
      type: body.type || "count",
      status: body.status || "active",
    });

    return NextResponse.json({ success: true, message: "Unit added successfully!", data: newUnit });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "Unit name or short name already exists" }, { status: 400 });
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
    const deletedUnit = await Unit.findByIdAndDelete(id);
    
    if (!deletedUnit) {
      return NextResponse.json({ success: false, error: "Unit not found" }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, message: "Unit deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
