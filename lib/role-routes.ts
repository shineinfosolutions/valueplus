/**
 * Each role has its own panel URL — /admin, /salesman, /driver … — which is both
 * where that role signs in and where it lands afterwards. This file is the single
 * mapping between a role, its panel URL and the page that panel actually shows;
 * the middleware, the login page and the navigation all read it.
 *
 * Kept free of imports so the edge middleware can use it.
 */

export interface RolePanel {
  /** URL segment: the panel lives at `/${slug}`. */
  slug: string;
  /** The `User.role` value this panel belongs to. */
  role: string;
  /** Name shown on the panel's login screen. */
  label: string;
  /** The page rendered at the panel URL. */
  home: string;
}

export const ROLE_PANELS: RolePanel[] = [
  { slug: "admin", role: "admin", label: "Super Admin", home: "/dashboard" },
  { slug: "manager", role: "manager", label: "Store Manager", home: "/dashboard" },
  { slug: "cashier", role: "cashier", label: "Cashier", home: "/dashboard" },
  { slug: "accounts", role: "accounts", label: "Accounts", home: "/dashboard" },
  { slug: "hr", role: "hr", label: "HR & Payroll", home: "/dashboard" },
  { slug: "salesman", role: "salesman", label: "Salesman", home: "/dashboard" },
  // /warehouse is already the Godown Hub page itself, so it needs no rewrite.
  { slug: "warehouse", role: "warehouse", label: "Godown Incharge", home: "/warehouse" },
  { slug: "driver", role: "driver", label: "Delivery Boy", home: "/driver/deliveries" },
  { slug: "supplier", role: "supplier", label: "Supplier", home: "/purchase/orders" },
];

/** Roles that exist on User but have no panel of their own. */
const ROLE_ALIASES: Record<string, string> = {
  sales: "salesman",
  courier: "driver",
  delivery: "driver",
};

export function normaliseRole(role?: string | null): string {
  const key = String(role || "").toLowerCase().trim();
  return ROLE_ALIASES[key] || key;
}

export function panelForSlug(slug?: string | null): RolePanel | undefined {
  const key = String(slug || "").toLowerCase().replace(/^\//, "").trim();
  return ROLE_PANELS.find((p) => p.slug === key);
}

export function panelForRole(role?: string | null): RolePanel | undefined {
  const key = normaliseRole(role);
  return ROLE_PANELS.find((p) => p.role === key);
}

/** Where a signed-in user of this role belongs: their own panel URL. */
export function panelPathForRole(role?: string | null): string {
  const panel = panelForRole(role);
  return panel ? `/${panel.slug}` : "/dashboard";
}
