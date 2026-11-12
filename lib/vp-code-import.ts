import * as XLSX from "xlsx";
import { isRealVpCode } from "@/lib/vp-code";
import { modelKey } from "@/lib/purchase-import/supplier-line";
import { extractEmbeddedCode } from "@/lib/purchase-import/match-item";

/**
 * A sheet that lists each product's VP code beside its name, used to put the right VP code on the catalog products.
 *
 * Each tab needs a header row with a product-name column ("Product", "Product Name", "Item", "Model", "Description"...)
 * and, usually, a "VP Code" column (a name cell that carries the code itself, like "VP0002116 - EI3V-C1(I)-P IVORY- HAIER",
 * also works). An optional "Brand" column helps recognise the model.
 *
 * Matching is careful, never a guess: a product is found by a code it already carries, by the same name, or by the same
 * model number when only ONE product has it. Several candidates, or none, are reported and left alone.
 */

export interface VpSheetRow {
  sheet: string;
  rowNumber: number;
  vpCode: string;
  name: string;
  brand: string;
}

export interface VpSheetNote {
  sheet: string;
  message: string;
}

const clean = (value: any) => String(value ?? "").replace(/\s+/g, " ").trim();
const VP_HEADER = /^(vp\s*code|sap\s*code|vp|item\s*code|material\s*code)$/i;
const NAME_HEADER = /^(product(\s*name)?|item(\s*name)?|name|model(\s*(no\.?|name|number))?|(material\s*)?desc(ription)?)$/i;
const BRAND_HEADER = /^brand$/i;

export function parseVpCodeWorkbook(data: Buffer | ArrayBuffer | Uint8Array): { rows: VpSheetRow[]; notes: VpSheetNote[] } {
  const workbook = XLSX.read(data, { type: "buffer" });
  const rows: VpSheetRow[] = [];
  const notes: VpSheetNote[] = [];

  for (const sheet of workbook.SheetNames) {
    const grid: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: "", blankrows: false });
    const headerIndex = grid.findIndex((r) => r.some((c) => NAME_HEADER.test(clean(c))));
    if (headerIndex < 0) {
      notes.push({ sheet, message: `Sheet "${sheet}" was skipped: it has no product name column ("Product", "Item", "Model" or "Description").` });
      continue;
    }
    const header = grid[headerIndex].map(clean);
    const nameIndex = header.findIndex((c) => NAME_HEADER.test(c));
    const vpIndex = header.findIndex((c) => VP_HEADER.test(c));
    const brandIndex = header.findIndex((c) => BRAND_HEADER.test(c));

    for (let i = headerIndex + 1; i < grid.length; i++) {
      const row = grid[i];
      const name = clean(row[nameIndex]);
      if (!name || NAME_HEADER.test(name)) continue; // blank, or a header repeated further down
      const typed = vpIndex >= 0 ? clean(row[vpIndex]).toUpperCase().replace(/\s+/g, "") : "";
      // The code column first; else a code written inside the name cell.
      const embedded = (extractEmbeddedCode(name) || "").replace("VP-", "VP");
      const vpCode = typed || embedded;
      if (!vpCode || /^[-–]$/.test(vpCode)) {
        notes.push({ sheet, message: `${name} (sheet "${sheet}", row ${i + 1}) was skipped: it has no VP code.` });
        continue;
      }
      rows.push({ sheet, rowNumber: i + 1, vpCode, name, brand: brandIndex >= 0 ? clean(row[brandIndex]) : "" });
    }
  }
  return { rows, notes };
}

export interface VpMatchedRow {
  itemId: string;
  name: string;
  /** The VP code the product shows now (its real one, else the code it is known by). */
  shownNow: string;
  newVpCode: string;
  sheet: string;
  rowNumber: number;
  how: "code" | "name" | "model";
}

export interface VpImportPlan {
  /** Products with no real VP code yet: safe to apply. */
  updates: VpMatchedRow[];
  /** Products that already have a different real VP code: only applied when ticked. */
  different: (VpMatchedRow & { oldVpCode: string })[];
  /** Already carry this VP code. */
  unchanged: { itemId: string; name: string; vpCode: string }[];
  /** The VP code is already shown by another product. */
  conflicts: { name: string; vpCode: string; sheet: string; rowNumber: number; heldBy: string }[];
  /** Several products fit the row: none is changed. */
  ambiguous: { name: string; vpCode: string; sheet: string; rowNumber: number; candidates: string[] }[];
  /** No product in the catalog fits the row. */
  notFound: { name: string; vpCode: string; sheet: string; rowNumber: number }[];
  skipped: { name: string; sheet: string; message: string }[];
}

