import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import SupplierStockItem from "@/models/SupplierStockItem";
import SupplierStockUpload from "@/models/SupplierStockUpload";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { notifyAssignee } from "@/lib/notify";
import { parseSupplierStockSheet, STOCK_UPLOAD_ROLES } from "@/lib/supplier-stock";
import { todayInIndia } from "@/lib/today";

const istDay = (d: any) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(d));

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** The latest supplier stock (products in stock) and details of the last upload. Any signed-in user. */
export async function GET() {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    await connectToDatabase();
    const lastUpload: any = await SupplierStockUpload.findOne({}).sort({ createdAt: -1 }).lean();
    // The stock sheet is uploaded every day. If today's has not been uploaded yet, yesterday's stock is
    // not shown (it may be sold or changed), so nothing can be ordered from it.
    const stale = !lastUpload || istDay(lastUpload.createdAt) !== todayInIndia();
    const items = stale
      ? []
      : await SupplierStockItem.find({ active: true, availableStock: { $gt: 0 } }).sort({ isNewArrival: -1, brand: 1, description: 1 }).lean();
    return NextResponse.json({ success: true, data: items, lastUpload, stale });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/** Upload the daily stock report. Admin, manager and cashier only. */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!STOCK_UPLOAD_ROLES.includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only the Admin, Store Manager or Cashier can upload the stock sheet." }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) return NextResponse.json({ success: false, error: "No file was uploaded." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ success: false, error: "File is larger than 10 MB." }, { status: 400 });
    if (![".xlsx", ".xls", ".csv"].some((e) => file.name.toLowerCase().endsWith(e))) {
      return NextResponse.json({ success: false, error: "Upload an Excel file (.xlsx, .xls or .csv)." }, { status: 400 });
    }

    const { rows, error } = parseSupplierStockSheet(Buffer.from(await file.arrayBuffer()));
    if (error) return NextResponse.json({ success: false, error }, { status: 400 });

    await connectToDatabase();
    const existing = await SupplierStockItem.find({}, { itemCode: 1, warehouse: 1, availableStock: 1, active: 1 }).lean();
    const known = new Map<string, any>(existing.map((e: any) => [`${e.itemCode}|${String(e.warehouse).toUpperCase()}`, e]));

    const upload = await SupplierStockUpload.create({
      fileName: file.name,
      uploadedBy: actor.name,
      uploadedByRole: actor.role,
      rowCount: rows.length,
      totalUnits: rows.reduce((t, r) => t + r.availableStock, 0),
    });
    const uploadId = String(upload._id);

    let newProducts = 0;
    const seen = new Set<string>();
    const ops: any[] = rows.map((r) => {
      const key = `${r.itemCode}|${r.warehouse.toUpperCase()}`;
      seen.add(key);
      const before = known.get(key);
      // "New" = not in the report before, or back after being left out of an earlier one.
      const isNewArrival = !before || !before.active;
      if (isNewArrival) newProducts++;
      return {
        updateOne: {
          filter: { itemCode: r.itemCode, warehouse: r.warehouse },
          update: {
            $set: { ...r, previousStock: before?.active ? Number(before.availableStock) || 0 : 0, isNewArrival, active: true, uploadId },
          },
          upsert: true,
        },
      };
    });
    // Products the new report no longer lists are out of stock.
    for (const e of existing as any[]) {
      const key = `${e.itemCode}|${String(e.warehouse).toUpperCase()}`;
      if (!seen.has(key) && e.active) {
        ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { active: false, previousStock: Number(e.availableStock) || 0, availableStock: 0, isNewArrival: false, uploadId } } } });
      }
    }
    await SupplierStockItem.bulkWrite(ops, { ordered: false });
    await SupplierStockUpload.findByIdAndUpdate(upload._id, { newProducts });

    try {
      await AuditLog.create({
        action: "supplier.stock.upload",
        entityType: "SupplierStock",
        entityRef: file.name,
        reason: `Supplier stock sheet uploaded: ${rows.length} products, ${newProducts} new`,
        performedBy: actor.name,
        performedByUserId: actor.id,
        performedByRole: actor.role,
        metadata: { rows: rows.length, newProducts },
      });
    } catch (e) {
      console.warn("Notice: audit log for stock upload:", e);
    }
    await notifyAssignee("Sales Staff", undefined, {
      type: "general",
      title: "New stock available",
      message: `${rows.length} products in the latest stock sheet${newProducts > 0 ? `, ${newProducts} new` : ""}. Open GIDA WAREHOUSE ORDER to order.`,
      link: "/sales/new-stock",
      createdBy: actor.name,
    });

    return NextResponse.json({ success: true, rows: rows.length, newProducts, fileName: file.name });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
