import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rangeParam = searchParams.get("range") || searchParams.get("period") || "month";
    const range = rangeParam.toLowerCase();
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    
    await connectToDatabase();
    
    const invoices = await Invoice.find({ type: { $nin: ["sales-order", "proforma"] } }).lean();
    
    let filteredInvoices = invoices;
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filteredInvoices = invoices.filter((inv: any) => {
        const d = new Date(inv.date || inv.createdAt);
        return d >= start && d <= end;
      });
    } else if (range === "today") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      filteredInvoices = invoices.filter((inv: any) => {
        const d = new Date(inv.date || inv.createdAt);
        return d >= start && d <= end;
      });
    } else if (range === "yesterday") {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      filteredInvoices = invoices.filter((inv: any) => {
        const d = new Date(inv.date || inv.createdAt);
        return d >= start && d <= end;
      });
    } else if (range === "week" || range === "this week" || range === "last 7 days") {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      filteredInvoices = invoices.filter((inv: any) => {
        const d = new Date(inv.date || inv.createdAt);
        return d >= start && d <= end;
      });
    } else if (range === "month" || range === "this month" || range === "last 30 days") {
      // `now` was never declared here, so this branch threw and the whole report
      // failed whenever it was asked for the current month.
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      filteredInvoices = invoices.filter((inv: any) => {
        const d = new Date(inv.date || inv.createdAt);
        return d >= start && d <= end;
      });
    } else if (range === "last month") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      end.setHours(23, 59, 59, 999);
      filteredInvoices = invoices.filter((inv: any) => {
        const d = new Date(inv.date || inv.createdAt);
        return d >= start && d <= end;
      });
    }
    
    // Group metrics by staff
    const staffMap: Record<string, {
      staffName: string;
      salesAmount: number;
      numberOfBills: number;
      unitsSold: number;
      netSales: number;
      collection: number;
      warrantySales: number;
    }> = {};
    
    filteredInvoices.forEach((inv: any) => {
      const staff = inv.salesExecutive || "Amit Kumar";
      if (!staffMap[staff]) {
        staffMap[staff] = {
          staffName: staff,
          salesAmount: 0,
          numberOfBills: 0,
          unitsSold: 0,
          netSales: 0,
          collection: 0,
          warrantySales: 0,
        };
      }
      
      const totalUnits = inv.items?.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 1), 0) || 1;
      const total = Number(inv.total) || 0;
      const paid = Number(inv.paidAmount) || (inv.status === "paid" ? total : 0);
      
      staffMap[staff].salesAmount += total;
      staffMap[staff].numberOfBills += 1;
      staffMap[staff].unitsSold += totalUnits;
      staffMap[staff].netSales += Number(inv.taxableAmount) || (total - (Number(inv.totalGST) || 0));
      staffMap[staff].collection += paid;
      staffMap[staff].warrantySales += Number(inv.extendedWarrantyTotal) || 0;
    });
    
    const rankedStaff = Object.values(staffMap).map((s: any) => ({
      staffName: s.staffName,
      salesAmount: s.salesAmount || 0,
      totalSales: s.salesAmount || 0,
      numberOfBills: s.numberOfBills || 0,
      totalInvoices: s.numberOfBills || 0,
      unitsSold: s.unitsSold || 0,
      netSales: s.netSales || 0,
      collection: s.collection || 0,
      totalCollected: s.collection || 0,
      averageOrderValue: s.numberOfBills > 0 ? Math.round(s.salesAmount / s.numberOfBills) : 0,
      warrantySales: s.warrantySales || 0,
    })).sort((a, b) => b.totalSales - a.totalSales);
    
    return NextResponse.json({
      success: true,
      range,
      data: rankedStaff,
      totalInvoicesInPeriod: filteredInvoices.length,
      totalRevenueInPeriod: filteredInvoices.reduce((sum: number, inv: any) => sum + (Number(inv.total) || 0), 0),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
