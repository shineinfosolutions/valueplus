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
