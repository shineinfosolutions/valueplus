/**
 * Which catalog products are mobile phones, for the Mobile Live Audit.
 *
 * The product master has no single "mobile" flag, and its HSN codes cannot be trusted: Realme
 * phones are filed under HSN 84713010 ("computers") as often as 85171300 (phones), the brand is
 * usually "MOBILE & ACCESSORIES" (accessories carry it too), and the category is a phone brand
 * ("REALME", "OPPO", "VIVO") or "SAMSUNG MOBILE" / "Mobiles & Smart Devices". So:
 *   - a neckband, charger, cover or other accessory is never a phone;
 *   - a product whose category or name carries a phone brand (Realme, Oppo, Vivo…) is a phone,
 *     whatever its HSN;
 *   - a telephone / smartphone HSN (8517…) is a phone;
 *   - "mobile" / "smartphone" / "galaxy" in the category or name makes it a phone, unless its HSN
 *     is plainly an appliance's (a refrigerator filed under "Mobiles & Smart Devices" is 8418…).
 */

const PHONE_BRANDS = /\b(realme|oppo|vivo|redmi|xiaomi|poco|oneplus|motorola|nokia|infinix|tecno|itel|lava|iqoo|iphone|apple)\b/i;
// A phone brand also makes TVs and heaters (Xiaomi TV, Lava heater): these words in the name mean it is not a phone.
const NOT_PHONE_WORDS = /heater|convector|\btv\b|television|\bled\b|refrigerator|fridge|washing|cooler|\bfan\b|air\s*condition|\bac\b|geyser|mixer|grinder|microwave|purifier|soundbar|chimney|induction|trimmer|\biron\b|vacuum/i;
// Makers of appliances, not phones: a product of theirs filed under a "Mobiles" category is not a phone.
const NON_PHONE_BRANDS = /^(haier|whirlpool|havells|lloyd|bajaj|voltas|lg|panasonic|godrej|hitachi|daikin|carrier|bosch|ifb|crompton|orient|usha|v-?guard|aquaguard|kent|eureka forbes|philips|maharaja|sunflame|symphony|luminous|mitsubishi|mitsubhishi|frank\w* faber|blue star|whirlpool of india)/i;
const PHONE_WORDS = /mobile|smart\s*phone|smartphone|galaxy/i;
const ACCESSORY_WORDS = /accessor|neckband|earphone|earbud|headphone|charger|cable|\bcase\b|\bcover\b|power\s*bank|speaker|adapter|tempered|screen\s*guard/i;
// Appliance HSN families: a product under one of these is not a phone even if its category says "mobile".
const APPLIANCE_HSN = /^(8418|8415|8450|8451|8516|8509|8508|8414|8422|9403|8539|8504|8501)/;

export function isMobileProduct(p: { hsnCode?: string; category?: string; brand?: string; name?: string }): boolean {
  const name = String(p?.name || "");
  const category = String(p?.category || "");
  if (ACCESSORY_WORDS.test(name) || ACCESSORY_WORDS.test(category)) return false;
  if (NOT_PHONE_WORDS.test(name)) return false;
  if (NON_PHONE_BRANDS.test(String(p?.brand || "").trim())) return false;
  // The phone brand in the category or the name decides it; the brand field and the HSN code do not.
  if (PHONE_BRANDS.test(category) || PHONE_BRANDS.test(name)) return true;
  const hsn = String(p?.hsnCode || "").replace(/\D/g, "");
  if (hsn.startsWith("8517")) return true;
  if (PHONE_WORDS.test(`${category} ${name}`)) return !APPLIANCE_HSN.test(hsn);
  return false;
}
