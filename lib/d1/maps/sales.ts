import type { MasterSpec } from "../masters-map";

/**
 * D1 copy specs for this area (see docs/D1_MIGRATION_PLAN.md). Each entry maps one Mongo collection to its
 * D1 table (migration in d1/migrations/). Picked up by lib/d1/registry.ts, so the copy job (lib/d1/sync.ts)
 * copies it with no other change.
 */
export const SALES_SPECS: MasterSpec[] = [];
