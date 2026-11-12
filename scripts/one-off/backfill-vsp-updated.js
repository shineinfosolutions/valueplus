// Fills "VSP last updated (date, by whom, from which sheet)" on products whose VSP was changed by a price-sheet
// import BEFORE the product started keeping those fields. The record is the audit log of each import
// (action "item.price.import": who, when, the file and, per product, its name and new VSP).
// Only products whose current VSP still equals the VSP that import set are stamped; only the three fields
// vspUpdatedAt / vspUpdatedBy / vspUpdatedFrom are written, and products that already have them are left alone.
//   node scripts/one-off/backfill-vsp-updated.js          -> dry run
//   node scripts/one-off/backfill-vsp-updated.js --apply  -> saves the list of changes to a JSON file, then writes them
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
const uri = process.env.MONGODB_URI || fs.readFileSync(path.join(root, "lib/db.ts"), "utf8").match(/"(mongodb\+srv:\/\/[^"]+)"/)[1];
const APPLY = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || "valueplus" });
  const db = mongoose.connection.db;
  const logs = await db.collection("audit_logs").find({ action: "item.price.import" }).sort({ createdAt: 1 }).toArray();
  console.log(APPLY ? "APPLYING" : "DRY RUN", `- ${logs.length} price-sheet import(s) in the audit log`);
  const items = await db.collection("items").find({}, { projection: { name: 1, vsp: 1, vspUpdatedAt: 1 } }).toArray();
  const byName = new Map();
  for (const it of items) {
    const k = String(it.name || "").trim().toLowerCase();
    byName.set(k, [...(byName.get(k) || []), it]);
  }
  // The latest import that set each product's VSP wins (logs are oldest first).
  const latest = new Map();
  for (const log of logs) {
    for (const u of log.metadata?.updates || []) {
      if (u.newVsp === null || u.newVsp === undefined) continue;
      const list = byName.get(String(u.name || "").trim().toLowerCase()) || [];
      if (list.length !== 1) continue; // unknown or ambiguous name: not guessed
      latest.set(String(list[0]._id), { item: list[0], vsp: Number(u.newVsp), at: log.createdAt, by: log.performedBy || "", from: log.entityRef || "" });
    }
  }
  const changes = [];
  for (const { item, vsp, at, by, from } of latest.values()) {
    if (item.vspUpdatedAt) continue; // already stamped
    if (Math.abs((Number(item.vsp) || 0) - vsp) > 0.005) continue; // the VSP was changed again after that import
    changes.push({ id: String(item._id), name: item.name, vsp, at, by, from });
  }
  console.log(`${changes.length} product(s) would get "VSP updated" details`);
  for (const c of changes.slice(0, 15)) console.log(" ", c.name, "|", c.vsp, "|", new Date(c.at).toISOString().slice(0, 10), "|", c.by, "|", c.from);
  if (APPLY && changes.length) {
    const file = path.join(__dirname, `backfill-vsp-updated-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(changes, null, 2));
    const res = await db.collection("items").bulkWrite(
      changes.map((c) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(c.id), vspUpdatedAt: { $exists: false } }, update: { $set: { vspUpdatedAt: new Date(c.at), vspUpdatedBy: c.by, vspUpdatedFrom: c.from } } } }))
    );
    console.log("written:", res.modifiedCount, "| list saved to", file);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
