// Fix the advance of estimate EST-2026-0003-1921 (Ankita Dwivedi) after the old estimate edit damaged it:
//   1. the estimate / its saved quotation lost the Rs 20,000 UPI advance (paid reset to 0)  -> restored
//   2. the advance was entered a second time (ADV-2026-0008, same Rs 20,000)               -> cancelled (kept, status Cancelled)
//   3. the customer's advance balance counted both (Rs 40,000)                              -> back to Rs 20,000
// The real advance is ADV-2026-0007 (UPI, 06 Nov 21:55) with payment transaction TXN-1793982336632-667.
//   node scripts/one-off/restore-estimate-advance.js          -> dry run: shows what would change
//   node scripts/one-off/restore-estimate-advance.js --apply  -> backs every record up to a JSON file, then changes only:
//        estimates.advanceAmount / advanceMode
//        invoices (proforma).paidAmount / balanceAmount / paymentMode
//        customer_advances ADV-2026-0008: status, remainingBalance, notes
//        customers.advanceBalance
//        audit_logs: one "advance.cancel" entry
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
// The same connection string the app uses (lib/db.ts reads MONGODB_URI, else its built-in one).
const uri = process.env.MONGODB_URI || fs.readFileSync(path.join(root, "lib/db.ts"), "utf8").match(/"(mongodb\+srv:\/\/[^"]+)"/)[1];
const NO = "EST-2026-0003-1921";
const KEEP = "ADV-2026-0007";
const EXTRA = "ADV-2026-0008";
const ADVANCE = 20000;
const APPLY = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || "valueplus" });
  const db = mongoose.connection.db;
  const est = await db.collection("estimates").findOne({ estimateNumber: NO });
  const quote = await db.collection("invoices").findOne({ invoiceNumber: NO, type: "proforma" });
  const keep = await db.collection("customer_advances").findOne({ receiptNumber: KEEP });
  const extra = await db.collection("customer_advances").findOne({ receiptNumber: EXTRA });
  if (!est || !quote || !keep || !extra) throw new Error("estimate, quotation or an advance receipt not found");
  if (keep.amount !== ADVANCE || extra.amount !== ADVANCE || keep.customerPhone !== extra.customerPhone) throw new Error("the two advances are not the same ₹20,000 of one customer; stopping");
  if (extra.status !== "Available" || (extra.usedAmount || 0) > 0) throw new Error(`${EXTRA} is already ${extra.status}/used; nothing to cancel`);
  const cust = await db.collection("customers").findOne({ phone: extra.customerPhone });
  if (!cust) throw new Error("customer not found");

  const estSet = { advanceAmount: ADVANCE, advanceMode: "UPI" };
  const quoteSet = { paidAmount: ADVANCE, balanceAmount: Math.max(0, Number(quote.total) - ADVANCE), paymentMode: "UPI" };
  const today = new Date().toISOString().split("T")[0];
  const extraSet = {
    status: "Cancelled",
    remainingBalance: 0,
    notes: `${extra.notes ? extra.notes + " | " : ""}CANCELLED on ${today}: entered a second time by mistake while editing the estimate; the real advance is ${KEEP}`,
  };
  const custSet = { advanceBalance: Math.max(0, (cust.advanceBalance || 0) - ADVANCE) };

  console.log(APPLY ? "APPLYING" : "DRY RUN");
  console.log("estimate     :", { advanceAmount: est.advanceAmount, advanceMode: est.advanceMode }, "->", estSet);
  console.log("quotation    :", { paidAmount: quote.paidAmount, balanceAmount: quote.balanceAmount, paymentMode: quote.paymentMode }, "->", quoteSet);
  console.log(`${EXTRA}     :`, { status: extra.status, remainingBalance: extra.remainingBalance }, "->", { status: extraSet.status, remainingBalance: 0 });
  console.log("customer     :", { advanceBalance: cust.advanceBalance }, "->", custSet);
  if (!APPLY) return mongoose.disconnect();

  const backup = path.join(__dirname, `estimate-advance-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify({ estimate: est, quotation: quote, advanceKept: keep, advanceCancelled: extra, customer: cust }, null, 1));
  console.log("backup written:", backup);
  await db.collection("estimates").updateOne({ _id: est._id }, { $set: estSet });
  await db.collection("invoices").updateOne({ _id: quote._id }, { $set: quoteSet });
  await db.collection("customer_advances").updateOne({ _id: extra._id }, { $set: extraSet });
  await db.collection("customers").updateOne({ _id: cust._id }, { $set: custSet });
  await db.collection("audit_logs").insertOne({
    action: "advance.cancel",
    entityType: "CustomerAdvance",
    entityRef: EXTRA,
    entityId: String(extra._id),
    partyName: extra.customerName,
    amount: ADVANCE,
    reason: `Entered a second time by mistake while editing estimate ${NO}; the real advance is ${KEEP}. Cancelled at the Admin's request (script scripts/one-off/restore-estimate-advance.js).`,
    performedBy: "Admin (via script)",
    performedByRole: "admin",
    pinVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log("done");
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
