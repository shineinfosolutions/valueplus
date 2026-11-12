/**
 * Who may give how much discount (no imports, so the product screen can use it too): the discount is how far the price
 * offered is below the product's selling price.
 *   up to 7%             the salesman himself
 *   above 7%, up to 10%  the Cashier
 *   above 10%, up to 12% the Store Manager
 *   above 12%            the Admin only
 */
/** Up to this % anyone may give the discount without asking. */
export const SELF_MAX_PERCENT = 7;
/** Up to this % (and above SELF_MAX_PERCENT) the Cashier approves. */
export const CASHIER_MAX_PERCENT = 10;
/** Up to this % (above CASHIER_MAX_PERCENT) the Store Manager approves; above it only the Admin. */
export const MANAGER_MAX_PERCENT = 12;

export type DiscountTier = "cashier" | "manager" | "admin";

export const TIER_LABEL: Record<DiscountTier, string> = {
  cashier: "the Cashier",
  manager: "the Store Manager",
  admin: "the Admin",
};

export const tierFor = (percent: number): DiscountTier | null =>
  percent <= SELF_MAX_PERCENT
    ? null
    : percent <= CASHIER_MAX_PERCENT
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

