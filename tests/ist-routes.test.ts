/**
 * Dates the server stamps on its own ("today") are India dates, even on a UTC machine just after midnight IST.
 *
 * The process runs in UTC (as on Cloudflare) and the clock is frozen at instants where the UTC date is still the day
 * before (see tests/helpers/fixed-clock.ts). Covers the money / record dates from docs/IST_AUDIT.md:
 *   #1  the receipt written when a due is cleared (PUT /api/invoices, action "clear-due")
 *   #4  the salary payment date (PUT /api/staff/salary)
 *   #10 the pending day-close (GET /api/day-close and lib/day-close-pending.ts, which must agree)
 *
 *   node tests/run-tests.mjs ist-routes
 */
process.env.TZ = "UTC";
import { setNow } from "./helpers/fixed-clock";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo, dropDatabase } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import Invoice from "@/models/Invoice";
import PaymentTransaction from "@/models/PaymentTransaction";
import Salary from "@/models/Salary";
import DayClose from "@/models/DayClose";
import { PUT as invoicesPUT } from "@/app/api/invoices/route";
import { PUT as salaryPUT } from "@/app/api/staff/salary/route";
import { GET as dayCloseGET } from "@/app/api/day-close/route";
import { getPendingDayCloseDate } from "@/lib/day-close-pending";

const jsonRequest = (url: string, method: string, body: any) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function clearDue() {
  console.log("\n#1 clear-due receipt date");
  // 00:15 IST on 14 Nov (18:45 UTC on the 13th).
  setNow("2026-11-13T18:45:00Z");
  await Invoice.create({
    invoiceNumber: "INV-IST-1",
    type: "tax-invoice",
    customerId: new mongoose.Types.ObjectId().toHexString(),
    customerName: "Ravi",
    date: "2026-11-10",
    dueDate: "2026-11-20",
    items: [],
    subtotal: 1000,
    taxableAmount: 1000,
    totalGST: 0,
    total: 1000,
    paidAmount: 0,
    balanceAmount: 1000,
    status: "pending",
  });
  const res = await invoicesPUT(
    jsonRequest("http://localhost/api/invoices", "PUT", { invoiceNumber: "INV-IST-1", action: "clear-due", dueClearedMode: "Cash" })
  );
  const body: any = await res.json();
  check(res.status === 200 && body.success, `clear-due succeeded (${res.status} ${body.error || ""})`);
  const receipt: any = await PaymentTransaction.findOne({ referenceId: "INV-IST-1" }).lean();
  check(receipt?.date === "2026-11-14", `receipt dated 14 Nov in India, not 13 Nov (got ${receipt?.date})`);
  check(receipt?.amount === 1000 && receipt?.paymentMode === "Cash", "receipt amount and mode unchanged");
}

async function salary() {
  console.log("\n#4 salary payment date");
  // 00:30 IST on 1 Dec (19:00 UTC on 30 Nov): a salary paid now belongs to December.
  setNow("2026-11-30T19:00:00Z");
  const s = await Salary.create({
    employeeName: "Amit",
    employeeId: "EMP-1",
    monthlySalary: 20000,
    payableAmount: 20000,
    month: "November",
    year: 2026,
  });
  const res = await salaryPUT(
    jsonRequest("http://localhost/api/staff/salary", "PUT", { id: String(s._id), paymentAmount: 20000, paymentMode: "Cash" })
  );
  const body: any = await res.json();
  check(res.status === 200 && body.success, `salary payment succeeded (${res.status} ${body.error || ""})`);
  const saved: any = await Salary.findById(s._id).lean();
  check(saved.paymentDate === "2026-12-01", `paymentDate 1 Dec, not 30 Nov (got ${saved.paymentDate})`);
  const last = saved.history[saved.history.length - 1];
  check(last?.date === "2026-12-01", `history entry dated 1 Dec (got ${last?.date})`);
  check(saved.paymentStatus === "Paid" && saved.paymentMode === "Cash", "status and mode unchanged");
}

async function dayClose() {
  console.log("\n#10 pending day-close");
  const closed = (date: string) => ({
    date,
    systemExpectedCash: 0,
    countedCash: 0,
    denominations: [],
    difference: 0,
    closedBy: "Cashier",
    closedAt: `${date}T22:00:00+05:30`,
  });
  await DayClose.create(closed("2026-11-12"));

  // 00:15 IST on 14 Nov: the 13th has just ended and is not closed, so it is pending. (In UTC it is still the 13th,
  // which made "yesterday" the 12th — already closed — so nothing was pending until 05:30 IST.)
  setNow("2026-11-13T18:45:00Z");
  const lib = await getPendingDayCloseDate();
  const res = await dayCloseGET(new Request("http://localhost/api/day-close"));
  const body: any = await res.json();
  check(lib === "2026-11-13", `lib/day-close-pending: 13 Nov pending (got ${lib})`);
  check(body?.data?.pendingDate === "2026-11-13", `GET /api/day-close: 13 Nov pending (got ${body?.data?.pendingDate})`);
  check(lib === body?.data?.pendingDate, "route and lib agree");

  // Later the same India evening (23:00 IST on the 13th): the 13th is today, so nothing is pending yet.
  setNow("2026-11-13T23:00:00+05:30");
  const lib2 = await getPendingDayCloseDate();
  const body2: any = await (await dayCloseGET(new Request("http://localhost/api/day-close"))).json();
  check(lib2 === null && body2?.data?.pendingDate === null, `23:00 IST on the 13th: nothing pending (lib ${lib2}, route ${body2?.data?.pendingDate})`);
}

async function main() {
  check(new Date(2026, 0, 1).getTimezoneOffset() === 0, "process really runs in UTC");
  await startMemoryMongo();
  await clearDue();
  await dropDatabase();
  await salary();
  await dropDatabase();
  await dayClose();
  await stopMemoryMongo();
  return summary("ist-routes");
}

main().then(
  (failures) => process.exit(failures ? 1 : 0),
  async (e) => {
    console.error(e);
    await stopMemoryMongo().catch(() => {});
    process.exit(1);
  }
);
