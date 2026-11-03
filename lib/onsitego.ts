/**
 * Onsitego (extended-warranty partner). Client-safe: used by the bill form and the server.
 *
 * Price list: the Admin uploads Onsitego's plan PDF ("OnsiteGo Extended Warranty — SKU Name · VP Code ·
 * Price (VSP)") to the On Site Go documents folder. Every plan line of it, e.g.
 *   "2 Yr EW for AC - 30K - 40K   VP0013773   ₹ 5,299"
 * is read by `parsePlanLines` (lib/onsitego-server.ts reads the PDF's text) and replaces the stored list.
 * The bill form then shows, for each product, every plan whose product type and price slab fit it.
 *
 * Incentive: the bill's salesman earns 10% of every Onsitego plan sold on the bill. It is worked out on the
 * server when a bill is saved or edited (`Invoice.onsitegoIncentive`) and added to his incentive
 * (lib/staff-incentive.ts). Bills from before this rule carry no value and earn nothing extra.
 */

export const ONSITEGO_INCENTIVE_RATE = 0.1;

/** The Documents folder the Admin uploads Onsitego material to (the plan price list PDF). */
export const ONSITEGO_FOLDER = "On Site Go";

export const isOnsitego = (provider: any) => /on\s*site\s*go/i.test(String(provider || ""));

/** 10% of the Onsitego plan amounts on a bill's lines, in rupees (2 decimals). */
export function onsitegoIncentiveOf(items: any[] | undefined | null): number {
  const total = (items || []).reduce(
    (t, it) => t + (isOnsitego(it?.extendedWarrantyProvider) ? Number(it?.extendedWarrantyAmount) || 0 : 0),
    0
  );
  return Math.round(total * ONSITEGO_INCENTIVE_RATE * 100) / 100;
}

export interface OnsitegoPlanRow {
  /** Section of the price list, e.g. "Television — ADLD (Accidental & Liquid Damage)". */
  category: string;
  /** Product group the plan is for (see DEVICE_GROUPS), e.g. "TV". */
  device: string;
  /** EW, ADLD, AMC, LTC … */
  kind: string;
  years: number;
  /** Product price slab: from (exclusive, except 0) … to (inclusive; 0 = no upper limit). */
  minPrice: number;
  maxPrice: number;
  /** SKU name as printed, e.g. "2 Yr EW for AC - 30K - 40K". */
  planName: string;
  /** SAP VP reference entered at the billing counter, e.g. "VP0013773". */
  vpCode: string;
  /** Customer price (VSP). */
  price: number;
}

/**
 * Product groups of the price list, and how a product is recognised as one: its category, the category of
 * its HSN code, or words in its name. Keys are the price list's own "for …" names.
 */
const DEVICE_GROUPS: { test: RegExp; words: RegExp }[] = [
  { test: /^ac$/i, words: /\bair\s*condition|\bac\b|\bsplit\b|\bwindow\b|\bton\b|\binverter\s*ac/ },
  { test: /^tv$/i, words: /television|\btv\b|\bled\b|\boled\b|\bqled\b|\buhd\b|smart\s*tv|\binch\b/ },
  { test: /ref|wm|mw|dw/i, words: /refrigerator|fridge|freezer|washing|washer|front\s*load|top\s*load|microwave|\boven\b|dish\s*washer/ },
  { test: /cooler/i, words: /cooler/ },
  { test: /sda|wp|audio|ka/i, words: /small|domestic|kitchen|audio|sound|speaker|soundbar|home\s*theat|purifier|\bro\b|mixer|grinder|\biron\b|kettle|toaster|\bfan\b|heater|geyser|induction|chimney|cooktop|\bhob\b|vacuum|stabili/ },
  { test: /laptop/i, words: /laptop|notebook|macbook/ },
];

/** Does a plan's product group fit this product? */
function deviceFits(device: string, productText: string): boolean {
  const g = DEVICE_GROUPS.find((d) => d.test.test(String(device || "").replace(/\s*\(.*\)\s*/g, "").trim()));
  return !!g && g.words.test(productText);
}

