import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import Customer from "@/models/Customer";

export async function GET() {
  try {
    await connectToDatabase();
    const invoices = await Invoice.find();
    let updated = 0;

    for (const inv of invoices) {
      if (inv.customerId) {
        const cust = await Customer.findById(inv.customerId);
        if (cust) {
          const c = cust as any;
          const updates: any = {};
          if (!inv.customerPhone) updates.customerPhone = c.phone || "";
          if (!inv.customerEmail) updates.customerEmail = c.email || "";
          if (!inv.customerAddress) updates.customerAddress = c.billingAddress?.line1 || c.address || "";
          if (!inv.customerCity) updates.customerCity = c.billingAddress?.city || c.city || "";
          if (!inv.customerPin) updates.customerPin = c.billingAddress?.pincode || c.pin || "";
          if (!inv.placeOfSupply) updates.placeOfSupply = c.billingAddress?.state || c.state || "Uttar Pradesh (09)";

          if (Object.keys(updates).length > 0) {
            await Invoice.findByIdAndUpdate(inv._id, { $set: updates });
            updated++;
          }
        }
      }
    }

    return NextResponse.json({ success: true, message: `Fixed ${updated} invoices with missing customer data.` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
