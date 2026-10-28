import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";

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
    
    await connectToDatabase();
    
    // Sales only: neither a booking (sales order) nor a quotation (estimate).
    const filter: any = {
      type: { $nin: ["sales-order", "proforma"] },
    };
    
    if (startDate && endDate) {
      filter.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      filter.date = { $gte: startDate };
    } else if (endDate) {
      filter.date = { $lte: endDate };
    }
    
    if (bank && bank !== "all") {
      if (["Cash", "UPI", "Online", "Card"].includes(bank)) {
        filter.paymentMode = bank;
      } else if (bank === "Finance") {
        filter.paymentMode = "Finance";
      } else {
        filter.$or = [
          { financeProvider: { $regex: bank, $options: "i" } },
          { paymentMode: { $regex: bank, $options: "i" } }
        ];
      }
    } else if (paymentMode && paymentMode !== "all") {
      filter.paymentMode = paymentMode;
    }
    
    if (dueOnly === "true") {
      filter.balanceAmount = { $gt: 0 };
    }
    
    if (staff && staff !== "all") {
      filter.salesExecutive = staff;
    }
    
    if (customer) {
      filter.customerName = { $regex: customer, $options: "i" };
    }
    
    const invoices = await Invoice.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    
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
