import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import ProductCatalogReference from "@/models/ProductCatalogReference";
import Category from "@/models/Category";
import { categoryForHsnCode } from "@/lib/purchase-import/hsn-category";
import { getActor } from "@/lib/requirePermission";
import { resolveRows } from "@/lib/purchase-import/resolve-rows";
import { findMatchingItem, extractEmbeddedCode } from "@/lib/purchase-import/match-item";
import { splitSupplierLine, productNameFromLine } from "@/lib/purchase-import/supplier-line";
import { groupSerialsByProduct, findSerialsForRow } from "@/lib/purchase-import/serial-table";

/**
 * Parse an uploaded Excel/CSV or PDF purchase sheet into a preview — never
 * writes anything. The admin reviews and edits the returned rows in the UI;
 * only a later, separate save (through the existing purchase-entry flow)
 * touches the database.
 */

// PDF table extraction plus the full item lookup can run past Vercel's
// default 10s function timeout on larger files — without this, a slow
// parse gets killed mid-request and the client sees an HTML timeout page
// instead of a JSON error.
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".csv"];
const PDF_EXTENSION = ".pdf";

export async function POST(req: Request) {
  try {
    const actor = await getActor();
    if (!actor) {
      return NextResponse.json({ success: false, error: "You must be signed in to do this." }, { status: 401 });
    }
    // Matches who can already create a purchase entry / add a product.
    if (!["admin", "superadmin", "manager", "warehouse"].includes(actor.role)) {
      return NextResponse.json(
        { success: false, error: "Only an admin or manager can import a purchase sheet." },
        { status: 403 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: "File is larger than 10 MB." }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const isExcel = EXCEL_EXTENSIONS.some((ext) => name.endsWith(ext));
    const isPdf = name.endsWith(PDF_EXTENSION);

    if (!isExcel && !isPdf) {
      return NextResponse.json(
        { success: false, error: "Upload an Excel (.xlsx, .xls, .csv) or PDF file." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let grid: string[][];
    let serialGrid: string[][] = [];
    let sourceType: "excel" | "pdf" = "excel";
    let usedTableExtraction = true;
    let pdfHadNoText = false;
    // Only a PDF's own letterhead text carries this — an Excel sheet has no
    // equivalent, so it's left undefined there and the admin's own supplier
    // picker in Purchase Entry is unaffected either way.
    let supplier: { name?: string; phone?: string; gstin?: string } | undefined;

    if (isExcel) {
      // Loaded lazily so a bundling/runtime failure in one parser (e.g.
      // pdf-parse's known CJS/ESM interop issue on Vercel) can't take down
      // the other's upload path — each only pays the import cost, and risk,
      // for the file type actually chosen.
      const { extractRowsFromExcel } = await import("@/lib/purchase-import/excel");
      grid = extractRowsFromExcel(buffer);
    } else {
      sourceType = "pdf";
      const { extractRowsFromPdf } = await import("@/lib/purchase-import/pdf");
      const result = await extractRowsFromPdf(buffer);
      grid = result.grid;
      serialGrid = result.serialGrid;
      usedTableExtraction = result.usedTableExtraction;
      pdfHadNoText = !result.rawText && !result.usedTableExtraction && grid.length === 0;
      supplier = result.supplier;
    }

    if (pdfHadNoText) {
      return NextResponse.json({
        success: false,
        error:
          "No readable text found in this PDF. A scanned or photographed invoice has no text layer this can read — try the Excel upload instead, or type the bill in manually.",
      });
    }

    // A PDF whose table extraction failed falls back to raw text lines with
    // no header and no reliable column order — including invoice chrome
    // (addresses, GSTINs, bank details) that would otherwise be misread as
    // line items with invented rate/quantity values. Only trust a row there
    // when it carries this shop's own embedded product code.
    const parsedRows = resolveRows(grid, { requireEmbeddedCode: sourceType === "pdf" && !usedTableExtraction });

    if (parsedRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No product rows could be found in this file. Check the file and try again.",
      });
    }

    await connectToDatabase();
    const allItems = await Item.find(
      {},
      { name: 1, code: 1, vpCode: 1, supplierCodes: 1, purchasePrice: 1, gstRate: 1, category: 1, brand: 1, hsnCode: 1 }
    ).lean();

    // Many products came from the old stock sheet filed under its brand groups
    // ("LLOYD", "HAIER WASHING MACHINE") instead of a real category, and the
    // stock reference's categories are often wrong too. For every row a real
    // category from the Categories master is suggested from the invoice's HSN
    // code (8450 → Washing Machines, 8415 → Air Conditioners, …).
    const masterCategories = new Set(
      ((await Category.find({}, { name: 1 }).lean()) as any[]).map((c) => String(c.name || "").trim()).filter(Boolean)
    );

    const serialGroups = groupSerialsByProduct(serialGrid);

    // Only looked up for rows that don't already match a catalog Item — an
    // existing item keeps its own real category/brand, this is purely for
    // filling in a brand-new product the admin would otherwise have to pick
    // Category/Brand for by hand.
    const referenceByVpCode = new Map<string, { category: string; brand: string }>();
    const codesPresent = parsedRows.some((row) => extractEmbeddedCode(row.name));
    if (codesPresent) {
      const references = await ProductCatalogReference.find(
        { category: { $ne: "" } },
        { vpCode: 1, category: 1, brand: 1 }
      ).lean();
      references.forEach((r: any) => {
        referenceByVpCode.set(r.vpCode, { category: r.category || "", brand: r.brand || "" });
      });
    }

    // Two invoice lines can carry the same product code (one unit per line),
    // while the serial page lists them all under that code — each line takes
    // the next serials in order, as many as its quantity, instead of every
    // line getting the whole list.
    const serialsTaken: Record<string, number> = {};
    const takeSerials = (rowName: string, quantity: number): string[] | undefined => {
      const all = findSerialsForRow(rowName, serialGroups);
      if (!all || all.length === 0) return undefined;
      const key = extractEmbeddedCode(rowName) || rowName;
      const start = serialsTaken[key] || 0;
      const count = Math.max(1, Math.round(quantity) || 1);
      serialsTaken[key] = start + count;
      const sameCodeRows = parsedRows.filter((r) => (extractEmbeddedCode(r.name) || r.name) === key).length;
      // A single line keeps every serial listed for it, as before.
      return sameCodeRows > 1 ? all.slice(start, start + count) : all;
    };

    const rows = parsedRows.map((row) => {
      const matched = findMatchingItem(row.name, allItems);
      const serialNumbers = takeSerials(row.name, row.quantity);
      const embeddedCode = !matched ? extractEmbeddedCode(row.name) : null;
      const referenceMatch = embeddedCode ? referenceByVpCode.get(embeddedCode) || null : null;
      // "VP0012023 - GLS19I3AGAHF- LLOYD" → code VP0012023, brand LLOYD, and the
      // clean name a new product should get: "GLS19I3AGAHF- LLOYD".
      const parts = splitSupplierLine(row.name);
      const suggestedCategory = categoryForHsnCode(row.hsn, masterCategories);
      return {
        ...row,
        suggestedCategory,
        // "Right" means a master category that agrees with the HSN on the bill.
        categoryIsMaster: matched
          ? masterCategories.has(String(matched.category || "").trim()) &&
            (!suggestedCategory || suggestedCategory === String(matched.category || "").trim())
          : true,
        supplierCode: parts.supplierCode,
        parsedBrand: parts.brand,
        suggestedName: productNameFromLine(parts) || row.name,
        matchedItem: matched
          ? {
              _id: String(matched._id),
              code: matched.code,
              vpCode: matched.vpCode,
              name: matched.name,
              category: matched.category,
              brand: matched.brand,
              gstRate: matched.gstRate,
            }
          : null,
        serialNumbers: serialNumbers && serialNumbers.length > 0 ? serialNumbers : undefined,
        referenceMatch,
      };
    });

    const matchedCount = rows.filter((r) => r.matchedItem).length;

    return NextResponse.json({
      success: true,
      data: {
        rows,
        supplier,
        meta: {
          sourceType,
          usedTableExtraction,
          totalRows: rows.length,
          matchedCount,
          newCount: rows.length - matchedCount,
          lowConfidenceCount: rows.filter((r) => r.lowConfidence).length,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Could not read this file." },
      { status: 500 }
    );
  }
}
