import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import PurchaseEntry from "@/models/PurchaseEntry";
import { getActor } from "@/lib/requirePermission";

export const dynamic = "force-dynamic";

/**
 * Everything that helps to work out a product's brand: full name, VP code, supplier codes, category, HSN,
 * prices, stock, and the last bills it came in on (supplier, bill, rate). GET ?id=<item id>
 */
export async function GET(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    const id = new URL(req.url).searchParams.get("id") || "";
    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ success: false, error: "Product not found." }, { status: 400 });
    await connectToDatabase();
    const it: any = await Item.findById(id).lean();
    if (!it) return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });

    const bills: any[] = await PurchaseEntry.find(
      { type: { $ne: "debit-note" }, status: { $ne: "cancelled" }, $or: [{ "items.itemId": id }, { "items.name": it.name }] },
      { billNo: 1, supplierName: 1, billDate: 1, items: 1 }
    )
      .sort({ billDate: -1 })
      .limit(5)
      .lean();
    const lastPurchases = bills.map((b) => {
      const line = (b.items || []).find((l: any) => String(l.itemId) === id || l.name === it.name) || {};
      return { billNo: b.billNo, supplier: b.supplierName, date: b.billDate, rate: Number(line.rate) || 0, quantity: Number(line.quantity) || 0 };
    });

    return NextResponse.json({
      success: true,
      data: {
        id,
        name: it.name,
        vpCode: it.vpCode || "",
        code: it.code || "",
        supplierCodes: it.supplierCodes || [],
        description: it.description || "",
        category: it.category || "",
        brand: it.brand || "",
        unit: it.unit || "",
        hsnCode: it.hsnCode || "",
        gstRate: it.gstRate,
        purchasePrice: it.purchasePrice || 0,
        sellingPrice: it.sellingPrice || 0,
        mrp: it.mrp || 0,
        currentStock: it.currentStock || 0,
        warehouse: it.warehouse || "",
        billingEntity: it.billingEntity || "valueplus",
        isSerialized: !!it.isSerialized,
        createdAt: it.createdAt || null,
        lastPurchases,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
