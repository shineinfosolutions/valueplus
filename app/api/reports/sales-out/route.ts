import { NextResponse } from "next/server";
import { salesRead } from "@/lib/repo/sales/shadow";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const paymentMode = searchParams.get("paymentMode");
    const bank = searchParams.get("bank");
    const dueOnly = searchParams.get("dueOnly");
    const staff = searchParams.get("staff");
    const customer = searchParams.get("customer");
    
    // Sales only: neither a booking (sales order) nor a quotation (estimate). The query (lib/repo/sales/invoices.ts
    // mongoSalesOut) runs through the sales read switch: MongoDB, MongoDB compared with D1, or D1.
    const invoices: any[] = await salesRead("salesOut.invoices", { startDate, endDate, paymentMode, bank, dueOnly, staff, customer });
    
    // Map strictly to required columns: Due, Date, Amount, Bill Number, Customer Name, plus enhanced columns
    const reportData = invoices.map((inv) => ({
      due: inv.balanceAmount || 0,
      date: inv.date,
      amount: inv.total,
      billNumber: inv.invoiceNumber,
      customerName: inv.customerName,
      customerPhone: inv.customerPhone || "N/A",
      staff: inv.salesExecutive || "AMIT SINGH",
      paymentMode: inv.paymentMode || "Cash",
      paidAmount: inv.paidAmount || 0,
      dueAmount: inv.balanceAmount || 0,
      invoiceStatus: inv.status,
      financeStatus: inv.financeApprovalStatus || (inv.paymentMode === "Finance" ? "Pending" : "N/A"),
      financeProvider: inv.financeProvider || (inv.paymentMode === "Finance" ? "Bajaj Finance" : ""),
      vehicleNumber: inv.vehicleNumber || "",
      extendedWarrantyTotal: inv.extendedWarrantyTotal || 0,
    }));
    
    const summary = {
      totalInvoices: reportData.length,
      totalAmount: reportData.reduce((sum, item) => sum + item.amount, 0),
      totalPaid: reportData.reduce((sum, item) => sum + item.paidAmount, 0),
      totalDue: reportData.reduce((sum, item) => sum + item.dueAmount, 0),
    };
    
    return NextResponse.json({ success: true, data: reportData, summary });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
