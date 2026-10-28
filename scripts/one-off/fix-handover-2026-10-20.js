// Correct the 20 Oct 2026 21:22 cash handover by Ansh Gaur: it was saved as
// ₹1,67,500 (the register wrongly showed every cash bill ever as "today's
// cash"); the cash actually received between the 18 Oct 12:37 handover and
// this one was ₹57,810.
//   node scripts/one-off/fix-handover-2026-10-20.js          → dry run
//   node scripts/one-off/fix-handover-2026-10-20.js --apply  → backup, then fix
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")])
);
const APPLY = process.argv.includes("--apply");
const FROM = 167500;
const TO = 57810;

(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB || undefined });
  const db = mongoose.connection.db;
  const col = db.collection("cash_transactions");
  const list = await col.find({ category: "MD_HANDOVER", date: "2026-10-20", time: "21:22", amount: FROM }).toArray();
  if (list.length !== 1) throw new Error(`expected exactly one matching handover, found ${list.length}`);
  const entry = list[0];
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"}: handover ${entry.referenceNo} by ${entry.recordedBy}, 20 Oct 21:22, ₹${FROM} → ₹${TO}`);
  if (!APPLY) return mongoose.disconnect();

  const backup = path.join(__dirname, `handover-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(entry, null, 1));
  await col.updateOne(
    { _id: entry._id, amount: FROM },
    {
      $set: {
        amount: TO,
        description: `${entry.description || "Cash handover to Admin"} (corrected from ₹1,67,500: cash received 18 Oct 12:37 – 20 Oct 21:22)`,
      },
    }
  );
  await db.collection("audit_logs").insertOne({
    action: "cash.handover.corrected",
    entityType: "CashTransaction",
    entityRef: entry.referenceNo,
    amount: TO,
    reason: `Handover of 20 Oct 21:22 corrected from ₹${FROM} to ₹${TO}: the register had counted every cash bill ever as today's cash.`,
    performedBy: "Claude (on request)",
    metadata: { backupFile: path.basename(backup), from: FROM, to: TO },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log("done · backup:", backup);
  await mongoose.disconnect();
})().catch((e) => { console.log("STOPPED:", e.message); process.exit(1); });
