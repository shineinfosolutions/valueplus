/**
 * Category / brand / unit / warehouse / customer / supplier reads on D1 (stage B2). Each returns exactly what its
 * route's MongoDB read returns: the same documents (lib/repo/masters/rows.ts), the same filter, the same order.
 *
 * Order notes:
 *  - `.sort({ createdAt: ±1 })`: createdAt is ISO text in D1, so text order is time order. Documents created in
 *    the same millisecond have no defined order in MongoDB; D1 breaks the tie by id (creation order).
 *  - Brands use `.collation({ locale: "en", strength: 2 })`: ICU, case-insensitive, accent-sensitive. SQLite's
 *    NOCASE only folds A-Z and orders punctuation by byte value, so the final order is made in code with
 *    Intl.Collator("en", { sensitivity: "accent" }), which is the same ICU rule (strength 2 = "accent").
 */
import type { D1DatabaseLike } from "@/lib/d1/types";
import { SPECS, allRows, docFromRow } from "./rows";

// \ny\: the documents stand in for the lean() results of the MongoDB queries they replace, whatever their declared type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

/** Item counts per value of an items column (exact, case-sensitive match, as Item.countDocuments({ col: v })). */
async function itemCountsBy(db: D1DatabaseLike, col: "category" | "brand"): Promise<Map<string, number>> {
  const rows = await allRows(db, `SELECT ${col} AS k, COUNT(*) AS n FROM items WHERE ${col} IS NOT NULL GROUP BY ${col}`);
  return new Map(rows.map((r) => [String(r.k), Number(r.n)]));
}

/** GET /api/categories: every category, newest first, each with `items` = products in it. */
export async function listCategoriesWithCounts(db: D1DatabaseLike): Promise<Doc[]> {
  const [rows, counts] = await Promise.all([allRows(db, "SELECT * FROM categories ORDER BY createdAt DESC, id ASC"), itemCountsBy(db, "category")]);
  return rows.map((r) => {
    const cat = docFromRow(SPECS.categories, r);
    return { ...cat, items: typeof cat.name === "string" ? counts.get(cat.name) ?? 0 : 0 };
  });
}

const brandCollator = new Intl.Collator("en", { sensitivity: "accent" });

/** Mongo's order for `.collation({ locale: "en", strength: 2 }).sort({ name: 1 })`: missing names first. */
export function compareBrandNames(a: unknown, b: unknown): number {
  const aMissing = typeof a !== "string";
  const bMissing = typeof b !== "string";
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? -1 : 1;
  return brandCollator.compare(a as string, b as string);
}

/** GET /api/brands: every brand by name (case-insensitive), each with `items` = products of that brand. */
export async function listBrandsWithCounts(db: D1DatabaseLike): Promise<Doc[]> {
  const [rows, counts] = await Promise.all([allRows(db, "SELECT * FROM brands ORDER BY name COLLATE NOCASE, id ASC"), itemCountsBy(db, "brand")]);
  const docs = rows.map((r) => docFromRow(SPECS.brands, r));
  // Array.prototype.sort is stable: names equal under the collation keep the id order from SQL.
  docs.sort((a, b) => compareBrandNames(a.name, b.name));
  return docs.map((b) => ({ ...b, items: typeof b.name === "string" ? counts.get(b.name) ?? 0 : 0 }));
}

/** GET /api/units: every unit, newest first. */
export async function listUnits(db: D1DatabaseLike): Promise<Doc[]> {
  return (await allRows(db, "SELECT * FROM units ORDER BY createdAt DESC, id ASC")).map((r) => docFromRow(SPECS.units, r));
}

/**
 * GET /api/warehouses: every warehouse except the old placeholders (lib/legacy-rows.ts NOT_LEGACY_WAREHOUSE:
 * `name $nin [...]`, which also keeps a warehouse without a name), oldest first.
 */
export async function listWarehouses(db: D1DatabaseLike, legacyNames: string[]): Promise<Doc[]> {
  const marks = legacyNames.map(() => "?").join(", ");
  const where = legacyNames.length ? `WHERE name IS NULL OR name NOT IN (${marks})` : "";
  return (await allRows(db, `SELECT * FROM warehouses ${where} ORDER BY createdAt ASC, id ASC`, legacyNames)).map((r) => docFromRow(SPECS.warehouses, r));
}

/** GET /api/customers: every customer, newest first. */
export async function listCustomers(db: D1DatabaseLike): Promise<Doc[]> {
  return (await allRows(db, "SELECT * FROM customers ORDER BY createdAt DESC, id ASC")).map((r) => docFromRow(SPECS.customers, r));
}

/** GET /api/suppliers: every supplier, newest first (bank details included, as the Mongo route returns them). */
export async function listSuppliers(db: D1DatabaseLike): Promise<Doc[]> {
  return (await allRows(db, "SELECT * FROM suppliers ORDER BY createdAt DESC, id ASC")).map((r) => docFromRow(SPECS.suppliers, r));
}
