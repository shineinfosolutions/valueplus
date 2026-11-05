import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import DiscountApproval from "@/models/DiscountApproval";

/**
 * Discount approval on estimates and bills.
 *
 * The discount is how far the price offered is below the product's selling price. Who may give it:
 *   up to 5%            the salesman himself (no approval)
 *   above 5%, below 10% the Cashier
 *   10% to 12%          the Store Manager
 *   above 12%           the Admin only
 * A person never needs approval for a band at or below their own role, and may decide requests in those bands
 * (the Manager also decides the Cashier band; the Admin decides everything). An approval is for one person, one
 * product, one price and one customer, and is good for 24 hours (so the estimate and the bill made from it do not
 * ask twice).
 */

/** Up to this % anyone may give the discount without asking. */
export const SELF_MAX_PERCENT = 5;
/** Below this % (and above SELF_MAX_PERCENT) the Cashier approves. */
export const CASHIER_BELOW_PERCENT = 10;
/** Up to this % (from CASHIER_BELOW_PERCENT) the Store Manager approves; above it only the Admin. */
export const MANAGER_MAX_PERCENT = 12;
const VALID_HOURS = 24;

export type DiscountTier = "cashier" | "manager" | "admin";

export const TIER_LABEL: Record<DiscountTier, string> = {
  cashier: "the Cashier",
  manager: "the Store Manager",
  admin: "the Admin",
};

export interface DiscountLine {
  itemId: string;
  itemName: string;
  brand: string;
  sellingPrice: number;
  price: number;
  quantity: number;
  percent: number;
  tier: DiscountTier;
}

export const tierFor = (percent: number): DiscountTier | null =>
  percent <= SELF_MAX_PERCENT
    ? null
    : percent < CASHIER_BELOW_PERCENT
    ? "cashier"
    : percent <= MANAGER_MAX_PERCENT
    ? "manager"
    : "admin";

const TIER_RANK: Record<DiscountTier, number> = { cashier: 1, manager: 2, admin: 3 };
export const tierRank = (tier: any) => TIER_RANK[tier as DiscountTier] ?? 3;

/** How far up the discount ladder a role reaches: salesman 0, cashier 1, manager 2, admin 3. */
export const roleRank = (role: string) => {
  const r = String(role || "").toLowerCase();
  if (r === "admin" || r === "superadmin") return 3;
  if (r === "manager") return 2;
  if (r === "cashier") return 1;
  return 0;
};

/** Does a person of this role never need approval for this tier? */
export const exemptFrom = (role: string, tier: DiscountTier) => roleRank(role) >= tierRank(tier);

/** Can a person of this role decide a request of this tier? */
export const canDecideDiscount = (role: string, tier: DiscountTier) => roleRank(role) >= tierRank(tier);

/** The tiers a role may decide (for listing its pending requests). */
export const tiersDecidableBy = (role: string): DiscountTier[] =>
  (Object.keys(TIER_RANK) as DiscountTier[]).filter((t) => canDecideDiscount(role, t));

/** The roles to tell about a request of this tier: everyone who can decide it. */
export const decidersOf = (tier: DiscountTier): string[] =>
  ["cashier", "manager", "admin", "superadmin"].filter((r) => canDecideDiscount(r, tier));

export const normKey = (s: any) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Every line priced more than SELF_MAX_PERCENT below the product's selling price (the price is taken from the catalog, never from the form). */
export async function discountedLines(items: any[]): Promise<DiscountLine[]> {
  await connectToDatabase();
  const lines = Array.isArray(items) ? items : [];
  const ids = lines.map((l) => l?.itemId).filter((id) => mongoose.isValidObjectId(id));
  const names = lines.map((l) => String(l?.itemName || l?.name || "").trim()).filter(Boolean);
  if (ids.length + names.length === 0) return [];
  const catalog: any[] = await Item.find({ $or: [{ _id: { $in: ids } }, { name: { $in: names } }] }, { name: 1, brand: 1, sellingPrice: 1 }).lean();
  const byId = new Map(catalog.map((c) => [String(c._id), c]));
  const byName = new Map(catalog.map((c) => [normKey(c.name), c]));

  const out: DiscountLine[] = [];
  for (const l of lines) {
    const prod = (mongoose.isValidObjectId(l?.itemId) && byId.get(String(l.itemId))) || byName.get(normKey(l?.itemName || l?.name));
    if (!prod) continue;
    const selling = Number(prod.sellingPrice) || 0;
    if (selling <= 0) continue;
    const price = (Number(l.rate) || 0) - (Number(l.discount) || 0);
    if (price >= selling) continue;
    const percent = r2(((selling - price) / selling) * 100);
    const tier = tierFor(percent);
    if (!tier) continue;
    out.push({
      itemId: String(prod._id),
      itemName: String(prod.name),
      brand: String(prod.brand || ""),
      sellingPrice: selling,
      price: r2(price),
      quantity: Number(l.quantity ?? l.qty) || 1,
      percent,
      tier,
    });
  }
  return out;
}

/**
 * Which discounted lines still lack an approval for this person and customer. `covered` holds the lines of a bill
 * that were already approved earlier (the invoice made from it): a line at the same price or higher is covered.
 */
export async function missingApprovals(
  actor: { id: string; role: string },
  customerName: string,
  items: any[],
  covered: any[] = []
): Promise<DiscountLine[]> {
  const lines = (await discountedLines(items)).filter((l) => !exemptFrom(actor.role, l.tier));
  if (lines.length === 0) return [];
  const coveredLines = await discountedLines(covered);
  const since = new Date(Date.now() - VALID_HOURS * 3600 * 1000);
  const approved: any[] = await DiscountApproval.find({ requestedById: actor.id, status: "approved", createdAt: { $gte: since } }).lean();
  const customer = normKey(customerName);
  return lines.filter((l) => {
    if (coveredLines.some((c) => c.itemId === l.itemId && c.price <= l.price + 0.01)) return false;
    return !approved.some(
      (a) =>
        a.itemId === l.itemId &&
        normKey(a.customerName) === customer &&
        a.price <= l.price + 0.01 &&
        tierRank(a.tier) >= tierRank(l.tier)
    );
  });
}
