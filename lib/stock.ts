import Item from "@/models/Item";
import Warehouse from "@/models/Warehouse";

/**
 * The single place in the app allowed to move stock on an Item. Every write
 * site (purchase entries, sales, stock transfers, inventory adjustment/journal)
 * must route through this instead of hand-rolling `$inc`s on currentStock /
 * showroomStock / godownStock directly — those three fields are derived here
 * from `stockByWarehouse`, not independent counters, and re-deriving them in
 * one place is what stops them drifting out of sync with each other (which is
 * exactly how the original showroom/godown-sharing bug happened: three
 * different routes each reimplementing the same classification slightly
 * differently).
 *
 * `warehouseId` may be omitted — some callers (a sale with no resolvable
 * warehouse) fall back to the old blind behaviour of adjusting `currentStock`
 * alone, matching what this app did everywhere before this file existed.
 * Deliberately does not clamp at zero: the codebase has never blocked an
 * oversell/negative count, and changing that is out of scope here.
 */
export async function applyStockMovement(
  itemId: string,
  warehouseId: string | null | undefined,
  delta: number
): Promise<void> {
  if (!delta) return;

  if (!warehouseId) {
    await Item.updateOne({ _id: itemId }, { $inc: { currentStock: delta } });
    return;
  }

  // Atomic per-warehouse increment first — correct under concurrent calls
  // regardless of what happens to the aggregates below.
  let updated = await Item.findOneAndUpdate(
    { _id: itemId, "stockByWarehouse.warehouseId": warehouseId },
    { $inc: { "stockByWarehouse.$.qty": delta } },
    { new: true }
  ).lean();

  if (!updated) {
    updated = await Item.findOneAndUpdate(
      { _id: itemId },
      { $push: { stockByWarehouse: { warehouseId, qty: delta } } },
      { new: true, upsert: false }
    ).lean();
  }

  if (!updated) return; // itemId didn't match any Item — nothing to reconcile.

  await recomputeAggregates(itemId, (updated as any).stockByWarehouse || []);
}

/**
 * Re-sums showroomStock/godownStock/currentStock from stockByWarehouse. Safe
 * to call any time the array might have changed by a path other than
 * applyStockMovement (e.g. a migration script writing stockByWarehouse
 * directly) to bring the aggregates back in line.
 */
export async function recomputeAggregates(
  itemId: string,
  entries: Array<{ warehouseId: any; qty: number }>
): Promise<void> {
  const warehouseIds = entries.map((e) => e.warehouseId).filter(Boolean);
  const warehouses = warehouseIds.length
    ? await Warehouse.find({ _id: { $in: warehouseIds } }, { type: 1 }).lean()
    : [];
  const typeById = new Map(warehouses.map((w: any) => [String(w._id), w.type]));

  let showroomStock = 0;
  let godownStock = 0;
  for (const entry of entries) {
    const type = typeById.get(String(entry.warehouseId));
    if (type === "godown") godownStock += Number(entry.qty) || 0;
    else showroomStock += Number(entry.qty) || 0; // unknown type treated as showroom — the safer default for display
  }

  await Item.updateOne(
    { _id: itemId },
    { $set: { showroomStock, godownStock, currentStock: showroomStock + godownStock } }
  );
}
