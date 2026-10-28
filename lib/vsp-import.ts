import * as XLSX from "xlsx";

/**
 * Brand price-list sheets (e.g. "LG Price List_Oct 26.xlsx") carry one tab per
 * product family. Each tab has a header row with a "Sap code" column, one or two
 * "Model" columns, a "New V+NLC" column and a "New VSP" column. This reads every
 * tab and matches its rows to catalog products so that two prices are updated:
 *
 *   New V+NLC → the product's purchase price (its cost)
 *   New VSP   → the product's VSP
 *
 * A tab may carry only one of the two ("LG Panel 2025" has no VSP); then only
 * that price is updated. MRP, DP, Store Landing and every other field are left
 * alone.
 *
 * The sheet's Sap code (VP0009918) is the brand's own number and does not match
 * the catalog's generated VP code (VP-DWXD9S7054), so a product is recognised by
 * its model number: the sheet says "55UA83006LA", the catalog names the product
 * "55UA83006LA.ATR-LG". Both are reduced to the base model before the first dot.
 */

export interface VspSheetRow {
  sheet: string;
  rowNumber: number;
  sapCode: string;
  /** Model as written in the sheet (the fullest form available). */
  model: string;
  /** Every base model this row can be recognised by. */
  modelKeys: string[];
  /** New VSP, or null when the tab or row has none. */
  vsp: number | null;
  /** New V+NLC (the purchase price), or null when the tab or row has none. */
  cost: number | null;
}

export interface VspSheetNote {
  sheet: string;
  message: string;
}

const clean = (value: any) => String(value ?? "").replace(/\s+/g, " ").trim();

