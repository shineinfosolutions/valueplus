// Set every product saved above 18% GST (or at a rate that does not exist,
// like 22% or 20.01%) to 18%.
//   node scripts/one-off/gst-cap-18.js          → dry run: lists them
//   node scripts/one-off/gst-cap-18.js --apply  → backup, then update
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")])
);
const APPLY = process.argv.includes("--apply");
const FILTER = { gstRate: { $nin: [0, 5, 12, 18] } };

(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB || undefined });
  const db = mongoose.connection.db;
  const items = await db.collection("items").find(FILTER, { projection: { name: 1, gstRate: 1, hsnCode: 1 } }).toArray();
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"}: ${items.length} products → 18%`);
  items.forEach((i) => console.log(`  ${i.gstRate}% → 18%  ${i.name} (HSN ${i.hsnCode || "-"})`));
  if (!APPLY || items.length === 0) return mongoose.disconnect();

  const backup = path.join(__dirname, `gst-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(items, null, 1));
  const res = await db.collection("items").updateMany(
    { _id: { $in: items.map((i) => i._id) }, ...FILTER },
    { $set: { gstRate: 18 } }
  );
  await db.collection("audit_logs").insertOne({
    action: "item.gst.capped",
    entityType: "Item",
    entityRef: `${res.modifiedCount} products`,
    reason: "GST set to 18% for products saved above 18% or at a non-existent rate",
    performedBy: "Claude (on request)",
    metadata: { backupFile: path.basename(backup), products: items.map((i) => ({ name: i.name, from: i.gstRate })) },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log("updated:", res.modifiedCount, "· backup:", backup);
  await mongoose.disconnect();
})().catch((e) => { console.log("STOPPED:", e.message); process.exit(1); });
