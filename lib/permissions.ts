/**
 * Central role → permission map for the ledger, PIN-authorised and audit features.
 *
 * Access control used to live in exactly one place: the sidebar filtered its links
 * by `role` (see components/layout/sidebar.tsx). That hides a menu entry but stops
 * nobody — the page still renders if the URL is typed by hand, and the API route
 * behind it never looked at the session at all. Money-bearing screens (party
 * ledgers, void audit) need a real answer, so every new check routes through here
 * and is enforced in three places: the sidebar, the page (RoleGuard) and the API
 * (requirePermission).
 *
 * Nothing that already worked is gated by this file. Existing routes keep their
 * current behaviour; only the features added alongside this map consult it.
 */

export type Permission =
  | "ledger.vendor.view"
  | "ledger.supplier.view"
  | "ledger.customer.view"
  | "ledger.export"
  | "vendor.manage"
  | "payment.record"
  | "invoice.cancel"
  | "invoice.edit"
  | "invoice.delete"
  | "purchase.entry.cancel"
  | "purchase.entry.delete"
  | "audit.view"
  | "roles.manage";

export const ALL_PERMISSIONS: Permission[] = [
  "ledger.vendor.view",
  "ledger.supplier.view",
  "ledger.customer.view",
  "ledger.export",
  "vendor.manage",
  "payment.record",
  "invoice.cancel",
  "invoice.edit",
  "invoice.delete",
  "purchase.entry.cancel",
  "purchase.entry.delete",
  "audit.view",
  "roles.manage",
];

/** Human labels for the settings screen. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "ledger.vendor.view": "View vendor ledgers",
  "ledger.supplier.view": "View supplier ledgers",
  "ledger.customer.view": "View customer ledgers",
  "ledger.export": "Export / print ledger statements",
  "vendor.manage": "Add, edit and delete vendors",
  "payment.record": "Record payments and receipts",
  "invoice.cancel": "Cancel an invoice (PIN required)",
  "invoice.edit": "Edit a saved invoice's products, prices and payment (PIN required)",
  "invoice.delete": "Delete an invoice (PIN required)",
  "purchase.entry.cancel": "Cancel a supplier purchase bill (PIN required)",
  "purchase.entry.delete": "Delete a supplier purchase bill (PIN required)",
  "audit.view": "View void & leakage audit trail",
  "roles.manage": "Change role permissions",
};

/**
 * Defaults, used whenever the database holds no override for a role.
 *
 * `supplier` is deliberately absent from `ledger.supplier.view`: that role belongs
 * to an outside supplier logging in, and the supplier ledger screen lists every
 * supplier's balances. Scoping it to "own records only" needs a link between the
 * user and a Supplier document, which does not exist yet — so until it does, the
 * safe default is no access rather than everyone's books.
 */
const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  manager: [
    "ledger.vendor.view",
    "ledger.supplier.view",
    "ledger.customer.view",
    "ledger.export",
    "vendor.manage",
    "payment.record",
    "invoice.cancel",
    "invoice.edit",
    "purchase.entry.cancel",
    "audit.view",
  ],
  accounts: [
    "ledger.vendor.view",
    "ledger.supplier.view",
    "ledger.customer.view",
    "ledger.export",
    "vendor.manage",
    "payment.record",
  ],
  cashier: ["ledger.customer.view", "payment.record"],
  salesman: [],
  sales: [],
  hr: [],
  warehouse: [],
  driver: [],
  supplier: [],
};

export function defaultPermissionsForRole(role?: string): Permission[] {
  const key = (role || "").toLowerCase().trim();
  return DEFAULT_ROLE_PERMISSIONS[key] ?? [];
}

/**
 * Resolve a role's permissions, preferring a stored override.
 *
 * `overrides` is the RolePermission collection keyed by role. A role missing from
 * it falls back to the defaults above, so the feature works on day one with an
 * empty collection and keeps working if someone deletes a row.
 */
export function permissionsForRole(
  role: string | undefined,
  overrides?: Record<string, Permission[]>
): Permission[] {
  const key = (role || "").toLowerCase().trim();
  const override = overrides?.[key];
  if (override && Array.isArray(override)) return override;
  return defaultPermissionsForRole(key);
}

export function roleHasPermission(
  role: string | undefined,
  permission: Permission,
  overrides?: Record<string, Permission[]>
): boolean {
  // Admin is never locked out of its own system, whatever the overrides say.
  if ((role || "").toLowerCase().trim() === "admin") return true;
  return permissionsForRole(role, overrides).includes(permission);
}