const normaliseName = (value: string) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const up = (v: any) => clean(v).toUpperCase();

export function planVpCodes(rows: VpSheetRow[], items: any[]): VpImportPlan {
  const byCode = new Map<string, any>();
  const byName = new Map<string, any[]>();
  const byModel = new Map<string, any[]>();
  const holder = new Map<string, any>();
  const push = (m: Map<string, any[]>, k: string, it: any) => {
    if (!k) return;
    const l = m.get(k) || [];
    if (!l.includes(it)) m.set(k, [...l, it]);
  };
  for (const it of items) {
    for (const c of [it.code, it.vpCode, ...(Array.isArray(it.supplierCodes) ? it.supplierCodes : [])]) if (isRealVpCode(c)) byCode.set(up(c), it);
    if (isRealVpCode(it.vpCode)) holder.set(up(it.vpCode), it);
    push(byName, normaliseName(it.name), it);
    const mk = modelKey(String(it.name || ""), it.brand);
    if (mk.length >= 5) push(byModel, mk, it);
  }

  const plan: VpImportPlan = { updates: [], different: [], unchanged: [], conflicts: [], ambiguous: [], notFound: [], skipped: [] };
  const decided = new Map<string, string>(); // itemId -> the VP code the sheet gave it first
  const assigned = new Map<string, string>(); // VP code -> the product this sheet gave it to

  for (const row of rows) {
    const vp = up(row.vpCode);
    if (!isRealVpCode(vp)) {
      plan.skipped.push({ name: row.name, sheet: row.sheet, message: `${row.name} (row ${row.rowNumber}): "${row.vpCode}" is not a VP code (VP and 6 to 8 digits), so it was skipped.` });
      continue;
    }

    // 1. A product that already carries this code, 2. the same name, 3. the same model (only when one product has it).
    let target: any = byCode.get(vp) || null;
    let how: VpMatchedRow["how"] = "code";
    if (!target) {
      const sameName = byName.get(normaliseName(row.name)) || [];
      const stripped = byName.get(normaliseName(row.name.replace(/^VP-?\d{4,}\s*-\s*/i, ""))) || [];
      const named = sameName.length ? sameName : stripped;
      if (named.length === 1) {
        target = named[0];
        how = "name";
      } else if (named.length > 1) {
        plan.ambiguous.push({ name: row.name, vpCode: vp, sheet: row.sheet, rowNumber: row.rowNumber, candidates: named.map((n) => n.name) });
        continue;
      } else {
        const mk = modelKey(row.name, row.brand);
        const modelHits = mk.length >= 5 ? byModel.get(mk) || [] : [];
        if (modelHits.length === 1) {
          target = modelHits[0];
          how = "model";
        } else if (modelHits.length > 1) {
          plan.ambiguous.push({ name: row.name, vpCode: vp, sheet: row.sheet, rowNumber: row.rowNumber, candidates: modelHits.map((n) => n.name) });
          continue;
        }
      }
    }
    if (!target) {
      plan.notFound.push({ name: row.name, vpCode: vp, sheet: row.sheet, rowNumber: row.rowNumber });
      continue;
    }

    const itemId = String(target._id);
    const earlier = decided.get(itemId);
    if (earlier) {
      if (earlier !== vp) plan.skipped.push({ name: row.name, sheet: row.sheet, message: `${target.name} appears again (row ${row.rowNumber}) with ${vp}; the first code, ${earlier}, was used.` });
      continue;
    }
    decided.set(itemId, vp);

    const current = isRealVpCode(target.vpCode) ? up(target.vpCode) : "";
    if (current === vp) {
      plan.unchanged.push({ itemId, name: target.name, vpCode: vp });
      continue;
    }
    // The same code given to two products by this sheet, or already shown by another product.
    const heldBy = holder.get(vp) || (assigned.has(vp) && assigned.get(vp) !== itemId ? { _id: assigned.get(vp), name: "another row of this sheet" } : null);
    if (heldBy && String(heldBy._id) !== itemId) {
      plan.conflicts.push({ name: target.name, vpCode: vp, sheet: row.sheet, rowNumber: row.rowNumber, heldBy: heldBy.name });
      continue;
    }
    assigned.set(vp, itemId);
    const matched: VpMatchedRow = { itemId, name: target.name, shownNow: target.vpCode || target.code || "", newVpCode: vp, sheet: row.sheet, rowNumber: row.rowNumber, how };
    if (current) plan.different.push({ ...matched, oldVpCode: current });
    else plan.updates.push(matched);
  }
  return plan;
}
