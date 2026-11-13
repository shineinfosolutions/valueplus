/**
 * Stage B2 of the D1 migration, STAFF & SYSTEM reads (lib/repo/staff): for EVERY entry of STAFF_READS and several
 * argument combinations, the D1 read gives the same JSON as the current Mongo query.
 *  - realistic data saved through the models (every role, an inactive user, attendance with away periods and
 *    lastPresence, leave / weekly off / breaks, tasks with seenBy and sales targets, salaries with payment history,
 *    payouts, read / unread notifications, push devices, role overrides, the price-unlock PIN, cron guards, audit
 *    logs with metadata), plus rows saved the way upserts and older code saved them (no __v, no liveAuditAccess,
 *    no readAt, no history, missing defaults);
 *  - copied to a local D1 with the existing copy job (lib/d1/sync.ts), then compared;
 *  - every D1 row rebuilds to exactly its Mongo document (docHash and canonical JSON);
 *  - lib/repo/staff/meta.ts agrees with the mongoose schemas;
 *  - secret fields (password / PIN hashes, lockout counters, push keys) appear only where the Mongo read has them;
 *  - an id that is not an ObjectId fails on both sides.
 * Normalisation applied to BOTH results before JSON.stringify: (1) object keys sorted (D1 cannot know the order the
 * fields were first saved in); (2) rows with EQUAL sort keys are put in _id order, and a read with no sort at all
 * is compared in _id order (Mongo leaves those orders to the query plan: an index on the filter changes them).
 * Secret values are never printed: a mismatch prints the read, the arguments and the first differing path only.
 */
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { canonicalJson, docHash } from "@/lib/d1/masters-map";
import { STAFF_SYSTEM_SPECS } from "@/lib/d1/maps/staff-system";
import { runD1Sync } from "@/lib/d1/sync";
import { STAFF_READS, setStaffD1 } from "@/lib/repo/staff";
import { rowsToDocs } from "@/lib/repo/staff/rebuild";
import { ARRAY_PATHS, DEFAULTS, ELEMENT_DEFAULTS, NULL_DEFAULTS, SELECT_FALSE, defaultValue } from "@/lib/repo/staff/meta";
import User from "@/models/User";
import Attendance from "@/models/Attendance";
import LeaveRequest from "@/models/LeaveRequest";
import StaffTask from "@/models/StaffTask";
import Salary from "@/models/Salary";
import IncentivePayout from "@/models/IncentivePayout";
import ShiftSetting from "@/models/ShiftSetting";
import Notification from "@/models/Notification";
import PushSubscription from "@/models/PushSubscription";
import RolePermission from "@/models/RolePermission";
import PriceUnlockSetting from "@/models/PriceUnlockSetting";
import ScheduledRun from "@/models/ScheduledRun";
import AuditLog from "@/models/AuditLog";

const { ObjectId } = mongoose.mongo as any;
const MINE = STAFF_SYSTEM_SPECS.map((s) => s.collection);
const MODELS: Record<string, any> = {
  users: User,
  attendance: Attendance,
  leaverequests: LeaveRequest,
  staff_tasks: StaffTask,
  salaries: Salary,
  incentive_payouts: IncentivePayout,
  shift_settings: ShiftSetting,
  notifications: Notification,
  push_subscriptions: PushSubscription,
  role_permissions: RolePermission,
  price_unlock_settings: PriceUnlockSetting,
  scheduled_runs: ScheduledRun,
  audit_logs: AuditLog,
};

const TODAY = "2026-11-14";
const YESTERDAY = "2026-11-13";
const NOW = new Date("2026-11-14T08:00:00.000Z"); // 13:30 IST
const FAKE_HASH = (tag: string) => `$2a$10$${tag.padEnd(53, "x")}`; // looks like a bcrypt hash; never a real secret

const SECRET_KEYS = ["password", "securityPin", "pinHash", "pinFailCount", "pinLockedUntil", "unlockPinFailCount", "unlockPinLockedUntil", "p256dh", "auth"];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

let clock = Date.parse("2026-10-01T04:00:00.000Z");
const tick = (minutes = 7) => new Date((clock += minutes * 60000));

/** Saved through the model (defaults, casting, __v) with chosen timestamps. */
async function mk(Model: any, doc: any, at: Date = tick()): Promise<any> {
  const d = new Model({ createdAt: at, updatedAt: at, ...doc });
  await d.save({ timestamps: false });
  return d;
}

const ids: Record<string, string> = {};
const names: Record<string, string> = {};

