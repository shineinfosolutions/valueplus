/**
 * Stage D of docs/D1_MIGRATION_PLAN.md: WHICH collections each write area owns once it writes to D1.
 *
 * A write area is a group of collections whose writes move from MongoDB to D1 together (switch `write:<area>`,
 * lib/d1/write-mode.ts). A collection is listed here only when EVERY route that writes it has a D1 path; a
 * collection that some unwired route still writes in MongoDB must not be listed, because in 'd1' mode the
 * write-through would skip it and that MongoDB write would never reach D1 (see lib/repo/WRITES_INVENTORY.md).
 *
 * Kept free of heavy imports: lib/d1/write-through.ts (loaded by lib/db.ts on every request) reads it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readAreaOfCollection } from "./registry";

/**
 * U1 masters (§6.6), as far as it can move on its own:
 *  - brands, categories, units, warehouses: read area 'masters';
 *  - variants, product_catalog_references: read area 'stock' (their GET routes read through read:stock).
 * NOT here (they move with later units, see lib/repo/WRITES_INVENTORY.md): items (stock quantities and
 * purchasePrice are written by purchase entries / orders / bills: U5), customers and suppliers (balances: U5),
 * billing_companies (usageCount is bumped by every bill and estimate: U5 / U4).
 */
export const WRITE_AREA_COLLECTIONS: Record<string, string[]> = {
  masters: ["brands", "categories", "units", "warehouses", "variants", "product_catalog_references"],
};

export const WRITE_AREAS = Object.keys(WRITE_AREA_COLLECTIONS);

const AREA_BY_COLLECTION = new Map<string, string>(
  Object.entries(WRITE_AREA_COLLECTIONS).flatMap(([area, list]) => list.map((c) => [c, area] as [string, string]))
);

/** The write area that owns a collection, or null when its writes always go to MongoDB first. */
export function writeAreaOfCollection(collection: string | null | undefined): string | null {
  return collection ? AREA_BY_COLLECTION.get(String(collection)) ?? null : null;
}

/**
 * The read areas (read:<area> switches) that serve the write area's collections. A write area may only write D1
 * while ALL of them answer from D1: otherwise a user could save on D1 and then be shown MongoDB's older copy.
 */
export function readAreasOfWriteArea(area: string): string[] {
  const out = new Set<string>();
  for (const c of WRITE_AREA_COLLECTIONS[area] || []) {
    const r = readAreaOfCollection(c);
    if (r) out.add(r);
  }
  return Array.from(out);
}

/**
 * Set while the reverse mirror (lib/d1/reverse-mirror.ts) writes a document into MongoDB. The write-through sees
 * it and leaves that write alone: the document came FROM D1, copying it back would only bounce it.
 */
export const mirrorWriteContext = new AsyncLocalStorage<boolean>();
