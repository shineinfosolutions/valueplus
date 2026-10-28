/**
 * One-time backfill: seed the new `vsp` (Value Plus Selling Price) field from
 * each item's existing `sellingPrice`, for every item that doesn't have a vsp
 * set yet. Going forward, Master Products lets this be edited independently.
 *
 * Usage:
 *   npx tsx scripts/migrate-vsp-backfill.ts            (dry run)
 *   npx tsx scripts/migrate-vsp-backfill.ts --apply
 */
import connectToDatabase from "../lib/db";
import Item from "../models/Item";

async function main() {
  const apply = process.argv.includes("--apply");
  await connectToDatabase();

  const items = await Item.find(
    { $or: [{ vsp: { $exists: false } }, { vsp: 0 }, { vsp: null }] },
    { code: 1, name: 1, sellingPrice: 1, vsp: 1 }
  ).lean();

  const plan = items
    .filter((it: any) => Number(it.sellingPrice) > 0)
    .map((it: any) => ({ _id: String(it._id), code: it.code, name: it.name, sellingPrice: it.sellingPrice }));

  console.log(`${items.length} item(s) with no vsp set; ${plan.length} have a sellingPrice to seed from.\n`);
  console.table(plan.slice(0, 25).map((p) => ({ code: p.code, name: p.name, vsp: p.sellingPrice })));
  if (plan.length > 25) console.log(`...and ${plan.length - 25} more (showing first 25).`);

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to write these changes.");
    process.exit(0);
  }

  for (const p of plan) {
    await Item.updateOne({ _id: p._id }, { $set: { vsp: p.sellingPrice } });
  }

  console.log(`\nApplied. ${plan.length} item(s) seeded.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