async function seed(mongo: any) {
  // ── users: every role, one inactive, one legacy (saved raw by older code) ──
  const people: [string, string, string, any?][] = [
    ["admin", "Shiva Rai (Super Admin)", "admin@valueplus.in", { mobile: "9140860604", designation: "Managing Director", securityPin: FAKE_HASH("pinadmin"), pinUpdatedAt: new Date("2026-10-02T05:00:00Z"), liveAuditAccess: true }],
    ["manager", "Anil Verma", "store@valueplus.in", { mobile: "9000000002", designation: "Store Manager", pinLockedUntil: new Date("2026-11-14T09:00:00Z"), pinFailCount: 2 }],
    ["salesman", "Ravi Kumar", "salesman@valueplus.in", { mobile: "9000000003", assignedBrand: "HAIER", assignedBrands: ["HAIER", "LG"], monthlySalary: 15000, bankAccountNo: "0011223344", idProofNumber: "1234-5678-9012" }],
    ["sales", "Amit Kumar Singh", "amit@valueplus.in", { mobile: "9000000004", assignedBrands: ["SAMSUNG"] }],
    ["cashier", "Pooja Sharma", "cashier@valueplus.in", { mobile: "9000000005", unlockPinFailCount: 3, unlockPinLockedUntil: new Date("2026-11-14T08:30:00Z") }],
    ["warehouse", "Mohan Lal", "warehouse2@valueplus.in", {}],
    ["accounts", "Neha Gupta", "accounts@valueplus.in", {}],
    ["hr", "Kavita Joshi", "hr@valueplus.in", {}],
    ["supplier", "Haier Distributor", "supplier@valueplus.in", {}],
    ["driver", "Sunil Yadav", "driver@valueplus.in", { vehicleNumber: "UP53AB1234", drivingLicenseNo: "DL-998877" }],
    ["courier", "Fast Courier", "courier@valueplus.in", {}],
    ["salesman", "Deepak Mishra", "deepak@valueplus.in", { status: "inactive" }],
    ["salesman", "Ravi.Kumar", "ravi.dot@valueplus.in", { mobile: "" }],
  ];
  for (const [role, name, email, extra] of people) {
    const u = await mk(User, { name, email, role, password: FAKE_HASH(`pw-${role}`), ...(extra || {}) });
    ids[email] = String(u._id);
    names[email] = name;
  }
  // Older documents: no liveAuditAccess / assignedBrands / joiningDate / __v, status missing (counts as active).
  const legacyId = new ObjectId();
  await mongo.collection("users").insertOne({
    _id: legacyId,
    name: "Old Timer",
    email: "Old.Timer@ValuePlus.in",
    password: FAKE_HASH("pw-legacy"),
    role: "cashier",
    mobile: "9000000099",
    createdAt: tick(),
    updatedAt: new Date(clock),
  });
  ids.legacy = String(legacyId);
  // A user with explicit nulls (written by a $set of null).
  const nullUser = await mk(User, { name: "Null Fields", email: "null@valueplus.in", role: "warehouse", password: FAKE_HASH("pw-null") });
  await mongo.collection("users").updateOne({ _id: nullUser._id }, { $set: { avatar: null, monthlySalary: null } });
  ids.nullUser = String(nullUser._id);

  const ravi = ids["salesman@valueplus.in"];
  const amit = ids["amit@valueplus.in"];
  const pooja = ids["cashier@valueplus.in"];
  const anil = ids["store@valueplus.in"];
  const admin = ids["admin@valueplus.in"];

  // ── attendance: Oct + Nov, several staff, away periods, lastPresence, leave, absent ──
  const staff = [
    ["Ravi Kumar", ravi, "salesman"],
    ["Amit Kumar Singh", amit, "sales"],
    ["Pooja Sharma", pooja, "cashier"],
    ["Anil Verma", anil, "manager"],
  ];
  const days = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-03", "2026-11-10", YESTERDAY, TODAY];
  for (const day of days) {
    for (const [i, [name, uid, role]] of staff.entries()) {
      const late = (i + day.length) % 3 === 0;
      const doc: any = {
        staffName: name,
        staffId: uid,
        userId: uid,
        staffEmail: `${String(name).split(" ")[0].toLowerCase()}@valueplus.in`,
        staffRole: role,
        date: day,
        checkInTime: late ? "10:42 AM" : "09:55 AM",
        checkOutTime: day === TODAY ? undefined : "09:00 PM",
        workingDurationMinutes: day === TODAY ? 0 : 638,
        shiftName: "Showroom Shift (10:00 AM - 09:00 PM)",
        isLate: late,
        status: late ? "Late" : "Present",
        lateMinutes: late ? 42 : 0,
        notes: late ? "Checked in late at 10:42 AM (Grace: 10:00 + 15m)" : "Checked in on time at 09:55 AM",
        checkInPhotoKey: i === 3 ? "" : `attendance/${uid}/${day}-1.jpg`,
        checkInLat: 26.7606 + i / 10000,
        checkInLng: 83.3732,
        checkInDistanceM: 12 + i,
      };
      if (name === "Ravi Kumar") {
        doc.awayPeriods = [
          { kind: "away", leftAt: new Date(`${day}T06:00:00Z`), backAt: new Date(`${day}T06:25:00Z`), minutes: 25, leftDistanceM: 80, maxDistanceM: 420 },
          { kind: "unknown", leftAt: new Date(`${day}T07:00:00Z`), backAt: new Date(`${day}T07:10:00Z`), minutes: 10, endUncertain: true },
        ];
        if (day === TODAY) doc.awayPeriods.push({ kind: "away", leftAt: new Date("2026-11-14T07:20:00Z"), leftDistanceM: 95, maxDistanceM: 600, lastAlertAt: new Date("2026-11-14T07:50:00Z") });
        doc.totalAwayMinutes = 25;
        doc.unknownMinutes = 10;
        doc.lastPresence = { state: day === TODAY ? "out" : "in", at: new Date(`${day}T07:20:00Z`), distanceM: 95, lat: 26.761, lng: 83.374 };
      }
      if (name === "Amit Kumar Singh" && day === TODAY) {
        doc.awayPeriods = [{ kind: "break", leftAt: new Date("2026-11-14T07:30:00Z"), breakEndsAt: new Date("2026-11-14T07:50:00Z"), maxDistanceM: 300 }];
        doc.lastPresence = { state: "out", at: new Date("2026-11-14T07:30:00Z") };
      }
      if (name === "Pooja Sharma" && day === "2026-11-10") {
        Object.assign(doc, { checkInTime: "--", checkOutTime: "--", status: "On Leave", leaveType: "Casual", leaveStatus: "Approved", leaveReason: "Family function", isLate: false, lateMinutes: 0 });
      }
      if (name === "Anil Verma" && day === YESTERDAY) {
        Object.assign(doc, { checkOutTime: "", status: "Present" }); // left open: the auto check-out picks it up
      }
      await mk(Attendance, doc);
    }
  }
  // Absent row, and an attendance with an unknown lastPresence key and an extra top-level field.
  await mk(Attendance, { staffName: "Mohan Lal", staffRole: "warehouse", date: YESTERDAY, checkInTime: "--", checkOutTime: "--", status: "Absent", notes: "Marked absent" });
  const odd = await mk(Attendance, { staffName: "Kavita Joshi", staffRole: "hr", date: TODAY, checkInTime: "10:05 AM" });
  await mongo.collection("attendance").updateOne({ _id: odd._id }, { $set: { "lastPresence.state": "in", "lastPresence.accuracyM": 12, legacyNote: "set by an old script" } });

  // ── leave requests and breaks ──
  await mk(LeaveRequest, { kind: "leave", staffName: "Ravi Kumar", staffId: ravi, staffRole: "salesman", fromDate: "2026-11-20", toDate: "2026-11-22", days: 3, reason: "Wedding", status: "pending" });
  await mk(LeaveRequest, { kind: "weekly_off", staffName: "Amit Kumar Singh", staffId: amit, staffRole: "sales", fromDate: TODAY, toDate: TODAY, status: "approved", reviewedBy: "Shiva Rai (Super Admin)", reviewedAt: new Date("2026-11-12T05:00:00Z") });
  await mk(LeaveRequest, { kind: "leave", staffName: "Neha Gupta", staffId: ids["accounts@valueplus.in"], staffRole: "accounts", fromDate: "2026-11-12", toDate: "2026-11-15", days: 4, status: "approved", reviewNote: "OK" });
  await mk(LeaveRequest, { kind: "emergency", staffName: "Ravi Kumar", staffId: ravi, staffRole: "salesman", fromDate: "2026-10-31", toDate: "2026-11-01", days: 2, status: "cancelled" });
  await mk(LeaveRequest, { kind: "leave", staffName: "Ravi Kumar", staffRole: "salesman", fromDate: "2026-10-20", toDate: "2026-10-21", days: 2, status: "rejected", reviewNote: "Busy days" }); // by name only (no staffId)
  // Breaks: over and not back (break-over alert), running now, returned, pending.
  await mk(LeaveRequest, { kind: "break", staffName: "Amit Kumar Singh", staffId: amit, staffRole: "sales", fromDate: TODAY, toDate: TODAY, breakMinutes: 20, status: "approved", breakStartedAt: new Date("2026-11-14T07:30:00Z"), breakEndsAt: new Date("2026-11-14T07:50:00Z"), lastOverAlertAt: new Date("2026-11-14T07:55:00Z") });
  await mk(LeaveRequest, { kind: "break", staffName: "Pooja Sharma", staffId: pooja, staffRole: "cashier", fromDate: TODAY, toDate: TODAY, breakMinutes: 30, status: "approved", breakStartedAt: new Date("2026-11-14T07:45:00Z"), breakEndsAt: new Date("2026-11-14T08:15:00Z") });
  await mk(LeaveRequest, { kind: "break", staffName: "Ravi Kumar", staffId: ravi, staffRole: "salesman", fromDate: TODAY, toDate: TODAY, breakMinutes: 10, status: "approved", breakStartedAt: new Date("2026-11-14T05:00:00Z"), breakEndsAt: new Date("2026-11-14T05:10:00Z"), breakReturnedAt: new Date("2026-11-14T05:08:00Z") });
  await mk(LeaveRequest, { kind: "break", staffName: "Ravi Kumar", staffId: ravi, staffRole: "salesman", fromDate: TODAY, toDate: TODAY, breakMinutes: 10, status: "pending" });

  // ── tasks: general and sales targets, group tasks, seenBy ──
  const g1 = "grp-1";
  await mk(StaffTask, { taskTitle: "Clean the display", assignedStaff: "All Staff", dueDate: "2026-11-15", priority: "Low", createdBy: "Anil Verma", groupId: g1, seenBy: [{ userId: ravi, name: "Ravi Kumar", at: new Date("2026-11-14T05:00:00Z") }, { userId: amit, name: "Amit Kumar Singh", at: new Date("2026-11-14T05:05:00Z") }] });
  await mk(StaffTask, { taskTitle: "Sell Haier ACs", assignedStaff: "Ravi Kumar", assignedStaffId: ravi, dueDate: "2026-11-30", taskType: "sales_target", targetBrand: "HAIER", targetProduct: "Haier 1.5T AC", targetQty: 5, targetAmount: 175000, currentQty: 2, currentAmount: 71000, linkedInvoiceNumber: "INV-1001", priority: "High", createdBy: "Shiva Rai (Super Admin)" });
  await mk(StaffTask, { taskTitle: "Call back leads", assignedStaff: "  ravi kumar ", dueDate: "2026-11-14", dueTime: "17:00", taskType: "follow_up", createdBy: "Anil Verma", status: "In Progress", reminder: true });
  await mk(StaffTask, { taskTitle: "Demo the new TV", assignedStaff: "Sales Staff", dueDate: "2026-11-14", taskType: "product_demo", createdBy: "Ravi Kumar" });
  await mk(StaffTask, { taskTitle: "Count the cash", assignedStaff: "Pooja Sharma", assignedStaffId: pooja, dueDate: "2026-11-13", status: "Completed", completedAt: new Date("2026-11-13T15:00:00Z"), completionRemarks: "Done", createdBy: "Anil Verma" });
  await mk(StaffTask, { taskTitle: "Amit's target", assignedStaff: "Amit Kumar Singh", assignedStaffId: amit, dueDate: "2026-11-30", taskType: "sales_target", targetQty: 3, createdBy: "Admin" });
  const t7 = await mk(StaffTask, { taskTitle: "Stock check", assignedStaff: "Mohan Lal", dueDate: "2026-11-16", createdBy: "Admin" });
  ids.task = String(t7._id);

  // ── salaries: with history (pushed as the route does), without, and a legacy one ──
  const s1 = await mk(Salary, { employeeName: "Ravi Kumar", employeeId: ravi, monthlySalary: 15000, incentives: 2500, commission: 500, deductions: 1000, payableAmount: 17000, month: "October 2026", year: 2026, salaryType: "Fixed + Incentive" });
  s1.history.push({ date: "2026-11-05", amount: 10000, paymentMode: "Bank Transfer", txnRef: "UTR123", notes: "First part" });
  s1.history.push({ date: "2026-11-07", amount: 7000, paymentMode: "Cash" });
  s1.paymentStatus = "Paid";
  s1.paymentDate = "2026-11-07";
  await s1.save({ timestamps: false });
  await mk(Salary, { employeeName: "Amit Kumar Singh", employeeId: amit, monthlySalary: 12000, payableAmount: 12000, month: "October 2026", paymentStatus: "Pending" });
  await mk(Salary, { employeeName: "Amit Kumar Singh", employeeId: amit, monthlySalary: 12000, incentives: 800, payableAmount: 12800, month: "November 2026", paymentStatus: "Paid", history: [{ date: "2026-11-12", amount: 12800 }] });
  await mk(Salary, { employeeName: "Pooja Sharma", employeeId: pooja, monthlySalary: 14000, payableAmount: 14000, month: "November 2026", paymentStatus: "Processing" });
  const legacySalary = new ObjectId();
  await mongo.collection("salaries").insertOne({ _id: legacySalary, employeeName: "Old Timer", employeeId: ids.legacy, monthlySalary: 9000, payableAmount: 9000, month: "September 2026", paymentStatus: "Paid", incentives: 100, createdAt: tick(), updatedAt: new Date(clock) });

  // ── incentive payouts ──
  for (const [i, amt] of [1500, 700, 300].entries()) {
    await mk(IncentivePayout, { userId: ravi, employeeName: "Ravi Kumar", amount: amt, date: i === 2 ? "2026-11-10" : `2026-11-0${i + 2}`, paymentMode: i ? "UPI" : "Cash", note: i ? "" : "Diwali", paidBy: "Shiva Rai (Super Admin)", paidByUserId: admin });
  }
  await mk(IncentivePayout, { userId: amit, employeeName: "Amit Kumar Singh", amount: 450.5, date: "2026-11-10", paidBy: "Shiva Rai (Super Admin)" });

  // ── settings ──
  await mk(ShiftSetting, { shiftName: "Showroom Shift (10:00 AM - 06:00 PM)", endTime: "18:00" }, new Date("2026-09-01T00:00:00Z"));
  await mk(ShiftSetting, { shiftName: "Showroom Shift (10:00 AM - 09:00 PM)", startTime: "10:00", endTime: "21:00", minHoursForFullDay: 7.5, updatedBy: "Store Manager" });
  // Upserts, as the routes write them (no __v on insert).
  await RolePermission.findOneAndUpdate({ role: "manager" }, { role: "manager", permissions: ["audit.view", "roles.manage", "ledger.vendor.view"], updatedBy: "Shiva Rai (Super Admin)" }, { new: true, upsert: true });
  await RolePermission.findOneAndUpdate({ role: "cashier" }, { role: "cashier", permissions: [], updatedBy: "Shiva Rai (Super Admin)" }, { new: true, upsert: true });
  await PriceUnlockSetting.findOneAndUpdate({ key: "price-unlock" }, { $set: { pinHash: FAKE_HASH("unlockpin"), updatedBy: "Shiva Rai (Super Admin)" } }, { upsert: true, setDefaultsOnInsert: true });
  await ScheduledRun.findOneAndUpdate({ key: "ensure-indexes-v3" }, { $setOnInsert: { ranAt: new Date("2026-11-13T18:00:00Z") } }, { upsert: true, new: false });
  await ScheduledRun.findOneAndUpdate({ key: `office-start:${TODAY}` }, { $setOnInsert: { ranAt: new Date() } }, { upsert: true, new: false });

  // ── notifications: 40 for Ravi (some read), a few for others, one legacy without readAt; insertMany like notify ──
  const batch: any[] = [];
  for (let i = 0; i < 40; i++) {
    const at = tick(3);
    batch.push({
      recipientId: ravi,
      recipientName: "Ravi Kumar",
      type: i % 5 === 0 ? "task_assigned" : i % 5 === 1 ? "target_assigned" : "general",
      title: `Notice ${i}`,
      message: i % 2 ? `Message ${i}` : "",
      link: "/dashboard",
      readAt: i < 20 ? new Date(at.getTime() + 60000) : null,
      refType: i % 5 === 0 ? "task" : i % 7 === 0 ? "late-checkin" : "",
      refId: i % 5 === 0 ? ids.task : i % 7 === 0 ? `${TODAY}:${ravi}` : "",
      createdBy: "System",
      createdAt: at,
      updatedAt: at,
    });
  }
  for (const [uid, nm] of [[amit, "Amit Kumar Singh"], [pooja, "Pooja Sharma"], [admin, "Shiva Rai (Super Admin)"]]) {
    const at = tick(2);
    batch.push({ recipientId: uid, recipientName: nm, type: "approval_request", title: "Approve a discount", refType: "task", refId: ids.task, createdAt: at, updatedAt: at });
  }
  const inserted: any[] = (await Notification.insertMany(batch, { timestamps: false } as any)) as any;
  ids.taskNotice = String(inserted[0]._id);
  ids.readNotice = String(inserted[1]._id);
  const legacyNotice = await mongo.collection("notifications").insertOne({ recipientId: ravi, title: "Old notice", type: "general", createdAt: tick(), updatedAt: new Date(clock) });
  ids.legacyNotice = String(legacyNotice.insertedId);

  // ── push devices: upserted as the subscribe route does ──
  for (const [i, uid] of [ravi, ravi, amit, admin].entries()) {
    await PushSubscription.findOneAndUpdate(
      { endpoint: `https://fcm.googleapis.com/fcm/send/device-${i}` },
      { $set: { userId: uid, p256dh: `BPublicKey${i}`.padEnd(87, "A"), auth: `authsecret${i}`.padEnd(22, "B"), userAgent: "Mozilla/5.0 (Android)", failCount: 0 } },
      { upsert: true, new: true }
    );
    await new Promise((r) => setTimeout(r, 5)); // distinct updatedAt
  }
  await PushSubscription.updateOne({ endpoint: "https://fcm.googleapis.com/fcm/send/device-0" }, { $set: { lastSuccessAt: new Date("2026-11-14T06:00:00Z") } });

  // ── audit logs ──
  const audits: any[] = [
    { action: "invoice.delete", entityType: "Invoice", entityRef: "INV-1001", entityId: "x1", partyName: "Ramesh Traders", amount: 35400, reason: "Wrong customer", performedBy: "Shiva Rai (Super Admin)", performedByUserId: admin, performedByRole: "admin", pinVerified: true, ip: "1.2.3.4", userAgent: "UA", metadata: { before: { total: 35400, items: [{ name: "Haier AC", qty: 1, rate: 30000 }] }, after: null, when: new Date("2026-11-13T20:00:00Z") } },
    { action: "approval.request", entityType: "Invoice", entityRef: "invoice:INV-1001", reason: "Edit requested", performedBy: "Anil Verma", performedByRole: "manager" },
    { action: "incentive.payout", entityType: "IncentivePayout", entityRef: "Ravi Kumar", partyName: "Ravi Kumar", amount: 1500, reason: "Incentive ₹1500 paid to Ravi Kumar", performedBy: "Shiva Rai (Super Admin)", metadata: { date: "2026-11-02", mode: "Cash", balanceBefore: 4200, expenseNo: "EXP-INC-1" } },
    { action: "pricelock.pin.set", entityType: "PriceUnlockPin", entityRef: "price-unlock", reason: "Price unlock PIN set or changed", performedBy: "Shiva Rai (Super Admin)", pinVerified: true, usedLegacyPin: false },
    { action: "invoice.cancel", entityType: "Invoice", entityRef: "INV-1002", partyName: "50% Off Store", amount: 1200, reason: "Customer returned_goods", performedBy: "Pooja Sharma", usedLegacyPin: true },
    { action: "invoice.delete", entityType: "Invoice", entityRef: "INV-0999", partyName: "Old Party", amount: 99, reason: "Test bill", performedBy: "Shiva Rai (Super Admin)", metadata: {} },
  ];
  const auditTimes = ["2026-11-13T18:45:00Z", "2026-11-13T19:00:00Z", "2026-11-02T06:00:00Z", "2026-10-31T18:20:00Z", "2026-11-14T04:00:00Z", "2026-10-01T10:00:00Z"];
  for (const [i, a] of audits.entries()) await mk(AuditLog, a, new Date(auditTimes[i]));
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function sortKeysDeep(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
    return out;
  }
  return v;
}

