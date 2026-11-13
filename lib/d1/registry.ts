import { MASTER_SPECS, type MasterSpec } from "./masters-map";
import { SALES_SPECS } from "./maps/sales";
import { STOCK_CASH_SPECS } from "./maps/stock-cash";
import { STAFF_SYSTEM_SPECS } from "./maps/staff-system";
import { CRM_DOCS_SPECS } from "./maps/crm-docs";

/**
 * Every Mongo collection the D1 copy job (lib/d1/sync.ts) copies, in the order it copies them: master data
 * first (phase 1), then each area. Adding an area = filling its file in lib/d1/maps/ and adding its migration.
 */
export const ALL_SPECS: MasterSpec[] = [...MASTER_SPECS, ...SALES_SPECS, ...STOCK_CASH_SPECS, ...STAFF_SYSTEM_SPECS, ...CRM_DOCS_SPECS];

export const ALL_SPEC_BY_COLLECTION: Record<string, MasterSpec> = Object.fromEntries(ALL_SPECS.map((s) => [s.collection, s]));

/**
 * Which read area (the `read:<area>` switch of lib/d1/read-source.ts) each copied collection belongs to: the
 * spec file it is declared in. Used by the Stage C freshness guard: a write-through or copy-job failure on one of
 * an area's collections means that area's D1 copy may be behind, so it reads MongoDB for a while.
 */
export const READ_AREA_COLLECTIONS: Record<string, string[]> = {
  masters: MASTER_SPECS.map((s) => s.collection),
  sales: SALES_SPECS.map((s) => s.collection),
  stock: STOCK_CASH_SPECS.map((s) => s.collection),
  staff: STAFF_SYSTEM_SPECS.map((s) => s.collection),
  crm: CRM_DOCS_SPECS.map((s) => s.collection),
};

const AREA_BY_COLLECTION = new Map<string, string>(
  Object.entries(READ_AREA_COLLECTIONS).flatMap(([area, list]) => list.map((c) => [c, area] as [string, string]))
);

/** The read area of a collection, or null when it is not one the D1 copy holds. */
export function readAreaOfCollection(collection: string | null | undefined): string | null {
  return collection ? AREA_BY_COLLECTION.get(String(collection)) ?? null : null;
}
