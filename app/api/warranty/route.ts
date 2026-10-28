import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import ExtendedWarranty from "@/models/ExtendedWarranty";
import Invoice from "@/models/Invoice";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceNumber = searchParams.get("invoiceNumber");
    const customerPhone = searchParams.get("customerPhone");
    const vpCode = searchParams.get("vpCode");
    const status = searchParams.get("status");
    
    await connectToDatabase();
    
    const filter: any = {};
    if (invoiceNumber) filter.invoiceNumber = invoiceNumber;
    if (customerPhone) filter.customerPhone = customerPhone;
    if (vpCode) filter.vpCode = vpCode;
    if (status) filter.status = status;
    
    const warranties = await ExtendedWarranty.find(filter).sort({ createdAt: -1 });
    
    // Aggregated stats from ExtendedWarranty collection
    let totalCount = await ExtendedWarranty.countDocuments();
    const totalRevenueResult = await ExtendedWarranty.aggregate([
      { $group: { _id: null, total: { $sum: "$warrantyAmount" } } }
    ]);
    let totalRevenue = totalRevenueResult[0]?.total || 0;
    
    // Also check Invoices for any extended warranty sold directly on invoices
    const allInvoices = await Invoice.find({ type: { $ne: "proforma" } }).lean();
    let invoiceWarrantyRevenue = 0;
    let invoiceWarrantyCount = 0;

    allInvoices.forEach((inv: any) => {
      let invW = Number(inv.extendedWarrantyTotal) || Number(inv.warrantyAmount) || 0;
      let hasW = invW > 0 || Boolean(inv.extendedWarranty);
      if (Array.isArray(inv.items)) {
        let itSum = 0;
        inv.items.forEach((it: any) => {
          const amt = Number(it.extendedWarrantyAmount) || 0;
          if (amt > 0 || (it.extendedWarrantyPlan && it.extendedWarrantyPlan !== "none" && it.extendedWarrantyPlan !== "No Warranty")) {
            hasW = true;
            itSum += amt;
          }
        });
        if (invW === 0 && itSum > 0) invW = itSum;
      }
      if (hasW || invW > 0) {
        invoiceWarrantyRevenue += invW;
        invoiceWarrantyCount += 1;
      }
    });

    // Use max of invoice calculations or warranty collection
    totalRevenue = Math.max(totalRevenue, invoiceWarrantyRevenue);
    totalCount = Math.max(totalCount, invoiceWarrantyCount);

    const todayStr = new Date().toISOString().split("T")[0];
    const todayCount = await ExtendedWarranty.countDocuments({ startDate: { $gte: todayStr } });
    const thisMonthStr = todayStr.substring(0, 7);
    const thisMonthCount = await ExtendedWarranty.countDocuments({ startDate: { $regex: `^${thisMonthStr}` } });

    const totalBills = allInvoices.length || 1;
    const conversionRate = Math.round((totalCount / totalBills) * 100);

    return NextResponse.json({
      success: true,
      data: warranties,
      analytics: {
        totalCount,
        totalRevenue,
        todayCount,
        thisMonthCount,
      },
      metrics: {
        totalSales: totalRevenue,
        totalCount,
        conversionRate,
      }
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await connectToDatabase();
    
    if (!body.warrantyId) {
      const count = await ExtendedWarranty.countDocuments();
      body.warrantyId = `EW-2026-${String(count + 1).padStart(4, "0")}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    
    const warranty = await ExtendedWarranty.create(body);
    return NextResponse.json({ success: true, data: warranty });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
