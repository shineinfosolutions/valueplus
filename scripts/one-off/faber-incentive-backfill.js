// Saurabh Rai's two Faber FMG 500 bills of 5 Nov 2026 (INV2026-0003 at Rs 2,300, INV2026-0004 at Rs 2,500) were billed
// a day BEFORE the product's incentive rule was set (6 Nov), so they carry no incentive. The Admin asked to add it:
// Rs 50 on the 2,300 bill and Rs 150 (50 + 100, both rules) on the 2,500 bill.
//   node scripts/one-off/faber-incentive-backfill.js          -> dry run
//   node scripts/one-off/faber-incentive-backfill.js --apply  -> backs the two bills up to a JSON file, then sets only
//        items[Faber line].incentiveEarned / incentiveRules and the bill's salesExecutiveIncentive
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
const uri = process.env.MONGODB_URI || fs.readFileSync(path.join(root, "lib/db.ts"), "utf8").match(/"(mongodb\+srv:\/\/[^"]+)"/)[1];
const APPLY = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || "valueplus" });
  const db = mongoose.connection.db;
  const item = await db.collection("items").findOne({ name: "Faber FMG 500 3J VITA" });
  const rules = item.incentives;
  const plan = { "INV2026-0003": 50, "INV2026-0004": 150 };
  const backup = [];
  for (const [no, amount] of Object.entries(plan)) {
    const b = await db.collection("invoices").findOne({ invoiceNumber: no });
    if (!b) { console.log(no, "not found"); continue; }
    const idx = b.items.findIndex((l) => /faber fmg 500/i.test(l.itemName));
    console.log(no, "line", idx, "now", b.items[idx].incentiveEarned, "bill", b.salesExecutiveIncentive, "->", amount);
    if (idx < 0 || Number(b.salesExecutiveIncentive) !== 0 || Number(b.items[idx].incentiveEarned) !== 0) { console.log("  skipped (already has incentive)"); continue; }
    backup.push(b);
    if (APPLY) {
      await db.collection("invoices").updateOne({ _id: b._id }, { $set: { [`items.${idx}.incentiveEarned`]: amount, [`items.${idx}.incentiveRules`]: rules, salesExecutiveIncentive: amount } });
      console.log("  updated");
    }
  }
  if (APPLY && backup.length) {
    const file = path.join(__dirname, `faber-incentive-backup-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    console.log("backup:", file);
  }
  const names = await db.collection("invoices").distinct("salesExecutive");
  console.log("DISTINCT salesExecutive:", JSON.stringify(names));
  const users = await db.collection("users").find({}).project({ name: 1, role: 1 }).toArray();
  console.log("USERS:", JSON.stringify(users.map((u) => `${u.name} (${u.role})`)));
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
