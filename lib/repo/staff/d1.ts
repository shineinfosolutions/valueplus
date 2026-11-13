/**
 * Stage B2 of docs/D1_MIGRATION_PLAN.md, STAFF & SYSTEM area: the D1 versions of the reads in
 * lib/repo/staff/mongo.ts, one for one, giving the same JSON (field names, nested arrays such as awayPeriods / seenBy /
 * salary history, `_id` as its 24-hex text, numbers / dates / booleans, the same filters, sort and limit, and the
 * secret fields exactly where the Mongo read has them). How a row becomes the document: lib/repo/staff/rebuild.ts.
 *
 * Translation rules (lib/repo/staff/INVENTORY.md has the per-read notes):
 *  - a find with no sort (Mongo's natural order = insertion order) -> ORDER BY id (an ObjectId's text sorts by its
 *    creation time); every sort ends with `id` so rows with equal sort keys come in natural order;
 *  - Mongo's null / missing ordering (first when ascending) is SQLite's NULL ordering;
 *  - an equality on a string field is `col = ?` (case-sensitive, like Mongo); `{ $ne: x }` / `{ $nin: [...] }` also
 *    match a missing field, so they are `(col IS NULL OR col <> ?)`;
 *  - an escaped, anchored, case-insensitive regex is `col LIKE ? ESCAPE '\'` on the literal text; an unanchored one
 *    is `LIKE '%…%'`. LIKE folds the case of ASCII letters only (Mongo's /i folds other alphabets too);
 *  - Dates are ISO-8601 UTC text in D1, so a Date comparison binds `date.toISOString()`;
 *  - `$elemMatch` on awayPeriods is checked in JS on the parsed JSON array.
 *
 * The database is the Worker's D1 binding (lib/d1/client.ts), or the one given to setStaffD1 (tests).
 */
import { getD1 } from "@/lib/d1/client";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { istDayEnd, istDayStart } from "@/lib/ist";
import { IN_JSON, PCRE_WS, all, castError, hydrateJson, isObjectIdHex, likeLiteral, project, rowsToDocs, type Row } from "./rebuild";
import { STAFF_ROLES, TASK_MANAGER_ROLES } from "./constants";
import type { AttendanceListArgs, AuditListArgs, LeaveListArgs, TaskListArgs } from "./types";

let override: D1DatabaseLike | null = null;

/** Use this database instead of the Worker binding (tests); null goes back to the binding. */
export function setStaffD1(db: D1DatabaseLike | null) {
  override = db;
}

function d1(): D1DatabaseLike {
  const db = override ?? getD1();
  if (!db) throw new Error("D1 is not available here");
  return db;
}

/** SELECT * from a table, rebuilt into the Mongo documents (in the query's order). */
async function docs(collection: string, table: string, where: string, order: string, args: unknown[], limit?: number): Promise<any[]> {
  const db = d1();
  const sql = `SELECT * FROM ${table}${where ? ` WHERE ${where}` : ""} ORDER BY ${order}${limit !== undefined ? ` LIMIT ${Math.trunc(limit)}` : ""}`;
  const rows = await all(db, sql, ...args);
  return rowsToDocs(db, collection, rows);
}

const ESC = "ESCAPE '\\'";
/** The value of an anchored /^x$/i on `col`. */
const likeExact = (col: string) => `${col} LIKE ? ${ESC}`;
/** `^\s*x\s*$` with /i on `col` (app/api/staff/tasks exactName). */
const likeExactTrimmed = (col: string) => `trim(${col}, ?) LIKE ? ${ESC}`;
const ACTIVE_SQL = "(status = 'active' OR status IS NULL)";

