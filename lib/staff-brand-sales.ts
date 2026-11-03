import Invoice from "@/models/Invoice";
import Item from "@/models/Item";
import mongoose from "mongoose";
import { normName } from "@/lib/staff-incentive";

export interface BrandRow {
  brand: string;
  quantity: number;
  amount: number;
}

export interface BrandSales {
  assignedBrand: string;
  own: { quantity: number; amount: number };
  other: { quantity: number; amount: number };
  otherBrands: BrandRow[];
  bills: number;
}

const normBrand = (b: any) => String(b || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isSameBrand = (assigned: string, line: string) => {
  const a = normBrand(assigned);
  const l = normBrand(line);
  return !!a && !!l && (a === l || l.includes(a) || a.includes(l));
};

/**
 * How much a salesman sold of his own brand and of other brands (pieces and amount incl. GST), from the bills that
 * carry his name as Sales Executive. `from` / `to` (YYYY-MM-DD) limit the bill dates; leave them out for all time.
 * The brand of a line is the product catalog's brand, because the brand saved on old bill lines is often generic.
 */
export async function brandSalesFor(name: string, assignedBrand: string, from?: string, to?: string): Promise<BrandSales> {
  const dateQuery: any = {};
  if (from) dateQuery.$gte = from;
  if (to) dateQuery.$lte = to;
  const query: any = { type: { $nin: ["proforma", "sales-order", "credit-note"] }, status: { $ne: "cancelled" } };
  if (from || to) query.date = dateQuery;
  const all: any[] = await Invoice.find(query, { salesExecutive: 1, items: 1, date: 1 }).lean();
  const k = normName(name);
  const mine = all.filter((b) => normName(b.salesExecutive) === k);

  const ids = new Set<string>();
  const names = new Set<string>();
  for (const b of mine) for (const l of b.items || []) {
    if (mongoose.isValidObjectId(l.itemId)) ids.add(String(l.itemId));
    else if (l.itemName) names.add(String(l.itemName));
  }
  const catalog: any[] = ids.size + names.size
    ? await Item.find({ $or: [{ _id: { $in: Array.from(ids) } }, { name: { $in: Array.from(names) } }] }, { name: 1, brand: 1 }).lean()
    : [];
  const byId = new Map(catalog.map((c) => [String(c._id), c.brand]));
  const byName = new Map(catalog.map((c) => [String(c.name).trim().toLowerCase(), c.brand]));

  const own = { quantity: 0, amount: 0 };
  const other = { quantity: 0, amount: 0 };
  const perBrand = new Map<string, BrandRow>();
  for (const b of mine) {
    for (const l of b.items || []) {
      const brand =
        byId.get(String(l.itemId)) || byName.get(String(l.itemName || "").trim().toLowerCase()) ||
        (l.brand && !/showroom partner/i.test(l.brand) ? l.brand : "") ||
        "Unknown";
      const qty = Number(l.quantity) || 0;
      const amt = Number(l.amount) || 0;
      if (isSameBrand(assignedBrand, brand)) {
        own.quantity += qty;
        own.amount += amt;
      } else {
        other.quantity += qty;
        other.amount += amt;
        const key = normBrand(brand) || "unknown";
        const row = perBrand.get(key) || { brand: String(brand), quantity: 0, amount: 0 };
        row.quantity += qty;
        row.amount += amt;
        perBrand.set(key, row);
      }
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    assignedBrand,
    own: { quantity: own.quantity, amount: r2(own.amount) },
    other: { quantity: other.quantity, amount: r2(other.amount) },
    otherBrands: Array.from(perBrand.values()).map((r) => ({ ...r, amount: r2(r.amount) })).sort((a, b) => b.amount - a.amount),
    bills: mine.length,
  };
}
