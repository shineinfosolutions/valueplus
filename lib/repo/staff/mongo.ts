/**
 * The CURRENT MongoDB reads of the STAFF & SYSTEM area, each wrapped verbatim (same filter, projection, sort, limit,
 * lean or not) from the route / lib named above it, so lib/repo/staff/d1.ts can be compared with them
 * (lib/repo/staff/index.ts, tests/d1-staff-reads.test.ts). The callers are not changed in this stage.
 * Filters that a route builds from its request are rebuilt here from the same inputs, line for line.
 */
import connectToDatabase from "@/lib/db";
import { istDayEnd, istDayStart } from "@/lib/ist";
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
import type { AttendanceListArgs, AuditListArgs, LeaveListArgs, TaskListArgs } from "./types";
import { STAFF_ROLES, TASK_MANAGER_ROLES } from "./constants";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** app/api/staff/tasks/route.ts exactName */
const exactName = (name: string) => ({ $regex: new RegExp(`^\\s*${escapeRegex(name.trim())}\\s*$`, "i") });
/** lib/notify.ts ACTIVE */
const ACTIVE = { $or: [{ status: "active" }, { status: { $exists: false } }] };

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

/** GET /api/users */
export async function usersList() {
  await connectToDatabase();
  return User.find({}).select("-password").sort({ createdAt: -1 }).lean();
}

