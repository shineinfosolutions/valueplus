import { splitSupplierLine } from "@/lib/purchase-import/supplier-line";
import { hsnCategoryName } from "@/lib/purchase-import/hsn-category";

/**
 * A short "what is it" for a product: brand + kind, e.g. "LLOYD AC",
 * "HAIER Washing Machine", "LG Fridge".
 *
 * Neither is taken blindly from the product master: many products came from
 * the old stock sheet with a group in place of the brand ("GIFT &
 * ACCESSORIES", "MOBILE & ACCESSORIES") and a brand in place of the category
 * ("LLOYD"). The brand is read from the product name's own "- BRAND" ending
 * first, and the kind from the bill's HSN code (8415 is always an AC).
 */

const SHORT_KIND: Record<string, string> = {
  "Air Conditioners": "AC",
  "Televisions & Home Entertainment": "TV",
  "Refrigerators & Freezers": "Fridge",
  "Washing Machines": "Washing Machine",
  "Air Coolers": "Cooler",
  "Mobiles & Smart Devices": "Mobile",
  "Audio & Sound Systems": "Audio",
  "Kitchen & Home Appliances": "Kitchen",
  "Small & Domestic Appliances": "Home Appliance",
};

/** A brand field that is really a group from the old stock sheet. */
const isGroupName = (v: string) => /&|accessor|gift|appliance|electronics|mobile/i.test(v);

/** Words a company name carries that are not the brand: "BAJAJ ELECTRICALS" → "BAJAJ". */
const COMPANY_WORDS = /\s+(electricals?|electronics|india|ltd|limited|pvt|private|appliances?)\b.*$/i;

/**
 * The brand written at the end of a product name. "- " (dash, space) marks it
 * when present, so a brand with its own hyphen survives: "PRIME M 1150- V-GUARD"
 * → "V-GUARD". Otherwise the letters after the last "-": "1250 W-HAVELLS".
 */
function brandFromName(name: string): string {
  const text = name.replace(/\s+/g, " ").trim();
  const spaced = text.lastIndexOf("- ");
  let tail = spaced >= 0 ? text.slice(spaced + 2) : "";
  if (!tail) {
    const m = text.match(/-([A-Za-z][A-Za-z ]{1,24})$/);
    tail = m ? m[1] : "";
  }
  tail = tail.replace(/\(.*$/, "").trim();
  if (!/^[A-Za-z][A-Za-z .&-]{1,24}$/.test(tail) || isGroupName(tail)) return "";
  return tail.replace(COMPANY_WORDS, "").trim();
}

export function productLabel(line: { itemName?: string; name?: string; hsn?: string }, product?: any): string {
  const name = String(line.itemName || line.name || product?.name || "");
  const fromName = brandFromName(name) || splitSupplierLine(name).brand;
  const master = String(product?.brand || "").trim().replace(COMPANY_WORDS, "");
  const brand = (fromName || (master && !isGroupName(master) ? master : "")).toUpperCase();

  const category = hsnCategoryName(line.hsn || product?.hsnCode);
  const kind = SHORT_KIND[category] || "";

  return [brand, kind].filter(Boolean).join(" ");
}
