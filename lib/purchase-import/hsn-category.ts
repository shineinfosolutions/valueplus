/**
 * The product category an HSN code belongs to, by its tariff heading:
 * 8450 is always a washing machine, 8415 an air conditioner, and so on. This
 * is used to suggest a category on purchase import because the categories
 * already saved on products (and on the stock reference sheet) are not
 * reliable — split ACs filed as "Air Coolers", washing machines as "Kitchen &
 * Home Appliances", TVs as "Audio & Sound Systems".
 *
 * Longest prefix wins, so 847960 (evaporative air coolers) is matched before
 * any shorter 8479 rule. Only names from the Categories master are returned,
 * and only when that category exists there.
 */
const HSN_RULES: [string, string][] = [
  ["8450", "Washing Machines"],
  ["8415", "Air Conditioners"],
  ["8418", "Refrigerators & Freezers"],
  ["8528", "Televisions & Home Entertainment"],
  ["847960", "Air Coolers"],
  ["8517", "Mobiles & Smart Devices"],
  ["8518", "Audio & Sound Systems"],
  ["8519", "Audio & Sound Systems"],
  ["8521", "Audio & Sound Systems"],
  ["8527", "Audio & Sound Systems"],
  // Kitchen: mixers/grinders, microwaves/ovens/cooktops, toasters, kettles, cookware.
  ["8509", "Kitchen & Home Appliances"],
  ["851650", "Kitchen & Home Appliances"],
  ["851660", "Kitchen & Home Appliances"],
  ["851671", "Kitchen & Home Appliances"],
  ["851672", "Kitchen & Home Appliances"],
  ["851679", "Kitchen & Home Appliances"],
  ["7323", "Kitchen & Home Appliances"],
  ["7615", "Kitchen & Home Appliances"],
  // Small domestic: water heaters/geysers, room heaters, irons, fans, purifiers, vacuums, stabilisers.
  ["851610", "Small & Domestic Appliances"],
  ["851621", "Small & Domestic Appliances"],
  ["851629", "Small & Domestic Appliances"],
  ["851640", "Small & Domestic Appliances"],
  ["8414", "Small & Domestic Appliances"],
  ["8421", "Small & Domestic Appliances"],
  ["8508", "Small & Domestic Appliances"],
  ["8504", "Small & Domestic Appliances"],
].sort((a, b) => b[0].length - a[0].length) as [string, string][];

/** The category an HSN code belongs to, without checking the Categories master. */
export function hsnCategoryName(hsn: string | undefined): string {
  const digits = String(hsn || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  for (const [prefix, category] of HSN_RULES) if (digits.startsWith(prefix)) return category;
  return "";
}

export function categoryForHsnCode(hsn: string | undefined, masterCategories: Set<string>): string {
  const digits = String(hsn || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  for (const [prefix, category] of HSN_RULES) {
    if (digits.startsWith(prefix)) return masterCategories.has(category) ? category : "";
  }
  return "";
}
