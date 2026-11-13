import { istToday, istDayStart, istDayEnd, istMonthStart, addDaysIst } from "@/lib/ist";
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
    
    // Every range is whole India days (00:00–23:59 IST). The server runs on UTC, so `setHours(0, 0, 0, 0)` started
    // "Today" at 05:30 IST, and between midnight and 05:30 IST "Today" was still yesterday.
    const inDays = (fromDay: string, toDay: string) => {
      const start = istDayStart(fromDay);
      const end = istDayEnd(toDay);
      return invoices.filter((inv: any) => {
        const d = new Date(inv.date || inv.createdAt);
        return d >= start && d <= end;
      });
    };
    const todayStr = istToday();

    let filteredInvoices = invoices;
    if (startDate && endDate) {
      filteredInvoices = inDays(startDate, endDate);
    } else if (range === "today") {
      filteredInvoices = inDays(todayStr, todayStr);
    } else if (range === "yesterday") {
      const yesterdayStr = addDaysIst(todayStr, -1);
      filteredInvoices = inDays(yesterdayStr, yesterdayStr);
    } else if (range === "week" || range === "this week" || range === "last 7 days") {
      filteredInvoices = inDays(addDaysIst(todayStr, -7), todayStr);
    } else if (range === "month" || range === "this month" || range === "last 30 days") {
      filteredInvoices = inDays(istMonthStart(), todayStr);
    } else if (range === "last month") {
      // `now` was never declared in this branch either, so "last month" threw; the bounds now come from today in India.
      const lastDayOfLastMonth = addDaysIst(istMonthStart(), -1);
      filteredInvoices = inDays(`${lastDayOfLastMonth.slice(0, 7)}-01`, lastDayOfLastMonth);
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
