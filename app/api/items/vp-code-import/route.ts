import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { parseVpCodeWorkbook, planVpCodes } from "@/lib/vp-code-import";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".csv"];

/**
 * Put VP codes on products from a sheet (VP code + product name).
 *
 * Without `apply` the sheet is only read and the changes are listed (preview). With `apply=true` the products that
 * have no real VP code yet get the sheet's code; products that already have a different real code are changed only
 * when their id is in `overrideIds` (ticked in the preview). Nothing else on a product is touched. The old code stays
 * findable: it is kept in `supplierCodes`, and `code` is never changed.
 */
export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    if (!["admin", "superadmin", "manager", "accounts"].includes(actor.role)) {
      return NextResponse.json({ success: false, error: "Only an admin, manager or accounts user can update VP codes from a sheet." }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const apply = form.get("apply") === "true";
    let overrideIds: string[] = [];
    try {
      overrideIds = JSON.parse(String(form.get("overrideIds") || "[]")).map(String);
    } catch {
      overrideIds = [];
    }
    if (!file || !(file instanceof File)) return NextResponse.json({ success: false, error: "No file was uploaded." }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ success: false, error: "File is larger than 10 MB." }, { status: 400 });
    if (!EXCEL_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      return NextResponse.json({ success: false, error: "Upload an Excel file (.xlsx, .xls or .csv)." }, { status: 400 });
    }

    const { rows, notes } = parseVpCodeWorkbook(Buffer.from(await file.arrayBuffer()));
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No rows with a VP code were found. The sheet needs a product name column ("Product", "Item", "Model" or "Description") and a "VP Code" column.', notes },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const items = await Item.find({}, { name: 1, code: 1, vpCode: 1, supplierCodes: 1, brand: 1 }).lean();
    const plan = planVpCodes(rows, items);

    let appliedCount = 0;
    if (apply) {
      const chosen = new Set(overrideIds);
      const todo = [...plan.updates, ...plan.different.filter((d) => chosen.has(d.itemId))].filter((r) => mongoose.isValidObjectId(r.itemId));
      if (todo.length > 0) {
        const oldCodes = new Map<string, string>(plan.different.map((d) => [d.itemId, d.oldVpCode]));
        const write = await Item.bulkWrite(
          todo.map((r) => ({
            updateOne: {
              filter: { _id: r.itemId },
              update: {
                $set: { vpCode: r.newVpCode },
                // Both the new and the replaced code keep finding the product.
                $addToSet: { supplierCodes: { $each: [r.newVpCode, ...(oldCodes.get(r.itemId) ? [oldCodes.get(r.itemId)!] : [])] } },
              },
            },
          })),
          { ordered: false }
        );
        appliedCount = write.modifiedCount || 0;
        try {
          await AuditLog.create({
            action: "item.vpcode.import",
            entityType: "Item",
            entityRef: file.name,
            reason: `VP code set from sheet "${file.name}" for ${appliedCount} products`,
            performedBy: actor.name,
            performedByUserId: actor.id,
            performedByRole: actor.role,
            pinVerified: false,
            metadata: { changes: todo.map((r) => ({ name: r.name, from: r.shownNow, to: r.newVpCode })) },
          });
        } catch (logErr) {
          console.warn("Notice: audit log for VP code import:", logErr);
        }
      }
    }

    return NextResponse.json({ success: true, applied: apply, appliedCount, fileName: file.name, sheetRows: rows.length, ...plan, notes });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
