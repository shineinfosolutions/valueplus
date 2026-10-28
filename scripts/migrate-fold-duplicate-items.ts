/**
 * One-time fold: stock-transfer used to create a brand-new Item document per
 * destination warehouse instead of tracking one product's stock across
 * warehouses (app/api/stock-transfers/route.ts, before this fix). This finds
 * those historical duplicates and folds their stock into the canonical item's
 * new `stockByWarehouse` array, then soft-deletes the duplicate — it is not
 * hard-deleted because SerialNumber/PurchaseEntry records may still reference
 * its _id.
 *
 * Matching rule: items sharing the same `name` (case-insensitive) where the
 * duplicate's free-text `warehouse` field matches a real Warehouse name. The
 * `-XXXX` code-suffix the old transfer code generated turned out to never
 * actually be used for matching (the lookup and the creation used different
 * string-cleaning rules, so it never found its own output) — so it's ignored
 * here as unreliable, in favour of name + warehouse matching.
 *
 * Usage:
 *   npx tsx scripts/migrate-fold-duplicate-items.ts            (dry run)
 *   npx tsx scripts/migrate-fold-duplicate-items.ts --apply
 */
import connectToDatabase from "../lib/db";
import Item from "../models/Item";
import Warehouse from "../models/Warehouse";

async function main() {
  const apply = process.argv.includes("--apply");
  await connectToDatabase();

  const [items, warehouses] = await Promise.all([
    Item.find({ status: { $ne: "inactive" } }).sort({ createdAt: 1 }).lean(),
    Warehouse.find({}).lean(),
  ]);

  const warehouseByNameLower = new Map(
    (warehouses as any[]).map((w) => [String(w.name || "").trim().toLowerCase(), w])
  );

  const byName = new Map<string, any[]>();
  for (const it of items as any[]) {
    const key = String(it.name || "").trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(it);
  }

  type FoldPlan = {
    canonicalId: string;
    canonicalName: string;
    canonicalCode: string;
    duplicateId: string;
    duplicateCode: string;
    warehouseName: string;
    warehouseId: string;
    qty: number;
  };
  const plan: FoldPlan[] = [];
  const unmatchedDuplicates: Array<{ id: string; code: string; name: string; warehouse: string }> = [];

  for (const [, group] of byName) {
    if (group.length < 2) continue;
    const [canonical, ...rest] = group; // oldest first (sorted by createdAt above)

    for (const dup of rest) {
      const whName = String(dup.warehouse || "").trim().toLowerCase();
      const warehouse = whName ? warehouseByNameLower.get(whName) : undefined;
      if (!warehouse) {
        unmatchedDuplicates.push({
          id: String(dup._id),
          code: dup.code,
          name: dup.name,
          warehouse: dup.warehouse || "(none)",
        });
        continue;
      }
      plan.push({
        canonicalId: String(canonical._id),
        canonicalName: canonical.name,
        canonicalCode: canonical.code,
        duplicateId: String(dup._id),
        duplicateCode: dup.code,
        warehouseName: warehouse.name,
        warehouseId: String(warehouse._id),
        qty: Number(dup.currentStock) || 0,
      });
    }
  }

  console.log(`${items.length} active items scanned, ${byName.size} distinct product names.\n`);
  console.log(`${plan.length} duplicate(s) to fold:`);
  console.table(
    plan.map((p) => ({
      product: p.canonicalName,
      canonicalCode: p.canonicalCode,
      duplicateCode: p.duplicateCode,
      intoWarehouse: p.warehouseName,
      qty: p.qty,
    }))
  );

  if (unmatchedDuplicates.length > 0) {
    console.log(
      `\n${unmatchedDuplicates.length} same-named item(s) found but their "warehouse" text didn't match any real warehouse — left untouched, review manually:`
    );
    console.table(unmatchedDuplicates);
  }

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to write these changes.");
    process.exit(0);
  }

  const { recomputeAggregates } = await import("../lib/stock");

  // Group by canonical so one item with several duplicates gets folded in one pass.
  const byCanonical = new Map<string, FoldPlan[]>();
  for (const p of plan) {
    if (!byCanonical.has(p.canonicalId)) byCanonical.set(p.canonicalId, []);
    byCanonical.get(p.canonicalId)!.push(p);
  }

  for (const [canonicalId, folds] of byCanonical) {
    const canonical = await Item.findById(canonicalId);
    if (!canonical) continue;
    const entries = (canonical.stockByWarehouse || []) as any[];
    for (const f of folds) {
      const existing = entries.find((e: any) => String(e.warehouseId) === f.warehouseId);
      if (existing) existing.qty = (existing.qty || 0) + f.qty;
      else entries.push({ warehouseId: f.warehouseId, qty: f.qty });
    }
    canonical.stockByWarehouse = entries as any;
    await canonical.save();
    await recomputeAggregates(canonicalId, entries);

    for (const f of folds) {
      await Item.updateOne(
        { _id: f.duplicateId },
        { $set: { status: "inactive", mergedIntoItemId: canonicalId } }
      );
    }
  }

  console.log(`\nApplied. ${plan.length} duplicate(s) folded into ${byCanonical.size} canonical item(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
