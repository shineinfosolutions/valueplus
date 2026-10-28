import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import InventoryAudit from "@/models/InventoryAudit";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date");
    const checkPending = searchParams.get("checkPending");
    
    await connectToDatabase();
    const today = new Date().toISOString().split("T")[0];
    
    if (checkPending === "true") {
      const todayAudit = await InventoryAudit.findOne({ auditDate: today });
      return NextResponse.json({
        success: true,
        auditPending: !todayAudit,
        todayAudit: todayAudit || null,
      });
    }
    
    const filter: any = {};
    if (date) filter.auditDate = date;
    
    const audits = await InventoryAudit.find(filter).sort({ auditDate: -1, createdAt: -1 }).lean();
    return NextResponse.json({ success: true, data: audits });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.auditDate) {
      body.auditDate = new Date().toISOString().split("T")[0];
    }
    
    // Calculate discrepancy totals
    let expected = 0;
    let physical = 0;
    let diff = 0;
    
    if (body.items && Array.isArray(body.items)) {
      body.items.forEach((it: any) => {
        expected += Number(it.expectedStock) || 0;
        physical += Number(it.physicalStock) || 0;
        diff += (Number(it.physicalStock) || 0) - (Number(it.expectedStock) || 0);
      });
    }
    
    body.totalExpected = expected;
    body.totalPhysical = physical;
    body.totalDiscrepancy = diff;
    body.status = diff !== 0 ? "Discrepancy Found" : "Completed";
    
    const audit = await InventoryAudit.create(body);
    return NextResponse.json({ success: true, data: audit });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
