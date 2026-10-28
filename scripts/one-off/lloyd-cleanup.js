// Lloyd product clean-up on the live database.
//   node scripts/one-off/lloyd-cleanup.js          → dry run: shows every change, writes nothing
//   node scripts/one-off/lloyd-cleanup.js --apply  → backs up every touched document, then applies
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")])
);
const APPLY = process.argv.includes("--apply");
const { ObjectId } = mongoose.Types;
const WAREHOUSE = "6a8bdc767e64f9b197e315cf";

// The duplicate 43PS850G TV is merged into the original product.
const MERGE = { from: "6ac261812ac2a057f834aed7", into: "6abfa49026b871dd47788cb8", code: "VP0010597" };
// Unused duplicates (stock 0, nothing refers to them) of products that exist properly.
const REMOVE = [
  { id: null, name: "VP0012023 - GLS19I3AGAHF- LLOYD", keep: "GLS19I3AGAHF- LLOYD", code: "VP0012023" },
  { id: null, name: "VP0012024 - GLS19I3AGAHF OU- LLOYD", keep: "GLS19I3AGAHF OU", code: "VP0012024" },
];
// Wrong name/brand/category fixed in place.
const RENAME = [
  { name: "VP0013234 - GLDG2012CSGCF- LLOYD", set: { name: "GLDG2012CSGCF- LLOYD", brand: "LLOYD", category: "LLOYD DC" }, code: "VP0013234" },
  { name: "VP0012934 - LLOYD 43FS501J (LED)-", set: { name: "LLOYD 43FS501J (LED)- LLOYD", category: "LLOYD" }, code: "VP0012934" },
];
const TYPO_BRAND = { from: "LLYOD", to: "LLOYD" };
// Supplier codes from invoice 617202672 for products that are already right.
const LEARN = [
  ["LLOYD 55PS850G (QLED)- LLOYD", "VP0010655"],
  ["GLS18I3AGCHC- LLOYD", "VP0011966"],
  ["GLS18I3AGCHC OU- LLOYD", "VP0011967"],
  ["GLWS705ARDVG- LLOYD", "VP0006037"],
];

