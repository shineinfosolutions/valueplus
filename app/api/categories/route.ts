import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Category from "@/models/Category";
import Item from "@/models/Item";

export async function GET() {
  try {
    await connectToDatabase();
    const categories = await Category.find({}).sort({ createdAt: -1 }).lean();
    
    // Add item count to each category
    const categoriesWithItemCount = await Promise.all(
      categories.map(async (cat: any) => {
        const itemCount = await Item.countDocuments({ category: cat.name });
        return { ...cat, items: itemCount };
      })
    );

    return NextResponse.json({ success: true, data: categoriesWithItemCount });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
