// Temporary test of back-dating during invoice edit (STAGING only). Deleted after the run.
const { MongoClient } = require("mongodb");
const fs = require("fs");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const B = "https://valueplus-erp-staging.shineinfosolutions1.workers.dev";
const results = [];
const check = (n, c, x = "") => results.push(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`);

function session() {
  let cookie = "";
  const keep = (res) => { for (const c of res.headers.getSetCookie()) { const kv = c.split(";")[0]; const k = kv.split("=")[0]; cookie = cookie.split("; ").filter((x) => x && !x.startsWith(k + "=")).concat(kv).join("; "); } };
  return {
    async login(email, password) {
      const r1 = await fetch(B + "/api/auth/csrf", { headers: { cookie } }); keep(r1); const csrf = (await r1.json()).csrfToken;
      const r2 = await fetch(B + "/api/auth/callback/credentials", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", cookie }, body: new URLSearchParams({ csrfToken: csrf, email, password, json: "true" }), redirect: "manual" }); keep(r2);
      const r3 = await fetch(B + "/api/auth/session", { headers: { cookie } }); return (await r3.json())?.user?.role;
    },
    async put(body) { const r = await fetch(B + "/api/invoices", { method: "PUT", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) }); return r.json(); },
  };
}

(async () => {
  const c = new MongoClient(env.MONGODB_URI); await c.connect();
  const st = c.db("valueplus_staging"), prod = c.db("valueplus");
  const liveBefore = await prod.collection("invoices").findOne({ invoiceNumber: "SVAK2026RI00051" });
  // staging-only setup: manager may edit invoices
  await st.collection("role_permissions").updateOne({ role: "manager" }, { $addToSet: { permissions: "invoice.edit" } });
  await st.collection("users").updateMany({ email: { $in: ["admin", "storeincharge@valueplus.in"] } }, { $unset: { securityPin: "" } });

  const NO = "SVAK2026RI00051";
  const bill = await st.collection("invoices").findOne({ invoiceNumber: NO });
  const payload = (date) => ({ customerId: bill.customerId, customerName: bill.customerName, customerPhone: bill.customerPhone, date, dueDate: date,
    items: bill.items.map(({ _id, ...it }) => it), total: bill.total, subtotal: bill.subtotal, taxableAmount: bill.taxableAmount, totalGST: bill.totalGST, cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst, paidAmount: bill.total - bill.advanceAdjusted, paymentMode: "Cash" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  const admin = session();
  check("admin login", (await admin.login("admin", "123456")) === "admin");
  let r = await admin.put({ action: "full-edit", invoiceNumber: NO, pin: "1234", reason: "date test", invoice: payload("2026-12-31") });
  check("future date refused", !r.success, r.error);
  r = await admin.put({ action: "full-edit", invoiceNumber: NO, pin: "1234", reason: "date test", invoice: payload("2026-10-20") });
  let d = await st.collection("invoices").findOne({ invoiceNumber: NO });
  const tx = await st.collection("payment_transactions").findOne({ referenceId: NO, notes: /^Initial payment/ });
  check("admin back-date to 2026-10-20", r.success && d.date === "2026-10-20" && d.backdateStatus === "approved" && d.backdateMadeOn === today, `${r.error || ""} ${d.date} ${d.backdateStatus} ${d.backdateMadeOn}`);
  check("receipt date follows the bill", tx?.date === "2026-10-20", tx?.date);
  check("money unchanged by date edit", d.total === bill.total && d.paidAmount === bill.paidAmount && d.balanceAmount === bill.balanceAmount, `${d.total}/${d.paidAmount}/${d.balanceAmount}`);

  const mgr = session();
  check("manager login", (await mgr.login("storeincharge@valueplus.in", "store123")) === "manager");
  r = await mgr.put({ action: "full-edit", invoiceNumber: NO, pin: "1234", reason: "date test mgr", invoice: payload("2026-10-18") });
  d = await st.collection("invoices").findOne({ invoiceNumber: NO });
  const appr = await st.collection("store_activity_approvals").findOne({ "payload.invoiceNumber": NO, status: "pending" }) || await st.collection("storeactivityapprovals").findOne({ "payload.invoiceNumber": NO, status: "pending" });
  check("manager back-date goes to approval", r.success && d.date === "2026-10-18" && d.backdateStatus === "pending" && d.backdateRequestedBy, `${r.error || ""} ${d.date} ${d.backdateStatus} ${d.backdateRequestedBy}`);
  check("approval request created (reject would restore 2026-10-20)", appr && appr.payload.madeOn === "2026-10-20", appr ? JSON.stringify(appr.payload) : "none");

  r = await admin.put({ action: "full-edit", invoiceNumber: NO, pin: "1234", reason: "date back to today", invoice: payload(today) });
  d = await st.collection("invoices").findOne({ invoiceNumber: NO });
  check("date back to today clears back-date flags", r.success && d.date === today && d.backdateStatus === "", `${r.error || ""} ${d.date} '${d.backdateStatus}'`);

  const liveAfter = await prod.collection("invoices").findOne({ invoiceNumber: NO });
  check("LIVE bill untouched", liveAfter.date === liveBefore.date && liveAfter.total === liveBefore.total && String(liveAfter.updatedAt) === String(liveBefore.updatedAt));
  console.log(results.join("\n"));
  await c.close();
})().catch((e) => { console.log(results.join("\n")); console.error(e); process.exit(1); });
