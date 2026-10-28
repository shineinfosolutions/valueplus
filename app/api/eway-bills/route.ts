import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import EWayBill from "@/models/EWayBill";
import Invoice from "@/models/Invoice";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceNumber = searchParams.get("invoiceNumber");
    const status = searchParams.get("status");
    
    await connectToDatabase();
    
    const filter: any = {};
    if (invoiceNumber) filter.invoiceNumber = invoiceNumber;
    if (status && status !== "all") filter.status = status;
    
    const bills = await EWayBill.find(filter).sort({ createdAt: -1 });
    return NextResponse.json({ success: true, data: bills });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.ewayBillNo) {
      const randomPart = Math.floor(100000000000 + Math.random() * 900000000000);
      body.ewayBillNo = `EWB-${randomPart}`;
    }
    
    const bill = await EWayBill.create(body);
    return NextResponse.json({ success: true, data: bill });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    const { id, ewayBillNo, status, ...updates } = body;
    const query = id ? { _id: id } : { ewayBillNo };
    
    if (status === "Generated") {
      updates.generatedDate = new Date().toISOString();
      const validUntil = new Date(Date.now() + 3 * 86400000).toISOString();
      updates.validUntil = validUntil;
    }
    
    const updated = await EWayBill.findOneAndUpdate(query, { status, ...updates }, { new: true });
    if (!updated) {
      return NextResponse.json({ success: false, error: "E-Way bill not found" }, { status: 404 });
    }
    
    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
