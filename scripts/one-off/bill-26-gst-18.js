// Re-state bill SVAK2026RI00026 (LG 65UA83006LA TV) at 18% GST instead of 28%.
// The bill total (₹61,500, GST inclusive), payment and finance stay the same;
// only the split between taxable value and GST changes.
//   node scripts/one-off/bill-26-gst-18.js          → dry run
//   node scripts/one-off/bill-26-gst-18.js --apply  → backup, then update
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")])
);
const APPLY = process.argv.includes("--apply");
const r2 = (n) => Math.round(n * 100) / 100;

(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB || undefined });
  const db = mongoose.connection.db;
  const col = db.collection("invoices");
  const inv = await col.findOne({ invoiceNumber: "SVAK2026RI00026" });
  if (!inv) throw new Error("bill not found");
  if (inv.items.length !== 1 || inv.items[0].gstRate !== 28) throw new Error("bill is not the expected single 28% line — stopped");

  const total = Number(inv.total); // 61500, GST inclusive
  const taxable = r2(total / 1.18);
  const half = r2((total - taxable) / 2);
  const gst = r2(half * 2);
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"}: ${inv.invoiceNumber} total ₹${total} → taxable ₹${taxable}, CGST ₹${half}, SGST ₹${half} (was taxable ₹${inv.taxableAmount}, GST ₹${inv.totalGST})`);
  if (!APPLY) return mongoose.disconnect();

  const backup = path.join(__dirname, `bill-26-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(inv, null, 1));
  await col.updateOne(
    { _id: inv._id, "items.0.gstRate": 28 },
    {
      $set: {
        "items.0.gstRate": 18,
        "items.0.taxableAmount": taxable,
        "items.0.cgst": half,
        "items.0.sgst": half,
        "items.0.igst": 0,
        taxableAmount: taxable,
        cgst: half,
        sgst: half,
        igst: 0,
        totalGST: gst,
        lastModifiedReason: "gst-corrected",
      },
    }
  );
  await db.collection("audit_logs").insertOne({
    action: "invoice.gst.corrected",
    entityType: "Invoice",
    entityRef: inv.invoiceNumber,
    entityId: String(inv._id),
    partyName: inv.customerName,
    amount: total,
    reason: `GST changed from 28% to 18% (total ₹${total} unchanged; taxable ₹${inv.taxableAmount} → ₹${taxable}, GST ₹${inv.totalGST} → ₹${gst})`,
    performedBy: "Claude (on request)",
    metadata: { backupFile: path.basename(backup) },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log("done · backup:", backup);
  await mongoose.disconnect();
})().catch((e) => { console.log("STOPPED:", e.message); process.exit(1); });
