import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Invoice from "@/models/Invoice";
import Item from "@/models/Item";
import Customer from "@/models/Customer";
import SerialNumber from "@/models/SerialNumber";
import Lead from "@/models/Lead";
import DeliveryChallan from "@/models/DeliveryChallan";
import FinanceTransaction from "@/models/FinanceTransaction";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim();
    
    if (!q || q.length < 2) {
      return NextResponse.json({ success: true, results: [] });
    }
    
    await connectToDatabase();
    const regex = new RegExp(q, "i");
    
    const [invoices, items, customers, serials, leads, challans, financeTxns] = await Promise.all([
      Invoice.find({
        $or: [
          { invoiceNumber: regex },
          { customerName: regex },
          { customerPhone: regex },
          { vehicleNumber: regex },
          { financeDoId: regex },
        ],
      }).limit(5),
      Item.find({
        $or: [
          { name: regex },
          { code: regex },
          { vpCode: regex },
          { batchNumber: regex },
        ],
      }).limit(5),
      Customer.find({
        $or: [
          { name: regex },
          { phone: regex },
          { email: regex },
          { gstNumber: regex },
        ],
      }).limit(5),
      SerialNumber.find({
        $or: [
          { serialNumber: regex },
          { vpCode: regex },
          { itemName: regex },
        ],
      }).limit(5),
      Lead.find({
        $or: [
          { leadId: regex },
          { customerName: regex },
          { mobile: regex },
        ],
      }).limit(5),
      DeliveryChallan.find({
        $or: [
          { challanNo: regex },
          { vehicleNo: regex },
          { destinationParty: regex },
        ],
      }).limit(5),
      FinanceTransaction.find({
        $or: [
          { doId: regex },
          { customerName: regex },
          { customerMobile: regex },
          { atosDealId: regex },
        ],
      }).limit(5),
    ]);
    
    const results = [
      ...invoices.map((inv) => ({
        type: "Invoice",
        title: `${inv.invoiceNumber} - ${inv.customerName}`,
        subtitle: `₹${inv.total?.toLocaleString("en-IN")} • ${inv.paymentMode} • ${inv.date}`,
        link: `/sales/invoices?search=${encodeURIComponent(inv.invoiceNumber)}`,
        raw: inv,
      })),
      ...items.map((it) => ({
        type: "Product",
        title: `${it.name} (${it.vpCode || it.code})`,
        subtitle: `Stock: ${it.currentStock} ${it.unit} • ₹${it.sellingPrice?.toLocaleString("en-IN")}`,
        link: `/masters/items?search=${encodeURIComponent(it.vpCode || it.code)}`,
        raw: it,
      })),
      ...customers.map((c) => ({
        type: "Customer",
        title: c.name,
        subtitle: `Phone: ${c.phone} • Balance: ₹${c.outstandingBalance?.toLocaleString("en-IN")}`,
        link: `/masters/customers?search=${encodeURIComponent(c.phone)}`,
        raw: c,
      })),
      ...serials.map((s) => ({
        type: "Serial Number",
        title: `SN: ${s.serialNumber} (${s.status})`,
        subtitle: `${s.itemName} • VP Code: ${s.vpCode}`,
        link: `/sales/invoices?search=${encodeURIComponent(s.serialNumber)}`,
        raw: s,
      })),
      ...leads.map((l) => ({
        type: "Lead",
        title: `${l.leadId} - ${l.customerName}`,
        subtitle: `${l.interestedProduct} • Status: ${l.status}`,
        link: `/marketing/leads?search=${encodeURIComponent(l.leadId)}`,
        raw: l,
      })),
      ...challans.map((ch) => ({
        type: "Delivery Challan",
        title: `${ch.challanNo} - ${ch.destinationParty}`,
        subtitle: `Vehicle: ${ch.vehicleNo || 'N/A'} • Status: ${ch.status}`,
        link: `/sales/challan?search=${encodeURIComponent(ch.challanNo)}`,
        raw: ch,
      })),
      ...financeTxns.map((f) => ({
        type: "Finance DO",
        title: `${f.doId} (${f.financeProvider})`,
        subtitle: `${f.customerName} • Loan: ₹${f.netLoanAmount?.toLocaleString("en-IN")} • ${f.approvalStatus}`,
        link: `/sales/invoices?search=${encodeURIComponent(f.doId)}`,
        raw: f,
      })),
    ];
    
    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
