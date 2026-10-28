/**
 * Old stock: products still on hand that have not been bought in for a long time.
 *
 * Stock is not tracked unit by unit for every product, so a product's age is
 * measured from the last time it was purchased. If that was more than six months
 * ago and some is still on the shelf, every one of those units is at least that
 * old — the figure can understate a unit's age, never overstate it. A product
 * with no purchase bill at all falls back to the day it was added to the catalog.
 */

export const SIX_MONTHS_DAYS = 180;
export const ONE_YEAR_DAYS = 365;

export type AgeBucket = "sixMonths" | "oneYear";

export interface AgedStockRow {
  _id: string;
  name: string;
  vpCode: string;
  brand: string;
  category: string;
  qty: number;
  stockValue: number;
  lastInwardDate: string;
  /** Where the date came from: a purchase bill, or the catalog entry itself. */
  dateSource: "purchase" | "catalog";
  ageDays: number;
  bucket: AgeBucket;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toDay(value: any): string {
  if (!value) return "";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function ageInDays(dateStr: string, today: Date): number {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(d.getTime())) return 0;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(0, Math.floor((t - d.getTime()) / DAY_MS));
}

export function buildAgedStock(items: any[], purchaseEntries: any[], today = new Date()) {
  // Latest purchase date per product, matched by item id first and by name for
  // bills entered before products were linked by id.
  const lastById = new Map<string, string>();
  const lastByName = new Map<string, string>();
  const keep = (map: Map<string, string>, key: string, day: string) => {
    if (!key || !day) return;
    const prev = map.get(key);
    if (!prev || day > prev) map.set(key, day);
  };
  for (const entry of purchaseEntries) {
    if (entry.status === "cancelled" || entry.type === "debit-note") continue;
    const day = toDay(entry.billDate || entry.date || entry.createdAt);
    for (const line of entry.items || []) {
      keep(lastById, String(line.itemId || ""), day);
      keep(lastByName, String(line.name || "").trim().toLowerCase(), day);
    }
  }

  const rows: AgedStockRow[] = [];
  for (const item of items) {
    const qty = Number(item.currentStock) || 0;
    if (qty <= 0) continue;

    const purchased =
      lastById.get(String(item._id)) || lastByName.get(String(item.name || "").trim().toLowerCase()) || "";
    const lastInwardDate = purchased || toDay(item.createdAt);
    if (!lastInwardDate) continue;

    const ageDays = ageInDays(lastInwardDate, today);
    if (ageDays < SIX_MONTHS_DAYS) continue;

    const unitPrice = Number(item.sellingPrice) || Number(item.purchasePrice) || 0;
    rows.push({
      _id: String(item._id),
      name: item.name || "",
      vpCode: item.vpCode || item.code || "",
      brand: item.brand || "",
      category: item.category || "",
      qty,
      stockValue: qty * unitPrice,
      lastInwardDate,
      dateSource: purchased ? "purchase" : "catalog",
      ageDays,
      bucket: ageDays >= ONE_YEAR_DAYS ? "oneYear" : "sixMonths",
    });
  }

  rows.sort((a, b) => b.ageDays - a.ageDays || b.stockValue - a.stockValue);

  const summarise = (bucket: AgeBucket) => {
    const list = rows.filter((r) => r.bucket === bucket);
    return {
      products: list.length,
      qty: list.reduce((s, r) => s + r.qty, 0),
      value: list.reduce((s, r) => s + r.stockValue, 0),
    };
  };

  return { summary: { sixMonths: summarise("sixMonths"), oneYear: summarise("oneYear") }, items: rows };
}
