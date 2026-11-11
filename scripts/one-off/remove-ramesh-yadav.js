// Remove the built-in demo staff "Ramesh Yadav (Godown Incharge)" (warehouse@valueplus.in) from the users list.
// He is a sample account that came with the app, not a real staff member. Nothing else refers to him (the script shows how
// many records mention his name; it refuses to delete if he has attendance or salary records).
//   node scripts/one-off/remove-ramesh-yadav.js          -> dry run
//   node scripts/one-off/remove-ramesh-yadav.js --apply  -> saves his record to a JSON file, then deletes only that user
const path = require("path");
const fs = require("fs");
const root = path.resolve(__dirname, "../..");
const mongoose = require(path.join(root, "node_modules/mongoose"));
const uri = process.env.MONGODB_URI || fs.readFileSync(path.join(root, "lib/db.ts"), "utf8").match(/"(mongodb\+srv:\/\/[^"]+)"/)[1];
const APPLY = process.argv.includes("--apply");
const EMAILS = ["warehouse@valueplus.in", "driver@valueplus.in"];

(async () => {
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || "valueplus" });
  const db = mongoose.connection.db;
  const users = await db.collection("users").find({ email: { $in: EMAILS }, name: /^Ramesh Yadav/i }).toArray();
  console.log(APPLY ? "APPLYING" : "DRY RUN", `- ${users.length} demo user(s) named Ramesh Yadav`);
  if (users.length === 0) return mongoose.disconnect();
  const name = /ramesh yadav/i;
  const counts = {
    attendances: await db.collection("attendances").countDocuments({ staffName: name }),
    salaries: await db.collection("salaries").countDocuments({ employeeName: name }),
    leaveRequests: await db.collection("leaverequests").countDocuments({ staffName: name }),
    tasks: await db.collection("stafftasks").countDocuments({ assignedStaff: name }).catch(() => 0),
    billsAsDriver: await db.collection("invoices").countDocuments({ driverName: name }),
  };
  console.log("records that mention the name:", counts);
  users.forEach((u) => console.log(" user:", u.name, `<${u.email}>`, u.role, u.status));
  if (counts.attendances > 0 || counts.salaries > 0) throw new Error("he has attendance or salary records; not deleting");
  if (!APPLY) return mongoose.disconnect();
  const backup = path.join(__dirname, `ramesh-yadav-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(users, null, 1));
  console.log("backup written:", backup);
  const r = await db.collection("users").deleteMany({ _id: { $in: users.map((u) => u._id) } });
  console.log("deleted users:", r.deletedCount);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
