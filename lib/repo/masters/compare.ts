/**
 * How the shadow comparison (lib/d1/compare.ts) treats each master-data read path, and WHY each rule exists.
 * The route passes the matching entry to readWithShadow; the tests use the same entries, so "identical" in the
 * tests means exactly what the live comparison checks.
 *
 * Every master document (prefix = where the documents sit in the compared value):
 *  - __v: `0` equals absent. D1's `v` column is NOT NULL DEFAULT 0, so a document written without mongoose (an
 *    import, a script) and therefore without __v reads 0 from D1. No screen reads __v.
 * Item documents also:
 *  - stockByWarehouse[]._id is ignored: MongoDB gives each entry its own id; the copy keeps only (warehouse, qty)
 *    and no screen reads the entry id.
 *  - purchaseIncludesGst / isSerialized / isBatchTracked: `false` equals absent. D1 keeps booleans as 0/1, so an
 *    item saved before the field existed reads `false` from D1 while MongoDB leaves it out (both falsy for the app).
 *  - stockByWarehouse: `[]` equals absent (mongoose creates it as []; only a raw-inserted document lacks it).
 * Warehouses: isDefault `false` equals absent (same boolean reason).
 * Customers: billingAddress._id / shippingAddress._id are ignored (subdocument ids, not copied, never read).
 * Lists sorted on a key: `tieOrder` on that key, because documents with an equal key (e.g. created in the same
 * millisecond by insertMany) have no defined order in MongoDB.
 * A find() without sort: `unorderedPaths`, because MongoDB's natural order is not defined.
 */
import type { CompareOptions } from "@/lib/d1/compare";

function docRules(prefix: string, more: { ignore?: string[]; defaults?: Record<string, unknown> } = {}): Pick<CompareOptions, "ignorePaths" | "defaultsWhenMissing"> {
  const p = prefix ? `${prefix}.` : "";
  const defaults: Record<string, unknown> = { [`${p}__v`]: 0 };
  for (const [k, v] of Object.entries(more.defaults || {})) defaults[`${p}${k}`] = v;
  const ignore = (more.ignore || []).map((x) => `${p}${x}`);
  return { ...(ignore.length ? { ignorePaths: ignore } : {}), defaultsWhenMissing: defaults };
}

const itemRules = (prefix: string) =>
  docRules(prefix, {
    ignore: ["stockByWarehouse[]._id"],
    defaults: { purchaseIncludesGst: false, isSerialized: false, isBatchTracked: false, stockByWarehouse: [] },
  });

const byCreatedAt = { path: "", key: (d: any) => d?.createdAt ?? null };

export const MASTER_COMPARE: Record<string, CompareOptions> = {
  /** GET /api/items: the lean list, sorted by currentStock desc, name. */
  "items.list": { ...itemRules("[]"), tieOrder: [{ path: "", key: (d: any) => [d?.currentStock ?? null, d?.name ?? null] }] },
  /** GET /api/items/brand-info: one item document. */
  "items.byId": itemRules(""),
  /** GET /api/items/incentive-plan: the computed plan, sorted by atBestPrice desc (ties in natural order). */
  "items.incentivePlan": { tieOrder: [{ path: "", key: (d: any) => d?.atBestPrice ?? null }] },
  /**
   * GET /api/items/assign-brands: items sorted by (has proposal, name); brand list ordered by count (ties natural).
   * A brand written in several capitalisations ("LG" / "lg") is listed under the spelling met FIRST in a find()
   * without sort, i.e. MongoDB's undefined natural order, so that spelling (and a proposal built from it) is
   * compared without capitals.
   */
  "items.assignBrands": {
    tieOrder: [{ path: "items", key: (d: any) => [d?.proposal ? 0 : 1, d?.name ?? null] }],
    unorderedPaths: ["brands"],
    foldCasePaths: ["brands[]", "items[].proposal"],
  },
  /** GET /api/items/gst-fix: sorted by name. */
  "items.gstFix": { tieOrder: [{ path: "items", key: (d: any) => d?.name ?? null }] },
  /** GET /api/items/purchase-gst-flag: no sort. */
  "items.purchaseGstFlag": { unorderedPaths: ["items"] },
  /** GET /api/items/vp-code-backfill: sorted by name. */
  "items.vpBackfill": { tieOrder: [{ path: "", key: (d: any) => d?.name ?? null }] },
  /** GET /api/categories: newest first, with item counts. */
  "categories.list": { ...docRules("[]"), tieOrder: [byCreatedAt] },
  /** GET /api/brands: by name, case-insensitive (ICU strength 2): names that differ only in case are ties. */
  "brands.list": { ...docRules("[]"), tieOrder: [{ path: "", key: (d: any) => (typeof d?.name === "string" ? d.name.toLowerCase() : null) }] },
  /** GET /api/units: newest first. */
  "units.list": { ...docRules("[]"), tieOrder: [byCreatedAt] },
  /** GET /api/warehouses: oldest first. */
  "warehouses.list": { ...docRules("[]", { defaults: { isDefault: false } }), tieOrder: [byCreatedAt] },
  /** GET /api/customers: newest first. */
  "customers.list": { ...docRules("[]", { ignore: ["billingAddress._id", "shippingAddress._id"] }), tieOrder: [byCreatedAt] },
  /** GET /api/suppliers: newest first. */
  "suppliers.list": { ...docRules("[]"), tieOrder: [byCreatedAt] },
};
