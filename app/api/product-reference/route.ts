import { NextResponse } from "next/server";
import { getWriteMode } from "@/lib/d1/write-mode";
import * as mastersWrites from "@/lib/repo/masters/writes";
import connectToDatabase from "@/lib/db";
import ProductCatalogReference from "@/models/ProductCatalogReference";
import { getActor } from "@/lib/requirePermission";
import { readStock } from "@/lib/repo/stock/shadow-read";

export async function GET() {
  try {
    // Read through the read:stock switch (lib/repo/stock/shadow-read.ts): MongoDB, MongoDB compared with D1, or D1.
    const data = await readStock("productCatalogReferences.list", {});
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * Commits a parsed stock reference sheet: each row's Group Name is resolved
 * to the real Category the admin just confirmed on the mapping screen, then
 * every row is upserted by vpCode — a re-upload of the same or an updated
 * sheet overwrites in place rather than duplicating.
 */
export async function POST(req: Request) {
  // Stage D (docs/D1_MIGRATION_PLAN.md §6.8a): while write:masters is 'mongo' (the default) this is the MongoDB
  // code below, unchanged; in 'd1' the same write is made on D1 (lib/repo/masters/writes.ts), in 'fence' it waits.
  const writeMode = await getWriteMode("masters");
  if (writeMode !== "mongo") return mastersWrites.importProductReferences(req, writeMode);

  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    if (!["admin", "superadmin", "manager"].includes(actor.role)) {
      return NextResponse.json(
        { success: false, error: "Only an admin or manager can import a stock reference sheet." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
    const groupToCategory: Record<string, string> = body.groupToCategory || {};

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "No rows to import." }, { status: 400 });
    }

    await connectToDatabase();

    const operations = rows
      .filter((r) => r.vpCode)
      .map((r) => ({
        updateOne: {
          filter: { vpCode: String(r.vpCode).trim().toUpperCase() },
          update: {
            $set: {
              description: r.description || "",
              brand: r.brand || "",
              groupName: r.groupName || "",
              category: (r.groupName && groupToCategory[r.groupName]) || "",
              productDesc: r.productDesc || "",
              charDesc: r.charDesc || "",
            },
          },
          upsert: true,
        },
      }));

    const result = await ProductCatalogReference.bulkWrite(operations);

    return NextResponse.json({
      success: true,
      data: {
        matched: result.matchedCount,
        upserted: result.upsertedCount,
        total: operations.length,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
