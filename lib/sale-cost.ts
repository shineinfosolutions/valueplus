import mongoose from "mongoose";
import Item from "@/models/Item";
import Invoice from "@/models/Invoice";

/**
 * The cost of goods on a bill line.
 *
 * A bill line keeps the product's purchase price as it stood when the bill was
 * made (`costPrice`), so a later price change — a brand price sheet, a new
 * purchase rate — does not rewrite the profit of sales already made. Lines from
 * before this existed have no `costPrice`; for them the catalog's purchase price
 * is used, which is what the P&L always did.
 */

type CatalogLookup = (line: any) => any | null;

/** Find the catalog product a bill line refers to: by id, then VP/item code, then name. */
export function buildCatalogLookup(catalogItems: any[]): CatalogLookup {
  const byId = new Map<string, any>();
  const byCode = new Map<string, any>();
  const byName = new Map<string, any>();
  for (const it of catalogItems) {
    if (it._id) byId.set(String(it._id), it);
    if (it.code) byCode.set(String(it.code).toUpperCase(), it);
    if (it.vpCode) byCode.set(String(it.vpCode).toUpperCase(), it);
    if (it.name) byName.set(String(it.name).trim().toLowerCase(), it);
  }
  return (line: any) => {
    if (line.itemId && byId.has(String(line.itemId))) return byId.get(String(line.itemId));
    if (line.vpCode && byCode.has(String(line.vpCode).toUpperCase())) return byCode.get(String(line.vpCode).toUpperCase());
    if (line.itemCode && byCode.has(String(line.itemCode).toUpperCase())) return byCode.get(String(line.itemCode).toUpperCase());
    if (line.itemName && byName.has(String(line.itemName).trim().toLowerCase())) {
      return byName.get(String(line.itemName).trim().toLowerCase());
    }
    return null;
  };
}

/** A catalog product's current unit cost (purchase price, else 80% of selling price). */
export function catalogUnitCost(item: any | null): number {
  return Number(item?.purchasePrice || (item?.sellingPrice ? item.sellingPrice * 0.8 : 0));
}

/** True when a bill line already carries the cost it was sold at. */
export function hasStoredCost(line: any): boolean {
  return typeof line?.costPrice === "number" && Number.isFinite(line.costPrice);
}

/** Unit cost of a bill line: the stored cost if it has one, else the catalog's. */
export function lineUnitCost(line: any, matched: any | null): number {
  return hasStoredCost(line) ? Number(line.costPrice) : catalogUnitCost(matched);
}

/**
 * Put the unit cost on each line of a bill being saved. The value always comes
 * from the server, never from the form. On an edit, a line for a product that
 * was already on the bill keeps the cost it was first sold at.
 */
export async function stampLineCosts(lines: any[], previousLines: any[] = []): Promise<any[]> {
  if (!Array.isArray(lines) || lines.length === 0) return lines;

  const earlierCost = new Map<string, number>();
  for (const prev of previousLines || []) {
    if (prev?.itemId && hasStoredCost(prev) && !earlierCost.has(String(prev.itemId))) {
      earlierCost.set(String(prev.itemId), Number(prev.costPrice));
    }
  }

  const ids = lines.map((l) => l?.itemId).filter((id) => mongoose.isValidObjectId(id));
  const products = ids.length
    ? await Item.find({ _id: { $in: ids } }, { name: 1, code: 1, vpCode: 1, purchasePrice: 1, sellingPrice: 1 }).lean()
    : [];
  const lookup = buildCatalogLookup(products as any[]);

  return lines.map((line) => {
    if (!line || typeof line !== "object") return line;
    const kept = line.itemId ? earlierCost.get(String(line.itemId)) : undefined;
    const costPrice = kept !== undefined ? kept : Math.round(catalogUnitCost(lookup(line)) * 100) / 100;
    return { ...line, costPrice };
  });
}

/**
 * Freeze the cost on every existing bill line that has none, at today's catalog
 * purchase price — exactly the figure the P&L shows for it now. Run before
 * catalog purchase prices are changed in bulk, so past months keep their profit.
 * Returns the number of bills touched.
 */
export async function freezeMissingLineCosts(): Promise<number> {
  const invoices = await Invoice.find(
    { items: { $elemMatch: { costPrice: { $exists: false } } } },
    { items: 1 }
  ).lean();
  if (invoices.length === 0) return 0;

  const catalog = await Item.find({}, { name: 1, code: 1, vpCode: 1, purchasePrice: 1, sellingPrice: 1 }).lean();
  const lookup = buildCatalogLookup(catalog as any[]);

  const ops: any[] = [];
  for (const inv of invoices as any[]) {
    const set: Record<string, number> = {};
    (inv.items || []).forEach((line: any, idx: number) => {
      if (!hasStoredCost(line)) set[`items.${idx}.costPrice`] = Math.round(catalogUnitCost(lookup(line)) * 100) / 100;
    });
    if (Object.keys(set).length > 0) ops.push({ updateOne: { filter: { _id: inv._id }, update: { $set: set } } });
  }
  if (ops.length === 0) return 0;
  const res = await Invoice.bulkWrite(ops, { ordered: false });
  return res.modifiedCount || 0;
}
