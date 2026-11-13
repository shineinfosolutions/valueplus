import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import PurchaseEntry from "@/models/PurchaseEntry";
import { getActor } from "@/lib/requirePermission";
import { readWithShadow } from "@/lib/d1/shadow";
import { getItemById } from "@/lib/repo/masters/items";
import { MASTER_COMPARE } from "@/lib/repo/masters/compare";
import { readStock } from "@/lib/repo/stock/shadow-read";

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
    // Master-data read through the D1 switch (lib/d1/shadow.ts); the purchase bills below through the read:stock one.
    const it: any = await readWithShadow(
      "masters",
      "items.byId",
      async () => {
        await connectToDatabase();
        return Item.findById(id).lean();
      },
      (db) => getItemById(db, id),
      { compare: MASTER_COMPARE["items.byId"] }
    );
    if (!it) return NextResponse.json({ success: false, error: "Product not found." }, { status: 404 });

    // The last 5 bills with this product (by id or by name), newest bill date first.
    const bills: any[] = await readStock("purchaseEntries.brandInfo", { id, name: it.name });
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
