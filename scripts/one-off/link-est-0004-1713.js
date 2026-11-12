// The salesman's bill EST-2026-0004-1713 (DILBAG RAJ, Rs 3,500, Amit Singh) stayed "pending" because the cashier made
// its invoice SVAK2026RI00147 without "Make Bill", so the two were never linked and the "New bill from a salesman"
// pop-up kept coming. This marks the bill as invoiced under SVAK2026RI00147, as "Make Bill" would have.
//   node scripts/one-off/link-est-0004-1713.js          -> dry run
//   node scripts/one-off/link-est-0004-1713.js --apply  -> backs the estimate up to a JSON file, then sets status
//        "Converted", convertedInvoiceNumber, approvalStatus "approved" (+ approvedBy/At), dealAmount, dealSalesperson
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
const uri = process.env.MONGODB_URI || fs.readFileSync(path.join(root, "lib/db.ts"), "utf8").match(/"(mongodb\+srv:\/\/[^"]+)"/)[1];
const APPLY = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || "valueplus" });
  const db = mongoose.connection.db;
  const est = await db.collection("estimates").findOne({ estimateNumber: "EST-2026-0004-1713" });
  const inv = await db.collection("invoices").findOne({ invoiceNumber: "SVAK2026RI00147" });
  if (!est || !inv) throw new Error("estimate or invoice not found");
  const samePhone = String(est.customerPhone).slice(-10) === String(inv.customerPhone).slice(-10);
  const sameTotal = Math.abs(Number(est.total) - Number(inv.total)) <= 1;
  console.log(APPLY ? "APPLYING" : "DRY RUN", { estStatus: est.status, estApproval: est.approvalStatus, converted: est.convertedInvoiceNumber, samePhone, sameTotal });
  if (!samePhone || !sameTotal) throw new Error("phone or total differ; not touching it");
  if (est.status === "Converted") { console.log("already converted"); await mongoose.disconnect(); return; }
  if (APPLY) {
    const file = path.join(__dirname, `link-est-0004-1713-backup-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(est, null, 2));
    await db.collection("estimates").updateOne(
      { _id: est._id },
      { $set: { status: "Converted", convertedInvoiceNumber: inv.invoiceNumber, approvalStatus: "approved", approvedBy: "Matched to invoice " + inv.invoiceNumber, approvedAt: new Date(), dealAmount: Number(est.total) || Number(inv.total) || 0, dealSalesperson: est.salesperson || est.salesExecutive } }
    );
    console.log("done; backup:", file);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
