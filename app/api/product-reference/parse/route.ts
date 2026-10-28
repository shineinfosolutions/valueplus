import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import Category from "@/models/Category";
import ProductCatalogReference from "@/models/ProductCatalogReference";
import { getActor } from "@/lib/requirePermission";
import { extractRowsFromExcel } from "@/lib/purchase-import/excel";

/**
 * Read a stock/reference Excel sheet (Itemcode / Brand / Group Name style,
 * e.g. a Tally Stock Report export) into rows ready for the admin to map
 * each distinct Group Name to a real Category — never writes anything.
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const COLUMN_KEYWORDS: Record<string, string[]> = {
  vpCode: ["itemcode", "item code", "vp code", "code"],
  description: ["item description", "description"],
  brand: ["brand"],
  groupName: ["group name", "group", "category"],
  productDesc: ["product desc"],
  charDesc: ["char desc", "characteristic"],
};

function normalise(cell: string): string {
  return String(cell || "").toLowerCase().trim();
}

/** The sheet's real header isn't necessarily row 0 — a title/date line or a
 *  blank row often sits above it (seen in the actual sample: "STOCK REPORT",
 *  then a blank row, then the header) — so this scans for the first row that
 *  actually names recognisable columns instead of assuming a fixed index. */
function findHeaderRowIndex(grid: string[][]): number {
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const joined = grid[i].map(normalise).join(" ");
    const hits = Object.values(COLUMN_KEYWORDS).filter((kws) => kws.some((k) => joined.includes(k))).length;
    if (hits >= 3) return i;
  }
  return -1;
}

function detectColumns(headerRow: string[]): Partial<Record<string, number>> {
  const map: Partial<Record<string, number>> = {};
  headerRow.forEach((cell, idx) => {
    const text = normalise(cell);
    if (!text) return;
    for (const [role, keywords] of Object.entries(COLUMN_KEYWORDS)) {
      if (map[role] !== undefined) continue;
      if (keywords.some((k) => text.includes(k))) map[role] = idx;
    }
  });
  return map;
}

/** A rough, convenience-only guess at which existing Category a sheet's raw
 *  Group Name is probably closest to — shown as a pre-filled suggestion the
 *  admin reviews and can freely change, never trusted on its own. */
function suggestCategory(groupName: string, categories: string[]): string | null {
  const groupWords = new Set(
    groupName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
  if (groupWords.size === 0) return null;

  let best: { name: string; score: number } | null = null;
  for (const cat of categories) {
    const catWords = cat
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const score = catWords.filter((w) => groupWords.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { name: cat, score };
  }
  return best?.name || null;
}

export async function POST(req: Request) {
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

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: "File is larger than 10 MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const grid = extractRowsFromExcel(buffer);

    const headerIdx = findHeaderRowIndex(grid);
    if (headerIdx === -1) {
      return NextResponse.json({
        success: false,
        error: "Couldn't find a header row with recognisable columns (Itemcode, Brand, Group Name...). Check the file.",
      });
    }
    const columns = detectColumns(grid[headerIdx]);
    if (columns.vpCode === undefined) {
      return NextResponse.json({
        success: false,
        error: "No 'Itemcode' / item code column found — this sheet doesn't look like a stock reference report.",
      });
    }

    const dataRows = grid.slice(headerIdx + 1);
    const rows = dataRows
      .map((row) => ({
        vpCode: (row[columns.vpCode!] || "").trim().toUpperCase(),
        description: columns.description !== undefined ? (row[columns.description] || "").trim() : "",
        brand: columns.brand !== undefined ? (row[columns.brand] || "").trim() : "",
        groupName: columns.groupName !== undefined ? (row[columns.groupName] || "").trim() : "",
        productDesc: columns.productDesc !== undefined ? (row[columns.productDesc] || "").trim() : "",
        charDesc: columns.charDesc !== undefined ? (row[columns.charDesc] || "").trim() : "",
      }))
      // A code cell that's entirely non-alphanumeric or empty is a stray
      // total/footer line, not a product row.
      .filter((r) => /[A-Z0-9]/i.test(r.vpCode));

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: "No product rows were found under the header." });
    }

    await connectToDatabase();
    const categories = (await Category.find({}, { name: 1 }).lean()).map((c: any) => c.name).filter(Boolean);

    // Every distinct Group Name, each with a suggested Category — preferring
    // whatever this exact group was mapped to on a PREVIOUS import (so
    // re-uploading an updated stock sheet doesn't ask the same question
    // twice) before falling back to the word-overlap guess.
    const distinctGroups: string[] = Array.from(new Set(rows.map((r) => r.groupName).filter(Boolean)));
    const priorMappings = distinctGroups.length
      ? await ProductCatalogReference.find(
          { groupName: { $in: distinctGroups }, category: { $ne: "" } },
          { groupName: 1, category: 1 }
        ).lean()
      : [];
    const priorByGroup = new Map<string, string>();
    priorMappings.forEach((m: any) => {
      if (!priorByGroup.has(m.groupName)) priorByGroup.set(m.groupName, m.category);
    });

    const groupSuggestions = distinctGroups.map((g) => ({
      groupName: g,
      suggestedCategory: priorByGroup.get(g) || suggestCategory(g, categories) || null,
    }));

    return NextResponse.json({
      success: true,
      data: { rows, groupSuggestions, totalRows: rows.length },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Could not read this file." },
      { status: 500 }
    );
  }
}
