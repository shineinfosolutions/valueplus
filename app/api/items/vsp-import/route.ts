import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import AuditLog from "@/models/AuditLog";
import { getActor } from "@/lib/requirePermission";
import { parseVspWorkbook, matchVspRows } from "@/lib/vsp-import";
import { freezeMissingLineCosts } from "@/lib/sale-cost";

/**
 * Update product prices from a brand price-list sheet:
 *   New V+NLC → purchase price, New VSP → VSP.
 *
 * Without `apply` this only reads the sheet and reports what would change, so
 * the result can be reviewed first. With `apply=true` it writes those two
 * fields on the matched products; selling price, floor price and MRP are left
 * exactly as they are.
 *
 * Before a purchase price changes, every past bill line that has no cost of its
 * own is given today's purchase price, so the profit of sales already made does
 * not move with the new price.
 */

export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".csv"];

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    if (!["admin", "superadmin", "manager", "accounts"].includes(actor.role)) {
      return NextResponse.json(
        { success: false, error: "Only an admin, manager or accounts user can update prices from a sheet." },
        { status: 403 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const apply = form.get("apply") === "true";

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: "File is larger than 10 MB." }, { status: 400 });
    }
    if (!EXCEL_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      return NextResponse.json({ success: false, error: "Upload an Excel file (.xlsx, .xls or .csv)." }, { status: 400 });
    }

    const { rows, notes } = parseVspWorkbook(Buffer.from(await file.arrayBuffer()));
    if (rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No price rows were found. The sheet needs a "Model" (or "Product") column and a "New V+NLC" or "New VSP" column.',
          notes,
        },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const items = await Item.find({}, { name: 1, code: 1, vpCode: 1, supplierCodes: 1, brand: 1, vsp: 1, purchasePrice: 1 }).lean();
    const result = matchVspRows(rows, items);

    let applied = 0;
    let billsCostFrozen = 0;
    if (apply && result.updates.length > 0) {
      // Must finish before any purchase price changes; if it fails, nothing is updated.
      if (result.updates.some((u) => u.newCost !== null)) {
        billsCostFrozen = await freezeMissingLineCosts();
      }

      const write = await Item.bulkWrite(
        result.updates
          .filter((u) => mongoose.isValidObjectId(u.itemId))
          .map((u) => {
            const set: Record<string, number> = {};
            if (u.newCost !== null) set.purchasePrice = u.newCost;
            if (u.newVsp !== null) set.vsp = u.newVsp;
            return { updateOne: { filter: { _id: u.itemId }, update: { $set: set } } };
          })
      );
      applied = write.modifiedCount || 0;

      // A price change made in bulk should leave a trace of who did it and from
      // which sheet. Best-effort: the update itself has already succeeded.
      try {
        await AuditLog.create({
          action: "item.price.import",
          entityType: "Item",
          entityRef: file.name,
          reason: `Purchase price / VSP updated from sheet "${file.name}" for ${applied} products`,
          performedBy: actor.name,
          performedByUserId: actor.id,
          performedByRole: actor.role,
          metadata: {
            billsCostFrozen,
            updates: result.updates.map((u) => ({
              name: u.name,
              model: u.model,
              oldCost: u.oldCost,
              newCost: u.newCost,
              oldVsp: u.oldVsp,
              newVsp: u.newVsp,
            })),
          },
        });
      } catch (logErr) {
        console.warn("Notice: audit log for price sheet import:", logErr);
      }
    }

    return NextResponse.json({
      success: true,
      applied: apply,
      appliedCount: applied,
      billsCostFrozen,
      fileName: file.name,
      sheetRows: rows.length,
      ...result,
      notes,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
