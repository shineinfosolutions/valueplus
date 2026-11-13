/**
 * Old rows that the Bank Accounts and Warehouses lists leave out.
 *
 * The two GET handlers used to DELETE these rows every time the page was opened — a database write on every read.
 * Now they only leave them out of what they return (the list people see is the same), and
 * scripts/cleanup-legacy-bank-warehouse.ts removes them once. Both use the filters below, so the list and the
 * clean-up always agree on which rows are "legacy".
 */
import BankAccount from "@/models/BankAccount";
import Warehouse from "@/models/Warehouse";

/** Cash-register entries that were once kept in the bank accounts table (exactly what the old delete matched). */
export const LEGACY_CASH_REGISTER = {
  $or: [{ type: "cash" }, { name: { $regex: /cash register/i } }, { number: { $regex: /cash-register/i } }],
};
/** The opposite of LEGACY_CASH_REGISTER: every bank account the list shows. */
export const NOT_LEGACY_CASH_REGISTER = {
  type: { $ne: "cash" },
  name: { $not: /cash register/i },
  number: { $not: /cash-register/i },
};

/** Generic placeholder warehouses from an early version. */
export const LEGACY_WAREHOUSE_NAMES = ["Showroom", "Godown", "Main Warehouse"];
export const LEGACY_WAREHOUSE = { name: { $in: LEGACY_WAREHOUSE_NAMES } };
export const NOT_LEGACY_WAREHOUSE = { name: { $nin: LEGACY_WAREHOUSE_NAMES } };

/**
 * Lists (and with `apply`, deletes) the legacy rows. Used by the one-off script; the API never deletes.
 */
export async function cleanupLegacyBankWarehouse(apply: boolean) {
  const [bankRows, warehouseRows] = await Promise.all([
    BankAccount.find(LEGACY_CASH_REGISTER, { name: 1, number: 1, type: 1 }).lean(),
    Warehouse.find(LEGACY_WAREHOUSE, { name: 1, code: 1 }).lean(),
  ]);
  let deletedBank = 0;
  let deletedWarehouses = 0;
  if (apply) {
    deletedBank = (await BankAccount.deleteMany(LEGACY_CASH_REGISTER)).deletedCount || 0;
    deletedWarehouses = (await Warehouse.deleteMany(LEGACY_WAREHOUSE)).deletedCount || 0;
  }
  return { bankRows, warehouseRows, deletedBank, deletedWarehouses };
}
