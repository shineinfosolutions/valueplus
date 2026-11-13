/**
 * Stage B2 wiring of the STOCK / PURCHASE / CASH and STAFF / SYSTEM reads: the routes and helpers now read through
 * the switches `read:stock` and `read:staff` (lib/repo/stock/shadow-read.ts, lib/repo/staff/shadow-read.ts).
 *
 * MongoDB (in memory) is seeded with realistic data for both areas, the copy job (lib/d1/sync.ts) copies it into a
 * local D1, and the flag rows read:stock / read:staff are written by this test. Then, for a representative set of
 * routes and helpers, each is called in 'mongo', 'shadow' and 'd1' mode and:
 *  - the three answers are identical (canonical JSON: sorted keys, null = missing; the shadow answer byte for byte);
 *  - shadow mode records a MATCH for every read path the call went through;
 *  - with every D1 query failing, d1 mode answers exactly as MongoDB and records the fallbacks;
 *  - d1 mode really reads D1 (a value changed only in D1 shows through).
 * Sign-in and permissions get their own checks: the login look-up never returns another user than MongoDB, never a
 * secret field MongoDB's read does not return, never accepts a user deleted (or a password changed) on MongoDB but
 * not yet in D1, and permission overrides come out the same in every mode, D1 failing or not.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import { faulty } from "./helpers/d1-faults";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { runD1Sync } from "@/lib/d1/sync";
import { STOCK_CASH_SPECS } from "@/lib/d1/maps/stock-cash";
import { STAFF_SYSTEM_SPECS } from "@/lib/d1/maps/staff-system";
import { canonicalize, compareResults, type CompareOptions } from "@/lib/d1/compare";
import { configureReadSource, resetReadModeCache, resetReadSourceConfig } from "@/lib/d1/read-source";
import { flushShadowWork, resetShadowConfig, resetShadowSampling } from "@/lib/d1/shadow";
import { deferredContext } from "@/lib/deferred-context";
import { invalidatePermissionCache, loadPermissionOverrides } from "@/lib/requirePermission";
import { authOptions } from "@/lib/authOptions";
import { loginLookup } from "@/lib/repo/staff/login-lookup";
import { readStaff } from "@/lib/repo/staff/shadow-read";
import { STAFF_READS } from "@/lib/repo/staff";
import { getPendingDayCloseDate } from "@/lib/day-close-pending";
import { usersForAssignee } from "@/lib/notify";
import { staffNotCheckedIn } from "@/lib/attendance-alerts";
import { getShift } from "@/lib/shift-settings";
import { isUnlockPinSet } from "@/lib/priceLock";
import { istToday } from "@/lib/ist";
import User from "@/models/User";
import Attendance from "@/models/Attendance";
import LeaveRequest from "@/models/LeaveRequest";
import StaffTask from "@/models/StaffTask";
import Salary from "@/models/Salary";
import IncentivePayout from "@/models/IncentivePayout";
import ShiftSetting from "@/models/ShiftSetting";
import PushSubscription from "@/models/PushSubscription";
import RolePermission from "@/models/RolePermission";
import PriceUnlockSetting from "@/models/PriceUnlockSetting";
import AuditLog from "@/models/AuditLog";
import Item from "@/models/Item";
import Supplier from "@/models/Supplier";
import PurchaseEntry from "@/models/PurchaseEntry";
import DeletedPurchaseEntry from "@/models/DeletedPurchaseEntry";
import PurchaseOrder from "@/models/PurchaseOrder";
import Expense from "@/models/Expense";
import StockTransfer from "@/models/StockTransfer";
import StockAdjustment from "@/models/StockAdjustment";
import InventoryAudit from "@/models/InventoryAudit";
import SerialNumber from "@/models/SerialNumber";
import StockOrderRequest from "@/models/StockOrderRequest";
import Vendor from "@/models/Vendor";
import VendorBill from "@/models/VendorBill";
import VendorPayment from "@/models/VendorPayment";
import DayClose from "@/models/DayClose";
import AdminCashEntry from "@/models/AdminCashEntry";
import BankAccount from "@/models/BankAccount";
import Variant from "@/models/Variant";
import ProductCatalogReference from "@/models/ProductCatalogReference";
import { GET as purchaseEntriesGET } from "@/app/api/purchase-entries/route";
import { GET as purchaseOrdersGET } from "@/app/api/purchase-orders/route";
import { GET as expensesGET } from "@/app/api/expenses/route";
import { GET as variantsGET } from "@/app/api/variants/route";
import { GET as productReferenceGET } from "@/app/api/product-reference/route";
import { GET as adjustmentGET } from "@/app/api/inventory/adjustment/route";
import { GET as auditInventoryGET } from "@/app/api/inventory/audit/route";
import { GET as stockFlowGET } from "@/app/api/inventory/stock-flow/route";
import { GET as stockTransfersGET } from "@/app/api/stock-transfers/route";
import { GET as serialNumbersGET } from "@/app/api/serial-numbers/route";
import { GET as stockOrdersGET } from "@/app/api/stock-orders/route";
import { GET as agedStockGET } from "@/app/api/reports/aged-stock/route";
import { GET as vendorsGET } from "@/app/api/vendors/route";
import { GET as vendorBillsGET } from "@/app/api/vendors/bills/route";
import { GET as vendorPaymentsGET } from "@/app/api/vendors/payments/route";
import { GET as vendorLedgerGET } from "@/app/api/vendors/ledger/route";
import { GET as adminCashGET } from "@/app/api/admin-cash/route";
import { GET as dayCloseGET } from "@/app/api/day-close/route";
import { GET as bankAccountsGET } from "@/app/api/bank-accounts/route";
import { GET as auditGET } from "@/app/api/audit/route";
import { GET as usersGET } from "@/app/api/users/route";
import { GET as rolesGET } from "@/app/api/roles/route";
import { GET as attendanceGET } from "@/app/api/staff/attendance/route";
import { GET as presenceGET } from "@/app/api/staff/presence/route";
import { GET as leaveGET } from "@/app/api/staff/leave-requests/route";
import { GET as tasksGET } from "@/app/api/staff/tasks/route";
import { GET as salaryGET } from "@/app/api/staff/salary/route";
import { GET as overviewGET } from "@/app/api/staff/overview/route";
import { GET as memberActivityGET } from "@/app/api/staff/member-activity/route";
import { GET as myIncentiveGET } from "@/app/api/staff/my-incentive/route";
import { GET as securityPinGET } from "@/app/api/auth/security-pin/route";
import { GET as priceLockPinGET } from "@/app/api/price-lock/pin/route";

const { ObjectId } = mongoose.Types;
type Handler = (req: Request) => Promise<Response>;
type Mode = "mongo" | "shadow" | "d1";
const MODES: Mode[] = ["mongo", "shadow", "d1"];

const TODAY = istToday();
const MONTH = TODAY.slice(0, 7);
const dayOffset = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const YESTERDAY = dayOffset(-1);

// Every document gets its own creation time, so no sort has ties and MongoDB's order is fully defined.
let clock = Date.parse("2026-10-01T04:00:00.000Z");
const tick = (minutes = 7) => new Date((clock += minutes * 60000));

async function mk(Model: any, doc: any, at: Date = tick()): Promise<any> {
  const d = new Model({ createdAt: at, updatedAt: at, ...doc });
  await d.save({ timestamps: false });
  return d;
}

const ids: Record<string, string> = {};
const PASSWORDS: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed() {
  const raw = mongoose.connection.db!;
  // ── users (real bcrypt hashes, cost 4 to keep the test quick) ──
  const people: Array<[string, string, string, string, any?]> = [
    ["admin", "Shiva Rai (Super Admin)", "admin@valueplus.in", "9140860604", { securityPin: await bcrypt.hash("4321", 4), pinUpdatedAt: new Date("2026-10-02T05:00:00Z") }],
    ["manager", "Anil Verma", "store@valueplus.in", "9000000002", { pinLockedUntil: new Date(Date.now() + 3600_000), pinFailCount: 3 }],
    ["salesman", "Ravi Kumar", "ravi.kumar@valueplus.in", "9000000003", { assignedBrand: "HAIER" }],
    ["sales", "Amit Kumar Singh", "amit@valueplus.in", "9000000004", {}],
    ["cashier", "Pooja Sharma", "cashier@valueplus.in", "9000000005", { unlockPinFailCount: 2 }],
    ["warehouse", "Mohan Lal", "mohan@valueplus.in", "9000000006", {}],
    ["hr", "Kavita Joshi", "hr@valueplus.in", "9000000007", {}],
    ["salesman", "Deepak Mishra", "deepak@valueplus.in", "9000000008", { status: "inactive" }],
    // Look-alikes for the sign-in checks: "_" and "%" are wildcards in SQL LIKE, "." in a regex.
    ["salesman", "Ravi Underscore", "ravi_kumar@valueplus.in", "9000000009", {}],
    ["salesman", "Percent Person", "per%cent@valueplus.in", "9000000010", {}],
    ["salesman", "Plus Person", "a+b@valueplus.in", "9000000011", {}],
    ["accounts", "Ümit Çelik", "Ümit@ValuePlus.in", "9000000012", {}],
  ];
  for (const [role, name, email, mobile, extra] of people) {
    const pw = `pw-${email.split("@")[0]}`;
    PASSWORDS[email] = pw;
    const u = await mk(User, { name, email, role, mobile, password: await bcrypt.hash(pw, 4), ...(extra || {}) });
    ids[email] = String(u._id);
  }
  // A legacy user written raw: no status (counts as active), no __v.
  const legacy = new ObjectId();
  PASSWORDS["old.timer@valueplus.in"] = "pw-old";
  await raw.collection("users").insertOne({ _id: legacy, name: "Old Timer", email: "Old.Timer@ValuePlus.in", password: await bcrypt.hash("pw-old", 4), role: "cashier", mobile: "9000000099", createdAt: tick(), updatedAt: new Date(clock) });
  ids.legacy = String(legacy);

  const admin = ids["admin@valueplus.in"];
  const ravi = ids["ravi.kumar@valueplus.in"];
  const amit = ids["amit@valueplus.in"];
  const pooja = ids["cashier@valueplus.in"];

  // ── attendance: this month and last, today, an open away period ──
  const staff: Array<[string, string, string]> = [
    ["Ravi Kumar", ravi, "salesman"],
    ["Amit Kumar Singh", amit, "sales"],
    ["Pooja Sharma", pooja, "cashier"],
  ];
  for (const day of [dayOffset(-40), dayOffset(-3), YESTERDAY, TODAY]) {
    for (const [i, [name, uid, role]] of staff.entries()) {
      const late = i === 1;
      const doc: any = {
        staffName: name, staffId: uid, userId: uid, staffRole: role, date: day,
        checkInTime: late ? "10:42 AM" : "09:55 AM", checkOutTime: day === TODAY ? undefined : "09:00 PM",
        workingDurationMinutes: day === TODAY ? 0 : 638, isLate: late, status: late ? "Late" : "Present", lateMinutes: late ? 42 : 0,
        checkInPhotoKey: `attendance/${uid}/${day}.jpg`, checkInDistanceM: 10 + i,
      };
      if (name === "Ravi Kumar" && day === TODAY) {
        doc.awayPeriods = [
          { kind: "away", leftAt: new Date(`${day}T05:00:00Z`), backAt: new Date(`${day}T05:20:00Z`), minutes: 20, maxDistanceM: 300 },
          { kind: "away", leftAt: new Date(`${day}T06:00:00Z`), leftDistanceM: 90, maxDistanceM: 500 },
        ];
        doc.totalAwayMinutes = 20;
        doc.lastPresence = { state: "out", at: new Date(`${day}T06:00:00Z`), distanceM: 90 };
      }
      await mk(Attendance, doc);
    }
  }
  // ── leave and breaks ──
  await mk(LeaveRequest, { kind: "leave", staffName: "Ravi Kumar", staffId: ravi, staffRole: "salesman", fromDate: dayOffset(5), toDate: dayOffset(7), days: 3, reason: "Wedding", status: "pending" });
  await mk(LeaveRequest, { kind: "weekly_off", staffName: "Mohan Lal", staffId: ids["mohan@valueplus.in"], staffRole: "warehouse", fromDate: TODAY, toDate: TODAY, status: "approved" });
  await mk(LeaveRequest, { kind: "emergency", staffName: "Ravi Kumar", staffId: ravi, staffRole: "salesman", fromDate: dayOffset(-3), toDate: dayOffset(-2), days: 2, status: "cancelled" });
  await mk(LeaveRequest, { kind: "break", staffName: "Amit Kumar Singh", staffId: amit, staffRole: "sales", fromDate: TODAY, toDate: TODAY, breakMinutes: 20, status: "pending" });
  // ── tasks ──
  await mk(StaffTask, { taskTitle: "Clean the display", assignedStaff: "All Staff", dueDate: dayOffset(1), priority: "Low", createdBy: "Anil Verma", seenBy: [{ userId: ravi, name: "Ravi Kumar", at: new Date("2026-11-01T05:00:00Z") }] });
  await mk(StaffTask, { taskTitle: "Sell Haier ACs", assignedStaff: "Ravi Kumar", assignedStaffId: ravi, dueDate: dayOffset(10), taskType: "sales_target", targetQty: 5, targetAmount: 175000, createdBy: "Shiva Rai (Super Admin)" });
  await mk(StaffTask, { taskTitle: "Call back leads", assignedStaff: "  ravi kumar ", dueDate: dayOffset(2), createdBy: "Anil Verma", status: "In Progress" });
  await mk(StaffTask, { taskTitle: "Demo the TV", assignedStaff: "Sales Staff", dueDate: dayOffset(3), createdBy: "Ravi Kumar" });
  await mk(StaffTask, { taskTitle: "Count the cash", assignedStaff: "Pooja Sharma", assignedStaffId: pooja, dueDate: dayOffset(4), status: "Completed", createdBy: "Anil Verma" });
  // ── salaries, payouts ──
  const s1 = await mk(Salary, { employeeName: "Ravi Kumar", employeeId: ravi, monthlySalary: 15000, incentives: 2500, payableAmount: 17500, month: "October 2026", year: 2026 });
  s1.history.push({ date: "2026-11-05", amount: 10000, paymentMode: "Bank Transfer", txnRef: "UTR123" });
  s1.paymentStatus = "Paid";
  await s1.save({ timestamps: false });
  await mk(Salary, { employeeName: "Amit Kumar Singh", employeeId: amit, monthlySalary: 12000, payableAmount: 12000, month: "October 2026", paymentStatus: "Pending" });
  await mk(IncentivePayout, { userId: ravi, employeeName: "Ravi Kumar", amount: 1500, date: dayOffset(-5), paymentMode: "Cash", paidBy: "Shiva Rai (Super Admin)" });
  await mk(IncentivePayout, { userId: ravi, employeeName: "Ravi Kumar", amount: 700, date: dayOffset(-2), paymentMode: "UPI", paidBy: "Shiva Rai (Super Admin)" });
  // ── settings, permissions, devices, audit log ──
  await mk(ShiftSetting, { shiftName: "Showroom Shift (10:00 AM - 09:00 PM)", startTime: "10:00", endTime: "21:00", updatedBy: "Store Manager" });
  await RolePermission.findOneAndUpdate({ role: "manager" }, { role: "manager", permissions: ["audit.view", "roles.manage", "ledger.vendor.view", "ledger.supplier.view"], updatedBy: "Shiva Rai (Super Admin)" }, { new: true, upsert: true });
  await RolePermission.findOneAndUpdate({ role: "cashier" }, { role: "cashier", permissions: ["audit.view"], updatedBy: "Shiva Rai (Super Admin)" }, { new: true, upsert: true });
  await PriceUnlockSetting.findOneAndUpdate({ key: "price-unlock" }, { $set: { pinHash: await bcrypt.hash("2468", 4), updatedBy: "Shiva Rai (Super Admin)" } }, { upsert: true, setDefaultsOnInsert: true });
  for (const [i, uid] of [ravi, ravi, amit].entries()) {
    await PushSubscription.findOneAndUpdate(
      { endpoint: `https://fcm.googleapis.com/fcm/send/device-${i}` },
      { $set: { userId: uid, p256dh: `BPublicKey${i}`.padEnd(87, "A"), auth: `authsecret${i}`.padEnd(22, "B"), failCount: 0 } },
      { upsert: true, new: true }
    );
    await new Promise((r) => setTimeout(r, 5));
  }
  for (const [i, a] of [
    { action: "invoice.delete", entityType: "Invoice", entityRef: "INV-1001", partyName: "Ramesh Traders", amount: 35400, reason: "Wrong customer", performedBy: "Shiva Rai (Super Admin)", metadata: { before: { total: 35400 } } },
    { action: "approval.request", entityType: "Invoice", entityRef: "invoice:INV-1001", reason: "Edit requested", performedBy: "Anil Verma" },
    { action: "invoice.cancel", entityType: "Invoice", entityRef: "INV-1002", partyName: "50% Off Store", amount: 1200, reason: "Customer returned_goods", performedBy: "Pooja Sharma" },
  ].entries()) {
    await mk(AuditLog, a, new Date(Date.parse(`${YESTERDAY}T10:00:00Z`) + i * 3600_000));
  }

  // ── masters the stock routes join with (still read from MongoDB) ──
  const wh = new ObjectId();
  const items: any[] = [];
  for (const [i, name] of ["LG 260L Fridge", "Samsung 43\" TV", "Voltas 1.5T AC [Inverter]"].entries()) {
    items.push(await mk(Item, { code: `IT-${i}`, vpCode: `VP-${100 + i}`, name, category: "Appliance", brand: ["LG", "Samsung", "Voltas"][i], purchasePrice: 10000 + i, sellingPrice: 12000 + i, mrp: 15000, currentStock: 3 + i, stockByWarehouse: [{ warehouseId: wh, qty: 3 + i }], warehouse: "Kunraghat Showroom", hsnCode: "8418", gstRate: 18, unit: "NOS" }));
  }
  const supplier = await mk(Supplier, { code: "SUPP-001", name: "LG India Pvt Ltd", phone: "9111111111", address: { line1: "Hub", city: "Lucknow", state: "UP", pincode: "226001" } });
  ids.supplier = String(supplier._id);

  // ── purchases ──
  for (let i = 0; i < 8; i++) {
    const k = i % 3;
    await mk(PurchaseEntry, {
      billNo: i === 6 ? "DN-1" : `PB-2026-00${i}`, supplierName: i % 2 ? "LG India Pvt Ltd" : "Sharma Electronics", supplierId: i % 2 ? ids.supplier : undefined,
      type: i === 6 ? "debit-note" : "entry", billDate: dayOffset(-30 + i * 3),
      items: [{ itemId: String(items[k]._id), name: items[k].name, quantity: 1 + k, rate: 10000 + k, gstRate: 18, serialNumbers: i % 2 ? [`SN-${i}-A`, `SN-${i}-B`].slice(0, 1 + k) : [] }],
      subtotal: 10000, gst: 1800, total: 11800 + i, paid: i % 3 === 0 ? 11800 + i : 0, status: i === 5 ? "cancelled" : i % 3 === 0 ? "paid" : "pending",
    });
  }
  await mk(DeletedPurchaseEntry, { billNo: "PB-DEL-1", supplierName: "LG India Pvt Ltd", total: 5000, deletedAt: new Date(`${YESTERDAY}T09:00:00Z`), deletedBy: "Admin", deleteReason: "Duplicate", snapshot: { billNo: "PB-DEL-1" } });
  await mk(PurchaseOrder, { poNo: "PO-1", supplierName: "LG India Pvt Ltd", totalAmount: 42000, status: "sent", items: [{ itemId: String(items[0]._id), name: items[0].name, quantity: 2, rate: 21000, gstRate: 18 }] });
  for (let i = 0; i < 4; i++) await mk(Expense, { expenseNo: `EXP-${i}`, category: "Tea", description: `Expense ${i}`, amount: 100 + i, date: dayOffset(-i), paymentMode: i % 2 ? "UPI" : "Cash" });
  await mk(Variant, { name: "Colour", values: ["Red", "Blue"] });
  await mk(ProductCatalogReference, { vpCode: "VP-100", productName: "LG 260L Fridge", groupName: "LG", category: "Refrigerator", brand: "LG" });

  // ── stock ──
  await mk(StockTransfer, { transferNo: "ST-1", fromWarehouse: "Kunraghat Showroom", toWarehouse: "Godown 2", items: [{ itemId: String(items[0]._id), itemName: items[0].name, quantity: 1 }], date: dayOffset(-4), status: "received" });
  await mk(StockTransfer, { transferNo: "ST-2", fromWarehouse: "Godown 2", toWarehouse: "Kunraghat Showroom", items: [{ itemId: String(items[1]._id), itemName: items[1].name, quantity: 2 }], date: dayOffset(-1) });
  await mk(StockAdjustment, { adjustmentNo: "ADJ-1", date: dayOffset(-2), reason: "Damaged", items: [{ itemId: String(items[2]._id), itemName: items[2].name, quantity: 1, type: "out" }] });
  const lines = (n: number) => Array.from({ length: n }, (_, j) => ({ productId: String(items[j % 3]._id), productName: `${items[j % 3].name} #${j}`, expectedStock: j % 4, counted: j % 2 === 0, countedBy: j % 2 === 0 ? "Ravi" : "" }));
  const todaysAudit = await mk(InventoryAudit, { auditDate: TODAY, auditor: "Ravi", items: lines(25), status: "In Progress", kind: "all", totalExpected: 30 });
  ids.audit = String(todaysAudit._id);
  await mk(InventoryAudit, { auditDate: YESTERDAY, auditor: "Sita", items: lines(6), status: "Completed", kind: "mobile" });
  for (let i = 0; i < 5; i++) {
    await mk(SerialNumber, { serialNumber: `SER-${i}`, itemId: String(items[i % 3]._id), vpCode: `VP-${100 + (i % 3)}`, itemName: items[i % 3].name, status: i === 4 ? "SOLD" : "AVAILABLE", history: [{ action: "Inward", date: new Date("2026-10-05T06:00:00Z"), performedBy: "Purchase Inward" }] });
  }
  await mk(StockOrderRequest, { requestNumber: "GO-1", status: "pending", salesperson: "Ravi Kumar", salespersonId: ravi, items: [{ itemCode: "IC-1", description: "LG AC", brand: "LG", quantity: 2 }], totalQuantity: 2 });
  await mk(StockOrderRequest, { requestNumber: "GO-2", status: "approved", salesperson: "Amit Kumar Singh", salespersonId: amit, items: [{ itemCode: "IC-2", description: "TV", brand: "Samsung", quantity: 1 }], totalQuantity: 1 });

  // ── vendors ──
  const vendors: any[] = [];
  for (let i = 0; i < 2; i++) vendors.push(await mk(Vendor, { code: `VEN-000${i + 1}`, name: ["Ram Traders", "Shyam Distributors"][i], phone: `90000001${i}0`, openingBalance: i * 1000, openingBalanceDate: i ? "2026-04-01" : "", address: { line1: `Shop ${i}`, city: "Gorakhpur" } }));
  ids.vendor = String(vendors[0]._id);
  for (let i = 0; i < 4; i++) {
    await mk(VendorBill, { billNo: `VB-${i}`, vendorId: String(vendors[i % 2]._id), vendorName: vendors[i % 2].name, date: dayOffset(-20 + i), dueDate: dayOffset(-5 + i), items: [{ name: "Installation", quantity: 2, rate: 500, amount: 1000 }], subtotal: 1000, gstAmount: 180, total: 1180 + i, status: i === 3 ? "cancelled" : "open" });
    await mk(VendorPayment, { paymentId: `VP-PAY-${i}`, vendorId: String(vendors[i % 2]._id), vendorName: vendors[i % 2].name, date: dayOffset(-15 + i), amount: 500 + i, mode: i % 2 ? "UPI" : "Cash", againstBillNo: i === 0 ? "VB-0" : "", type: i === 2 ? "paid" : "received" });
  }

  // ── cash ──
  await mk(DayClose, { date: dayOffset(-3), systemExpectedCash: 1000, countedCash: 1000, difference: 0, closedBy: "Ravi", closedAt: `${dayOffset(-3)}T21:00:00+05:30`, denominations: [{ value: 500, count: 2 }] });
  await mk(DayClose, { date: dayOffset(-2), systemExpectedCash: 2000, countedCash: 1900, difference: -100, closedBy: "Pooja", closedAt: `${dayOffset(-2)}T21:00:00+05:30` });
  await mk(AdminCashEntry, { type: "OPENING", amount: 5000, date: dayOffset(-10), recordedBy: "Admin" });
  await mk(AdminCashEntry, { type: "DEPOSIT", amount: 2000, date: dayOffset(-5), time: "11:00", bankAccount: "SBI", recordedBy: "Admin" });
  for (const [i, b] of [["SBI Current", "State Bank of India", "SBIN0001849"], ["HDFC Savings", "HDFC Bank", "HDFC0000492"]].entries()) {
    await mk(BankAccount, { name: b[0], bank: b[1], number: `10000${i}`, ifsc: b[2], branch: "Gorakhpur", type: i ? "savings" : "current", balance: 1000 * i });
  }
}

// ---------------------------------------------------------------------------
// Modes and calls
// ---------------------------------------------------------------------------

async function setModes(db: D1DatabaseLike, mode: Mode) {
  await db.prepare("UPDATE feature_flags SET value = ? WHERE key IN ('read:stock', 'read:staff')").bind(mode).run();
  resetReadModeCache();
  // The permission overrides are cached for 30 s per isolate: each call must read them in the mode under test.
  invalidatePermissionCache();
}

function actor(email: string, role: string, name: string) {
  return { id: ids[email], name, email, role, permissions: [] as any[] };
}

let ACTORS: Record<string, ReturnType<typeof actor>> = {};

async function call(handler: Handler, url: string, who?: string): Promise<{ status: number; text: string }> {
  const run = () => handler(new Request(url));
  const res = who ? await deferredContext.run({ approver: ACTORS[who] as any }, run) : await run();
  return { status: res.status, text: await res.text() };
}

const canon = (v: any) => JSON.stringify(canonicalize(v) ?? null);

interface Case {
  label: string;
  /** The read paths the call goes through, as "<area>/<name>" (shadow must record a match for each). */
  reads: string[];
  /**
   * Only for answers whose ORDER is not defined (a find() without sort decides who is notified / reminded, in
   * MongoDB's natural order): compared as a set, with the same rule the live shadow comparison uses.
   */
  compare?: CompareOptions;
  run: () => Promise<any>;
}

