/**
 * Stage A of the D1 migration, STAFF & SYSTEM area (docs/D1_MIGRATION_PLAN.md §4.2, §4.6, §4.8): the copy of
 * users, attendance, leaveRequests, staffTasks, salaries (+ salaryPayments), incentivePayouts, shiftSettings,
 * notifications, pushSubscriptions, rolePermissions, priceUnlockSettings, scheduledRuns and auditLogs into D1.
 *  - 0004 applies after 0001 and every table has exactly the columns the mapping writes (≤ 100), plain indexes only;
 *  - each spec reads the model's real Mongo collection;
 *  - realistic documents for every collection, plus legacy edge cases, map without loss: the document rebuilt from
 *    its D1 row (+ child rows + extra) equals the Mongo document after the column type conversion;
 *  - a full copy (with a notification volume, timed), then incremental copies of presence updates, task seenBy /
 *    target $inc, a salary payment, a password change, a read notification, new audit logs;
 *  - nightly reconciliation deletes and repairs; counts and hashes match;
 *  - a large audit log (before/after) is copied whole; a row over D1's 2 MB is reported, never cut;
 *  - time-boxing resumes to the same end state.
 * Secrets (password / PIN hashes, bank and ID-proof details) are compared, never printed.
 * Uses only this area's tables (plus sync_state / sync_errors), so other areas' migrations can coexist.
 */
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { MASTER_SPECS, type MasterSpec, tableColumns, mapDoc, normalize, canonicalJson, toText, toReal, toInt, toDate, toBool } from "@/lib/d1/masters-map";
import { STAFF_SYSTEM_SPECS, STAFF_SYSTEM_DERIVED, staffKeyOf } from "@/lib/d1/maps/staff-system";
import { ALL_SPECS } from "@/lib/d1/registry";
import { runD1Sync, getD1SyncStatus } from "@/lib/d1/sync";
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

const { ObjectId, Decimal128 } = mongoose.mongo as any;

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
const MINE = STAFF_SYSTEM_SPECS.map((s) => s.collection);
const SPEC: Record<string, MasterSpec> = Object.fromEntries(STAFF_SYSTEM_SPECS.map((s) => [s.collection, s]));
const NOTIFICATIONS = 3000;

