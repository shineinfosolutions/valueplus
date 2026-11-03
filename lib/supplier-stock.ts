import * as XLSX from "xlsx";

/**
 * The supplier warehouse's daily stock report ("STOCK REPORT FOR COCO AND FOFO").
 * Its header row has: Itemcode, Item Description, Brand, Group Name, Product Desc,
 * Char Desc, Warehouse Name, Available Stock. Columns are found by their names, so
 * an empty or extra column between them does not matter.
 */

export const STOCK_UPLOAD_ROLES = ["admin", "superadmin", "manager", "cashier"];
// The Store Manager can review, combine and send stock orders like the Admin.
export const STOCK_APPROVER_ROLES = ["admin", "superadmin", "manager"];
export const STOCK_ORDER_ROLES = ["salesman", "sales", "admin", "superadmin", "manager", "cashier"];

export interface SupplierStockRow {
  itemCode: string;
  description: string;
  brand: string;
  groupName: string;
  productDesc: string;
  charDesc: string;
  warehouse: string;
  availableStock: number;
}

const clean = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim();

export function parseSupplierStockSheet(data: Buffer | ArrayBuffer | Uint8Array): { rows: SupplierStockRow[]; error?: string } {
  const wb = XLSX.read(data, { type: "buffer" });
  const merged = new Map<string, SupplierStockRow>();

  for (const name of wb.SheetNames) {
    const grid: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", blankrows: false });
    const headerAt = grid.findIndex(
      (r) => r.some((c) => /^item\s*code$/i.test(clean(c))) && r.some((c) => /available\s*stock|^stock$/i.test(clean(c)))
    );
    if (headerAt < 0) continue;
    const header = grid[headerAt].map(clean);
    const col = (re: RegExp) => header.findIndex((c) => re.test(c));
    const iCode = col(/^item\s*code$/i);
    const iDesc = col(/^item\s*desc/i);
    const iBrand = col(/^brand$/i);
    const iGroup = col(/^group/i);
    const iProduct = col(/^product\s*desc/i);
    const iChar = col(/^char/i);
    const iWh = col(/warehouse/i);
    const iStock = col(/available\s*stock|^stock$/i);

    for (let r = headerAt + 1; r < grid.length; r++) {
      const row = grid[r];
      const itemCode = clean(row[iCode]);
      if (!itemCode || /^item\s*code$/i.test(itemCode)) continue;
      const qty = Number(String(row[iStock]).replace(/,/g, ""));
      if (!Number.isFinite(qty)) continue;
      const warehouse = iWh >= 0 ? clean(row[iWh]) : "";
      const key = `${itemCode.toUpperCase()}|${warehouse.toUpperCase()}`;
      const earlier = merged.get(key);
      if (earlier) {
        earlier.availableStock += qty; // the same product listed twice in one warehouse
        continue;
      }
      merged.set(key, {
        itemCode: itemCode.toUpperCase(),
        description: iDesc >= 0 ? clean(row[iDesc]) : "",
        brand: iBrand >= 0 ? clean(row[iBrand]) : "",
        groupName: iGroup >= 0 ? clean(row[iGroup]) : "",
        productDesc: iProduct >= 0 ? clean(row[iProduct]) : "",
        charDesc: iChar >= 0 ? clean(row[iChar]) : "",
        warehouse,
        availableStock: qty,
      });
    }
  }

  if (merged.size === 0) {
    return { rows: [], error: 'No stock rows found. The sheet needs a header row with "Itemcode" and "Available Stock" columns.' };
  }
  return { rows: Array.from(merged.values()) };
}

export { buildOrderMessage } from "@/lib/stock-order-message";
