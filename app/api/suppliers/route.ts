import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Supplier from "@/models/Supplier";

export async function GET() {
  try {
    await connectToDatabase();
    const suppliers = await Supplier.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: suppliers });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();

    // 1. Check if supplier already exists by phone or name
    if (body.phone) {
      const existingByPhone = await Supplier.findOne({ phone: body.phone });
      if (existingByPhone) {
        return NextResponse.json({ success: true, data: existingByPhone, message: "Supplier already exists" });
      }
    }
    if (body.name) {
      const existingByName = await Supplier.findOne({ name: { $regex: new RegExp(`^${body.name.trim()}$`, "i") } });
      if (existingByName) {
        return NextResponse.json({ success: true, data: existingByName, message: "Supplier already exists" });
      }
    }

    // 2. Generate unique supplier code if not provided
    let suppCode = body.code?.trim();
    if (!suppCode) {
      const count = await Supplier.countDocuments();
      suppCode = `SUPP-${String(count + 1).padStart(3, "0")}`;
      // Verify uniqueness
      const codeExists = await Supplier.findOne({ code: suppCode });
      if (codeExists) {
        const randomSuffix = Math.floor(100 + Math.random() * 900);
        suppCode = `SUPP-${String(count + 1).padStart(3, "0")}-${randomSuffix}`;
      }
    }

    // 3. Format address with defaults if missing
    const address = {
      line1: body.address?.line1 || body.addressLine || "Commercial Trade Hub / Store Outlet",
      city: body.address?.city || body.city || "Mumbai",
      state: body.address?.state || body.state || "Maharashtra",
      pincode: body.address?.pincode || body.pincode || "400001",
      country: body.address?.country || "India",
    };

    const payload = {
      code: suppCode,
      name: body.name?.trim(),
      phone: body.phone?.trim() || "0000000000",
      email: body.email?.trim() || "",
      gstNumber: body.gstNumber?.trim() || body.gstin?.trim() || "",
      panNumber: body.panNumber?.trim() || "",
      address,
      creditLimit: Number(body.creditLimit) || 100000,
      creditDays: Number(body.creditDays) || 45,
      outstandingBalance: Number(body.outstandingBalance) || 0,
      status: body.status || "active",
    };

    const supplier = await Supplier.create(payload);
    return NextResponse.json({ success: true, data: supplier });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.code) {
      return NextResponse.json({ success: false, error: "Supplier code is required for update" }, { status: 400 });
    }

    const updatedSupplier = await Supplier.findOneAndUpdate({ code: body.code }, body, { new: true });
    
    if (!updatedSupplier) {
      return NextResponse.json({ success: false, error: "Supplier not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Supplier updated successfully!", data: updatedSupplier });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    
    if (!code) {
      return NextResponse.json({ success: false, error: "Supplier code is required" }, { status: 400 });
    }

    await connectToDatabase();
    await Supplier.findOneAndDelete({ code });

    return NextResponse.json({ success: true, message: "Supplier deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