async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any[]> {
  const res = await db.prepare(sql).bind(...args).all();
  return (res.results || []) as any[];
}
async function one(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any> {
  return db.prepare(sql).bind(...args).first();
}
async function count(db: D1DatabaseLike, table: string): Promise<number> {
  return Number((await one(db, `SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0);
}
async function clearMine(db: D1DatabaseLike) {
  const tables = STAFF_SYSTEM_SPECS.flatMap((s) => [...(s.children || []).map((c) => c.table), s.table]);
  for (const t of tables) await db.prepare(`DELETE FROM ${t}`).run();
  for (const c of MINE) await db.prepare("DELETE FROM sync_state WHERE collection = ?").bind(c).run();
  await db.prepare("DELETE FROM sync_errors").run();
}

// ---------------------------------------------------------------------------
// Lossless check: rebuild the document from D1 and compare with Mongo after the column type conversion
// ---------------------------------------------------------------------------

/** Drops null / undefined values and empty objects at every level, so "absent" and "null" compare equal. */
function prune(v: any): any {
  if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? null : prune(x)));
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) {
      const p = prune(v[k]);
      if (p === null || p === undefined) continue;
      if (p && typeof p === "object" && !Array.isArray(p) && Object.keys(p).length === 0) continue;
      out[k] = p;
    }
    return out;
  }
  return v;
}

function colValue(type: string, raw: any): any {
  switch (type) {
    case "text":
      return toText(raw);
    case "real":
      return toReal(raw);
    case "int":
      return toInt(raw);
    case "bool":
      return toBool(raw) === 1;
    case "date":
      return toDate(raw);
    case "json":
      return raw === undefined || raw === null ? null : normalize(raw);
  }
  return raw;
}

/** The Mongo document as the copy is expected to keep it: every column's field converted to the column's type. */
function expectedDoc(spec: MasterSpec, doc: any): any {
  const out = normalize(doc);
  const derived = STAFF_SYSTEM_DERIVED[spec.table] || [];
  for (const c of spec.columns) {
    if (derived.includes(c.col)) continue;
    if (c.col.includes("_")) {
      const [p, k] = c.col.split("_");
      const s = doc?.[p];
      if (s && typeof s === "object" && !Array.isArray(s)) out[p][k] = colValue(c.type, s[k]);
    } else {
      out[c.col] = colValue(c.type, doc?.[c.col]);
    }
  }
  if (spec.collection === "salaries") {
    const h = doc?.history;
    const list = Array.isArray(h) ? h : h === undefined || h === null ? [] : [h];
    out.history = list.map((e: any) => {
      if (!e || typeof e !== "object" || Array.isArray(e)) return normalize(e);
      const n = normalize(e);
      return { ...n, date: toText(e.date), amount: toReal(e.amount), paymentMode: toText(e.paymentMode), txnRef: toText(e.txnRef), notes: toText(e.notes) };
    });
  }
  // Timestamps and __v are checked separately (a missing one falls back to the ObjectId time).
  delete out.createdAt;
  delete out.updatedAt;
  delete out.__v;
  return prune(out);
}

/** The document rebuilt from its D1 row, child rows and `extra`. */
function rebuiltDoc(spec: MasterSpec, row: any, payments: any[] = []): any {
  const out: Record<string, any> = { _id: row.id };
  const derived = STAFF_SYSTEM_DERIVED[spec.table] || [];
  for (const c of spec.columns) {
    if (derived.includes(c.col)) continue;
    let v = row[c.col];
    if (c.type === "bool") v = v === 1;
    if (c.type === "json" && v !== null) v = JSON.parse(v);
    if (c.col.includes("_")) {
      const [p, k] = c.col.split("_");
      (out[p] ||= {})[k] = v;
    } else out[c.col] = v;
  }
  const extra = row.extra ? JSON.parse(row.extra) : {};
  for (const k of Object.keys(extra)) {
    if (spec.flattened?.[k] && extra[k] && typeof extra[k] === "object") out[k] = { ...(out[k] || {}), ...extra[k] };
    else out[k] = extra[k];
  }
  if (spec.collection === "salaries") {
    out.history = payments
      .sort((a, b) => a.idx - b.idx)
      .map((p) => {
        const ex = p.extra ? JSON.parse(p.extra) : {};
        const isValue = p.id === null && p.date === null && p.amount === null && Object.keys(ex).length === 1 && "value" in ex;
        if (isValue) return ex.value;
        return { ...ex, ...(p.id === null ? {} : { _id: p.id }), date: p.date, amount: p.amount, paymentMode: p.paymentMode, txnRef: p.txnRef, notes: p.notes };
      });
  }
  return prune(out);
}

async function losslessFailures(db: D1DatabaseLike, mongo: any): Promise<{ checked: number; bad: string[] }> {
  let checked = 0;
  const bad: string[] = [];
  for (const spec of STAFF_SYSTEM_SPECS) {
    const docs = await mongo.collection(spec.collection).find().toArray();
    for (const doc of docs) {
      checked++;
      const id = String(normalize(doc._id));
      const row = await one(db, `SELECT * FROM ${spec.table} WHERE id = ?`, id);
      if (!row) {
        bad.push(`${spec.collection}/${id}: missing`);
        continue;
      }
      const pays = spec.collection === "salaries" ? await all(db, "SELECT * FROM salaryPayments WHERE salaryId = ?", id) : [];
      const want = canonicalJson(expectedDoc(spec, doc));
      const got = canonicalJson(rebuiltDoc(spec, row, pays));
      // Only ids are named on a mismatch: these documents hold secrets.
      if (want !== got) bad.push(`${spec.collection}/${id}`);
      const ts = (v: any) => (v instanceof Date ? v.toISOString() : null);
      if (ts(doc.createdAt) && row.createdAt !== ts(doc.createdAt)) bad.push(`${spec.collection}/${id}: createdAt`);
      if (ts(doc.updatedAt) && row.updatedAt !== ts(doc.updatedAt)) bad.push(`${spec.collection}/${id}: updatedAt`);
      if (row.v !== (toInt(doc.__v) ?? 0)) bad.push(`${spec.collection}/${id}: __v`);
    }
  }
  return { checked, bad };
}

// ---------------------------------------------------------------------------
// Seed: realistic documents for every collection, plus legacy edge cases written with the raw driver
// ---------------------------------------------------------------------------

const FAKE_HASH = (n: number) => `$2b$10$${"x".repeat(20)}${String(n).padStart(33, "0")}`;
const U1 = new ObjectId();
const U2 = new ObjectId();

function invoiceSnapshot(lines: number, pad = 0) {
  return {
    _id: new ObjectId(),
    invoiceNumber: "VP/2026-27/1042",
    date: "2026-11-12",
    customerName: "राम कुमार",
    total: 123456.78,
    createdAt: new Date("2026-11-12T06:30:00Z"),
    items: Array.from({ length: lines }, (_, i) => ({
      _id: new ObjectId(),
      itemId: new ObjectId(),
      itemName: `LG 1.5 Ton AC ${i}`,
      quantity: 1,
      rate: 35000.5 + i,
      serialNumber: `SN${i}`,
      gstRate: 18,
      note: pad ? "p".repeat(pad) : undefined,
    })),
    payments: [{ mode: "cash", amount: 50000 }, { mode: "upi", amount: 73456.78, txnId: "UPI123" }],
  };
}

async function seed(mongo: any) {
  // users: through the model (defaults, select:false secrets) and raw legacy shapes.
  await User.create([
    {
      _id: U1, name: "Ravi Kumar", email: "ravi@example.com", password: FAKE_HASH(1), role: "salesman", mobile: "9000000101",
      idProofType: "PAN Card", idProofNumber: "ABCDE1234F", bankName: "SBI", bankAccountNo: "000123456789", bankIfsc: "SBIN0000001",
      assignedBrands: ["LG", "Samsung"], securityPin: FAKE_HASH(2), pinUpdatedAt: new Date("2026-10-01T05:00:00Z"), pinFailCount: 2,
      pinLockedUntil: new Date("2026-11-13T10:00:00Z"), unlockPinFailCount: 1, liveAuditAccess: true, monthlySalary: 18000.5, advanceBalance: 2500,
    },
    { _id: U2, name: "सुनीता देवी", email: "Sunita@Example.com", password: FAKE_HASH(3), role: "cashier", assignedBrands: [] },
    { name: "Admin", email: "admin@example.com", password: FAKE_HASH(4), role: "admin", status: "inactive" },
  ]);
  await mongo.collection("users").insertMany([
    // Legacy: number mobile, a role off the enum, assignedBrands as a string, an unknown field, no timestamps, __v 2.
    { _id: new ObjectId(), name: "Old Driver", email: "driver@example.com", password: FAKE_HASH(5), role: "courier", mobile: 9876543210, assignedBrands: "LG", liveAuditAccess: "true", legacyCode: { a: 1 }, __v: 2 },
    // Missing almost everything.
    { _id: new ObjectId(), name: "No Email", createdAt: "2024-01-05", updatedAt: new Date("2026-01-01T00:00:00Z") },
  ]);

  // attendance: a full presence day, a day without awayPeriods, a legacy lastPresence with an extra key.
  await Attendance.create([
    {
      staffName: "Ravi Kumar", staffId: String(U1), userId: String(U1), staffEmail: "ravi@example.com", date: "2026-11-12", checkInTime: "10:05 AM",
      checkOutTime: "09:02 PM", workingDurationMinutes: 657, isLate: true, status: "Late", lateMinutes: 5, checkInPhotoKey: "att/2026-11-12/ravi.jpg",
      checkInLat: 26.7606, checkInLng: 83.3732, checkInDistanceM: 12.4,
      awayPeriods: [
        { kind: "away", leftAt: new Date("2026-11-12T07:00:00Z"), backAt: new Date("2026-11-12T07:25:00Z"), minutes: 25, leftDistanceM: 160, maxDistanceM: 820.5 },
        { kind: "break", leftAt: new Date("2026-11-12T09:00:00Z"), backAt: new Date("2026-11-12T09:20:00Z"), minutes: 20, breakEndsAt: new Date("2026-11-12T09:30:00Z") },
        { kind: "unknown", leftAt: new Date("2026-11-12T11:00:00Z"), endUncertain: true, lastAlertAt: new Date("2026-11-12T11:30:00Z") },
      ],
      totalAwayMinutes: 25, unknownMinutes: 40,
      lastPresence: { state: "in", at: new Date("2026-11-12T15:30:00Z"), distanceM: 8, lat: 26.76061, lng: 83.37321 },
    },
    { staffName: "  सुनीता   देवी ", userId: String(U2), date: "2026-11-12", checkInTime: "09:55 AM", status: "Present" },
    { staffName: "Ravi Kumar", date: "2026-11-11", checkInTime: "-", status: "On Leave", leaveType: "Sick", leaveStatus: "Approved", leaveReason: "Fever", awayPeriods: [] },
  ]);
  await mongo.collection("attendance").insertOne({
    _id: new ObjectId(), staffName: "Legacy", date: "2025-03-01", checkInTime: "10:00 AM", status: "Present", isLate: 1,
    lastPresence: { state: "out", at: "2025-03-01T12:00:00Z", accuracyM: 30 }, gps: [1, 2], createdAt: new Date("2025-03-01T04:30:00Z"), updatedAt: new Date("2025-03-01T12:00:00Z"),
  });

  await LeaveRequest.create([
    { kind: "break", staffName: "Ravi Kumar", staffId: String(U1), staffRole: "salesman", fromDate: "2026-11-12", toDate: "2026-11-12", breakMinutes: 20, status: "approved", reviewedBy: "Admin", reviewedAt: new Date("2026-11-12T08:59:00Z"), breakStartedAt: new Date("2026-11-12T09:00:00Z"), breakEndsAt: new Date("2026-11-12T09:20:00Z"), breakReturnedAt: new Date("2026-11-12T09:19:00Z"), lastOverAlertAt: new Date("2026-11-12T09:25:00Z") },
    { kind: "leave", staffName: "सुनीता देवी", staffId: String(U2), fromDate: "2026-11-20", toDate: "2026-11-22", days: 3, reason: "शादी", status: "pending" },
    { kind: "weekly_off", staffName: "Ravi Kumar", fromDate: "2026-11-16", toDate: "2026-11-16", status: "rejected", reviewNote: "Sale day" },
  ]);

  await StaffTask.create([
    {
      taskTitle: "Sell 2 Haier ACs", assignedStaff: "Ravi Kumar", assignedStaffId: String(U1), assignedDate: "2026-11-10", dueDate: "2026-11-15", priority: "High",
      taskType: "sales_target", targetProduct: "Haier 1.5 Ton Inverter AC", targetBrand: "Haier", targetQty: 2, targetAmount: 70000, currentQty: 1, currentAmount: 35000,
      linkedInvoiceNumber: "VP/2026-27/1042", groupId: "g-1", reminder: true,
      seenBy: [{ userId: String(U1), name: "Ravi Kumar", at: new Date("2026-11-10T05:00:00Z") }],
    },
    { taskTitle: "Clean the display", assignedStaff: "सुनीता देवी", dueDate: "2026-11-13", groupId: "g-1", status: "Completed", completedAt: new Date("2026-11-13T07:00:00Z"), completionRemarks: "Done ✔" },
  ]);
  await mongo.collection("staff_tasks").insertOne({
    _id: new ObjectId(), taskTitle: "Legacy task", assignedStaff: "Old Driver", dueDate: "2025-01-01", reminder: "true", seenBy: [{ name: "x" }, null], targetQty: "3", currentQty: 0,
    createdAt: new Date("2025-01-01T00:00:00Z"), updatedAt: new Date("2025-01-01T00:00:00Z"),
  });

  await Salary.create([
    {
      employeeName: "Ravi Kumar", employeeId: String(U1), monthlySalary: 18000, payableAmount: 17500.5, deductions: 499.5, incentives: 1200, commission: 0, paymentStatus: "Partial", month: "October 2026", year: 2026,
      history: [
        { date: "2026-11-01", amount: 10000, paymentMode: "Bank Transfer", txnRef: "NEFT1" },
        { date: "2026-11-05", amount: 5000, paymentMode: "Cash" },
        { date: "2026-11-07", amount: 2500.5, paymentMode: "UPI", txnRef: "UPI9", notes: "rest" },
      ],
    },
    { employeeName: "सुनीता देवी", employeeId: String(U2), monthlySalary: 15000, payableAmount: 15000, month: "October 2026", year: 2026 },
  ]);
  await mongo.collection("salaries").insertOne({
    // Legacy: history entries without _id, with an extra key, null, a string; year as text; a Decimal128 amount.
    _id: new ObjectId(), employeeName: "Old Driver", employeeId: "legacy", monthlySalary: Decimal128.fromString("12000.25"), payableAmount: 12000, month: "March 2025", year: "2025",
    history: [{ date: "2025-04-01", amount: "6000", approvedBy: "Admin" }, null, "paid in cash"], createdAt: new Date("2025-04-01T00:00:00Z"), updatedAt: new Date("2025-04-01T00:00:00Z"),
  });

  await IncentivePayout.create([
    { userId: String(U1), employeeName: "Ravi Kumar", amount: 1500.75, date: "2026-11-10", paymentMode: "UPI", note: "October", paidBy: "Admin", paidByUserId: "a1" },
    { userId: String(U2), employeeName: "सुनीता देवी", amount: 0.01, date: "2026-11-11", paidBy: "Admin" },
  ]);
  await ShiftSetting.create({ shiftName: "General Showroom Shift", startTime: "10:00", endTime: "21:00", lateGraceMinutes: 15, minHoursForFullDay: 7.5, allowEarlyCheckoutWithoutPenalty: true });

  const now = Date.now();
  const notes: any[] = [];
  for (let i = 0; i < NOTIFICATIONS; i++) {
    const at = new Date(now - (NOTIFICATIONS - i) * 60_000);
    notes.push({
      _id: new ObjectId(), recipientId: String(i % 3 === 0 ? U1 : U2), recipientName: i % 3 === 0 ? "Ravi Kumar" : "सुनीता देवी", type: i % 2 ? "task_assigned" : "general",
      title: `Task ${i}`, message: `New task: clean shelf ${i} 🧹`, link: "/staff/tasks", readAt: i % 4 === 0 ? new Date(at.getTime() + 1000) : null,
      refType: "task", refId: String(new ObjectId()), createdBy: "Admin", createdAt: at, updatedAt: at, __v: 0,
    });
  }
  await mongo.collection("notifications").insertMany(notes);

  await PushSubscription.create([
    { userId: String(U1), endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: "BPub_key-1", auth: "authsecret1", userAgent: "Mozilla/5.0 (Linux; Android 14)", failCount: 0, lastSuccessAt: new Date("2026-11-12T10:00:00Z") },
    { userId: String(U2), endpoint: "https://updates.push.services.mozilla.com/wpush/v2/xyz", p256dh: "BPub_key-2", auth: "authsecret2" },
  ]);
  await RolePermission.create([
    { role: "  Cashier ", permissions: ["invoices.view", "cash.close"], updatedBy: "Admin" },
    { role: "driver", permissions: [] },
  ]);
  await PriceUnlockSetting.create({ pinHash: FAKE_HASH(6), updatedBy: "Admin" });
  await ScheduledRun.create([{ key: "office-start:2026-11-12" }, { key: "office-start:2026-11-13", ranAt: new Date("2026-11-13T04:30:00Z") }]);

  await AuditLog.create([
    {
      action: "invoice.cancel", entityType: "invoice", entityRef: "VP/2026-27/1042", entityId: String(new ObjectId()), partyName: "राम कुमार", amount: 123456.78, reason: "Wrong customer",
      performedBy: "Admin", performedByUserId: "a1", performedByRole: "admin", pinVerified: true, ip: "10.0.0.1", userAgent: "Mozilla/5.0",
      metadata: { before: invoiceSnapshot(40), after: { ...invoiceSnapshot(40), status: "cancelled" } },
    },
    { action: "payment.delete", entityType: "payment", entityRef: "PAY-9", reason: "Duplicate", performedBy: "Cashier", usedLegacyPin: true, metadata: { before: { amount: 500, mode: "cash" } } },
    { action: "invoice.delete", entityType: "invoice", entityRef: "VP/2026-27/1043", reason: "Test bill", performedBy: "Admin" },
  ]);
}

// ---------------------------------------------------------------------------

async function main() {
  await startMemoryMongo("d1_staff_system_test");
  const local = await startLocalD1();
  const db = local.db;
  const mongo = mongoose.connection.db!;
  try {
    // ── 1. migration and wiring ──
    const files = await applyMigrations(db);
    const i1 = files.findIndex((f) => f.startsWith("0001_"));
    const i4 = files.indexOf("0004_staff_system.sql");
    check(i1 === 0 && i4 > i1, `0004_staff_system.sql applies after 0001 (${files.join(", ")})`);
    const masterTables = new Set(MASTER_SPECS.flatMap((s) => [s.table, ...(s.children || []).map((c) => c.table)]));
    check(STAFF_SYSTEM_SPECS.every((s) => !masterTables.has(s.table)), "no table name shared with phase 1");
    check(MINE.every((c) => ALL_SPECS.some((s) => s.collection === c)), "every staff/system spec is in the registry");
    check(STAFF_SYSTEM_SPECS.length === 13, "13 collections in this area");
    for (const spec of STAFF_SYSTEM_SPECS) {
      const model = MODELS[spec.collection];
      check(!!model && model.collection.name === spec.collection, `${spec.table}: reads Mongo collection "${spec.collection}" (the model's)`);
      const cols = (await all(db, `PRAGMA table_info(${spec.table})`)).map((c) => c.name);
      const want = tableColumns(spec);
      // Same set of columns; a column added later by ALTER TABLE sits at the end of the table, and every write names
      // its columns, so the order does not matter.
      check(JSON.stringify([...cols].sort()) === JSON.stringify([...want].sort()), `${spec.table}: columns match the mapping (${cols.length})`);
      check(want.length <= 100, `${spec.table}: ${want.length} columns ≤ 100 (one row per statement ≤ 100 params)`);
      // Every schema path is a column, a flattened sub-column, a child table or a JSON column: none goes to extra.
      const paths = new Set(Object.keys(model.schema.paths).map((p: string) => p.split(".")[0]));
      for (const p of ["_id", "__v", "createdAt", "updatedAt"]) paths.delete(p);
      const missing = [...paths].filter((p) => !spec.known.includes(p));
      check(missing.length === 0, `${spec.table}: every model field has a column (${missing.join(", ") || "none missing"})`);
      for (const child of spec.children || []) {
        const ccols = (await all(db, `PRAGMA table_info(${child.table})`)).map((c) => c.name);
        check(JSON.stringify(ccols) === JSON.stringify(child.columns), `${child.table}: columns match (${ccols.length})`);
        check(Math.floor(100 / child.columns.length) >= 1, `${child.table}: rows fit 100 params`);
      }
      const idx = await all(db, `PRAGMA index_list(${spec.table})`);
      const named = idx.filter((x) => !String(x.name).startsWith("sqlite_autoindex"));
      check(named.every((x) => x.unique === 0), `${spec.table}: ${named.length} plain (non-unique) indexes`);
    }
    const plan = await all(db, "EXPLAIN QUERY PLAN SELECT * FROM notifications WHERE recipientId = ? AND readAt IS NULL", "x");
    check(plan.some((p) => /notifications_unread|notifications_recipient/.test(p.detail)), "the bell's unread query uses an index");
    const plan2 = await all(db, "EXPLAIN QUERY PLAN SELECT * FROM attendance WHERE staffName = ? AND date = ?", "x", "y");
    check(plan2.some((p) => /attendance_staff_date/.test(p.detail)), "attendance (staffName, date) lookup uses its index");

    // ── 2. mapping without a database ──
    const att = await mapDoc(SPEC.attendance, {
      _id: new ObjectId(), staffName: " A  B ", lastPresence: { state: "in", at: new Date("2026-11-12T10:00:00Z"), accuracyM: 5 },
      awayPeriods: [{ kind: "away", leftAt: new Date("2026-11-12T09:00:00Z") }],
    });
    check(att.row.staffKey === "a b" && staffKeyOf(undefined) === "", "staffKey: trimmed, spaces collapsed, lower case");
    check(att.row.lastPresence_at === "2026-11-12T10:00:00.000Z" && att.row.lastPresence_state === "in", "lastPresence flattened, Date -> ISO");
    check(att.row.extra === '{"lastPresence":{"accuracyM":5}}', `unknown lastPresence key kept in extra: ${att.row.extra}`);
    check(att.row.awayPeriods === '[{"kind":"away","leftAt":"2026-11-12T09:00:00.000Z"}]', "awayPeriods JSON with ISO dates");
    const sal = await mapDoc(SPEC.salaries, { _id: new ObjectId("650000000000000000000009"), history: [{ _id: new ObjectId("650000000000000000000010"), date: "2026-11-01", amount: 5, x: 1 }, 7] });
    const payRows = sal.children[0].rows;
    check(payRows.length === 2 && payRows[0][2] === "650000000000000000000010" && payRows[0][8] === '{"x":1}' && payRows[1][8] === '{"value":7}', "salary history -> child rows, subdocument _id, odd entries in extra");
    const bare = await mapDoc(SPEC.users, { _id: new ObjectId("650000000000000000000002") });
    check(bare.row.email === null && bare.row.liveAuditAccess === 0 && bare.row.extra === null && bare.row.createdAt === new Date(0x65000000 * 1000).toISOString(), "empty user: NULLs, 0, ObjectId time");

    // ── 3. full copy ──
    await seed(mongo);
    // Real runs with the production defaults (18 s budget, pages of 200, batches of 20) until the full copy is through.
    const fullRuns: { ms: number; copied: number; timedOut: boolean }[] = [];
    let fullOk = true;
    for (let r = 0; r < 20; r++) {
      const t0 = Date.now();
      const res = await runD1Sync(db, { collections: MINE, reconcile: "skip" });
      fullOk = fullOk && res.ok && res.errors === 0;
      fullRuns.push({ ms: Date.now() - t0, copied: Object.values(res.collections).reduce((n, c) => n + c.copied, 0), timedOut: res.timedOut });
      if (MINE.every((c) => res.collections[c]?.fullCopyDone)) break;
    }
    const totalDocs = fullRuns.reduce((n, r) => n + r.copied, 0);
    const totalMs = fullRuns.reduce((n, r) => n + r.ms, 0);
    console.log(`  info full copy (${NOTIFICATIONS} notifications + the rest): ${fullRuns.map((r) => `${r.copied} docs / ${r.ms} ms${r.timedOut ? " (time box)" : ""}`).join("; ")} => ${Math.round((totalDocs / Math.max(totalMs, 1)) * 1000)} docs/s on local D1`);
    check(fullOk, `full copy: no errors over ${fullRuns.length} run(s)`);
    check(fullRuns.every((r) => r.ms < 25_000), "every run stays within the time box (18 s budget + the page in flight)");
    const fullState = await all(db, `SELECT fullCopyDoneAt FROM sync_state WHERE collection IN (${MINE.map(() => "?").join(", ")})`, ...MINE);
    check(fullState.length === MINE.length && fullState.every((s) => !!s.fullCopyDoneAt), "every collection finished its full copy");
    for (const spec of STAFF_SYSTEM_SPECS) {
      const m = await mongo.collection(spec.collection).countDocuments();
      const d = await count(db, spec.table);
      check(m === d && m > 0, `${spec.collection}: Mongo ${m} = D1 ${d}`);
    }
    const histTotal = (await mongo.collection("salaries").find().toArray()).reduce((n: number, s: any) => n + (Array.isArray(s.history) ? s.history.length : 0), 0);
    check((await count(db, "salaryPayments")) === histTotal, `salaryPayments rows = history entries (${histTotal})`);

    let ll = await losslessFailures(db, mongo);
    check(ll.bad.length === 0, `lossless: ${ll.checked} documents rebuilt from D1 equal Mongo (${ll.bad.slice(0, 5).join("; ") || "all equal"})`);

    // The check itself catches a lost field: drop one value from a D1 row, then put it back.
    const victim = await one(db, "SELECT id, extra FROM users WHERE email = 'driver@example.com'");
    const victimPay = await one(db, "SELECT salaryId, idx, extra FROM salaryPayments WHERE extra IS NOT NULL LIMIT 1");
    await db.prepare("UPDATE users SET extra = NULL WHERE id = ?").bind(victim.id).run();
    await db.prepare("UPDATE salaryPayments SET extra = NULL WHERE salaryId = ? AND idx = ?").bind(victimPay.salaryId, victimPay.idx).run();
    const sabotaged = await losslessFailures(db, mongo);
    check(sabotaged.bad.length === 2, `the lossless check flags a dropped field and a dropped child value (${sabotaged.bad.length} flagged)`);
    await db.prepare("UPDATE users SET extra = ? WHERE id = ?").bind(victim.extra, victim.id).run();
    await db.prepare("UPDATE salaryPayments SET extra = ? WHERE salaryId = ? AND idx = ?").bind(victimPay.extra, victimPay.salaryId, victimPay.idx).run();

    // Spot checks (secrets compared, never printed).
    const ravi = await one(db, "SELECT * FROM users WHERE id = ?", String(U1));
    const raviRaw = await mongo.collection("users").findOne({ _id: U1 });
    check(ravi.password === raviRaw!.password && ravi.securityPin === raviRaw!.securityPin && ravi.bankAccountNo === raviRaw!.bankAccountNo && ravi.idProofNumber === raviRaw!.idProofNumber, "user secrets and bank / ID details copied exactly (select:false fields included)");
    check(ravi.pinFailCount === 2 && ravi.unlockPinFailCount === 1 && ravi.pinLockedUntil === "2026-11-13T10:00:00.000Z" && ravi.liveAuditAccess === 1, "PIN lockout fields copied");
    check(ravi.assignedBrands === '["LG","Samsung"]' && ravi.advanceBalance === 2500 && ravi.monthlySalary === 18000.5, "assignedBrands JSON, money REAL");
    const ci = await one(db, "SELECT id FROM users WHERE email = ? COLLATE NOCASE", "sunita@example.com");
    check(ci?.id === String(U2), "email lookup is case-insensitive");
    const drv = await one(db, "SELECT * FROM users WHERE email = 'driver@example.com'");
    check(drv.mobile === "9876543210" && drv.role === "courier" && drv.assignedBrands === '"LG"' && drv.liveAuditAccess === 1 && drv.v === 2 && drv.extra === '{"legacyCode":{"a":1}}', "legacy user: number mobile, off-enum role, string brands, 'true' boolean, __v, unknown field");
    const ne = await one(db, "SELECT * FROM users WHERE name = 'No Email'");
    check(ne.email === null && ne.createdAt === "2024-01-05T00:00:00.000Z" && ne.updatedAt === "2026-01-01T00:00:00.000Z", "legacy user: string createdAt");
    const a1 = await one(db, "SELECT * FROM attendance WHERE staffName = 'Ravi Kumar' AND date = '2026-11-12'");
    const away = JSON.parse(a1.awayPeriods);
    check(away.length === 3 && away[1].breakEndsAt === "2026-11-12T09:30:00.000Z" && away[2].endUncertain === true && !("backAt" in away[2]), "awayPeriods: 3 periods, dates ISO, optional fields as in Mongo");
    check(a1.lastPresence_state === "in" && a1.lastPresence_lat === 26.76061 && a1.isLate === 1 && a1.checkInDistanceM === 12.4 && a1.staffKey === "ravi kumar", "lastPresence flattened, booleans, geo numbers");
    const a2 = await one(db, "SELECT * FROM attendance WHERE userId = ?", String(U2));
    check(a2.staffKey === "सुनीता देवी" && a2.awayPeriods === null && a2.lastPresence_state === null, "attendance without presence: NULLs; unicode staffKey");
    check((await one(db, "SELECT awayPeriods FROM attendance WHERE date = '2026-11-11'")).awayPeriods === "[]", "empty awayPeriods stays [] (not NULL)");
    const aLeg = await one(db, "SELECT * FROM attendance WHERE staffName = 'Legacy'");
    check(aLeg.lastPresence_at === "2025-03-01T12:00:00.000Z" && aLeg.isLate === 1 && aLeg.extra === '{"gps":[1,2],"lastPresence":{"accuracyM":30}}', "legacy attendance: string date, unknown keys in extra");
    const task = await one(db, "SELECT * FROM staffTasks WHERE taskType = 'sales_target'");
    check(JSON.parse(task.seenBy)[0].at === "2026-11-10T05:00:00.000Z" && task.targetQty === 2 && task.currentQty === 1 && task.reminder === 1 && task.groupId === "g-1", "task: seenBy JSON, target fields");
    check((await one(db, "SELECT seenBy FROM staffTasks WHERE taskTitle = 'Clean the display'")).seenBy === "[]", "task default seenBy [] kept");
    const tLeg = await one(db, "SELECT * FROM staffTasks WHERE taskTitle = 'Legacy task'");
    check(tLeg.targetQty === 3 && tLeg.reminder === 1 && tLeg.seenBy === '[{"name":"x"},null]', "legacy task: string number, string boolean, odd seenBy kept");
    const sLeg = await one(db, "SELECT * FROM salaries WHERE employeeId = 'legacy'");
    const sLegPays = await all(db, "SELECT * FROM salaryPayments WHERE salaryId = ? ORDER BY idx", sLeg.id);
    check(sLeg.year === 2025 && sLeg.monthlySalary === 12000.25 && sLegPays.length === 3 && sLegPays[0].amount === 6000 && sLegPays[0].id === null && sLegPays[0].extra === '{"approvedBy":"Admin"}' && sLegPays[1].extra === '{"value":null}' && sLegPays[2].extra === '{"value":"paid in cash"}', "legacy salary: Decimal128, year text, history without _id / null / string entries kept in order");
    const pays = await all(db, "SELECT * FROM salaryPayments WHERE salaryId = (SELECT id FROM salaries WHERE employeeId = ?) ORDER BY idx", String(U1));
    check(pays.length === 3 && pays.every((p) => /^[0-9a-f]{24}$/.test(p.id)) && pays[2].amount === 2500.5 && pays[2].notes === "rest", "salary history: 3 payments with their subdocument ids");
    check((await one(db, "SELECT role, permissions FROM rolePermissions WHERE role = 'cashier'"))?.permissions === '["invoices.view","cash.close"]', "role lowercased/trimmed by the model, permissions JSON");
    const pu = await one(db, "SELECT * FROM priceUnlockSettings");
    check(pu.key === "price-unlock" && pu.pinHash === (await mongo.collection("price_unlock_settings").findOne())!.pinHash, "price-unlock pinHash copied exactly");
    check((await one(db, "SELECT ranAt FROM scheduledRuns WHERE key = 'office-start:2026-11-13'")).ranAt === "2026-11-13T04:30:00.000Z", "scheduledRuns: key, ranAt ISO");
    const ps = await one(db, "SELECT * FROM pushSubscriptions WHERE userId = ?", String(U2));
    check(ps.lastSuccessAt === null && ps.failCount === 0 && ps.auth === "authsecret2", "push subscription: null lastSuccessAt");
    const unread = await one(db, "SELECT COUNT(*) AS n FROM notifications WHERE recipientId = ? AND readAt IS NULL", String(U1));
    const unreadMongo = await mongo.collection("notifications").countDocuments({ recipientId: String(U1), readAt: null });
    check(Number(unread.n) === unreadMongo, `unread notifications for one user: D1 ${unread.n} = Mongo ${unreadMongo}`);
    const al = await one(db, "SELECT * FROM auditLogs WHERE action = 'invoice.cancel'");
    const alRaw = await mongo.collection("audit_logs").findOne({ action: "invoice.cancel" });
    check(al.metadata === canonicalJson(alRaw!.metadata) && JSON.parse(al.metadata).before.items.length === 40 && al.pinVerified === 1, `audit metadata before/after kept whole as JSON (${al.metadata.length} bytes)`);
    check((await one(db, "SELECT metadata FROM auditLogs WHERE action = 'invoice.delete'")).metadata === null, "audit log without metadata: NULL");

    // A second run straight after copies nothing.
    const idle = await runD1Sync(db, { collections: MINE, reconcile: "skip" });
    check(idle.ok && MINE.every((c) => idle.collections[c].mode === "incremental" && idle.collections[c].copied === 0), "second run: incremental, nothing rewritten");

    // ── 4. incremental: the app's real write shapes ──
    const att1 = await Attendance.findOne({ staffName: "Ravi Kumar", date: "2026-11-12" });
    await Attendance.updateOne(
      { _id: att1!._id },
      { $push: { awayPeriods: { kind: "away", leftAt: new Date("2026-11-12T15:40:00Z"), minutes: 3 } }, $set: { "lastPresence.state": "out", "lastPresence.at": new Date("2026-11-12T15:40:00Z") }, $inc: { totalAwayMinutes: 3 } }
    );
    const t1 = await StaffTask.findOne({ taskType: "sales_target" });
    await StaffTask.updateOne({ _id: t1!._id }, { $push: { seenBy: { userId: String(U2), name: "सुनीता देवी", at: new Date() } }, $inc: { currentQty: 1, currentAmount: 35000 } });
    const s1 = await Salary.findOne({ employeeId: String(U1) });
    s1!.history.push({ date: "2026-11-12", amount: 499.5, paymentMode: "Cash" } as any);
    s1!.paymentStatus = "Paid";
    await s1!.save();
    await User.updateOne({ _id: U1 }, { $set: { password: FAKE_HASH(99) }, $inc: { advanceBalance: -500 } });
    const firstUnread = await Notification.findOne({ recipientId: String(U1), readAt: null }).sort({ createdAt: -1 });
    await Notification.updateOne({ _id: firstUnread!._id }, { $set: { readAt: new Date() } });
    await Notification.create({ recipientId: String(U2), title: "Approval needed", type: "approval_request", link: "/approvals" });
    await AuditLog.create({ action: "invoice.cancel", entityType: "invoice", entityRef: "VP/2026-27/1050", reason: "Customer returned", performedBy: "Admin", metadata: { before: invoiceSnapshot(3) } });
    await ScheduledRun.create({ key: "office-start:2026-11-14" });
    await LeaveRequest.updateOne({ status: "pending" }, { $set: { status: "approved", reviewedBy: "Admin", reviewedAt: new Date() } });

    const incr = await runD1Sync(db, { collections: MINE, reconcile: "skip" });
    const copied = (c: string) => incr.collections[c].copied;
    check(incr.ok && copied("attendance") === 1 && copied("staff_tasks") === 1 && copied("salaries") === 1 && copied("users") === 1 && copied("notifications") === 2 && copied("audit_logs") === 1 && copied("scheduled_runs") === 1 && copied("leaverequests") === 1,
      `incremental copied exactly the changed documents (${MINE.map((c) => `${c} ${copied(c)}`).join(", ")})`);
    const a1b = await one(db, "SELECT * FROM attendance WHERE id = ?", String(att1!._id));
    check(JSON.parse(a1b.awayPeriods).length === 4 && a1b.lastPresence_state === "out" && a1b.lastPresence_lat === 26.76061 && a1b.totalAwayMinutes === 28, "presence update reached D1 (awayPeriods rewritten whole, lastPresence merged)");
    const t1b = await one(db, "SELECT * FROM staffTasks WHERE id = ?", String(t1!._id));
    check(JSON.parse(t1b.seenBy).length === 2 && t1b.currentQty === 2 && t1b.currentAmount === 70000, "seenBy push and target $inc reached D1");
    const s1Pays = await all(db, "SELECT * FROM salaryPayments WHERE salaryId = ? ORDER BY idx", String(s1!._id));
    check(s1Pays.length === 4 && s1Pays[3].amount === 499.5 && (await count(db, "salaryPayments")) === histTotal + 1, "salary payment added; child rows replaced, not duplicated");
    const raviB = await one(db, "SELECT password, advanceBalance FROM users WHERE id = ?", String(U1));
    check(raviB.password === (await mongo.collection("users").findOne({ _id: U1 }))!.password && raviB.advanceBalance === 2000, "password change and advanceBalance $inc reached D1");
    check((await one(db, "SELECT readAt FROM notifications WHERE id = ?", String(firstUnread!._id))).readAt !== null, "notification marked read");

    // ── 5. nightly reconciliation ──
    const goneSalary = await Salary.findOne({ employeeId: String(U2) });
    await Salary.deleteOne({ _id: goneSalary!._id });
    await Salary.updateOne({ employeeId: "legacy" }, { $set: { notes: "x" } }); // so it has children to keep
    const goneNote = await Notification.findOne({ recipientId: String(U2) });
    await Notification.deleteOne({ _id: goneNote!._id });
    // A raw write that leaves updatedAt old: only the nightly repair sees it.
    await mongo.collection("users").updateOne({ _id: U2 }, { $set: { pinFailCount: 3, updatedAt: new Date("2025-01-01T00:00:00Z") } });
    const rec = await runD1Sync(db, { collections: MINE, reconcile: "force" });
    check(rec.ok && rec.collections.salaries.reconcile?.deleted === 1 && rec.collections.notifications.reconcile?.deleted === 1, "reconcile deleted the gone salary and notification");
    check(rec.collections.users.reconcile?.repaired === 1 && (await one(db, "SELECT pinFailCount FROM users WHERE id = ?", String(U2))).pinFailCount === 3, "reconcile repaired the user changed behind updatedAt");
    check(!(await one(db, "SELECT id FROM salaries WHERE id = ?", String(goneSalary!._id))) && (await all(db, "SELECT * FROM salaryPayments WHERE salaryId = ?", String(goneSalary!._id))).length === 0, "deleted salary and its payment rows gone");

    // ── 6. counts and hashes match ──
    const status = await getD1SyncStatus(db, { sampleSize: 5000 });
    for (const cs of status.collections.filter((c) => MINE.includes(c.collection))) {
      check(cs.mongoCount === cs.d1Count && !cs.error && !!cs.sample && cs.sample.size === cs.mongoCount && cs.sample.mismatched === 0 && cs.sample.missing === 0,
        `status ${cs.collection}: Mongo ${cs.mongoCount} = D1 ${cs.d1Count}, ${cs.sample?.size} hashes match`);
    }
    ll = await losslessFailures(db, mongo);
    check(ll.bad.length === 0, `lossless after incremental + reconcile: ${ll.checked} documents (${ll.bad.slice(0, 5).join("; ") || "all equal"})`);

    // ── 7. audit log size: a big one is copied whole; one over D1's 2 MB is reported, never cut ──
    const big = await AuditLog.create({ action: "items.vp-code-import", entityType: "item", entityRef: "bulk", reason: "import", performedBy: "Admin", metadata: { before: invoiceSnapshot(2000, 600) } });
    const bigLen = canonicalJson(big.toObject().metadata).length;
    const bigRun = await runD1Sync(db, { collections: ["audit_logs"], reconcile: "skip" });
    const bigRow = await one(db, "SELECT length(CAST(metadata AS BLOB)) AS n, metadata FROM auditLogs WHERE id = ?", String(big._id));
    check(bigRun.ok && bigRow && Number(bigRow.n) === Buffer.byteLength(bigRow.metadata) && bigRow.metadata.length === bigLen && bigLen > 1_000_000 && bigLen < 2_000_000, `a ${(bigLen / 1e6).toFixed(2)} MB before/after is copied whole (under 2 MB)`);
    const huge = await AuditLog.create({ action: "items.gst-fix", entityType: "item", entityRef: "bulk", reason: "too big", performedBy: "Admin", metadata: { items: "z".repeat(2_100_000) } });
    const after = await AuditLog.create({ action: "payment.delete", entityType: "payment", entityRef: "PAY-10", reason: "after the huge one", performedBy: "Admin" });
    const hugeRun = await runD1Sync(db, { collections: ["audit_logs"], reconcile: "skip" });
    const hugeRow = await one(db, "SELECT length(metadata) AS n FROM auditLogs WHERE id = ?", String(huge._id));
    const hugeErr = await one(db, "SELECT * FROM sync_errors WHERE docId = ?", String(huge._id));
    check(!!(await one(db, "SELECT id FROM auditLogs WHERE id = ?", String(after._id))), "the document after an oversized one is still copied");
    check(!hugeRow || Number(hugeRow.n) === 2_100_000 + '{"items":""}'.length, "an oversized row is never truncated");
    if (hugeRow) {
      console.log("  info local D1 (Miniflare) accepted a row over 2 MB; real D1 rejects it, and the batch-retry path then logs it to sync_errors");
    } else {
      check(!hugeRun.ok && !!hugeErr && hugeErr.collection === "audit_logs", `an audit log over 2 MB is reported in sync_errors (${String(hugeErr?.message || "").slice(0, 80)})`);
    }
    await AuditLog.deleteOne({ _id: huge._id });
    await db.prepare("DELETE FROM auditLogs WHERE id = ?").bind(String(huge._id)).run();
    await db.prepare("DELETE FROM sync_errors").run();

    // ── 8. time-boxing: the notification volume over many short runs ends in the same state ──
    await clearMine(db);
    let fake = 0;
    const clock = () => (fake += 1000);
    let runs = 0;
    let timedOutRuns = 0;
    const perRun: number[] = [];
    for (; runs < 200; runs++) {
      const r = await runD1Sync(db, { collections: MINE, budgetMs: 6000, budgetClock: clock, pageSize: 200, reconcile: "skip" });
      if (r.timedOut) timedOutRuns++;
      perRun.push(Object.values(r.collections).reduce((n, c) => n + c.copied, 0));
      if (runs === 0) {
        check(r.timedOut, "first time-boxed run stopped at its budget");
      }
      const done = await all(db, `SELECT fullCopyDoneAt FROM sync_state WHERE collection IN (${MINE.map(() => "?").join(", ")})`, ...MINE);
      if (done.length === MINE.length && done.every((d) => d.fullCopyDoneAt)) break;
    }
    check(timedOutRuns > 1 && runs < 200, `full copy finished over ${runs + 1} short runs (${timedOutRuns} cut by the time box; copied per run: ${perRun.join(", ")})`);
    const final = await getD1SyncStatus(db, { sampleSize: 5000 });
    check(final.collections.filter((c) => MINE.includes(c.collection)).every((c) => c.mongoCount === c.d1Count && c.sample?.mismatched === 0 && c.sample?.missing === 0), "after resuming: every count and hash matches");
    const histNow = (await mongo.collection("salaries").find().toArray()).reduce((n: number, s: any) => n + (Array.isArray(s.history) ? s.history.length : 0), 0);
    check((await count(db, "salaryPayments")) === histNow, `salaryPayments = history entries (${histNow}), none duplicated by resuming`);
    check((await count(db, "sync_errors")) === 0, "no errors in the time-boxed runs");
  } finally {
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-staff-system") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