function idArg(id: string): string {
  if (!isObjectIdHex(id)) throw castError(id);
  return id.toLowerCase();
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export async function usersList() {
  const list = await docs("users", "users", "", "createdAt DESC, id", []);
  return list.map((u) => project("users", u, "-password"));
}

export async function authLoginLookup(inputIdentifier: string) {
  const list = await docs("users", "users", `${likeExact("email")} OR mobile = ?`, "id", [likeLiteral(inputIdentifier), inputIdentifier], 1);
  return list.length ? project("users", list[0], undefined) : null;
}

export async function usersFindById(id: string, select?: string) {
  const list = await docs("users", "users", "id = ?", "id", [idArg(id)], 1);
  return list.length ? project("users", list[0], select) : null;
}

export async function usersActive() {
  const list = await docs("users", "users", "status = 'active'", "id", []);
  return list.map((u) => project("users", u, undefined));
}

export async function usersDirectory() {
  const list = await docs("users", "users", "role IS NULL OR role NOT IN ('supplier', 'vendor')", "name, id", []);
  return list.map((u) => project("users", u, "name email role mobile designation status joiningDate assignedBrand"));
}

export async function usersSecurityPinState(id: string) {
  const list = await docs("users", "users", "id = ?", "id", [idArg(id)], 1);
  return list.length ? hydrateJson("users", list[0], "+securityPin +pinLockedUntil") : null;
}

export async function usersIdByExactName(name: string) {
  const list = await docs("users", "users", likeExactTrimmed("name"), "id", [PCRE_WS, likeLiteral(name.trim())], 1);
  return list.length ? project("users", list[0], { _id: 1 }) : null;
}

export async function usersNotifyById(assigneeId: string) {
  if (!isObjectIdHex(assigneeId)) return [];
  const list = await docs("users", "users", "id = ?", "id", [assigneeId.toLowerCase()]);
  return list.map((u) => project("users", u, { name: 1 }));
}

export async function usersNotifyAllStaff() {
  const list = await docs("users", "users", `${ACTIVE_SQL} AND (role IS NULL OR role NOT IN ('admin', 'superadmin'))`, "id", []);
  return list.map((u) => project("users", u, { name: 1 }));
}

export async function usersNotifySalesStaff() {
  const list = await docs("users", "users", `${ACTIVE_SQL} AND role IN ('salesman', 'sales')`, "id", []);
  return list.map((u) => project("users", u, { name: 1 }));
}

export async function usersNotifyByName(name: string) {
  const list = await docs("users", "users", likeExact("name"), "id", [likeLiteral(name)]);
  return list.map((u) => project("users", u, { name: 1 }));
}

export async function usersNotifyRoles(roles: string[]) {
  const list = await docs("users", "users", `${ACTIVE_SQL} AND ${IN_JSON("role")}`, "id", [JSON.stringify(roles)]);
  return list.map((u) => project("users", u, { name: 1 }));
}

export async function usersNotifyEmail(e: string) {
  const list = await docs("users", "users", likeExact("email"), "id", [likeLiteral(e)]);
  return list.map((u) => project("users", u, { name: 1 }));
}

export async function usersWorkingStaff() {
  const list = await docs(
    "users",
    "users",
    `${IN_JSON("role")} AND (status IS NULL OR status NOT IN ('inactive', 'terminated', 'suspended'))`,
    "id",
    [JSON.stringify(STAFF_ROLES)]
  );
  return list.map((u) => project("users", u, "name role"));
}

// ---------------------------------------------------------------------------
// role permissions
// ---------------------------------------------------------------------------

export async function rolePermissionsAll() {
  return docs("role_permissions", "rolePermissions", "", "id", []);
}

// ---------------------------------------------------------------------------
// attendance
// ---------------------------------------------------------------------------

export async function attendanceList(a: AttendanceListArgs) {
  const { dateParam, staffName, staffId, month, today } = a;
  const where: string[] = [];
  const args: unknown[] = [];
  let date: string | undefined;
  if (dateParam && dateParam !== "all") date = dateParam;
  else if (!dateParam && !month) date = today;
  let monthRx: RegExp | null = null;
  if (month) {
    date = undefined;
    // The route's `{ $regex: "^" + month }`: a plain prefix in SQL; anything with regex syntax is checked in JS.
    if (/^[A-Za-z0-9 _-]*$/.test(month)) {
      where.push("substr(date, 1, ?) = ?");
      args.push(month.length, month);
    } else {
      monthRx = new RegExp(`^${month}`);
      where.push("date IS NOT NULL");
    }
  }
  if (date !== undefined) {
    where.push("date = ?");
    args.push(date);
  }
  if (staffName && staffName !== "all") {
    where.push("staffName = ?");
    args.push(staffName);
  }
  if (staffId) {
    where.push("staffId = ?");
    args.push(staffId);
  }
  let list = await docs("attendance", "attendance", where.join(" AND "), "date DESC, createdAt DESC, id", args);
  if (monthRx) list = list.filter((r) => typeof r.date === "string" && monthRx!.test(r.date));
  return list;
}

export async function attendancePhotoRef(id: string) {
  const list = await docs("attendance", "attendance", "id = ?", "id", [idArg(id)], 1);
  return list.length ? project("attendance", list[0], "checkInPhotoKey userId staffId staffName") : null;
}

export async function attendanceBetween(from: string, to: string) {
  return docs("attendance", "attendance", "date >= ? AND date <= ?", "date DESC, id", [from, to]);
}

export async function attendanceOverviewDay(today: string) {
  const list = await docs("attendance", "attendance", "date = ?", "id", [today]);
  return list.map((r) => project("attendance", r, { staffName: 1, checkInTime: 1, checkOutTime: 1, status: 1, lateMinutes: 1, isLate: 1 }));
}

export async function attendanceRecentForStaff(staffName: string) {
  return docs("attendance", "attendance", "staffName = ?", "date DESC, id", [staffName], 60);
}

export async function attendancePresenceRows(date: string, staff?: string | null) {
  const where = ["date = ?"];
  const args: unknown[] = [date];
  if (staff) {
    where.push("staffName = ?");
    args.push(staff);
  }
  const list = await docs("attendance", "attendance", where.join(" AND "), "staffName, id", args);
  return list.map((r) =>
    project("attendance", r, "staffName staffRole date checkInTime checkOutTime awayPeriods totalAwayMinutes unknownMinutes lastPresence")
  );
}

export async function attendanceDayCheckins(day: string) {
  const list = await docs("attendance", "attendance", "date = ?", "id", [day]);
  return list.map((r) => project("attendance", r, { staffName: 1, checkInTime: 1, status: 1 }));
}

export async function attendanceFindByStaffDate(staffName: string, date: string) {
  const list = await docs("attendance", "attendance", "staffName = ? AND date = ?", "id", [staffName, date], 1);
  return list.length ? hydrateJson("attendance", list[0]) : null;
}

export async function attendanceAutoCheckoutCandidates(day: string) {
  const list = await docs(
    "attendance",
    "attendance",
    [
      "checkInTime IS NOT NULL AND checkInTime NOT IN ('', '--')",
      "(checkOutTime IS NULL OR checkOutTime = '' OR checkOutTime = '--')",
      "(status IS NULL OR status <> 'On Leave')",
      "date <= ?",
    ].join(" AND "),
    "id",
    [day]
  );
  return list.map((r) => hydrateJson("attendance", r));
}

const isObj = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v);

