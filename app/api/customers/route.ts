import { deferIfManager, diffFields } from "@/lib/deferred-actions";
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

    // The next free code, from the highest one in use. A random 4-digit code could land on
    // one that exists, and the unique index then rejected the new customer.
    let code = body.code as string | undefined;
    if (!code) {
      const codes = await Customer.find({ code: /^CUST-\d+$/ }, { code: 1 }).lean();
      const highest = codes.reduce((m: number, c: any) => Math.max(m, parseInt(String(c.code).slice(5), 10) || 0), 0);
      code = `CUST-${String(highest + 1).padStart(3, "0")}`;
    }

    const newCust = await Customer.create({
      code,
      name: body.name,
      email: body.email || "",
      phone: body.phone,
      // The Customer screen sends the GSTIN as `gst`, other callers as `gstNumber`:
      // only the second was read, so a GSTIN typed when adding a customer was dropped.
      gstNumber: body.gstNumber || body.gst || "",
      customerGroup: body.group || body.customerGroup || "Retail",
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
    const waiting = await deferIfManager(request, async () => {
      const current: any = await Customer.findOne({ code: body.code }).lean();
      const { before, after } = diffFields(current, body);
      return { title: `Edit customer ${current?.name || body.code}`, description: `Change the customer ${current?.name || ""} (${body.code}).`, target: `customer.edit:${body.code}`, before, after, body };
    });
    if (waiting) return waiting;

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
    const waiting = await deferIfManager(request, { title: `Delete customer ${code || ""}`, description: `Delete the customer ${code || ""}.`, target: `customer.delete:${code}` });
    if (waiting) return waiting;
    
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