/** Rows with equal sort keys in _id order (no sort keys = the whole list in _id order). */
function tieOrder(v: any, keys: string[] | null): any {
  if (!Array.isArray(v)) return v;
  const keyOf = (r: any) => JSON.stringify((keys || []).map((k) => r?.[k]));
  const out: any[] = [];
  let i = 0;
  while (i < v.length) {
    let j = i;
    while (j < v.length && keyOf(v[j]) === keyOf(v[i])) j++;
    out.push(...v.slice(i, j).sort((a, b) => String(a?._id).localeCompare(String(b?._id))));
    i = j;
  }
  return out;
}

const canon = (v: any, keys: string[] | null) => JSON.stringify(sortKeysDeep(tieOrder(JSON.parse(JSON.stringify(v ?? null)), keys)));

/** The first path where two JSON values differ, with secret values hidden. */
function firstDiff(a: any, b: any, path = "$"): string {
  if (JSON.stringify(a) === JSON.stringify(b)) return "";
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  const leaf = path.split(".").pop() || "";
  const redact = (x: any): any =>
    Array.isArray(x) ? x.map(redact) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, SECRET_KEYS.includes(k) ? "<secret>" : redact(v)])) : x;
  const show = (x: any) => (SECRET_KEYS.includes(leaf) ? (x === undefined ? "<absent>" : "<secret>") : JSON.stringify(redact(x))?.slice(0, 160));
  return `${path}: mongo=${show(a)} d1=${show(b)}`;
}

