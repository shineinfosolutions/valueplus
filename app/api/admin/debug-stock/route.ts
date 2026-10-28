import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import PurchaseEntry from "@/models/PurchaseEntry";
import Item from "@/models/Item";
import Invoice from "@/models/Invoice";

export async function GET() {
  try {
    await connectToDatabase();

    const purchaseEntries = await PurchaseEntry.find({}).sort({ createdAt: -1 }).lean();
    const items = await Item.find({}).sort({ updatedAt: -1 }).lean();
    const invoices = await Invoice.find({}).sort({ createdAt: -1 }).lean();

    return NextResponse.json({
      success: true,
      totalPurchaseEntries: purchaseEntries.length,
      purchaseEntries: purchaseEntries.map(pe => ({
        _id: pe._id,
        billNo: pe.billNo,
        supplierName: pe.supplierName,
        total: pe.total,
        billDate: pe.billDate,
        createdAt: (pe as any).createdAt,
        items: pe.items,
      })),
      totalItems: items.length,
      sampleItems: items.slice(0, 10).map(it => ({
        _id: it._id,
        code: it.code,
        vpCode: it.vpCode,
        name: it.name,
        currentStock: it.currentStock,
        purchasePrice: it.purchasePrice,
      })),
      totalInvoices: invoices.length,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
