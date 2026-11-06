// Estimates that show "Billed" although no bill was ever made from them.
// An old bug marked every new estimate as converted to itself the moment it was saved (its own saved quotation, type
// "proforma", matched the estimate by phone number): convertedInvoiceNumber equals the estimate's own number.
// This puts such an estimate back to "Sent" (so Make Bill is available again) ONLY when the customer has no real bill
// (not a proforma / credit note) made after the estimate. Others are listed and left alone.
//   node scripts/one-off/fix-estimate-billed-flag.js          -> dry run
//   node scripts/one-off/fix-estimate-billed-flag.js --apply  -> backs the estimates up to a JSON file, then changes only
//        estimates.status (to "Sent") and removes estimates.convertedInvoiceNumber
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
const uri = process.env.MONGODB_URI || fs.readFileSync(path.join(root, "lib/db.ts"), "utf8").match(/"(mongodb\+srv:\/\/[^"]+)"/)[1];
const APPLY = process.argv.includes("--apply");
// Optional: only these estimates, e.g.  --only=EST-2026-0003-1921,EST-2026-0002-7984
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", "").split(",").filter(Boolean);

(async () => {
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || "valueplus" });
  const db = mongoose.connection.db;
  const ests = await db.collection("estimates").find({ status: "Converted" }).toArray();
  const suspects = ests.filter((e) => e.convertedInvoiceNumber === e.estimateNumber && (!only.length || only.includes(e.estimateNumber)));
  console.log(APPLY ? "APPLYING" : "DRY RUN", `- ${suspects.length} estimate(s) marked Billed to themselves`);
  const fix = [];
  for (const e of suspects) {
    const phone = String(e.customerPhone || "").replace(/\D/g, "").slice(-10);
    const later = phone
      ? await db.collection("invoices").find({ customerPhone: new RegExp(phone + "$"), type: { $nin: ["proforma", "credit-note"] }, createdAt: { $gte: e.createdAt } }).project({ invoiceNumber: 1, total: 1 }).toArray()
      : [];
    if (later.length === 0) {
      console.log(`FIX    ${e.estimateNumber} ${e.customerName}: no real bill after it -> status Sent`);
      fix.push(e);
    } else {
      console.log(`LEAVE  ${e.estimateNumber} ${e.customerName}: the customer has bill(s) after it: ${later.map((b) => `${b.invoiceNumber} ₹${b.total}`).join(", ")} (check by hand whether it was billed from this estimate)`);
    }
  }
  if (!APPLY || fix.length === 0) return mongoose.disconnect();
  const backup = path.join(__dirname, `estimate-billed-flag-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(fix, null, 1));
  console.log("backup written:", backup);
  for (const e of fix) {
    await db.collection("estimates").updateOne({ _id: e._id }, { $set: { status: "Sent" }, $unset: { convertedInvoiceNumber: "" } });
  }
  console.log("done");
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