export async function attendanceOpenAway(today: string) {
  const list = await docs("attendance", "attendance", "date = ? AND awayPeriods IS NOT NULL", "id", [today]);
  return list
    .filter((r) => Array.isArray(r.awayPeriods) && r.awayPeriods.some((p: any) => isObj(p) && !("backAt" in p) && ["away", "break"].includes(p.kind)))
    .map((r) => hydrateJson("attendance", r));
}

// ---------------------------------------------------------------------------
// leave requests
// ---------------------------------------------------------------------------

export async function leaveList(a: LeaveListArgs) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (a.status) {
    where.push("status = ?");
    args.push(a.status);
  }
  if (a.mineOf) {
    where.push("(staffId = ? OR staffName = ?)");
    args.push(a.mineOf.id, a.mineOf.name);
  } else if (a.kinds) {
    where.push(IN_JSON("kind"));
    args.push(JSON.stringify(a.kinds));
  }
  return docs("leaverequests", "leaveRequests", where.join(" AND "), "createdAt DESC, id", args, 1000);
}

export async function leaveForStaffBetween(from: string, to: string, staffId: string, staffName: string) {
  return docs("leaverequests", "leaveRequests", "fromDate <= ? AND toDate >= ? AND (staffId = ? OR staffName = ?)", "fromDate DESC, id", [to, from, staffId, staffName]);
}

