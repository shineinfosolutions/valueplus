/**
 * One-time backfill: seed `stockByWarehouse` on every remaining active item
 * (i.e. not already handled by migrate-fold-duplicate-items.ts) from its
 * existing showroomStock/godownStock split — assigned to each type's default
 * (or first) warehouse, since the old two-bucket model can't tell us WHICH of
 * the two real showrooms (or two real godowns) the number actually belonged
 * to. This is a best-effort reconstruction, not a recovery of lost history.
 *
 * Also surfaces (but does not silently "fix") any item where
 * showroomStock + godownStock != currentStock — a real, separate bug found
 * during investigation (sales deduction only ever touched currentStock, never
 * the two buckets), so these numbers may already have quietly disagreed
 * before this migration ever ran. After this script, currentStock becomes the
 * derived sum going forward, so any such drift is resolved by this migration
 * — surfaced here so a real stock count can double check it if needed.
 *
 * Run migrate-fold-duplicate-items.ts first.
 *
 * Usage:
 *   npx tsx scripts/migrate-stockbywarehouse-backfill.ts            (dry run)
 *   npx tsx scripts/migrate-stockbywarehouse-backfill.ts --apply
 */
import connectToDatabase from "../lib/db";
import Item from "../models/Item";
import Warehouse from "../models/Warehouse";

async function main() {
  const apply = process.argv.includes("--apply");
  await connectToDatabase();

  const [showroomDefault, showroomAny, godownDefault, godownAny] = await Promise.all([
    Warehouse.findOne({ type: "showroom", isDefault: true }).lean(),
    Warehouse.findOne({ type: "showroom" }).sort({ createdAt: 1 }).lean(),
    Warehouse.findOne({ type: "godown", isDefault: true }).lean(),
    Warehouse.findOne({ type: "godown" }).sort({ createdAt: 1 }).lean(),
  ]);
  const showroomWarehouse: any = showroomDefault || showroomAny;
  const godownWarehouse: any = godownDefault || godownAny;

  if (!showroomWarehouse) console.warn("No showroom-type warehouse found — showroomStock cannot be seeded.");
  if (!godownWarehouse) console.warn("No godown-type warehouse found — godownStock cannot be seeded.");

  const items = await Item.find({
    status: { $ne: "inactive" },
    $or: [{ stockByWarehouse: { $exists: false } }, { stockByWarehouse: { $size: 0 } }],
  }).lean();

  type Plan = {
    _id: string;
    code: string;
    name: string;
    showroomStock: number;
    godownStock: number;
    currentStock: number;
    entries: Array<{ warehouseId: string; qty: number }>;
    discrepancy: boolean;
  };
  const plan: Plan[] = [];

  for (const it of items as any[]) {
    const showroomStock = Number(it.showroomStock) || 0;
    const godownStock = Number(it.godownStock) || 0;
    const currentStock = Number(it.currentStock) || 0;
    if (showroomStock === 0 && godownStock === 0) continue; // nothing to seed

    const entries: Array<{ warehouseId: string; qty: number }> = [];
    if (showroomStock > 0 && showroomWarehouse) {
      entries.push({ warehouseId: String(showroomWarehouse._id), qty: showroomStock });
    }
    if (godownStock > 0 && godownWarehouse) {
      entries.push({ warehouseId: String(godownWarehouse._id), qty: godownStock });
    }
    if (entries.length === 0) continue;

    plan.push({
      _id: String(it._id),
      code: it.code,
      name: it.name,
      showroomStock,
      godownStock,
      currentStock,
      entries,
      discrepancy: showroomStock + godownStock !== currentStock,
    });
  }

  console.log(`${items.length} item(s) with no stockByWarehouse yet; ${plan.length} have stock to seed.\n`);
  console.table(
    plan.map((p) => ({
      code: p.code,
      name: p.name,
      showroomStock: p.showroomStock,
      godownStock: p.godownStock,
      currentStock: p.currentStock,
      discrepancy: p.discrepancy ? "YES" : "",
    }))
  );

  const discrepancies = plan.filter((p) => p.discrepancy);
  if (discrepancies.length > 0) {
    console.log(
      `\n${discrepancies.length} item(s) have showroomStock + godownStock != currentStock today — after this migration, currentStock becomes the derived sum (shown above), overriding the old value. Worth a physical count if this list is long.`
    );
  }

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to write these changes.");
    process.exit(0);
  }

  const { recomputeAggregates } = await import("../lib/stock");
  for (const p of plan) {
    await Item.updateOne({ _id: p._id }, { $set: { stockByWarehouse: p.entries } });
    await recomputeAggregates(p._id, p.entries);
  }

  console.log(`\nApplied. ${plan.length} item(s) seeded.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