/**
 * Every plan that fits a product: same product group (category, HSN category or name) and the price inside
 * the slab. Grouped by plan kind, then tenure, as the price list is.
 */
export function plansFor(
  plans: OnsitegoPlanRow[],
  product: { category?: string; hsnCategory?: string; name?: string; price: number }
): OnsitegoPlanRow[] {
  const price = Number(product.price) || 0;
  if (price <= 0) return [];
  const text = ` ${[product.category, product.hsnCategory, product.name].join(" ").toLowerCase()} `;
  return plans
    .filter((p) => (p.minPrice === 0 ? price >= 0 : price > p.minPrice) && (!p.maxPrice || price <= p.maxPrice))
    .filter((p) => deviceFits(p.device, text))
    .sort((a, b) => String(a.kind || "").localeCompare(String(b.kind || "")) || a.years - b.years || a.price - b.price);
}

/** "30K" -> 30000, "10" (with a K on the other end) -> 10000, "Above" -> 0. */
function amount(token: string, otherHasK: boolean): number {
  const t = token.trim().toLowerCase();
  if (/above|more|\+/.test(t)) return 0;
  const n = parseFloat(t.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return /k/.test(t) || otherHasK ? Math.round(n * 1000) : n;
}

// "2 Yr EW for AC - 30K - 40K VP0013773 ₹ 5,299" (columns may be split by tabs or several spaces)
const PLAN_LINE = /^(\d+)\s*Yrs?\s+([A-Za-z]+)\s+for\s+(.+?)\s+-\s+(.+?)\s+(VP\d{5,})\s+(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)\s*$/i;
// "Television — ADLD (Accidental & Liquid Damage) 24 SKUs"
const SECTION_LINE = /^(.+?)\s+\d+\s+SKUs$/i;

/** Read the plan lines out of the price list's text (one PDF text line per plan row). */
export function parsePlanLines(text: string): OnsitegoPlanRow[] {
  const plans: OnsitegoPlanRow[] = [];
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t+/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const sec = line.match(SECTION_LINE);
    if (sec && !/^effective|^category/i.test(sec[1])) {
      section = sec[1].trim();
      continue;
    }
    const m = line.match(PLAN_LINE);
    if (!m) continue;
    const [, years, kind, device, range, vpCode, price] = m;
    const [loTok, hiTok = ""] = range.split(/\s*-\s*|\s*to\s*/i);
    const hasK = /k/i.test(range);
    const lo = amount(loTok, hasK);
    const hi = amount(hiTok, hasK);
    if (!Number.isFinite(lo)) continue;
    plans.push({
      category: section,
      device: device.trim(),
      kind: kind.toUpperCase(),
      years: Number(years),
      minPrice: lo,
      maxPrice: Number.isFinite(hi) ? hi : 0,
      planName: `${years} Yr ${kind} for ${device.trim()} - ${range.trim()}`,
      vpCode: vpCode.toUpperCase(),
      price: Number(price.replace(/,/g, "")),
    });
  }

  // A slab whose end is missing or mistyped ("25 to305K") ends where the next slab of the same plan starts.
  const groups = new Map<string, OnsitegoPlanRow[]>();
  for (const p of plans) {
    const k = `${p.kind}|${p.device}|${p.years}`;
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.minPrice - b.minPrice);
    list.forEach((p, i) => {
      const next = list[i + 1];
      if (next && (!p.maxPrice || p.maxPrice > next.minPrice || p.maxPrice <= p.minPrice)) p.maxPrice = next.minPrice;
    });
  }
  return plans;
}

/** "₹30,000 – ₹40,000" / "above ₹1,50,000" for showing a slab. */
export function slabLabel(p: Pick<OnsitegoPlanRow, "minPrice" | "maxPrice">): string {
  const r = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  return p.maxPrice ? `${r(p.minPrice)} – ${r(p.maxPrice)}` : `above ${r(p.minPrice)}`;
}
