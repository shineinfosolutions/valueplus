import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Brand from "@/models/Brand";
import Item from "@/models/Item";

export async function GET() {
  try {
    await connectToDatabase();
    const brands = await Brand.find({}).collation({ locale: "en", strength: 2 }).sort({ name: 1 }).lean();
    
    // Add item count to each brand
    const brandsWithItemCount = await Promise.all(
      brands.map(async (brand: any) => {
        const itemCount = await Item.countDocuments({ brand: brand.name });
        return { ...brand, items: itemCount };
      })
    );
    
    return NextResponse.json({ success: true, data: brandsWithItemCount });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