/** "GL-B257JPZ3.DSS" → "GLB257JPZ3": the model up to the first dot, letters and digits only. */
export function baseModelKey(value: any): string {
  const text = clean(value).toUpperCase();
  if (!text) return "";
  const beforeDot = text.split(".")[0];
  // A catalog name can carry words after the model ("ABC123 LG LED"); the model
  // itself never contains a space or a bracket.
  const firstToken = beforeDot.split(/[\s(]/)[0];
  return firstToken.replace(/[^A-Z0-9]/g, "");
}

function toNumber(value: any): number {
  if (typeof value === "number") return value;
  const n = Number(clean(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** A positive price rounded to paise, or null for a blank / dash / zero cell. */
function toPrice(value: any): number | null {
  const n = toNumber(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const formatPrice = (n: number | null) => (n === null ? "-" : String(n));

// The column holding the model number. LG sheets call it "Model"; other brands'
// sheets (e.g. Aisen) call it "Product" or "Model No.". A tab's "Model" columns
// are used when it has any, the other names only when it has none.
const MODEL_HEADER = /^model$/i;
const MODEL_HEADER_FALLBACK = /^(model\s*(no\.?|number|code)|product|product\s*(code|model)|item\s*code)$/i;
const isModelHeader = (c: string) => MODEL_HEADER.test(c) || MODEL_HEADER_FALLBACK.test(c);

export function parseVspWorkbook(data: Buffer | ArrayBuffer | Uint8Array): { rows: VspSheetRow[]; notes: VspSheetNote[] } {
  const workbook = XLSX.read(data, { type: "buffer" });
  const rows: VspSheetRow[] = [];
  const notes: VspSheetNote[] = [];

  for (const sheet of workbook.SheetNames) {
    const grid: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: "", blankrows: false });

    // The header is the first row that names a model column ("Model", or
    // "Product" / "Model No."); a tab without one is reported, not guessed at.
    const headerIndex = grid.findIndex((r) => r.some((c) => isModelHeader(clean(c))));
    if (headerIndex < 0) {
      notes.push({ sheet, message: `Sheet "${sheet}" was skipped: it has no "Model" or "Product" column.` });
      continue;
    }
    const header = grid[headerIndex].map(clean);
    const vspIndex = header.findIndex((c) => /\bvsp\b/i.test(c));
    // "New V+NLC" / "NEW V+NLC" — the store's landing cost from the brand.
    const costIndex = header.findIndex((c) => /v\s*\+\s*nl/i.test(c));
    if (vspIndex < 0 && costIndex < 0) {
      notes.push({ sheet, message: `Sheet "${sheet}" was skipped: it has neither a "New V+NLC" nor a "New VSP" column.` });
      continue;
    }
    if (vspIndex < 0) {
      notes.push({ sheet, message: `Sheet "${sheet}" has no "New VSP" column, so only purchase prices are taken from it.` });
    } else if (costIndex < 0) {
      notes.push({ sheet, message: `Sheet "${sheet}" has no "New V+NLC" column, so only VSPs are taken from it.` });
    }
    let modelIndexes = header.map((c, i) => (MODEL_HEADER.test(c) ? i : -1)).filter((i) => i >= 0);
    if (modelIndexes.length === 0) {
      modelIndexes = header.map((c, i) => (MODEL_HEADER_FALLBACK.test(c) ? i : -1)).filter((i) => i >= 0);
    }
    const sapIndex = header.findIndex((c) => /sap\s*code/i.test(c));

    for (let i = headerIndex + 1; i < grid.length; i++) {
      const row = grid[i];
      const models = modelIndexes.map((idx) => clean(row[idx])).filter(Boolean);
      if (models.length === 0) continue;
      // A header repeated further down the tab is not a product.
      if (models.every((m) => isModelHeader(m))) continue;

      const vsp = vspIndex >= 0 ? toPrice(row[vspIndex]) : null;
      const cost = costIndex >= 0 ? toPrice(row[costIndex]) : null;
      const model = models.slice().sort((a, b) => b.length - a.length)[0];
      if (vsp === null && cost === null) {
        notes.push({ sheet, message: `${model} (sheet "${sheet}", row ${i + 1}) was skipped: it has no V+NLC or VSP value.` });
        continue;
      }

      const modelKeys = Array.from(new Set(models.map(baseModelKey).filter((k) => k.length >= 3)));
      if (modelKeys.length === 0) continue;

      const sapCode = sapIndex >= 0 ? clean(row[sapIndex]) : "";
      rows.push({
        sheet,
        rowNumber: i + 1,
        sapCode: /^[-–]?$/.test(sapCode) ? "" : sapCode,
        model,
        modelKeys,
        vsp,
        cost,
      });
    }
  }

  return { rows, notes };
}

export interface VspMatchResult {
  /**
   * Products with at least one price changing. A `new*` value is null when that
   * price is not changing (not in the sheet, or already the same).
   */
  updates: {
    itemId: string;
    name: string;
    code: string;
    model: string;
    sheet: string;
    oldCost: number;
    newCost: number | null;
    oldVsp: number;
    newVsp: number | null;
  }[];
  /** Products found, already on these prices. */
  unchanged: { itemId: string; name: string; model: string; sheet: string; cost: number | null; vsp: number | null }[];
  /** Sheet rows with no product in the catalog. */
  notAdded: { model: string; sapCode: string; sheet: string; cost: number | null; vsp: number | null; message: string }[];
  /** Sheet rows left out, with the reason. */
  skipped: { model: string; sheet: string; message: string }[];
}

const samePrice = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Every model number a catalog product's name could carry. The first word is
 * the model for most names ("55UA83006LA.ATR-LG"), but some put the brand
 * first ("AISEN A43FDS962- AISEN") or glue it on ("A32HDS623-AISEN LED"), so
 * each word is tried too — kept only when it has both letters and digits and
 * is long enough to be a model, never a plain word like "AISEN" or "LED".
 */
function itemModelKeys(name: any): string[] {
  const keys = new Set<string>();
  const first = baseModelKey(name);
  if (first) keys.add(first);
  for (const word of clean(name).toUpperCase().split(/[\s()/,]+/)) {
    const beforeDot = word.split(".")[0];
    // "A32HDS623-AISEN" → also "A32HDS623": a trailing "-BRAND" (letters only).
    const withoutBrand = beforeDot.replace(/-[A-Z]+$/, "");
    for (const candidate of [beforeDot, withoutBrand]) {
      const key = candidate.replace(/[^A-Z0-9]/g, "");
      if (key.length >= 5 && /[A-Z]/.test(key) && /\d/.test(key)) keys.add(key);
    }
  }
  return Array.from(keys);
}

export function matchVspRows(rows: VspSheetRow[], items: any[]): VspMatchResult {
  const itemsByModel = new Map<string, any[]>();
  const itemsByCode = new Map<string, any>();
  for (const item of items) {
    for (const key of itemModelKeys(item.name)) {
      const list = itemsByModel.get(key) || [];
      if (!list.includes(item)) itemsByModel.set(key, [...list, item]);
    }
    for (const code of [item.code, item.vpCode, ...(Array.isArray(item.supplierCodes) ? item.supplierCodes : [])]) {
      const c = clean(code).toUpperCase();
      if (c) itemsByCode.set(c, item);
    }
  }

  const result: VspMatchResult = { updates: [], unchanged: [], notAdded: [], skipped: [] };
  const decided = new Map<string, { cost: number | null; vsp: number | null; sheet: string }>();

  for (const row of rows) {
    const matched = new Map<string, any>();
    const byCode = row.sapCode ? itemsByCode.get(row.sapCode.toUpperCase()) : null;
    if (byCode) matched.set(String(byCode._id), byCode);
    for (const key of row.modelKeys) {
      for (const item of itemsByModel.get(key) || []) matched.set(String(item._id), item);
    }

    if (matched.size === 0) {
      result.notAdded.push({
        model: row.model,
        sapCode: row.sapCode,
        sheet: row.sheet,
        cost: row.cost,
        vsp: row.vsp,
        message: `Product not added: ${row.model} is not in the product list, so its prices were not updated.`,
      });
      continue;
    }

    for (const item of matched.values()) {
      const itemId = String(item._id);
      const earlier = decided.get(itemId);
      if (earlier) {
        // The same product listed twice: the first prices in the sheet are kept and
        // a different later price is reported, never silently applied over them.
        if (earlier.cost !== row.cost || earlier.vsp !== row.vsp) {
          result.skipped.push({
            model: row.model,
            sheet: row.sheet,
            message: `${row.model} appears again in sheet "${row.sheet}" (V+NLC ${formatPrice(row.cost)}, VSP ${formatPrice(
              row.vsp
            )}); the first values (V+NLC ${formatPrice(earlier.cost)}, VSP ${formatPrice(earlier.vsp)}, sheet "${earlier.sheet}") were used.`,
          });
        }
        continue;
      }
      decided.set(itemId, { cost: row.cost, vsp: row.vsp, sheet: row.sheet });

      const oldCost = Number(item.purchasePrice) || 0;
      const oldVsp = Number(item.vsp) || 0;
      const newCost = row.cost !== null && !samePrice(oldCost, row.cost) ? row.cost : null;
      const newVsp = row.vsp !== null && !samePrice(oldVsp, row.vsp) ? row.vsp : null;

      if (newCost === null && newVsp === null) {
        result.unchanged.push({ itemId, name: item.name, model: row.model, sheet: row.sheet, cost: row.cost, vsp: row.vsp });
      } else {
        result.updates.push({
          itemId,
          name: item.name,
          code: item.code || item.vpCode || "",
          model: row.model,
          sheet: row.sheet,
          oldCost,
          newCost,
          oldVsp,
          newVsp,
        });
      }
    }
  }

  return result;
}