const route = (label: string, reads: string[], handler: unknown, url: string, who?: string): Case => ({
  label,
  reads,
  run: async () => {
    const r = await call(handler as Handler, url, who);
    return { status: r.status, body: JSON.parse(r.text) };
  },
});

const helper = (label: string, reads: string[], fn: () => Promise<any>, compare?: CompareOptions): Case => ({ label, reads, run: fn, compare });
const ANY_ORDER: CompareOptions = { unorderedPaths: [""] };

async function shadowRows(db: D1DatabaseLike): Promise<any[]> {
  return ((await db.prepare("SELECT area, name, kind, match, diffs, error FROM shadow_results ORDER BY id").all()).results || []) as any[];
}

async function threeModes(db: D1DatabaseLike, c: Case): Promise<Record<Mode, any>> {
  const out: any = {};
  for (const mode of MODES) {
    await setModes(db, mode);
    resetShadowSampling();
    if (mode === "shadow") await db.prepare("DELETE FROM shadow_results").run();
    out[mode] = await c.run();
    if (mode === "shadow") {
      await flushShadowWork();
      const rows = await shadowRows(db);
      for (const r of c.reads) {
        const [area, name] = r.split("/");
        const hit = rows.filter((x) => x.area === area && x.name === name && x.kind === "shadow");
        check(hit.length > 0 && hit.every((x) => x.match === 1), `${c.label}: shadow ${r} recorded as a match${hit.length === 0 ? " (NO ROW)" : hit.some((x) => x.match !== 1) ? ` (${hit.map((x) => x.diffs || x.error).join(" | ")})` : ""}`);
      }
    }
  }
  const okStatus = out.mongo?.status === undefined || out.mongo.status === 200;
  check(okStatus, `${c.label}: answers in mongo mode${okStatus ? "" : ` (${out.mongo.status} ${JSON.stringify(out.mongo.body).slice(0, 200)})`}`);
  check(canon(out.shadow) === canon(out.mongo), `${c.label}: shadow mode answer = mongo mode answer`);
  const same = c.compare ? compareResults(out.mongo, out.d1, c.compare).equal : canon(out.d1) === canon(out.mongo);
  check(same, `${c.label}: d1 mode answer = mongo mode answer${c.compare ? " (in any order)" : ""}${same ? "" : `\n      mongo: ${canon(out.mongo).slice(0, 400)}\n      d1:    ${canon(out.d1).slice(0, 400)}`}`);
  return out;
}

