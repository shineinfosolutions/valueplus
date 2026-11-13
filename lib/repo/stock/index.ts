/**
 * Every MongoDB read of the purchase, stock and cash area, each with its D1 twin (stage B2 of
 * docs/D1_MIGRATION_PLAN.md). The routes call them through readStock (./shadow-read.ts): the shadow-read framework compares `mongo` with `d1`, then the
 * routes switch over area by area. What each read is, where it is used and what it returns: INVENTORY.md here.
 * Parity is tested in tests/d1-stock-reads.test.ts.
 */
import { PURCHASE_READS } from "./purchases";
import { INVENTORY_READS } from "./inventory";
import { VENDOR_READS } from "./vendors";
import { CASH_READS } from "./cash";
import type { StockRead } from "./types";

export type { StockRead } from "./types";

export const STOCK_READS: Record<string, { mongo: (...args: any[]) => Promise<any>; d1: (...args: any[]) => Promise<any> }> & Record<string, StockRead> = {
  ...PURCHASE_READS,
  ...INVENTORY_READS,
  ...VENDOR_READS,
  ...CASH_READS,
};