export async function leaveApprovedAwayOn(day: string) {
  const list = await docs(
    "leaverequests",
    "leaveRequests",
    "status = 'approved' AND (kind IS NULL OR kind <> 'break') AND fromDate <= ? AND toDate >= ?",
    "id",
    [day, day]
  );
  return list.map((r) => project("leaverequests", r, { staffName: 1 }));
}

export async function leaveBreakOverCandidates(now: Date) {
  const list = await docs(
    "leaverequests",
    "leaveRequests",
    "kind = 'break' AND status = 'approved' AND breakStartedAt IS NOT NULL AND breakEndsAt <= ? AND breakReturnedAt IS NULL",
    "id",
    [now.toISOString()]
  );
  return list.map((r) => hydrateJson("leaverequests", r));
}

export async function leaveRunningBreak(staffName: string, now: Date) {
  const iso = now.toISOString();
  const list = await docs(
    "leaverequests",
    "leaveRequests",
    "staffName = ? AND kind = 'break' AND status = 'approved' AND breakStartedAt <= ? AND breakEndsAt >= ? AND breakReturnedAt IS NULL",
    "id",
    [staffName, iso, iso],
    1
  );
  return list.length ? project("leaverequests", list[0], "breakEndsAt") : null;
}

// ---------------------------------------------------------------------------
// staff tasks
// ---------------------------------------------------------------------------

export async function tasksList(a: TaskListArgs) {
  const { actor, staff: assignedStaff, status } = a;
  const where: string[] = [];
  const args: unknown[] = [];
  const or: string[] = [];
  const exact = (col: string, name: string) => {
    or.push(likeExactTrimmed(col));
    args.push(PCRE_WS, likeLiteral(name.trim()));
  };
  const equals = (col: string, v: string) => {
    or.push(`${col} = ?`);
    args.push(v);
  };
  if (!TASK_MANAGER_ROLES.includes(actor.role)) {
    const isSales = ["salesman", "sales"].includes(actor.role);
    if (actor.id) equals("assignedStaffId", actor.id);
    exact("assignedStaff", actor.name);
    equals("assignedStaff", "All Staff");
    if (isSales) equals("assignedStaff", "Sales Staff");
    exact("createdBy", actor.name);
  } else if (assignedStaff && assignedStaff !== "all") {
    exact("assignedStaff", assignedStaff);
    equals("assignedStaff", "All Staff");
    equals("assignedStaff", "Sales Staff");
  }
  if (or.length) where.push(`(${or.join(" OR ")})`);
  if (status && status !== "all") {
    where.push("status = ?");
    args.push(status);
  }
  return docs("staff_tasks", "staffTasks", where.join(" AND "), "dueDate, createdAt DESC, id", args);
}

export async function tasksOwnership() {
  const list = await docs("staff_tasks", "staffTasks", "", "id", []);
  return list.map((t) => project("staff_tasks", t, { assignedStaff: 1, assignedStaffId: 1, status: 1 }));
}

export async function tasksFindById(id: string) {
  const list = await docs("staff_tasks", "staffTasks", "id = ?", "id", [idArg(id)], 1);
  return list.length ? list[0] : null;
}

// ---------------------------------------------------------------------------
// salaries and incentive payouts
// ---------------------------------------------------------------------------

export async function salariesList(month?: string | null, employeeId?: string | null) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (month) {
    where.push("month = ?");
    args.push(month);
  }
  if (employeeId) {
    where.push("employeeId = ?");
    args.push(employeeId);
  }
  const list = await docs("salaries", "salaries", where.join(" AND "), "employeeName, id", args);
  return list.map((s) => hydrateJson("salaries", s));
}

