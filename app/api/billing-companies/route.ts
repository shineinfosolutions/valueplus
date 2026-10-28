import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import BillingCompany from "@/models/BillingCompany";
import { derivePanFromGstin } from "@/lib/gst";

/** Every company an invoice has ever been billed to, for the billing form's
 *  "pick an existing company" dropdown. */
export async function GET() {
  try {
    await connectToDatabase();
    const companies = await BillingCompany.find({}).sort({ usageCount: -1, companyName: 1 }).lean();
    return NextResponse.json({ success: true, data: companies });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * Remembers a company by its GSTIN so the next invoice for the same company
 * can be picked from the dropdown instead of retyped. Called automatically
 * whenever an invoice/estimate is saved with both a GSTIN and a company name
 * — this route exists mainly for that upsert, not for a separate "add
 * company" screen.
 */
export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const body = await request.json();
    const gstin = String(body.gstin || "").trim().toUpperCase();
    const companyName = String(body.companyName || "").trim();
    if (!gstin || !companyName) {
      return NextResponse.json(
        { success: false, error: "gstin and companyName are both required" },
        { status: 400 }
      );
    }

    const company = await BillingCompany.findOneAndUpdate(
      { gstin },
      {
        $set: { companyName, pan: derivePanFromGstin(gstin) },
        $inc: { usageCount: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return NextResponse.json({ success: true, data: company });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