/** Secret field names present anywhere in a value. */
function secretsIn(v: any, found = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => secretsIn(x, found));
  else if (v && typeof v === "object") {
    for (const k of Object.keys(v)) {
      if (SECRET_KEYS.includes(k)) found.add(k);
      secretsIn(v[k], found);
    }
  }
  return found;
}

const secretSummary: Record<string, string> = {};
const covered = new Set<string>();

async function compare(name: string, args: any[], order: string[] | null, label = ""): Promise<{ mongo: any; d1: any }> {
  const pair = STAFF_READS[name];
  const m = JSON.parse(JSON.stringify((await pair.mongo(...args)) ?? null));
  const d = JSON.parse(JSON.stringify((await pair.d1(...args)) ?? null));
  covered.add(name);
  const cm = canon(m, order);
  const cd = canon(d, order);
  const size = Array.isArray(m) ? `${m.length} rows` : m === null ? "null" : typeof m === "object" ? "1 doc" : String(m);
  const ok = cm === cd;
  check(ok, `${name}(${label || args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(", ")}) = ${size}`);
  if (!ok) console.log(`       ${firstDiff(JSON.parse(cm), JSON.parse(cd))}`);
  const sm = [...secretsIn(m)].sort().join(",");
  const sd = [...secretsIn(d)].sort().join(",");
  check(sm === sd, `   secrets in ${name}: same fields on both sides [${sm || "none"}]`);
  secretSummary[name] = secretSummary[name] && secretSummary[name] !== sm ? `${secretSummary[name]} | ${sm}` : sm;
  return { mongo: m, d1: d };
}