const SECRET_FIELDS = ["password", "securityPin", "pinFailCount", "pinLockedUntil", "unlockPinFailCount", "unlockPinLockedUntil", "pinHash", "p256dh", "auth"];
function secretsIn(v: any, found = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => secretsIn(x, found));
  else if (v && typeof v === "object" && !(v instanceof Date) && !(v instanceof ObjectId)) {
    for (const k of Object.keys(v)) {
      if (SECRET_FIELDS.includes(k)) found.add(k);
      secretsIn(v[k], found);
    }
  }
  return found;
}

async function authorize(identifier: string, password: string): Promise<{ ok: boolean; user?: any; error?: string }> {
  const provider: any = authOptions.providers[0];
  const fn = provider.options?.authorize ?? provider.authorize;
  try {
    return { ok: true, user: await fn({ email: identifier, password }, {} as any) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await startMemoryMongo("d1_wiring_stock_staff");
  const local = await startLocalD1();
  const db = local.db;
  try {
    await applyMigrations(db);
    await seed();
    ACTORS = {
      admin: actor("admin@valueplus.in", "admin", "Shiva Rai (Super Admin)"),
      manager: actor("store@valueplus.in", "manager", "Anil Verma"),
      salesman: actor("ravi.kumar@valueplus.in", "salesman", "Ravi Kumar"),
      cashier: actor("cashier@valueplus.in", "cashier", "Pooja Sharma"),
      hr: actor("hr@valueplus.in", "hr", "Kavita Joshi"),
    };

    // The serial-number list runs a reconcile (MongoDB writes) at most every 5 minutes: let it run once now, before
    // the copy, so the comparisons below see settled data.
    await call(serialNumbersGET as unknown as Handler, "http://localhost/api/serial-numbers");

    const collections = [...STOCK_CASH_SPECS, ...STAFF_SYSTEM_SPECS].map((s) => s.collection);
    for (let i = 0; ; i++) {
      const r = await runD1Sync(db, { reconcile: "skip", collections, budgetMs: 120_000 });
      if (r.errors) throw new Error(`copy job errors: ${r.errors}`);
      if (collections.every((c) => r.collections[c]?.fullCopyDone)) break;
      if (i > 20) throw new Error("the copy did not finish");
    }
    check(true, `stock and staff collections copied into D1 (${collections.length} collections)`);

    // The two switches (the other worker's migration 0008 seeds them in production; here the test writes them).
    for (const key of ["read:stock", "read:staff"]) {
      await db.prepare("INSERT OR REPLACE INTO feature_flags (key, value, updatedAt) VALUES (?, 'mongo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))").bind(key).run();
    }
    configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0 });
    resetShadowConfig();

    const U = "http://localhost";
    const P = "staff/rolePermissions.all";
    const cases: Case[] = [
      // ── stock / purchase / cash ──
      route("GET /api/purchase-entries", ["stock/purchaseEntries.list"], purchaseEntriesGET, `${U}/api/purchase-entries`),
      route("GET /api/purchase-entries?type=debit-note", ["stock/purchaseEntries.list"], purchaseEntriesGET, `${U}/api/purchase-entries?type=debit-note`),
      route("GET /api/purchase-orders", ["stock/purchaseOrders.list"], purchaseOrdersGET, `${U}/api/purchase-orders`),
      route("GET /api/expenses", ["stock/expenses.list"], expensesGET, `${U}/api/expenses`),
      route("GET /api/variants", ["stock/variants.list"], variantsGET, `${U}/api/variants`),
      route("GET /api/product-reference", ["stock/productCatalogReferences.list"], productReferenceGET, `${U}/api/product-reference`),
      route("GET /api/inventory/adjustment", ["stock/stockAdjustments.list"], adjustmentGET, `${U}/api/inventory/adjustment`),
      route("GET /api/inventory/audit (history)", ["stock/inventoryAudits.list"], auditInventoryGET, `${U}/api/inventory/audit`, "admin"),
      route("GET /api/inventory/audit?date=yesterday", ["stock/inventoryAudits.list"], auditInventoryGET, `${U}/api/inventory/audit?date=${YESTERDAY}`, "manager"),
      route("GET /api/inventory/audit?checkPending=true", ["stock/inventoryAudits.forDay"], auditInventoryGET, `${U}/api/inventory/audit?checkPending=true`, "cashier"),
      route("GET /api/inventory/audit?id=<today's audit>", ["stock/inventoryAudits.byId"], auditInventoryGET, `${U}/api/inventory/audit?id=${ids.audit}`, "admin"),
      route("GET /api/inventory/audit?id=<ID IN CAPITALS>", ["stock/inventoryAudits.byId"], auditInventoryGET, `${U}/api/inventory/audit?id=${ids.audit.toUpperCase()}`, "admin"),
      route("GET /api/inventory/stock-flow", ["stock/purchaseEntries.byBillDateDesc", "stock/stockTransfers.byDateDesc"], stockFlowGET, `${U}/api/inventory/stock-flow`),
      route("GET /api/stock-transfers", ["stock/stockTransfers.list"], stockTransfersGET, `${U}/api/stock-transfers`),
      route("GET /api/serial-numbers", ["stock/serialNumbers.list"], serialNumbersGET, `${U}/api/serial-numbers`),
      route("GET /api/serial-numbers?status=ALL&name=lg", ["stock/serialNumbers.list"], serialNumbersGET, `${U}/api/serial-numbers?status=ALL&name=lg`),
      route("GET /api/stock-orders as salesman", ["stock/stockOrders.list"], stockOrdersGET, `${U}/api/stock-orders`, "salesman"),
      route("GET /api/stock-orders as admin", ["stock/stockOrders.list"], stockOrdersGET, `${U}/api/stock-orders`, "admin"),
      route("GET /api/reports/aged-stock", ["stock/purchaseEntries.agedStock"], agedStockGET, `${U}/api/reports/aged-stock`),
      route("GET /api/vendors", ["stock/vendors.list", P], vendorsGET, `${U}/api/vendors`, "admin"),
      route("GET /api/vendors/bills?vendorId=", ["stock/vendorBills.list", P], vendorBillsGET, `${U}/api/vendors/bills?vendorId=${ids.vendor}`, "manager"),
      route("GET /api/vendors/payments?from=", ["stock/vendorPayments.list", P], vendorPaymentsGET, `${U}/api/vendors/payments?from=${dayOffset(-14)}`, "admin"),
      route("GET /api/vendors/ledger (vendors)", ["stock/vendors.ledger", "stock/vendorBills.ledger", "stock/vendorPayments.ledger", P], vendorLedgerGET, `${U}/api/vendors/ledger?party=vendor`, "admin"),
      route("GET /api/vendors/ledger?id= (one vendor)", ["stock/vendors.ledger", "stock/vendorBills.detail", "stock/vendorPayments.detail", P], vendorLedgerGET, `${U}/api/vendors/ledger?party=vendor&id=${ids.vendor}`, "manager"),
      route("GET /api/vendors/ledger?party=supplier", ["stock/purchaseEntries.allNatural", P], vendorLedgerGET, `${U}/api/vendors/ledger?party=supplier`, "admin"),
      route("GET /api/admin-cash", ["stock/adminCashEntries.book"], adminCashGET, `${U}/api/admin-cash`, "admin"),
      route("GET /api/day-close", ["stock/dayCloses.latest", "stock/dayCloses.history"], dayCloseGET, `${U}/api/day-close`),
      route("GET /api/bank-accounts", ["stock/bankAccounts.list"], bankAccountsGET, `${U}/api/bank-accounts`),
      route("GET /api/audit?view=deleted-purchase-entries", ["stock/deletedPurchaseEntries.audit", P], auditGET, `${U}/api/audit?view=deleted-purchase-entries&q=lg`, "admin"),
      helper("getPendingDayCloseDate()", ["stock/dayCloses.latestDate"], () => getPendingDayCloseDate()),
      // ── staff / system ──
      route("GET /api/users", ["staff/users.list"], usersGET, `${U}/api/users`),
      route("GET /api/roles", [P], rolesGET, `${U}/api/roles`, "admin"),
      route("GET /api/audit (log)", ["staff/audit.list", P], auditGET, `${U}/api/audit?from=${YESTERDAY}&q=invoice`, "manager"),
      route("GET /api/audit?refs=", ["staff/audit.list", P], auditGET, `${U}/api/audit?refs=INV-1001,invoice:INV-1001`, "cashier"),
      route("GET /api/staff/attendance (today)", ["staff/attendance.list"], attendanceGET, `${U}/api/staff/attendance`),
      route("GET /api/staff/attendance?month=", ["staff/attendance.list"], attendanceGET, `${U}/api/staff/attendance?month=${MONTH}&staff=Ravi%20Kumar`),
      route("GET /api/staff/attendance?date=all&staffId=", ["staff/attendance.list"], attendanceGET, `${U}/api/staff/attendance?date=all&staffId=${ids["amit@valueplus.in"]}`),
      route("GET /api/staff/presence", ["staff/attendance.presenceRows"], presenceGET, `${U}/api/staff/presence`, "manager"),
      route("GET /api/staff/leave-requests as admin", ["staff/leave.list"], leaveGET, `${U}/api/staff/leave-requests`, "admin"),
      route("GET /api/staff/leave-requests as salesman (own)", ["staff/leave.list"], leaveGET, `${U}/api/staff/leave-requests`, "salesman"),
      route("GET /api/staff/leave-requests?decidable=1 as manager", ["staff/leave.list"], leaveGET, `${U}/api/staff/leave-requests?decidable=1&status=pending`, "manager"),
      route("GET /api/staff/tasks as salesman", ["staff/tasks.list"], tasksGET, `${U}/api/staff/tasks`, "salesman"),
      route("GET /api/staff/tasks as admin", ["staff/tasks.list"], tasksGET, `${U}/api/staff/tasks`, "admin"),
      route("GET /api/staff/tasks?staff=ravi kumar as manager", ["staff/tasks.list"], tasksGET, `${U}/api/staff/tasks?staff=ravi%20kumar&status=all`, "manager"),
      route("GET /api/staff/salary", ["staff/salaries.list"], salaryGET, `${U}/api/staff/salary`),
      route("GET /api/staff/salary?month=", ["staff/salaries.list"], salaryGET, `${U}/api/staff/salary?month=October%202026`),
      route("GET /api/staff/overview (directory)", ["staff/users.directory", "staff/attendance.overviewDay", "staff/leave.approvedAwayOn"], overviewGET, `${U}/api/staff/overview`, "admin"),
      route("GET /api/staff/overview?id=", ["staff/users.findById", "staff/tasks.ownership", "staff/payouts.forUser", "staff/attendance.recentForStaff"], overviewGET, `${U}/api/staff/overview?id=${ids["ravi.kumar@valueplus.in"]}`, "manager"),
      route("GET /api/staff/member-activity?id=", ["staff/users.findById", "staff/attendance.between", "staff/leave.forStaffBetween"], memberActivityGET, `${U}/api/staff/member-activity?id=${ids["ravi.kumar@valueplus.in"]}&month=${MONTH}`, "hr"),
      route("GET /api/staff/my-incentive?detail=1", ["staff/payouts.forUser"], myIncentiveGET, `${U}/api/staff/my-incentive?detail=1`, "salesman"),
      route("GET /api/auth/security-pin (PIN set)", ["staff/users.securityPinState"], securityPinGET, `${U}/api/auth/security-pin`, "admin"),
      route("GET /api/auth/security-pin (locked out)", ["staff/users.securityPinState"], securityPinGET, `${U}/api/auth/security-pin`, "manager"),
      route("GET /api/price-lock/pin", ["staff/priceUnlock.setting"], priceLockPinGET, `${U}/api/price-lock/pin`, "admin"),
      helper("isUnlockPinSet()", ["staff/priceUnlock.setting"], () => isUnlockPinSet()),
      helper("loadPermissionOverrides()", [P], () => loadPermissionOverrides()),
      helper("getShift()", ["staff/shift.latest"], () => getShift()),
      helper("staffNotCheckedIn(today)", ["staff/users.workingStaff", "staff/attendance.dayCheckins", "staff/leave.approvedAwayOn"], () => staffNotCheckedIn(TODAY), ANY_ORDER),
      helper("usersForAssignee('All Staff')", ["staff/users.notifyAllStaff"], () => usersForAssignee("All Staff"), ANY_ORDER),
      helper("usersForAssignee('Sales Staff')", ["staff/users.notifySalesStaff"], () => usersForAssignee("Sales Staff"), ANY_ORDER),
      helper("usersForAssignee('ravi kumar')", ["staff/users.notifyByName"], () => usersForAssignee("ravi kumar")),
      helper("usersForAssignee(<id>)", ["staff/users.notifyById"], () => usersForAssignee("x", ids["amit@valueplus.in"])),
      helper("push devices of two users", ["staff/push.subsForUsers"], () => readStaff("push.subsForUsers", [ids["ravi.kumar@valueplus.in"], ids["amit@valueplus.in"]])),
    ];

    console.log("\nmongo / shadow / d1 mode: the same answer, shadow records a match");
    const results: Record<string, Record<Mode, any>> = {};
    for (const c of cases) results[c.label] = await threeModes(db, c);

    // Spot checks: the cases really return data (an empty answer would compare equal trivially).
    const n = (label: string, pick: (r: any) => any) => {
      const v = pick(results[label]?.d1);
      return Array.isArray(v) ? v.length : v ? 1 : 0;
    };
    check(n("GET /api/purchase-entries", (r) => r.body.data) === 7, "purchase entries: 7 bills (debit note left out)");
    check(n("GET /api/inventory/audit (history)", (r) => r.body.data) === 2 && results["GET /api/inventory/audit (history)"].d1.body.data[0].total === 25, "audit history with line totals from D1");
    check(results["GET /api/inventory/audit?checkPending=true"].d1.body.todayAudit?.counted === 13, "today's audit summary from D1");
    check(n("GET /api/vendors/ledger (vendors)", (r) => r.body.data.parties) === 2, "vendor ledger: two vendors");
    check(results["GET /api/bank-accounts"].d1.body.data.length === 2, "bank accounts from D1");
    check(n("GET /api/staff/tasks as salesman", (r) => r.body.data) === 4, "salesman sees his 4 tasks (own, exact name, All Staff, Sales Staff)");
    check(results["GET /api/auth/security-pin (locked out)"].d1.body.data.locked === true, "security PIN lockout read from D1's ISO date");
    check(results["GET /api/auth/security-pin (PIN set)"].d1.body.data.hasPin === true && !/\$2[aby]\$/.test(JSON.stringify(results["GET /api/auth/security-pin (PIN set)"].d1.body)), "security PIN state: no hash in the response");
    check(Object.keys(results["loadPermissionOverrides()"].d1).sort().join(",") === "cashier,manager", "permission overrides for manager and cashier");
    check(n("GET /api/users", (r) => r.body.data) === 13 && !secretsIn(results["GET /api/users"].d1.body).has("password"), "users list: everyone, no password hash");
    check(results["push devices of two users"].d1.length === 3, "push devices: 3");

    // ── d1 mode really reads D1 ──
    console.log("\nd1 mode reads D1");
    await db.prepare("UPDATE purchaseOrders SET supplierName = 'From D1' WHERE poNo = 'PO-1'").run();
    await db.prepare("UPDATE users SET designation = 'From D1' WHERE email = 'amit@valueplus.in'").run();
    await setModes(db, "d1");
    let po = JSON.parse((await call(purchaseOrdersGET as unknown as Handler, `${U}/api/purchase-orders`)).text);
    let us = JSON.parse((await call(usersGET as unknown as Handler, `${U}/api/users`)).text);
    check(po.data[0].supplierName === "From D1" && us.data.some((u: any) => u.designation === "From D1"), "d1 mode serves the D1 rows (stock and staff)");
    await setModes(db, "mongo");
    po = JSON.parse((await call(purchaseOrdersGET as unknown as Handler, `${U}/api/purchase-orders`)).text);
    us = JSON.parse((await call(usersGET as unknown as Handler, `${U}/api/users`)).text);
    check(po.data[0].supplierName !== "From D1" && !us.data.some((u: any) => u.designation === "From D1"), "mongo mode does not");
    await db.prepare("UPDATE purchaseOrders SET supplierName = 'LG India Pvt Ltd' WHERE poNo = 'PO-1'").run();
    await db.prepare("UPDATE users SET designation = NULL WHERE email = 'amit@valueplus.in'").run();

    // ── every D1 query failing: d1 mode answers as MongoDB, fallbacks recorded ──
    console.log("\nD1 failing in d1 mode: MongoDB answers");
    await setModes(db, "d1");
    configureReadSource({ resolveD1: () => faulty(db, { fail: (sql) => !/feature_flags|shadow_/i.test(sql) }) });
    await db.prepare("DELETE FROM shadow_results").run();
    for (const c of cases) {
      invalidatePermissionCache();
      const v = await c.run();
      check(canon(v) === canon(results[c.label].mongo), `${c.label}: D1 failing -> same answer as mongo mode`);
    }
    await flushShadowWork();
    configureReadSource({ resolveD1: () => db });
    const fb = ((await db.prepare("SELECT DISTINCT area || '/' || name AS r FROM shadow_results WHERE kind = 'fallback'").all()).results || []).map((x: any) => x.r);
    const expected = Array.from(new Set(cases.flatMap((c) => c.reads)));
    const missingFb = expected.filter((r) => !fb.includes(r));
    check(missingFb.length === 0, `every read path recorded its fallback (${fb.length})${missingFb.length ? " MISSING " + missingFb.join(", ") : ""}`);

    // ── bank accounts: the IFSC back-fill still runs on MongoDB documents ──
    console.log("\nbank accounts back-fill (a write) stays on MongoDB");
    await raw().collection("bank_accounts").updateOne({ name: "HDFC Savings" }, { $unset: { ifsc: 1 } });
    await db.prepare("UPDATE bankAccounts SET ifsc = NULL WHERE name = 'HDFC Savings'").run();
    // MongoDB's hydrated documents show the schema default IFSC for it; D1 has no IFSC, so d1 mode takes the MongoDB
    // path and must answer exactly as mongo mode does.
    await setModes(db, "mongo");
    const bfMongo = (await call(bankAccountsGET as unknown as Handler, `${U}/api/bank-accounts`)).text;
    await setModes(db, "d1");
    const bfD1 = (await call(bankAccountsGET as unknown as Handler, `${U}/api/bank-accounts`)).text;
    const bf = JSON.parse(bfD1);
    check(
      canon(JSON.parse(bfD1)) === canon(JSON.parse(bfMongo)) && bf.data.find((a: any) => a.name === "HDFC Savings")?.ifsc === "HDFC0000492",
      "d1 mode: an account without IFSC in D1 is answered by the MongoDB path, the same as mongo mode"
    );

    // ── sign-in ──
    console.log("\nsign-in look-up");
    const idents = [
      "admin@valueplus.in", "ADMIN@VALUEPLUS.IN", "9140860604", "ravi.kumar@valueplus.in", "ravi_kumar@valueplus.in", "RAVI_KUMAR@valueplus.in",
      "ravi%kumar@valueplus.in", "ravi.kumar@valueplus.in ", "per%cent@valueplus.in", "per_cent@valueplus.in", "a+b@valueplus.in", "aab@valueplus.in",
      "old.timer@valueplus.in", "9000000099", "ümit@valueplus.in", "Ümit@ValuePlus.in", "%", "_", ".*", "nobody@valueplus.in", "deepak@valueplus.in",
    ];
    for (const ident of idents) {
      const got: Record<string, any> = {};
      for (const mode of MODES) {
        await setModes(db, mode);
        got[mode] = await loginLookup(ident.trim());
      }
      const idOf = (u: any) => (u ? String(u._id) : "none");
      const secrets = (u: any) => Array.from(secretsIn(u)).sort().join(",");
      check(MODES.every((m) => idOf(got[m]) === idOf(got.mongo)), `login ${JSON.stringify(ident)}: the same user in every mode (${idOf(got.mongo) === "none" ? "nobody" : got.mongo.email})`);
      check(MODES.every((m) => secrets(got[m]) === secrets(got.mongo)), `login ${JSON.stringify(ident)}: the same secret fields as MongoDB [${secrets(got.mongo) || "none"}]`);
      // The registry read itself (what d1 mode searches with) is held to MongoDB's answer too.
      const direct = await STAFF_READS["auth.loginLookup"].d1On(db, ident.trim());
      // D1's own search may MISS where MongoDB finds (SQL LIKE folds ASCII capitals only: "ümit" vs "Ümit"); then
      // MongoDB answers (checked above). It must never find ANOTHER user, nor carry other secret fields.
      const directOk = (direct === null || idOf(direct) === idOf(got.mongo)) && (direct === null || secrets(direct) === secrets(got.mongo));
      check(directOk, `login ${JSON.stringify(ident)}: D1's own search ${direct === null && got.mongo ? "misses (MongoDB answers)" : "agrees with MongoDB"}`);
    }
    // authorize() end to end: right password, wrong password, in every mode.
    for (const email of ["admin@valueplus.in", "ravi.kumar@valueplus.in", "old.timer@valueplus.in", "ravi_kumar@valueplus.in"]) {
      for (const [label, pw] of [["right", PASSWORDS[email]], ["wrong", "not-the-password"]] as const) {
        const res: Record<string, any> = {};
        for (const mode of MODES) {
          await setModes(db, mode);
          res[mode] = await authorize(email, pw);
        }
        check(MODES.every((m) => canon(res[m]) === canon(res.mongo)), `authorize(${email}, ${label} password): same outcome in every mode (${res.mongo.ok ? "signed in" : res.mongo.error})`);
        check(MODES.every((m) => !secretsIn(res[m]).size), `authorize(${email}, ${label} password): no secret field in what it returns`);
      }
    }
    // D1 behind MongoDB: a user deleted on MongoDB, a password changed on MongoDB, a user not yet in D1.
    await setModes(db, "d1");
    const gone = "per%cent@valueplus.in";
    await raw().collection("users").deleteOne({ email: gone });
    check((await STAFF_READS["auth.loginLookup"].d1On(db, gone)) !== null, "set-up: the deleted user is still in D1");
    check((await loginLookup(gone)) === null && !(await authorize(gone, PASSWORDS[gone])).ok, "d1 mode: a user deleted on MongoDB (still in D1) cannot sign in");
    const changed = "ravi.kumar@valueplus.in";
    await raw().collection("users").updateOne({ email: changed }, { $set: { password: await bcrypt.hash("new-password", 4) } });
    check(!(await authorize(changed, PASSWORDS[changed])).ok, "d1 mode: the OLD password (still in D1) is refused after a change on MongoDB");
    check((await authorize(changed, "new-password")).ok, "d1 mode: the NEW password works before D1 has it");
    await mk(User, { name: "Fresh Hire", email: "fresh@valueplus.in", role: "salesman", mobile: "9000000077", password: await bcrypt.hash("pw-fresh", 4) });
    const fresh = await authorize("fresh@valueplus.in", "pw-fresh");
    check(fresh.ok && fresh.user?.email === "fresh@valueplus.in", "d1 mode: a user not yet copied to D1 signs in (MongoDB answers the miss)");
    const seedBefore = await User.countDocuments({ email: "salesman@valueplus.in" });
    await authorize("salesman@valueplus.in", "wrong");
    const seedAfter = await User.countDocuments({ email: "salesman@valueplus.in" });
    check(seedBefore === 0 && seedAfter === 1, "d1 mode: the seed-account path still runs on MongoDB's 'nobody' (one account created, not more)");
    await authorize("salesman@valueplus.in", "wrong");
    check((await User.countDocuments({ email: "salesman@valueplus.in" })) === 1, "d1 mode: the seed account is not created twice although D1 lacks it");
    configureReadSource({ resolveD1: () => faulty(db, { fail: (sql) => /FROM users\b/i.test(sql) }) });
    resetReadModeCache();
    const down = await authorize("admin@valueplus.in", PASSWORDS["admin@valueplus.in"]);
    check(down.ok && down.user?.email === "admin@valueplus.in", "d1 mode, D1 failing: sign-in answered by MongoDB");
    configureReadSource({ resolveD1: () => db });

    // ── permissions ──
    console.log("\npermission overrides");
    await setModes(db, "d1");
    configureReadSource({ resolveD1: () => faulty(db, { fail: (sql) => /rolePermissions/i.test(sql) }) });
    invalidatePermissionCache();
    const permDown = await loadPermissionOverrides();
    configureReadSource({ resolveD1: () => db });
    check(canon(permDown) === canon(results["loadPermissionOverrides()"].mongo), "d1 mode, D1 failing: the overrides come from MongoDB, not an empty map");
    await setModes(db, "d1");
    const denied = await call(auditGET as unknown as Handler, `${U}/api/audit`, "salesman");
    const allowed = await call(auditGET as unknown as Handler, `${U}/api/audit`, "cashier");
    check(denied.status === 403 && allowed.status === 200, "d1 mode: requirePermission still refuses a salesman and lets the cashier (override) in");
  } finally {
    resetReadSourceConfig();
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-wiring-stock-staff") ? 1 : 0);
}

function raw() {
  return mongoose.connection.db!;
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
