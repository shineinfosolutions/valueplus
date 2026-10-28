/**
 * One-time backfill: `User.assignedWarehouseId` exists in the schema and is
 * piped through the session/JWT, but was never actually populated — every
 * seed account only ever set `assignedWarehouseName` (a plain string). This
 * resolves that name against the real Warehouse collection and fills in the
 * id, which the sales-deduction warehouse-trust logic needs as a real,
 * rename-proof reference instead of a string match.
 *
 * Usage:
 *   npx tsx scripts/migrate-user-assigned-warehouse.ts            (dry run)
 *   npx tsx scripts/migrate-user-assigned-warehouse.ts --apply
 */
import connectToDatabase from "../lib/db";
import User from "../models/User";
import Warehouse from "../models/Warehouse";

async function main() {
  const apply = process.argv.includes("--apply");
  await connectToDatabase();

  const [users, warehouses] = await Promise.all([
    User.find({
      assignedWarehouseName: { $nin: [null, "", "ALL"] },
      $or: [{ assignedWarehouseId: { $exists: false } }, { assignedWarehouseId: "" }],
    }).lean(),
    Warehouse.find({}).lean(),
  ]);

  const warehouseByNameLower = new Map(
    (warehouses as any[]).map((w) => [String(w.name || "").trim().toLowerCase(), w])
  );

  const plan: Array<{ userId: string; name: string; assignedWarehouseName: string; warehouseId: string | null }> = [];
  for (const u of users as any[]) {
    const key = String(u.assignedWarehouseName || "").trim().toLowerCase();
    const warehouse = warehouseByNameLower.get(key);
    plan.push({
      userId: String(u._id),
      name: u.name || u.email || u._id,
      assignedWarehouseName: u.assignedWarehouseName,
      warehouseId: warehouse ? String(warehouse._id) : null,
    });
  }

  console.log(`${users.length} user(s) with a warehouse name but no id yet.\n`);
  console.table(plan.map((p) => ({ user: p.name, assignedWarehouseName: p.assignedWarehouseName, resolvedId: p.warehouseId || "NOT FOUND" })));

  const unresolved = plan.filter((p) => !p.warehouseId);
  if (unresolved.length > 0) {
    console.log(`\n${unresolved.length} user(s)' assignedWarehouseName didn't match any real warehouse — left untouched, review manually.`);
  }

  if (!apply) {
    console.log("\nDry run only — re-run with --apply to write these changes.");
    process.exit(0);
  }

  let applied = 0;
  for (const p of plan) {
    if (!p.warehouseId) continue;
    await User.updateOne({ _id: p.userId }, { $set: { assignedWarehouseId: p.warehouseId } });
    applied++;
  }

  console.log(`\nApplied. ${applied} user(s) updated.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