export async function salariesPaidIncentives() {
  const list = await docs("salaries", "salaries", "paymentStatus = 'Paid'", "id", []);
  return list.map((s) => project("salaries", s, { employeeName: 1, incentives: 1 }));
}

export async function payoutsForUser(userId: string, limit?: number) {
  return docs("incentive_payouts", "incentivePayouts", "userId = ?", "date DESC, createdAt DESC, id", [userId], limit ? Math.abs(limit) : undefined);
}

export async function payoutsAmounts() {
  const list = await docs("incentive_payouts", "incentivePayouts", "", "id", []);
  return list.map((p) => project("incentive_payouts", p, { userId: 1, amount: 1 }));
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export async function shiftLatest() {
  const list = await docs("shift_settings", "shiftSettings", "", "updatedAt DESC, id", [], 1);
  return list.length ? hydrateJson("shift_settings", list[0]) : null;
}

export async function priceUnlockSetting() {
  const list = await docs("price_unlock_settings", "priceUnlockSettings", "key = 'price-unlock'", "id", [], 1);
  return list.length ? list[0] : null;
}

export async function scheduledRunExists(key: string) {
  const rows = await all(d1(), "SELECT id FROM scheduledRuns WHERE key = ? ORDER BY id LIMIT 1", key);
  return rows.length ? { _id: rows[0].id } : null;
}

// ---------------------------------------------------------------------------
// notifications and push
// ---------------------------------------------------------------------------

export async function notificationsLatest(recipientId: string) {
  return docs("notifications", "notifications", "recipientId = ?", "createdAt DESC, id", [recipientId], 30);
}

export async function notificationsUnreadCount(recipientId: string) {
  const rows = await all(d1(), "SELECT COUNT(*) AS n FROM notifications WHERE recipientId = ? AND readAt IS NULL", recipientId);
  return Number(rows[0]?.n ?? 0);
}

export async function notificationsUnreadTaskRefs(recipientId: string, id?: string) {
  const where = ["recipientId = ?", "readAt IS NULL", "refType = 'task'"];
  const args: unknown[] = [recipientId];
  if (id) {
    where.unshift("id = ?");
    args.unshift(idArg(id));
  }
  const list = await docs("notifications", "notifications", where.join(" AND "), "id", args);
  return list.map((n) => project("notifications", n, { refId: 1 }));
}

export async function pushIdsForUser(userId: string) {
  const rows: Row[] = await all(d1(), "SELECT id FROM pushSubscriptions WHERE userId = ? ORDER BY updatedAt DESC, id", userId);
  return rows.map((r) => ({ _id: r.id }));
}

export async function pushSubsForUsers(userIds: string[]) {
  return docs("push_subscriptions", "pushSubscriptions", IN_JSON("userId"), "id", [JSON.stringify(userIds.map(String))], 300);
}

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

export async function auditList(a: AuditListArgs) {
  const { action, from, to } = a;
  const q = (a.q || "").trim();
  const limit = Math.min(Number(a.limit) || 200, 1000);
  const where: string[] = [];
  const args: unknown[] = [];
  if (action) {
    where.push("action = ?");
    args.push(action);
  }
  if (from) {
    where.push("createdAt >= ?");
    args.push(istDayStart(from).toISOString());
  }
  if (to) {
    where.push("createdAt <= ?");
    args.push(istDayEnd(to).toISOString());
  }
  const refs = (a.refs || "").split(",").map((r) => r.trim()).filter(Boolean).slice(0, 10);
  if (refs.length > 0) {
    where.push(IN_JSON("entityRef"));
    args.push(JSON.stringify(refs));
  }
  if (q) {
    const pat = `%${likeLiteral(q)}%`;
    where.push(`(entityRef LIKE ? ${ESC} OR partyName LIKE ? ${ESC} OR performedBy LIKE ? ${ESC} OR reason LIKE ? ${ESC})`);
    args.push(pat, pat, pat, pat);
  }
  return docs("audit_logs", "auditLogs", where.join(" AND "), "createdAt DESC, id", args, limit < 0 ? -limit : limit);
}
