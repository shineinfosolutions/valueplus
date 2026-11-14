import { NextResponse } from "next/server";
import { getWriteMode } from "@/lib/d1/write-mode";
import * as mastersWrites from "@/lib/repo/masters/writes";
import connectToDatabase from "@/lib/db";
import Category from "@/models/Category";
import Item from "@/models/Item";
import { readWithShadow } from "@/lib/d1/shadow";
import { listCategoriesWithCounts } from "@/lib/repo/masters/lists";
import { MASTER_COMPARE } from "@/lib/repo/masters/compare";

export async function GET() {
  try {
    // Master-data read through the D1 switch (lib/d1/shadow.ts): MongoDB, MongoDB compared with D1, or D1.
    const categoriesWithItemCount = await readWithShadow(
      "masters",
      "categories.list",
      async () => {
        await connectToDatabase();
        const categories = await Category.find({}).sort({ createdAt: -1 }).lean();

        // Add item count to each category
        return Promise.all(
          categories.map(async (cat: any) => {
            const itemCount = await Item.countDocuments({ category: cat.name });
            return { ...cat, items: itemCount };
          })
        );
      },
      (db) => listCategoriesWithCounts(db),
      { compare: MASTER_COMPARE["categories.list"] }
    );

    return NextResponse.json({ success: true, data: categoriesWithItemCount });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Stage D (docs/D1_MIGRATION_PLAN.md §6.8a): while write:masters is 'mongo' (the default) this is the MongoDB
  // code below, unchanged; in 'd1' the same write is made on D1 (lib/repo/masters/writes.ts), in 'fence' it waits.
  const writeMode = await getWriteMode("masters");
  if (writeMode !== "mongo") return mastersWrites.createCategory(request, writeMode);

  try {
    await connectToDatabase();
    const body = await request.json();

    const newCategory = await Category.create({
      name: body.name,
      description: body.description || "",
      parentId: body.parentId || null,
      status: body.status || "active",
    });

    return NextResponse.json({ success: true, message: "Category added successfully!", data: newCategory });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  // Stage D (docs/D1_MIGRATION_PLAN.md §6.8a): while write:masters is 'mongo' (the default) this is the MongoDB
  // code below, unchanged; in 'd1' the same write is made on D1 (lib/repo/masters/writes.ts), in 'fence' it waits.
  const writeMode = await getWriteMode("masters");
  if (writeMode !== "mongo") return mastersWrites.updateCategory(req, writeMode);

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });

    const body = await req.json();
    await connectToDatabase();
    
    const updatedCategory = await Category.findByIdAndUpdate(id, body, { new: true });
    if (!updatedCategory) return NextResponse.json({ success: false, error: "Category not found" }, { status: 404 });

    return NextResponse.json({ success: true, data: updatedCategory });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  // Stage D (docs/D1_MIGRATION_PLAN.md §6.8a): while write:masters is 'mongo' (the default) this is the MongoDB
  // code below, unchanged; in 'd1' the same write is made on D1 (lib/repo/masters/writes.ts), in 'fence' it waits.
  const writeMode = await getWriteMode("masters");
  if (writeMode !== "mongo") return mastersWrites.deleteCategory(req, writeMode);

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ success: false, error: "id is required" }, { status: 400 });

    await connectToDatabase();
    const deletedCategory = await Category.findByIdAndDelete(id);
    if (!deletedCategory) return NextResponse.json({ success: false, error: "Category not found" }, { status: 404 });

    return NextResponse.json({ success: true, data: {} });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
