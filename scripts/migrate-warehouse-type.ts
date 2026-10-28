/**
 * One-time backfill: classify every existing Warehouse as "showroom" or
 * "godown" using the same keyword heuristic the app used to reimplement in
 * several places (purchase-entries, PurchaseCreationModal, BranchContext) —
 * so behaviour is unchanged at migration time. Going forward, `Warehouse.type`
 * is the single source of truth and those call sites read it instead of
 * guessing.
 *
 * Usage:
 *   npx tsx scripts/migrate-warehouse-type.ts            (dry run — prints only)
 *   npx tsx scripts/migrate-warehouse-type.ts --apply    (writes)
 */
import connectToDatabase from "../lib/db";
import Warehouse from "../models/Warehouse";

function classify(name: string): "showroom" | "godown" {
  const n = name.toLowerCase();
  if (n.includes("godown") || n.includes("warehouse") || n.includes("gida") || n.includes("logistics")) {
    return "godown";
  }
  return "showroom";
}

async function main() {
  const apply = process.argv.includes("--apply");
  await connectToDatabase();

  const warehouses = await Warehouse.find({}).lean();
  console.log(`Found ${warehouses.length} warehouse(s).\n`);

  const plan = warehouses.map((w: any) => ({
    _id: w._id,
    name: w.name,
    currentType: w.type || "(none)",
    proposedType: classify(w.name || ""),
  }));

  console.table(plan.map((p) => ({ name: p.name, currentType: p.currentType, proposedType: p.proposedType })));

  const toChange = plan.filter((p) => p.currentType !== p.proposedType);
  console.log(`\n${toChange.length} of ${plan.length} would change.`);

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to write these changes.");
    process.exit(0);
  }

  for (const p of plan) {
    await Warehouse.updateOne({ _id: p._id }, { $set: { type: p.proposedType } });
  }
  console.log(`\nApplied. ${plan.length} warehouse(s) now have a type.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
