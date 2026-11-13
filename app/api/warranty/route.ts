import { salesRead } from "@/lib/repo/sales/shadow";
import { istToday } from "@/lib/ist";
import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import ExtendedWarranty from "@/models/ExtendedWarranty";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const invoiceNumber = searchParams.get("invoiceNumber");
    const customerPhone = searchParams.get("customerPhone");
    const vpCode = searchParams.get("vpCode");
    const status = searchParams.get("status");
    
    // Every read of this GET goes through the sales read switch (MongoDB, MongoDB compared with D1, or D1); the
    // queries are unchanged (lib/repo/sales/documents.ts, invoices.ts). In D1 mode it needs no MongoDB connection.
    const warranties = await salesRead("warranty.list", { invoiceNumber, customerPhone, vpCode, status });

    // Aggregated stats from ExtendedWarranty collection
    let totalCount: number = await salesRead("warranty.count");
    const totalRevenueResult: any[] = await salesRead("warranty.revenue");
    let totalRevenue = totalRevenueResult[0]?.total || 0;
    
    // Also check Invoices for any extended warranty sold directly on invoices
    const allInvoices: any[] = await salesRead("warranty.invoices");
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

    const todayStr = istToday(); // India day: the server clock is UTC
    const todayCount: number = await salesRead("warranty.todayCount", todayStr);
    const thisMonthStr = todayStr.substring(0, 7);
    const thisMonthCount: number = await salesRead("warranty.monthCount", thisMonthStr);

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