(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB || undefined });
  const db = mongoose.connection.db;
  const items = db.collection("items");
  const cols = (await db.listCollections().toArray()).map((c) => c.name);
  const byName = async (name) => {
    const list = await items.find({ name }).toArray();
    if (list.length !== 1) throw new Error(`expected exactly one product named "${name}", found ${list.length}`);
    return list[0];
  };

  // ── load and check everything first ──────────────────────────────────────
  const from = await items.findOne({ _id: new ObjectId(MERGE.from) });
  const into = await items.findOne({ _id: new ObjectId(MERGE.into) });
  if (!from || !into) throw new Error("merge products not found");
  for (const r of REMOVE) {
    const it = await byName(r.name);
    r.id = it._id; r.doc = it; r.keepDoc = await byName(r.keep);
    if ((Number(it.currentStock) || 0) !== 0) throw new Error(`${r.name} has stock`);
  }
  for (const r of RENAME) { r.doc = await byName(r.name); }
  const typo = await items.find({ brand: TYPO_BRAND.from }).toArray();
  const learn = [];
  for (const [name, code] of LEARN) learn.push({ doc: await byName(name), code });

  // Every document anywhere that mentions a product being removed or merged.
  const refs = {};
  const watch = [from, ...REMOVE.map((r) => r.doc)];
  for (const c of cols) {
    if (c === "items") continue;
    const docs = await db.collection(c).find({}).toArray();
    for (const d of docs) {
      const text = JSON.stringify(d);
      for (const w of watch) {
        if (text.includes(String(w._id)) || (w.code && text.includes(w.code))) {
          (refs[String(w._id)] ||= []).push({ c, _id: d._id });
        }
      }
    }
  }
  for (const r of REMOVE) {
    const n = (refs[String(r.id)] || []).length;
    if (n) throw new Error(`${r.name} is referenced in ${JSON.stringify(refs[String(r.id)])}`);
  }
  const mergeRefs = refs[String(from._id)] || [];
  const allowed = new Set(["serial_numbers", "purchase_entries", "purchase_orders", "audit_logs"]);
  const unexpected = mergeRefs.filter((x) => !allowed.has(x.c));
  if (unexpected.length) throw new Error(`merge source referenced in ${JSON.stringify(unexpected)}`);

  // ── show the plan ────────────────────────────────────────────────────────
  console.log(APPLY ? "APPLYING" : "DRY RUN (nothing written)");
  console.log(`MERGE "${from.name}" (stock ${from.currentStock}) into "${into.name}" (stock ${into.currentStock} -> ${into.currentStock + from.currentStock}); refs moved:`, mergeRefs.map((x) => x.c).join(", "));
  for (const r of REMOVE) console.log(`REMOVE "${r.name}" (stock 0, no references); code ${r.code} -> "${r.keepDoc.name}"`);
  for (const r of RENAME) console.log(`RENAME "${r.name}" -> ${JSON.stringify(r.set)} (was brand ${r.doc.brand}, category ${r.doc.category}); code ${r.code}`);
  console.log(`BRAND ${TYPO_BRAND.from} -> ${TYPO_BRAND.to}:`, typo.map((t) => t.name).join(", "));
  for (const l of learn) console.log(`CODE ${l.code} -> "${l.doc.name}"`);

  if (!APPLY) { await mongoose.disconnect(); return; }

  // ── back up every document about to change ───────────────────────────────
  const backup = { at: new Date().toISOString(), items: [], others: [] };
  const touchedIds = new Set([from, into, ...REMOVE.map((r) => r.doc), ...REMOVE.map((r) => r.keepDoc), ...RENAME.map((r) => r.doc), ...typo, ...learn.map((l) => l.doc)].map((d) => String(d._id)));
  backup.items = await items.find({ _id: { $in: [...touchedIds].map((i) => new ObjectId(i)) } }).toArray();
  const renamedRefs = [];
  for (const r of RENAME) {
    for (const c of ["serial_numbers", "purchase_entries", "purchase_orders"]) {
      const docs = await db.collection(c).find({ $or: [{ itemId: String(r.doc._id) }, { "items.itemId": String(r.doc._id) }] }).toArray();
      docs.forEach((d) => renamedRefs.push({ c, d }));
    }
  }
  for (const x of mergeRefs) backup.others.push({ c: x.c, doc: await db.collection(x.c).findOne({ _id: x._id }) });
  for (const x of renamedRefs) backup.others.push({ c: x.c, doc: x.d });
  const backupFile = path.join(__dirname, `lloyd-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1));
  console.log("backup:", backupFile, "| items", backup.items.length, "| other docs", backup.others.length);

  // ── 1. merge the duplicate TV ────────────────────────────────────────────
  const qty = Number(from.currentStock) || 0;
  const intoCode = into.vpCode || into.code;
  const hasWh = (into.stockByWarehouse || []).some((e) => String(e.warehouseId) === WAREHOUSE);
  await items.updateOne(
    { _id: into._id },
    {
      $inc: { currentStock: qty, showroomStock: Number(from.showroomStock) || 0, godownStock: Number(from.godownStock) || 0, ...(hasWh ? { "stockByWarehouse.$[w].qty": qty } : {}) },
      ...(hasWh ? {} : { $push: { stockByWarehouse: { warehouseId: WAREHOUSE, qty } } }),
      $addToSet: { supplierCodes: MERGE.code },
    },
    hasWh ? { arrayFilters: [{ "w.warehouseId": WAREHOUSE }] } : {}
  );
  const fromId = String(from._id);
  await db.collection("serial_numbers").updateMany({ itemId: fromId }, { $set: { itemId: String(into._id), vpCode: intoCode, itemName: into.name } });
  for (const c of ["purchase_entries", "purchase_orders"]) {
    await db.collection(c).updateMany(
      { "items.itemId": fromId },
      { $set: { "items.$[l].itemId": String(into._id), "items.$[l].name": into.name, "items.$[l].itemName": into.name, "items.$[l].code": into.code, "items.$[l].itemCode": into.code, "items.$[l].vpCode": intoCode } },
      { arrayFilters: [{ "l.itemId": fromId }] }
    );
  }
  await items.deleteOne({ _id: from._id });

  // ── 2. remove the unused duplicates, keep their codes on the real products
  for (const r of REMOVE) {
    await items.deleteOne({ _id: r.id, currentStock: { $in: [0, null] } });
    await items.updateOne({ _id: r.keepDoc._id }, { $addToSet: { supplierCodes: r.code } });
  }

  // ── 3. rename in place, and the names shown on their serials/purchases ───
  for (const r of RENAME) {
    const id = String(r.doc._id);
    await items.updateOne({ _id: r.doc._id }, { $set: r.set, $addToSet: { supplierCodes: r.code } });
    await db.collection("serial_numbers").updateMany({ itemId: id }, { $set: { itemName: r.set.name } });
    for (const c of ["purchase_entries", "purchase_orders"]) {
      await db.collection(c).updateMany({ "items.itemId": id }, { $set: { "items.$[l].name": r.set.name } }, { arrayFilters: [{ "l.itemId": id }] });
    }
  }

  // ── 4. brand typo, 5. learned codes ──────────────────────────────────────
  await items.updateMany({ brand: TYPO_BRAND.from }, { $set: { brand: TYPO_BRAND.to } });
  for (const l of learn) await items.updateOne({ _id: l.doc._id }, { $addToSet: { supplierCodes: l.code } });

  await db.collection("audit_logs").insertOne({
    action: "item.cleanup.lloyd",
    entityType: "Item",
    entityRef: "Lloyd products",
    reason: "Merged/removed mis-saved Lloyd duplicates, fixed names/brands, saved supplier codes (invoice 617202672)",
    performedBy: "Claude (on request)",
    metadata: { backupFile: path.basename(backupFile), merged: MERGE, removed: REMOVE.map((r) => r.name), renamed: RENAME.map((r) => [r.name, r.set.name]) },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log("done");
  await mongoose.disconnect();
})().catch((e) => { console.log("STOPPED:", e.message); process.exit(1); });
