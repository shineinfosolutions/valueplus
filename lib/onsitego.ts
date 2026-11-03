/**
 * Onsitego (extended-warranty partner). Client-safe: used by the bill form and the server.
 *
 * Incentive: the bill's salesman earns 10% of every Onsitego plan sold on the bill. It is worked out on the
 * server when a bill is saved or edited (`Invoice.onsitegoIncentive`) and added to his incentive
 * (lib/staff-incentive.ts). Bills from before this rule carry no value and earn nothing extra.
 */

export const ONSITEGO_INCENTIVE_RATE = 0.1;

/** The Documents folder the Admin uploads Onsitego material to (price list Excel, brochures). */
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
  category: string;
  minPrice: number;
  maxPrice: number;
  planName: string;
  years: number;
  price: number;
}

const norm = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Plans from the uploaded price list that fit a product: the product's price falls inside the plan's price
 * band, and the plan's category matches the product's category or name (a plan with no category fits all).
 * Cheapest first.
 */
export function plansFor(plans: OnsitegoPlanRow[], product: { category?: string; name?: string; price: number }): OnsitegoPlanRow[] {
  const price = Number(product.price) || 0;
  if (price <= 0) return [];
  const hay = ` ${norm(product.category)} ${norm(product.name)} `;
  return plans
    .filter((p) => price >= (p.minPrice || 0) && (!p.maxPrice || price <= p.maxPrice))
    .filter((p) => {
      const words = norm(p.category).split(" ").filter((w) => w.length > 2 && !["and", "all", "the"].includes(w));
      if (words.length === 0) return true;
      // "Air Conditioner" matches a product in "Air Conditioners"; a plural "s" is ignored.
      return words.some((w) => hay.includes(` ${w.replace(/s$/, "")}`));
    })
    .sort((a, b) => a.price - b.price);
}
