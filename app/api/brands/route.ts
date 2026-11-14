import { NextResponse } from "next/server";
import { getWriteMode } from "@/lib/d1/write-mode";
import * as mastersWrites from "@/lib/repo/masters/writes";
import connectToDatabase from "@/lib/db";
import Brand from "@/models/Brand";
import Item from "@/models/Item";
import { readWithShadow } from "@/lib/d1/shadow";
import { listBrandsWithCounts } from "@/lib/repo/masters/lists";
import { MASTER_COMPARE } from "@/lib/repo/masters/compare";

export async function GET() {
  try {
    // Master-data read through the D1 switch (lib/d1/shadow.ts): MongoDB, MongoDB compared with D1, or D1.
    const brandsWithItemCount = await readWithShadow(
      "masters",
      "brands.list",
      async () => {
        await connectToDatabase();
        const brands = await Brand.find({}).collation({ locale: "en", strength: 2 }).sort({ name: 1 }).lean();

        // Add item count to each brand
        return Promise.all(
          brands.map(async (brand: any) => {
            const itemCount = await Item.countDocuments({ brand: brand.name });
            return { ...brand, items: itemCount };
          })
        );
      },
      (db) => listBrandsWithCounts(db),
      { compare: MASTER_COMPARE["brands.list"] }
    );

    return NextResponse.json({ success: true, data: brandsWithItemCount });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Stage D (docs/D1_MIGRATION_PLAN.md §6.8a): while write:masters is 'mongo' (the default) this is the MongoDB
  // code below, unchanged; in 'd1' the same write is made on D1 (lib/repo/masters/writes.ts), in 'fence' it waits.
  const writeMode = await getWriteMode("masters");
  if (writeMode !== "mongo") return mastersWrites.createBrand(request, writeMode);

  try {
    await connectToDatabase();
    const body = await request.json();

    const newBrand = await Brand.create({
      name: body.name,
      description: body.description || "",
      status: body.status || "active",
    });

    return NextResponse.json({ success: true, message: "Brand added successfully!", data: newBrand });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "Brand name already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  // Stage D (docs/D1_MIGRATION_PLAN.md §6.8a): while write:masters is 'mongo' (the default) this is the MongoDB
  // code below, unchanged; in 'd1' the same write is made on D1 (lib/repo/masters/writes.ts), in 'fence' it waits.
  const writeMode = await getWriteMode("masters");
  if (writeMode !== "mongo") return mastersWrites.updateBrand(req, writeMode);

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });

    const body = await req.json();
    await connectToDatabase();
    
    const updatedBrand = await Brand.findByIdAndUpdate(id, body, { new: true });
    if (!updatedBrand) return NextResponse.json({ success: false, error: "Brand not found" }, { status: 404 });

    return NextResponse.json({ success: true, data: updatedBrand });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json({ success: false, error: "Brand name already exists" }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  // Stage D (docs/D1_MIGRATION_PLAN.md §6.8a): while write:masters is 'mongo' (the default) this is the MongoDB
  // code below, unchanged; in 'd1' the same write is made on D1 (lib/repo/masters/writes.ts), in 'fence' it waits.
  const writeMode = await getWriteMode("masters");
  if (writeMode !== "mongo") return mastersWrites.deleteBrand(req, writeMode);

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });

    await connectToDatabase();
    const deletedBrand = await Brand.findByIdAndDelete(id);
    if (!deletedBrand) return NextResponse.json({ success: false, error: "Brand not found" }, { status: 404 });

    return NextResponse.json({ success: true, data: {} });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