/** lib/authOptions.ts authorize(): the login lookup (needs the password hash). */
export async function authLoginLookup(inputIdentifier: string) {
  await connectToDatabase();
  return User.findOne({
    $or: [
      { email: { $regex: new RegExp(`^${inputIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } },
      { mobile: inputIdentifier },
    ],
  }).lean();
}

/**
 * User.findById(id).select(select).lean(): brand-sales ("name assignedBrand", "assignedBrand"), member-activity and
 * overview ("name email role mobile designation status joiningDate assignedBrand address"), incentive-payout
 * ("name"), fix-name ({ name: 1 }), users PUT ("role", "name").
 */
export async function usersFindById(id: string, select?: string) {
  await connectToDatabase();
  return select === undefined ? User.findById(id).lean() : User.findById(id).select(select).lean();
}

/** POST /api/staff/attendance (bulk): every active user. */
export async function usersActive() {
  await connectToDatabase();
  return User.find({ status: "active" }).lean();
}

/** GET /api/staff/overview: the directory list. */
export async function usersDirectory() {
  await connectToDatabase();
  return User.find({ role: { $nin: ["supplier", "vendor"] } })
    .select("name email role mobile designation status joiningDate assignedBrand")
    .sort({ name: 1 })
    .lean();
}

/** GET /api/auth/security-pin (non-lean; carries the PIN hash and, as the query stands, the password hash). */
export async function usersSecurityPinState(id: string) {
  await connectToDatabase();
  return User.findById(id).select("+securityPin +pinLockedUntil");
}

/** POST / PUT /api/staff/tasks: the user whose name is exactly the assignee. */
export async function usersIdByExactName(name: string) {
  await connectToDatabase();
  return User.findOne({ name: exactName(name) }, { _id: 1 }).lean();
}

/** lib/notify.ts usersForAssignee: by id (an id that is not an ObjectId gives []). */
export async function usersNotifyById(assigneeId: string) {
  await connectToDatabase();
  return User.find({ _id: assigneeId }, { name: 1 }).lean().catch(() => []);
}

/** lib/notify.ts usersForAssignee: "All Staff". */
export async function usersNotifyAllStaff() {
  await connectToDatabase();
  return User.find({ ...ACTIVE, role: { $nin: ["admin", "superadmin"] } }, { name: 1 }).lean();
}

/** lib/notify.ts usersForAssignee: "Sales Staff". */
export async function usersNotifySalesStaff() {
  await connectToDatabase();
  return User.find({ ...ACTIVE, role: { $in: ["salesman", "sales"] } }, { name: 1 }).lean();
}

/** lib/notify.ts usersForAssignee: a person's name (case-insensitive, whole name). */
export async function usersNotifyByName(name: string) {
  await connectToDatabase();
  return User.find({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, "i") } }, { name: 1 }).lean();
}

/** lib/notify.ts notifyRoles (and notifyAdmins with ["admin", "superadmin"]). */
export async function usersNotifyRoles(roles: string[]) {
  await connectToDatabase();
  return User.find({ ...ACTIVE, role: { $in: roles } }, { name: 1 }).lean();
}

/** lib/notify.ts notifyEmail. */
export async function usersNotifyEmail(e: string) {
  await connectToDatabase();
  return User.find({ email: { $regex: new RegExp(`^${escapeRegex(e)}$`, "i") } }, { name: 1 }).lean();
}

/** lib/attendance-alerts.ts staffNotCheckedIn: the working staff. */
export async function usersWorkingStaff() {
  await connectToDatabase();
  return User.find({ role: { $in: STAFF_ROLES }, status: { $nin: ["inactive", "terminated", "suspended"] } }).select("name role").lean();
}

// ---------------------------------------------------------------------------
// role permissions
// ---------------------------------------------------------------------------

/** lib/requirePermission.ts loadPermissionOverrides, GET /api/roles. */
export async function rolePermissionsAll() {
  await connectToDatabase();
  return RolePermission.find({}).lean();
}

// ---------------------------------------------------------------------------
// attendance
// ---------------------------------------------------------------------------

/** GET /api/staff/attendance (`today` is the route's getISTDate()). */
export async function attendanceList(a: AttendanceListArgs) {
  await connectToDatabase();
  const { dateParam, staffName, staffId, month, today } = a;
  const filter: any = {};
  if (dateParam && dateParam !== "all") {
    filter.date = dateParam;
  } else if (!dateParam && !month) {
    filter.date = today;
  }
  if (month) {
    filter.date = { $regex: `^${month}` };
  }
  if (staffName && staffName !== "all") {
    filter.staffName = staffName;
  }
  if (staffId) {
    filter.staffId = staffId;
  }
  return Attendance.find(filter).sort({ date: -1, createdAt: -1 }).lean();
}

/** GET /api/staff/attendance/photo */
export async function attendancePhotoRef(id: string) {
  await connectToDatabase();
  return Attendance.findById(id).select("checkInPhotoKey userId staffId staffName").lean();
}

/** GET /api/staff/member-activity: a month of everyone's attendance. */
export async function attendanceBetween(from: string, to: string) {
  await connectToDatabase();
  return Attendance.find({ date: { $gte: from, $lte: to } }).sort({ date: -1 }).lean();
}

/** GET /api/staff/overview: today's attendance for the cards. */
export async function attendanceOverviewDay(today: string) {
  await connectToDatabase();
  return Attendance.find({ date: today }, { staffName: 1, checkInTime: 1, checkOutTime: 1, status: 1, lateMinutes: 1, isLate: 1 }).lean();
}

/** GET /api/staff/overview?id=: one person's last 60 days. */
export async function attendanceRecentForStaff(staffName: string) {
  await connectToDatabase();
  return Attendance.find({ staffName }).sort({ date: -1 }).limit(60).lean();
}

/** GET /api/staff/presence */
export async function attendancePresenceRows(date: string, staff?: string | null) {
  await connectToDatabase();
  const filter: any = { date };
  if (staff) filter.staffName = staff;
  return Attendance.find(filter)
    .select("staffName staffRole date checkInTime checkOutTime awayPeriods totalAwayMinutes unknownMinutes lastPresence")
    .sort({ staffName: 1 })
    .lean();
}

/** lib/attendance-alerts.ts staffNotCheckedIn: the day's check-ins. */
export async function attendanceDayCheckins(day: string) {
  await connectToDatabase();
  return Attendance.find({ date: day }, { staffName: 1, checkInTime: 1, status: 1 }).lean();
}

/** POST /api/staff/presence, check-in / check-out (non-lean: the caller changes and saves it). */
export async function attendanceFindByStaffDate(staffName: string, date: string) {
  await connectToDatabase();
  return Attendance.findOne({ staffName, date });
}

/** lib/attendance-alerts.ts autoCheckOut: the records still open (non-lean). */
export async function attendanceAutoCheckoutCandidates(day: string) {
  await connectToDatabase();
  return Attendance.find({
    checkInTime: { $nin: [null, "", "--"] },
    $or: [{ checkOutTime: { $exists: false } }, { checkOutTime: "" }, { checkOutTime: "--" }],
    status: { $ne: "On Leave" },
    date: { $lte: day },
  });
}

/** lib/presence.ts awayTooLongAlerts: records with an open away / break period (non-lean). */
export async function attendanceOpenAway(today: string) {
  await connectToDatabase();
  return Attendance.find({
    date: today,
    awayPeriods: { $elemMatch: { backAt: { $exists: false }, kind: { $in: ["away", "break"] } } },
  });
}

// ---------------------------------------------------------------------------
// leave requests
// ---------------------------------------------------------------------------

/** GET /api/staff/leave-requests (the route decides `mineOf` / `kinds` from the session as before). */
export async function leaveList(a: LeaveListArgs) {
  await connectToDatabase();
  const query: any = {};
  if (a.status) query.status = a.status;
  if (a.mineOf) {
    query.$or = [{ staffId: a.mineOf.id }, { staffName: a.mineOf.name }];
  } else if (a.kinds) {
    query.kind = { $in: a.kinds };
  }
  return LeaveRequest.find(query).sort({ createdAt: -1 }).limit(1000).lean();
}

/** GET /api/staff/member-activity: one person's time off overlapping the month. */
export async function leaveForStaffBetween(from: string, to: string, staffId: string, staffName: string) {
  await connectToDatabase();
  return LeaveRequest.find({ fromDate: { $lte: to }, toDate: { $gte: from }, $or: [{ staffId }, { staffName }] }).sort({ fromDate: -1 }).lean();
}

/** GET /api/staff/overview and lib/attendance-alerts.ts: approved leave (not breaks) covering the day. */
export async function leaveApprovedAwayOn(day: string) {
  await connectToDatabase();
  return LeaveRequest.find({ status: "approved", kind: { $ne: "break" }, fromDate: { $lte: day }, toDate: { $gte: day } }, { staffName: 1 }).lean();
}

/** lib/attendance-alerts.ts breakOverAlerts (non-lean). */
export async function leaveBreakOverCandidates(now: Date) {
  await connectToDatabase();
  return LeaveRequest.find({
    kind: "break",
    status: "approved",
    breakStartedAt: { $exists: true },
    breakEndsAt: { $lte: now },
    breakReturnedAt: { $exists: false },
  });
}

/** lib/presence.ts runningBreak */
export async function leaveRunningBreak(staffName: string, now: Date) {
  await connectToDatabase();
  return LeaveRequest.findOne({
    staffName,
    kind: "break",
    status: "approved",
    breakStartedAt: { $lte: now },
    breakEndsAt: { $gte: now },
    breakReturnedAt: { $exists: false },
  })
    .select("breakEndsAt")
    .lean<{ breakEndsAt?: Date } | null>();
}

// ---------------------------------------------------------------------------
// staff tasks
// ---------------------------------------------------------------------------

/** GET /api/staff/tasks (`actor` is getActor()). */
export async function tasksList(a: TaskListArgs) {
  await connectToDatabase();
  const { actor, staff: assignedStaff, status } = a;
  const filter: any = {};
  if (!TASK_MANAGER_ROLES.includes(actor.role)) {
    const isSales = ["salesman", "sales"].includes(actor.role);
    filter.$or = [
      ...(actor.id ? [{ assignedStaffId: actor.id }] : []),
      { assignedStaff: exactName(actor.name) },
      { assignedStaff: "All Staff" },
      ...(isSales ? [{ assignedStaff: "Sales Staff" }] : []),
      { createdBy: exactName(actor.name) },
    ];
  } else if (assignedStaff && assignedStaff !== "all") {
    filter.$or = [{ assignedStaff: exactName(assignedStaff) }, { assignedStaff: "All Staff" }, { assignedStaff: "Sales Staff" }];
  }
  if (status && status !== "all") {
    filter.status = status;
  }
  return StaffTask.find(filter).sort({ dueDate: 1, createdAt: -1 }).lean();
}

/** GET /api/staff/overview?id=: every task's owner and status. */
export async function tasksOwnership() {
  await connectToDatabase();
  return StaffTask.find({}, { assignedStaff: 1, assignedStaffId: 1, status: 1 }).lean();
}

/** PUT /api/staff/tasks: the task before the change. */
export async function tasksFindById(id: string) {
  await connectToDatabase();
  return StaffTask.findById(id).lean();
}

// ---------------------------------------------------------------------------
// salaries and incentive payouts
// ---------------------------------------------------------------------------

/** GET /api/staff/salary (non-lean). */
export async function salariesList(month?: string | null, employeeId?: string | null) {
  await connectToDatabase();
  const filter: any = {};
  if (month) filter.month = month;
  if (employeeId) filter.employeeId = employeeId;
  return Salary.find(filter).sort({ employeeName: 1 });
}

/** lib/staff-incentive.ts loadIncentiveBook: incentive paid in salary. */
export async function salariesPaidIncentives() {
  await connectToDatabase();
  return Salary.find({ paymentStatus: "Paid" }, { employeeName: 1, incentives: 1 }).lean();
}

/** GET /api/staff/my-incentive?detail=1 (no limit) and GET /api/staff/overview?id= (limit 200). */
export async function payoutsForUser(userId: string, limit?: number) {
  await connectToDatabase();
  const q = IncentivePayout.find({ userId }).sort({ date: -1, createdAt: -1 });
  return limit ? q.limit(limit).lean() : q.lean();
}

/** lib/staff-incentive.ts loadIncentiveBook: every payout's user and amount. */
export async function payoutsAmounts() {
  await connectToDatabase();
  return IncentivePayout.find({}, { userId: 1, amount: 1 }).lean();
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

/** lib/shift-settings.ts getShift (GET /api/staff/shifts): the newest shift (non-lean); null = none yet. */
export async function shiftLatest() {
  await connectToDatabase();
  return ShiftSetting.findOne().sort({ updatedAt: -1 });
}

/** lib/priceLock.ts isUnlockPinSet / verifyUnlockPin, GET /api/price-lock/pin (holds the PIN hash). */
export async function priceUnlockSetting() {
  await connectToDatabase();
  return PriceUnlockSetting.findOne({ key: "price-unlock" }).lean();
}

/** lib/ensure-indexes.ts ensureIndexesOnce */
export async function scheduledRunExists(key: string) {
  await connectToDatabase();
  return ScheduledRun.exists({ key });
}

// ---------------------------------------------------------------------------
// notifications and push
// ---------------------------------------------------------------------------

/** GET /api/notifications: the latest 30. */
export async function notificationsLatest(recipientId: string) {
  await connectToDatabase();
  return Notification.find({ recipientId }).sort({ createdAt: -1 }).limit(30).lean();
}

/** GET /api/notifications: unread count. */
export async function notificationsUnreadCount(recipientId: string) {
  await connectToDatabase();
  return Notification.countDocuments({ recipientId, readAt: null });
}

/** PATCH /api/notifications markSeen: the unread task notifications (all, or one by id). */
export async function notificationsUnreadTaskRefs(recipientId: string, id?: string) {
  await connectToDatabase();
  const filter: any = id ? { _id: id } : {};
  return Notification.find({ ...filter, recipientId, readAt: null, refType: "task" }, { refId: 1 }).lean();
}

/** POST /api/push/subscribe: this person's devices, newest first. */
export async function pushIdsForUser(userId: string) {
  await connectToDatabase();
  return PushSubscription.find({ userId }).sort({ updatedAt: -1 }).select("_id").lean();
}

/** lib/push.ts pushToUsers (holds the device keys). */
export async function pushSubsForUsers(userIds: string[]) {
  await connectToDatabase();
  return PushSubscription.find({ userId: { $in: userIds.map(String) } }).limit(300).lean();
}

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

/** GET /api/audit (the log view; the deleted-bill archives are other areas). */
export async function auditList(a: AuditListArgs) {
  await connectToDatabase();
  const { action, from, to } = a;
  const q = (a.q || "").trim();
  const limit = Math.min(Number(a.limit) || 200, 1000);
  const range: any = {};
  if (from) range.$gte = istDayStart(from);
  if (to) range.$lte = istDayEnd(to);
  const filter: any = {};
  if (action) filter.action = action;
  if (from || to) filter.createdAt = range;
  const refs = (a.refs || "").split(",").map((r) => r.trim()).filter(Boolean).slice(0, 10);
  if (refs.length > 0) filter.entityRef = { $in: refs };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ entityRef: rx }, { partyName: rx }, { performedBy: rx }, { reason: rx }];
  }
  return AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}