async function rejectsBoth(name: string, args: any[]) {
  const pair = STAFF_READS[name];
  const m = await pair.mongo(...args).then(() => "resolved", (e: any) => e?.name || "error");
  const d = await pair.d1(...args).then(() => "resolved", (e: any) => e?.name || "error");
  check(m !== "resolved" && d !== "resolved", `${name}(${JSON.stringify(args)}) fails on both sides (mongo ${m}, d1 ${d})`);
}

async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any[]> {
  return ((await db.prepare(sql).bind(...args).all()).results || []) as any[];
}

async function clearD1(db: D1DatabaseLike) {
  for (const s of STAFF_SYSTEM_SPECS) {
    for (const c of s.children || []) await db.prepare(`DELETE FROM ${c.table}`).run();
    await db.prepare(`DELETE FROM ${s.table}`).run();
  }
  await db.prepare("DELETE FROM sync_state").run();
}

async function copyAll(db: D1DatabaseLike) {
  await clearD1(db);
  const res = await runD1Sync(db, { collections: MINE, reconcile: "skip" });
  return res;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await startMemoryMongo("d1_staff_reads_test");
  const local = await startLocalD1();
  const db = local.db;
  const mongo = mongoose.connection.db!;
  setStaffD1(db);
  try {
    await applyMigrations(db);

    // ── 1. lib/repo/staff/meta.ts agrees with the schemas ──
    for (const [coll, Model] of Object.entries(MODELS)) {
      const schema = Model.schema;
      const selFalse = Object.keys(schema.paths).filter((p) => schema.paths[p].options?.select === false).sort();
      check(JSON.stringify(selFalse) === JSON.stringify([...(SELECT_FALSE[coll] || [])].sort()), `${coll}: select:false paths = meta (${selFalse.join(", ") || "none"})`);
      const nullDefs = Object.keys(schema.paths).filter((p) => schema.paths[p].defaultValue === null).sort();
      check(JSON.stringify(nullDefs) === JSON.stringify([...(NULL_DEFAULTS[coll] || [])].sort()), `${coll}: default-null paths = meta (${nullDefs.join(", ") || "none"})`);
      if (DEFAULTS[coll]) {
        const want: Record<string, any> = {};
        const arrays: string[] = [];
        for (const [p, st] of Object.entries<any>(schema.paths)) {
          if (["_id", "__v"].includes(p) || p.includes(".")) continue;
          if (st.instance === "Array" || st.$isMongooseDocumentArray) {
            if (st.defaultValue !== undefined) arrays.push(p); // `default: undefined` (awayPeriods) leaves it absent
            continue;
          }
          if (st.defaultValue !== undefined) want[p] = typeof st.defaultValue === "function" ? st.defaultValue.call({}) : st.defaultValue;
        }
        const mine: Record<string, any> = {};
        for (const [p, d] of Object.entries(DEFAULTS[coll])) mine[p] = defaultValue(d);
        check(canonicalJson(want) === canonicalJson(mine), `${coll}: scalar defaults = meta`);
        check(JSON.stringify(arrays.sort()) === JSON.stringify([...(ARRAY_PATHS[coll] || [])].sort()), `${coll}: arrays that start as [] = meta (${arrays.join(", ") || "none"})`);
      }
    }
    const histDefaults = (Salary.schema.path("history") as any).schema.paths;
    check(
      canonicalJson(Object.fromEntries(Object.entries<any>(histDefaults).filter(([p, s]) => p !== "_id" && s.defaultValue !== undefined).map(([p, s]) => [p, s.defaultValue]))) ===
        canonicalJson(ELEMENT_DEFAULTS.salaries.history),
      "salaries.history element defaults = meta"
    );
    const awayDefaults = (Attendance.schema.path("awayPeriods") as any).schema.paths;
    check(
      canonicalJson(Object.fromEntries(Object.entries<any>(awayDefaults).filter(([, s]) => s.defaultValue !== undefined).map(([p, s]) => [p, s.defaultValue]))) ===
        canonicalJson(ELEMENT_DEFAULTS.attendance.awayPeriods),
      "attendance.awayPeriods element defaults = meta"
    );

    // ── 2. empty database: the reads that can be empty agree ──
    await copyAll(db);
    await compare("shift.latest", [], null, "no shift yet");
    await compare("priceUnlock.setting", [], null, "no PIN yet");
    await compare("users.list", [], ["createdAt"], "no users");
    await compare("notifications.unreadCount", ["650000000000000000000001"], null);

    // ── 3. seed and copy ──
    await seed(mongo);
    const res = await copyAll(db);
    check(res.ok && res.errors === 0, `copy job: ${Object.values(res.collections).reduce((n, c) => n + c.copied, 0)} documents copied, 0 errors`);

    // ── 4. every row rebuilds to exactly its Mongo document ──
    for (const spec of STAFF_SYSTEM_SPECS) {
      const rows = await all(db, `SELECT * FROM ${spec.table} ORDER BY id`);
      const rebuilt = await rowsToDocs(db, spec.collection, rows);
      const raw = await mongo.collection(spec.collection).find().sort({ _id: 1 }).toArray();
      let hashOk = 0;
      let jsonOk = 0;
      const bad: string[] = [];
      for (const [i, d] of rebuilt.entries()) {
        if ((await docHash(d)) === rows[i].docHash) hashOk++;
        if (canonicalJson(d) === canonicalJson(raw[i])) jsonOk++;
        else bad.push(String(rows[i].id));
      }
      check(rows.length === raw.length && hashOk === rows.length && jsonOk === rows.length, `${spec.table}: ${jsonOk}/${raw.length} rows rebuild to their Mongo document (hash ${hashOk})${bad.length ? ` bad: ${bad.join(",")}` : ""}`);
    }

    // ── 5. every read, several argument combinations ──
    const ravi = ids["salesman@valueplus.in"];
    const amit = ids["amit@valueplus.in"];
    const pooja = ids["cashier@valueplus.in"];
    const admin = ids["admin@valueplus.in"];
    const missing = "650000000000000000000abc";

    // users
    await compare("users.list", [], ["createdAt"]);
    for (const idf of ["admin@valueplus.in", "ADMIN@ValuePlus.IN", "9000000003", "old.timer@valueplus.in", "ravi.dot@valueplus.in", "nobody@valueplus.in", "%", "_dmin@valueplus.in", "admin@valueplus.i", ""]) {
      await compare("auth.loginLookup", [idf], null, JSON.stringify(idf));
    }
    for (const sel of [undefined, "name assignedBrand", "assignedBrand", "name email role mobile designation status joiningDate assignedBrand address", "role", "name", "-password", "+securityPin"]) {
      await compare("users.findById", [ravi, sel], null, `ravi, ${sel}`);
    }
    await compare("users.findById", [ids.legacy, "name email role mobile designation status joiningDate assignedBrand address"], null, "legacy user");
    await compare("users.findById", [ids.nullUser], null, "user with explicit nulls");
    await compare("users.findById", [admin.toUpperCase(), "name"], null, "upper-case hex id");
    await compare("users.findById", [missing, "name"], null, "missing id");
    await rejectsBoth("users.findById", ["not-an-id", "name"]);
    await compare("users.active", [], null);
    await compare("users.directory", [], ["name"]);
    for (const id of [admin, ravi, pooja, ids.legacy, ids["store@valueplus.in"]]) await compare("users.securityPinState", [id], null);
    await compare("users.securityPinState", [missing], null, "missing id");
    for (const n of ["Ravi Kumar", "  ravi kumar ", "RAVI KUMAR", "Ravi", "Ravi.Kumar", "nobody"]) await compare("users.idByExactName", [n], null, JSON.stringify(n));
    for (const id of [ravi, "bad-id", "", missing]) await compare("users.notifyById", [id], null, JSON.stringify(id));
    await compare("users.notifyAllStaff", [], null);
    await compare("users.notifySalesStaff", [], null);
    for (const n of ["Ravi Kumar", "ravi kumar", "Ravi.Kumar", "Ravi"]) await compare("users.notifyByName", [n], null, JSON.stringify(n));
    for (const r of [["admin", "superadmin"], ["manager", "admin", "superadmin"], ["cashier"], []]) await compare("users.notifyRoles", [r], null);
    for (const e of ["SALESMAN@valueplus.in", "old.timer@valueplus.in", "x"]) await compare("users.notifyEmail", [e], null, JSON.stringify(e));
    await compare("users.workingStaff", [], null);

    // permissions
    await compare("rolePermissions.all", [], null);

    // attendance
    const attArgs: any[] = [
      { today: TODAY },
      { dateParam: "all", today: TODAY },
      { dateParam: YESTERDAY, today: TODAY },
      { month: "2026-11", today: TODAY },
      { month: "2026-1", today: TODAY },
      { month: "2026-1[01]", today: TODAY },
      { dateParam: "all", staffName: "Ravi Kumar", today: TODAY },
      { month: "2026-10", staffId: amit, today: TODAY },
      { month: "2026-11", staffName: "all", today: TODAY },
      { dateParam: "2026-11-10", staffName: "Pooja Sharma", today: TODAY },
    ];
    for (const a of attArgs) await compare("attendance.list", [a], ["date", "createdAt"]);
    const anAtt: any = await Attendance.findOne({ staffName: "Ravi Kumar", date: TODAY }).lean();
    const noPhoto: any = await Attendance.findOne({ staffName: "Anil Verma", date: TODAY }).lean();
    for (const id of [String(anAtt._id), String(noPhoto._id), missing]) await compare("attendance.photoRef", [id], null);
    await rejectsBoth("attendance.photoRef", ["123"]);
    await compare("attendance.between", ["2026-11-01", "2026-11-31"], ["date"]);
    await compare("attendance.between", ["2026-10-01", "2026-10-31"], ["date"]);
    await compare("attendance.overviewDay", [TODAY], null);
    await compare("attendance.overviewDay", [YESTERDAY], null);
    for (const n of ["Ravi Kumar", "Pooja Sharma", "nobody"]) await compare("attendance.recentForStaff", [n], ["date"]);
    await compare("attendance.presenceRows", [TODAY], ["staffName"]);
    await compare("attendance.presenceRows", [TODAY, "Ravi Kumar"], ["staffName"]);
    await compare("attendance.presenceRows", [YESTERDAY, null], ["staffName"]);
    await compare("attendance.dayCheckins", [TODAY], null);
    await compare("attendance.findByStaffDate", ["Ravi Kumar", TODAY], null);
    await compare("attendance.findByStaffDate", ["Kavita Joshi", TODAY], null, "Kavita Joshi, today (extra fields)");
    await compare("attendance.findByStaffDate", ["Ravi Kumar", "1999-01-01"], null);
    await compare("attendance.autoCheckoutCandidates", [TODAY], null);
    await compare("attendance.autoCheckoutCandidates", [YESTERDAY], null);
    await compare("attendance.openAway", [TODAY], null);
    await compare("attendance.openAway", [YESTERDAY], null);

    // leave
    const leaveArgs: any[] = [
      {},
      { status: "pending" },
      { mineOf: { id: ravi, name: "Ravi Kumar" } },
      { status: "approved", mineOf: { id: amit, name: "Amit Kumar Singh" } },
      { kinds: ["break"] },
      { kinds: ["break", "leave", "emergency", "weekly_off"], status: "approved" },
      { kinds: [] },
    ];
    for (const a of leaveArgs) await compare("leave.list", [a], ["createdAt"]);
    await compare("leave.forStaffBetween", ["2026-11-01", "2026-11-31", ravi, "Ravi Kumar"], ["fromDate"]);
    await compare("leave.forStaffBetween", ["2026-10-01", "2026-10-31", ravi, "Ravi Kumar"], ["fromDate"]);
    await compare("leave.forStaffBetween", ["2026-11-01", "2026-11-31", "", "Neha Gupta"], ["fromDate"]);
    for (const d of [TODAY, "2026-11-12", "2026-11-21"]) await compare("leave.approvedAwayOn", [d], null);
    await compare("leave.breakOverCandidates", [NOW], null);
    await compare("leave.breakOverCandidates", [new Date("2026-11-14T08:30:00Z")], null);
    await compare("leave.runningBreak", ["Pooja Sharma", NOW], null);
    await compare("leave.runningBreak", ["Amit Kumar Singh", NOW], null);
    await compare("leave.runningBreak", ["Ravi Kumar", new Date("2026-11-14T05:05:00Z")], null);

    // tasks
    const taskArgs: any[] = [
      { actor: { id: admin, name: "Shiva Rai (Super Admin)", role: "admin" } },
      { actor: { id: admin, name: "Shiva Rai (Super Admin)", role: "admin" }, staff: "Ravi Kumar" },
      { actor: { id: admin, name: "Shiva Rai (Super Admin)", role: "admin" }, staff: "all", status: "Pending" },
      { actor: { id: ids["store@valueplus.in"], name: "Anil Verma", role: "manager" }, status: "Completed" },
      { actor: { id: ravi, name: "Ravi Kumar", role: "salesman" } },
      { actor: { id: ravi, name: "Ravi Kumar", role: "salesman" }, status: "In Progress" },
      { actor: { id: pooja, name: "Pooja Sharma", role: "cashier" } },
      { actor: { id: "", name: "Mohan Lal", role: "warehouse" } },
    ];
    for (const a of taskArgs) await compare("tasks.list", [a], ["dueDate", "createdAt"], `${a.actor.role}${a.staff ? " staff=" + a.staff : ""}${a.status ? " status=" + a.status : ""}`);
    await compare("tasks.ownership", [], null);
    await compare("tasks.findById", [ids.task], null);
    const seenTask: any = await StaffTask.findOne({ groupId: "grp-1" }).lean();
    await compare("tasks.findById", [String(seenTask._id)], null, "task with seenBy");
    await compare("tasks.findById", [missing], null);

    // salaries and payouts
    await compare("salaries.list", [], ["employeeName"]);
    await compare("salaries.list", ["November 2026"], ["employeeName"]);
    await compare("salaries.list", [null, amit], ["employeeName"]);
    await compare("salaries.list", ["September 2026", null], ["employeeName"], "legacy salary (no history, missing defaults)");
    await compare("salaries.paidIncentives", [], null);
    await compare("payouts.forUser", [ravi], ["date", "createdAt"]);
    await compare("payouts.forUser", [ravi, 200], ["date", "createdAt"]);
    await compare("payouts.forUser", [ravi, 1], ["date", "createdAt"]);
    await compare("payouts.forUser", [amit, 200], ["date", "createdAt"]);
    await compare("payouts.amounts", [], null);

    // settings
    await compare("shift.latest", [], null);
    await compare("priceUnlock.setting", [], null);
    for (const k of ["ensure-indexes-v3", `office-start:${TODAY}`, "never-ran"]) await compare("scheduledRuns.exists", [k], null);

    // notifications and push
    for (const u of [ravi, amit, missing]) {
      await compare("notifications.latest", [u], ["createdAt"]);
      await compare("notifications.unreadCount", [u], null);
      await compare("notifications.unreadTaskRefs", [u], null);
    }
    await compare("notifications.unreadTaskRefs", [ravi, ids.taskNotice], null, "ravi, one task notice");
    await compare("notifications.unreadTaskRefs", [ravi, ids.readNotice], null, "ravi, a read notice");
    await rejectsBoth("notifications.unreadTaskRefs", [ravi, "zzz"]);
    for (const u of [ravi, amit, missing]) await compare("push.idsForUser", [u], ["updatedAt"]);
    await compare("push.subsForUsers", [[ravi, amit]], null);
    await compare("push.subsForUsers", [[admin]], null);
    await compare("push.subsForUsers", [[]], null);

    // audit
    const auditArgs: any[] = [
      {},
      { action: "invoice.delete" },
      { from: "2026-11-01", to: "2026-11-14" },
      { from: "2026-11-14" },
      { to: "2026-10-31" },
      { refs: "INV-1001, invoice:INV-1001" },
      { q: "ravi" },
      { q: "50%" },
      { q: "returned_goods" },
      { q: "inv-100", action: "invoice.delete" },
      { limit: "2" },
      { limit: "5000" },
      { limit: "abc" },
    ];
    for (const a of auditArgs) await compare("audit.list", [a], ["createdAt"]);

    // ── 6. coverage and secrets ──
    const missingReads = Object.keys(STAFF_READS).filter((k) => !covered.has(k));
    check(missingReads.length === 0, `every STAFF_READS entry compared (${covered.size}/${Object.keys(STAFF_READS).length})${missingReads.length ? " missing: " + missingReads.join(", ") : ""}`);
    const expectSecrets: Record<string, string> = {
      "users.list": "",
      "auth.loginLookup": "password",
      "users.directory": "",
      "users.notifyAllStaff": "",
      "users.workingStaff": "",
      "users.active": "password",
      "priceUnlock.setting": "pinHash",
      "push.subsForUsers": "auth,p256dh",
      "notifications.latest": "",
    };
    for (const [read, want] of Object.entries(expectSecrets)) {
      const got = (secretSummary[read] || "").split(" | ").filter(Boolean).pop() || "";
      check(got === want, `secrets returned by ${read}: [${got || "none"}] as the Mongo read`);
    }
    check(/securityPin/.test(secretSummary["users.securityPinState"] || "") && /password/.test(secretSummary["users.securityPinState"] || ""), "users.securityPinState carries the PIN (and password) hash, as the Mongo query does");
    check(!/pinFailCount|unlockPin/.test(Object.values(secretSummary).join(",")), "lockout counters (select:false) never returned");
  } finally {
    setStaffD1(null);
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-staff-reads") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
