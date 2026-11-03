import * as XLSX from "xlsx";
import DocumentFolder from "@/models/DocumentFolder";
import OnsitegoPlan from "@/models/OnsitegoPlan";
import { ONSITEGO_FOLDER, OnsitegoPlanRow } from "@/lib/onsitego";

/**
 * Server side of Onsitego: the "On Site Go" documents folder (always there; Admin and Manager upload, and
 * salesmen and cashiers can open what is in it) and reading the plan price list Excel uploaded to it.
 */

/** Roles that see only the On Site Go folder of the Documents section. */
export const ONSITEGO_ONLY_ROLES = ["salesman", "sales", "cashier"];

/** The On Site Go folder, made the first time anyone asks for it. */
export async function getOnsitegoFolder(createdBy = "System"): Promise<{ _id: any; name: string }> {
  const nameKey = ONSITEGO_FOLDER.toLowerCase();
  const found: any = await DocumentFolder.findOne({ nameKey }).lean();
  if (found) return found;
  try {
    return (await DocumentFolder.create({ name: ONSITEGO_FOLDER, nameKey, createdBy })).toObject();
  } catch {
    // Two requests made it at the same moment (unique nameKey): use the one that won.
    return (await DocumentFolder.findOne({ nameKey }).lean()) as any;
  }
}

const isExcel = (name: string, type: string) =>
  /\.(xlsx|xls|csv)$/i.test(name) || /spreadsheet|ms-excel|text\/csv/i.test(type);
export { isExcel };

const num = (v: any): number => {
  const n = Number(String(v ?? "").replace(/[₹,\s]|rs\.?|inr/gi, ""));
  return Number.isFinite(n) ? n : NaN;
};
const norm = (v: any) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "10,001 - 20,000", "Up to 10000", "Above 50000", "10k-20k" -> [min, max] (max 0 = no upper limit). */
function parseBand(v: any): [number, number] | null {
  const s = String(v ?? "").toLowerCase().replace(/,/g, "").replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n) => String(Number(n) * 1000));
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length === 0) return null;
  if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  if (/up\s*to|upto|below|less|under|</.test(s)) return [0, nums[0]];
  if (/above|more|over|\+|>/.test(s)) return [nums[0], 0];
  return null;
}

/** Years from "2 Years", "24 Months", "EW 3 Yr" (0 when it says nothing). */
function parseYears(v: any): number {
  const s = String(v ?? "").toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years|m|mo|month|months)\b/);
  if (m) return /^m/.test(m[2]) ? Math.round((Number(m[1]) / 12) * 10) / 10 : Number(m[1]);
  return 0;
}

type Col = { idx: number; head: string };

/**
 * Read Onsitego plans from a price-list sheet. Columns are found by their heading (any order, any sheet):
 *  - category: Category / Product / Product type / Segment
 *  - price band: Min + Max (From / To, Lower / Upper) or one "Price range / Invoice value" column ("10001-20000")
 *  - plan: Plan / Plan name / Scheme, and Years / Duration / Tenure
 *  - plan price: Plan price / Price / MRP / Premium / Amount
 * A "wide" sheet with one price column per duration ("1 Year", "2 Years" ...) gives one plan per column.
 */
export function parseOnsitegoPlans(buf: ArrayBuffer | Buffer): { plans: OnsitegoPlanRow[]; sheet: string } {
  const wb = XLSX.read(buf, { type: Buffer.isBuffer(buf) ? "buffer" : "array" });
  let best: { plans: OnsitegoPlanRow[]; sheet: string } = { plans: [], sheet: "" };

  for (const sheetName of wb.SheetNames) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: "" });
    // The heading row: the first of the top 15 rows with a price-ish heading.
    const headIdx = rows.slice(0, 15).findIndex((r) => r.some((c) => /price|mrp|premium|amount|cost|range|value|year/i.test(String(c))));
    if (headIdx < 0) continue;
    const heads: Col[] = rows[headIdx].map((h, idx) => ({ idx, head: norm(h) }));
    const find = (re: RegExp, not?: RegExp) => heads.find((h) => re.test(h.head) && !(not && not.test(h.head)));

    const category = find(/\b(category|product|segment|type|appliance)\b/, /price|mrp|amount|plan|range|value/);
    const minC = find(/\b(min|from|lower|start)\b/);
    const maxC = find(/\b(max|to|upper|upto|end)\b/, /\bfrom\b/);
    const bandC = find(/\b(range|band|slab|invoice value|product value|device value|value)\b/, /\b(min|max)\b/);
    const planC = find(/\b(plan|scheme|cover)\b/, /price|mrp|amount|premium|cost/);
    // A heading with a number in it ("1 Year") is a price column of the wide layout, not the duration column.
    const yearsC = find(/\b(years?|duration|tenure|term|period)\b/, /price|mrp|amount|\d/);
    const priceC = find(/\b(price|mrp|premium|amount|cost|rate)\b/, /\b(min|max|from|to|range|band|value|product|invoice)\b/);
    // Wide layout: several price columns named by duration.
    const yearCols = heads.filter((h) => h !== yearsC && parseYears(h.head) > 0 && !(category && h.idx === category.idx));

    const plans: OnsitegoPlanRow[] = [];
    for (const r of rows.slice(headIdx + 1)) {
      let band: [number, number] | null = null;
      if (minC || maxC) {
        const lo = minC ? num(r[minC.idx]) : 0;
        const hi = maxC ? num(r[maxC.idx]) : 0;
        if (Number.isFinite(lo) || Number.isFinite(hi)) band = [Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0];
      }
      if (!band && bandC) band = parseBand(r[bandC.idx]);
      if (!band) continue;
      const cat = category ? String(r[category.idx] || "").trim() : "";

      if (priceC && !(yearCols.length > 1 && !planC)) {
        const price = num(r[priceC.idx]);
        if (!(price > 0)) continue;
        const years = yearsC ? parseYears(r[yearsC.idx]) || num(r[yearsC.idx]) || 0 : planC ? parseYears(r[planC.idx]) : 0;
        const planName = (planC && String(r[planC.idx] || "").trim()) || (years ? `Onsitego ${years} Year Extended Warranty` : "Onsitego Extended Warranty");
        plans.push({ category: cat, minPrice: band[0], maxPrice: band[1], planName, years, price });
      } else {
        for (const yc of yearCols) {
          const price = num(r[yc.idx]);
          if (!(price > 0)) continue;
          const years = parseYears(yc.head);
          plans.push({ category: cat, minPrice: band[0], maxPrice: band[1], planName: `Onsitego ${years} Year Extended Warranty`, years, price });
        }
      }
    }
    if (plans.length > best.plans.length) best = { plans, sheet: sheetName };
  }
  return best;
}

/** Replace the stored price list with the plans of a new upload. */
export async function savePlans(plans: OnsitegoPlanRow[], sourceDocId: string, sourceFileName: string) {
  await OnsitegoPlan.deleteMany({});
  if (plans.length) await OnsitegoPlan.insertMany(plans.map((p) => ({ ...p, sourceDocId, sourceFileName })));
}
