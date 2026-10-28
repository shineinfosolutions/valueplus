import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Customer from "@/models/Customer";

export async function GET() {
  try {
    await connectToDatabase();
    const customers = await Customer.find({}).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: customers });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const body = await request.json();

    const newCust = await Customer.create({
      code: body.code || `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
      name: body.name,
      email: body.email || "",
      phone: body.phone,
      gstNumber: body.gstNumber || "",
      billingAddress: {
        line1: body.address || "Main Street",
        city: body.city || "Mumbai",
        state: body.state || "Maharashtra",
        pincode: body.pincode || "",
        country: "India",
      },
      creditLimit: Number(body.creditLimit) || 50000,
      creditDays: Number(body.creditDays) || 30,
      outstandingBalance: Number(body.outstandingBalance) || 0,
      status: body.status || "active",
    });

    return NextResponse.json({ success: true, message: "Customer added successfully!", data: newCust });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await connectToDatabase();
    const body = await request.json();

    if (!body.code) {
      return NextResponse.json({ success: false, error: "Customer code is required for update" }, { status: 400 });
    }

    const updateData = {
      name: body.name,
      email: body.email,
      phone: body.phone,
      gstNumber: body.gst,
      billingAddress: {
        line1: body.address || "Main Street",
        city: body.city,
        state: body.state,
        pincode: body.pincode || "",
        country: "India",
      },
      creditLimit: Number(body.creditLimit) || 50000,
      customerGroup: body.group,
    };

    const updatedCust = await Customer.findOneAndUpdate({ code: body.code }, updateData, { new: true });
    
    if (!updatedCust) {
      return NextResponse.json({ success: false, error: "Customer not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Customer updated successfully!", data: updatedCust });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    
    if (!code) {
      return NextResponse.json({ success: false, error: "Customer code is required" }, { status: 400 });
    }

    await connectToDatabase();
    await Customer.findOneAndDelete({ code });

    return NextResponse.json({ success: true, message: "Customer deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
