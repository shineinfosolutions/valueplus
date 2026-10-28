/**
 * Removes the 493 items created by the earlier broken run of
 * import-ashoka-stock.ts, which treated every row of the Tally hierarchy
 * (brand totals, category subtotals, AND real products) as a separate item.
 * Every one of those items was tagged category: "Imported" — a marker no
 * genuine catalog item uses — so this is a safe, precise match.
 *
 * Usage:
 *   npx tsx scripts/cleanup-bad-stock-import.ts            (dry run)
 *   npx tsx scripts/cleanup-bad-stock-import.ts --apply
 */
import connectToDatabase from "../lib/db";
import Item from "../models/Item";

async function main() {
  const apply = process.argv.includes("--apply");
  await connectToDatabase();

  const toDelete = await Item.find({ category: "Imported" }).lean();
  console.log(`${toDelete.length} item(s) tagged category:"Imported" found.`);
  console.log("Sample:", toDelete.slice(0, 10).map((i: any) => ({ name: i.name, code: i.code, currentStock: i.currentStock })));

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to delete these.");
    process.exit(0);
  }

  const result = await Item.deleteMany({ category: "Imported" });
  console.log(`\nDeleted ${result.deletedCount} item(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
