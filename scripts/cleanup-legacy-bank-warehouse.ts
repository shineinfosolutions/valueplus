/**
 * One-time clean-up: deletes the old cash-register rows from the bank accounts table and the generic placeholder
 * warehouses ("Showroom", "Godown", "Main Warehouse").
 *
 * The Bank Accounts and Warehouses GET handlers used to delete these on every page open. They now only leave them
 * out of the list (lib/legacy-rows.ts has the exact filters), so nothing changes for anyone whether or not this
 * script is run; running it just removes rows nobody sees. NOT run automatically.
 *
 * Usage (against the database in MONGODB_URI / MONGODB_DB — check which one before using --apply):
 *   npx tsx scripts/cleanup-legacy-bank-warehouse.ts            (dry run — lists the rows only)
 *   npx tsx scripts/cleanup-legacy-bank-warehouse.ts --apply    (deletes them)
 */
import connectToDatabase from "../lib/db";
import { cleanupLegacyBankWarehouse } from "../lib/legacy-rows";

async function main() {
  const apply = process.argv.includes("--apply");
  await connectToDatabase();

  const result = await cleanupLegacyBankWarehouse(apply);
  console.log(`Legacy cash-register rows in bank accounts: ${result.bankRows.length}`);
  if (result.bankRows.length) console.table(result.bankRows.map((r: any) => ({ name: r.name, number: r.number, type: r.type })));
  console.log(`Placeholder warehouses: ${result.warehouseRows.length}`);
  if (result.warehouseRows.length) console.table(result.warehouseRows.map((w: any) => ({ name: w.name, code: w.code })));

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to delete these rows.");
  } else {
    console.log(`\nDeleted ${result.deletedBank} bank account row(s) and ${result.deletedWarehouses} warehouse(s).`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
