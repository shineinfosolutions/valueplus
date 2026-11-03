import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Item from "@/models/Item";
import DiscountApproval from "@/models/DiscountApproval";

/**
 * Discount approval on estimates and bills.
 *
 * The discount is how far the price offered is below the product's selling price. Under 1% needs nothing;
 * 1% to 10% needs the Store Manager; above 10% needs the Admin. The Admin is never asked, and a Store Manager is
 * not asked for the Manager band. An approval is for one person, one product, one price and one customer, and
 * is good for 24 hours (so the estimate and the bill made from it do not ask twice).
 */

export const DISCOUNT_MIN_PERCENT = 1;
export const MANAGER_MAX_PERCENT = 10;
const VALID_HOURS = 24;

export type DiscountTier = "manager" | "admin";

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
  percent < DISCOUNT_MIN_PERCENT ? null : percent <= MANAGER_MAX_PERCENT ? "manager" : "admin";

/** Does a person of this role never need approval for this tier? */
export const exemptFrom = (role: string, tier: DiscountTier) => {
  const r = String(role || "").toLowerCase();
  if (r === "admin" || r === "superadmin") return true;
  return r === "manager" && tier === "manager";
};

/** Can a person of this role decide a request of this tier? */
export const canDecideDiscount = (role: string, tier: DiscountTier) => {
  const r = String(role || "").toLowerCase();
  if (r === "admin" || r === "superadmin") return true;
  return r === "manager" && tier === "manager";
};

export const normKey = (s: any) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Every line priced at least 1% below the product's selling price (the price is taken from the catalog, never from the form). */
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
        (a.tier === "admin" || l.tier === "manager")
    );
  });
}
