/** Brand helpers shared by the stock report and the "assign brands" tool. */

/** A product with no real brand: empty, or a placeholder such as "Brand", "No Brand", "Generic", "Showroom Partner". */
export const isUnbrandedValue = (brand: any): boolean => {
  const b = String(brand || "").trim();
  return !b || /^(brand|no\s*brand|nobrand|unbranded|generic|na|n\/a|none|-+|showroom partner)$/i.test(b);
};

/** A brand value that is really a category or a stray label (MOBILE & ACCESSORIES, STABLIZERS, HAIER AC DUMMY...): not offered as a brand. */
export const looksLikeCategory = (brand: string): boolean => /&|accessor|stabli[sz]er|dummy|\bpack\b|\bset\b|\bparts?\b/i.test(brand);

/** No usable brand: empty / placeholder, or a value that is really a category (the product still needs its real brand). */
export const needsBrand = (brand: any): boolean => isUnbrandedValue(brand) || looksLikeCategory(String(brand || ""));

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * A brand for a product that has none, from what its name says.
 *  1. a known brand written in the name or the category (as whole words);
 *  2. otherwise the text after the last "- " in the name when it looks like a brand (VP0012495 - AVIOLUX M 800- V-GUARD).
 * Returns null when the name gives nothing: those are left for a person to choose.
 */
export function proposeBrand(name: string, category: string, known: string[]): { brand: string; source: "name" | "suffix" } | null {
  const hay = ` ${clean(`${name} ${category}`)} `;
  const sorted = [...known].sort((a, b) => b.length - a.length);
  for (const k of sorted) {
    const c = clean(k);
    if (c.length >= 3 && hay.includes(` ${c} `)) return { brand: k, source: "name" };
  }
  // The text after the model's own "- " (not the "VP0012495 - " code prefix): "AVIOLUX M 800- V-GUARD" -> V-GUARD.
  const body = String(name || "").replace(/^[A-Za-z]{1,4}\d+\s*-\s*/, "");
  const m = body.match(/\S\s*-\s+([A-Za-z][A-Za-z0-9 .&'-]{1,24})$/);
  if (m) {
    const cand = m[1].trim();
    const c = clean(cand);
    // Not a model code: needs letters and no long digit run.
    if (c.length >= 3 && /[A-Z]{3}/.test(c) && !/\d{3}/.test(c) && !looksLikeCategory(cand) && !/[&-]$/.test(cand)) {
      const existing = known.find((k) => clean(k) === c);
      return { brand: existing || cand.toUpperCase(), source: "suffix" };
    }
  }
  return null;
}
