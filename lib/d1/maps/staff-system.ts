import { canonicalJson, idText, toReal, toText, type MasterSpec, type SqlValue } from "../masters-map";

/**
 * D1 copy specs for the STAFF & SYSTEM area (docs/D1_MIGRATION_PLAN.md §4.2, §4.6, §4.8): users, attendance, leave,
 * tasks, salaries, incentive payouts, shift / price-unlock / role settings, notifications, push subscriptions,
 * scheduled-run guards and the audit log. Tables in d1/migrations/0004_staff_system.sql. Picked up by
 * lib/d1/registry.ts, so the copy job (lib/d1/sync.ts) copies them with no other change.
 *
 * Mongo collection names are each model's `collection` option; LeaveRequest sets none, so mongoose's pluralised
 * `leaverequests` is used.
 *
 * Secrets (User.password / securityPin, PriceUnlockSetting.pinHash: bcrypt hashes; bank and ID-proof details) are
 * copied as they are: nothing here logs a value.
 */

type Column = MasterSpec["columns"][number];
type ColType = Column["type"];

/** A top-level field, stored under its own name. */
const f = (col: string, type: ColType = "text"): Column => ({ col, type, get: (d) => d?.[col] });

/** A field of a flattened 1:1 subdocument, as column `${parent}_${field}`. */
const sub = (parent: string, field: string, type: ColType = "text"): Column => ({
  col: `${parent}_${field}`,
  type,
  get: (d) => {
    const s = d?.[parent];
    return s && typeof s === "object" && !Array.isArray(s) ? s[field] : undefined;
  },
});

/** Field names of the plain columns (derived helper columns are left out). */
const fieldsOf = (cols: Column[], derived: string[] = []) => cols.map((c) => c.col).filter((c) => !c.includes("_") && !derived.includes(c));

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

const USER_COLUMNS: Column[] = [
  f("name"),
  f("email"),
  f("password"),
  f("role"),
  f("mobile"),
  f("avatar"),
  f("address"),
  f("city"),
  f("state"),
  f("pincode"),
  f("idProofType"),
  f("idProofNumber"),
  f("idProofDoc"),
  f("designation"),
  f("monthlySalary", "real"),
  f("salaryType"),
  f("salaryPaymentDay", "real"),
  f("joiningDate"),
  f("advanceBalance", "real"),
  f("monthlyAdvanceDeduction", "real"),
  f("vehicleNumber"),
  f("drivingLicenseNo"),
  f("bankName"),
  f("bankAccountNo"),
  f("bankIfsc"),
  f("assignedWarehouseId"),
  f("assignedWarehouseName"),
  f("assignedBrand"),
  f("assignedBrands", "json"),
  f("securityPin"),
  f("pinUpdatedAt", "date"),
  f("pinFailCount", "int"),
  f("pinLockedUntil", "date"),
  f("unlockPinFailCount", "int"),
  f("unlockPinLockedUntil", "date"),
  f("liveAuditAccess", "bool"),
  f("status"),
];

// ---------------------------------------------------------------------------
// attendance
// ---------------------------------------------------------------------------

/** staffName trimmed, inner spaces collapsed, lower case: a search helper column, not a Mongo field. */
export function staffKeyOf(name: unknown): string {
  return (toText(name) ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const LAST_PRESENCE_FIELDS = ["state", "at", "distanceM", "lat", "lng"];

const ATTENDANCE_COLUMNS: Column[] = [
  f("staffName"),
  { col: "staffKey", type: "text", get: (d) => staffKeyOf(d?.staffName) },
  f("staffId"),
  f("staffEmail"),
  f("staffRole"),
  f("userId"),
  f("branchId"),
  f("branchName"),
  f("date"),
  f("checkInTime"),
  f("checkOutTime"),
  f("workingDurationMinutes", "real"),
  f("shiftName"),
  f("isLate", "bool"),
  f("isEarlyCheckout", "bool"),
  f("status"),
  f("leaveType"),
  f("leaveStatus"),
  f("leaveReason"),
  f("advanceRequested", "real"),
  f("advanceStatus"),
  f("notes"),
  f("lateMinutes", "real"),
  f("checkInPhotoKey"),
  f("checkInLat", "real"),
  f("checkInLng", "real"),
  f("checkInDistanceM", "real"),
  f("awayPeriods", "json"),
  f("totalAwayMinutes", "real"),
  f("unknownMinutes", "real"),
  sub("lastPresence", "state"),
  sub("lastPresence", "at", "date"),
  sub("lastPresence", "distanceM", "real"),
  sub("lastPresence", "lat", "real"),
  sub("lastPresence", "lng", "real"),
];

// ---------------------------------------------------------------------------
// leave, tasks, salaries, payouts, settings, notifications, push, roles, guards, audit
// ---------------------------------------------------------------------------

const LEAVE_COLUMNS: Column[] = [
  f("kind"),
  f("staffName"),
  f("staffId"),
  f("staffRole"),
  f("fromDate"),
  f("toDate"),
  f("days", "real"),
  f("breakMinutes", "real"),
  f("reason"),
  f("status"),
  f("reviewedBy"),
  f("reviewedAt", "date"),
  f("reviewNote"),
  f("breakStartedAt", "date"),
  f("breakEndsAt", "date"),
  f("breakReturnedAt", "date"),
  f("lastOverAlertAt", "date"),
];

const TASK_COLUMNS: Column[] = [
  f("taskTitle"),
  f("assignedStaff"),
  f("assignedStaffId"),
  f("assignedDate"),
  f("dueDate"),
  f("dueTime"),
  f("priority"),
  f("description"),
  f("reminder", "bool"),
  f("status"),
  f("taskType"),
  f("targetProduct"),
  f("targetBrand"),
  f("targetQty", "real"),
  f("targetAmount", "real"),
  f("currentQty", "real"),
  f("currentAmount", "real"),
  f("linkedInvoiceNumber"),
  f("createdBy"),
  f("groupId"),
  f("seenBy", "json"),
  f("completedAt", "date"),
  f("completionRemarks"),
  f("notes"),
  f("countFrom"),
  f("recountedAt", "date"),
  f("recountedBy"),
];

const SALARY_COLUMNS: Column[] = [
  f("employeeName"),
  f("employeeId"),
  f("designation"),
  f("monthlySalary", "real"),
  f("salaryType"),
  f("joiningDate"),
  f("deductions", "real"),
  f("incentives", "real"),
  f("commission", "real"),
  f("payableAmount", "real"),
  f("paymentStatus"),
  f("paymentDate"),
  f("paymentMode"),
  f("month"),
  f("year", "int"),
  f("notes"),
];

const PAYMENT_FIELDS = ["date", "amount", "paymentMode", "txnRef", "notes"];
export const SALARY_PAYMENT_COLUMNS = ["salaryId", "idx", "id", ...PAYMENT_FIELDS, "extra"];

/**
 * Salary.history[] -> salaryPayments rows, in array order. The subdocument _id becomes `id`; any other key of an
 * entry, or an entry that is not an object at all, is kept in the row's `extra`, so nothing is lost. A legacy
 * `history` that is a single object rather than an array is read as a one-entry list.
 */
function salaryPaymentRows(doc: any, salaryId: string): SqlValue[][] {
  const h = doc?.history;
  const list: unknown[] = Array.isArray(h) ? h : h === undefined || h === null ? [] : [h];
  return list.map((e: any, idx) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      return [salaryId, idx, null, null, null, null, null, null, e === undefined ? null : canonicalJson({ value: e })];
    }
    const rest: Record<string, unknown> = {};
    for (const k of Object.keys(e)) {
      if (k !== "_id" && !PAYMENT_FIELDS.includes(k) && e[k] !== undefined) rest[k] = e[k];
    }
    return [
      salaryId,
      idx,
      e._id === undefined || e._id === null ? null : idText(e._id),
      toText(e.date),
      toReal(e.amount),
      toText(e.paymentMode),
      toText(e.txnRef),
      toText(e.notes),
      Object.keys(rest).length ? canonicalJson(rest) : null,
    ];
  });
}

const PAYOUT_COLUMNS: Column[] = [
  f("userId"),
  f("employeeName"),
  f("amount", "real"),
  f("date"),
  f("paymentMode"),
  f("note"),
  f("paidBy"),
  f("paidByUserId"),
];

const SHIFT_COLUMNS: Column[] = [
  f("shiftName"),
  f("startTime"),
  f("endTime"),
  f("lateGraceMinutes", "real"),
  f("halfDayLateCutoff"),
  f("minHoursForFullDay", "real"),
  f("minHoursForHalfDay", "real"),
  f("allowEarlyCheckoutWithoutPenalty", "bool"),
  f("branchName"),
  f("updatedBy"),
];

const NOTIFICATION_COLUMNS: Column[] = [
  f("recipientId"),
  f("recipientName"),
  f("type"),
  f("title"),
  f("message"),
  f("link"),
  f("readAt", "date"),
  f("refType"),
  f("refId"),
  f("createdBy"),
];

const PUSH_COLUMNS: Column[] = [
  f("userId"),
  f("endpoint"),
  f("p256dh"),
  f("auth"),
  f("userAgent"),
  f("failCount", "int"),
  f("lastSuccessAt", "date"),
];

const ROLE_COLUMNS: Column[] = [f("role"), f("permissions", "json"), f("updatedBy")];
const PRICE_UNLOCK_COLUMNS: Column[] = [f("key"), f("pinHash"), f("updatedBy")];
const SCHEDULED_RUN_COLUMNS: Column[] = [f("key"), f("ranAt", "date")];

const AUDIT_COLUMNS: Column[] = [
  f("action"),
  f("entityType"),
  f("entityRef"),
  f("entityId"),
  f("partyName"),
  f("amount", "real"),
  f("reason"),
  f("performedBy"),
  f("performedByUserId"),
  f("performedByRole"),
  f("pinVerified", "bool"),
  f("usedLegacyPin", "bool"),
  f("ip"),
  f("userAgent"),
  f("metadata", "json"),
];

/** A spec whose columns are all plain top-level fields. */
const flat = (collection: string, table: string, columns: Column[]): MasterSpec => ({ collection, table, columns, known: fieldsOf(columns) });

export const STAFF_SYSTEM_SPECS: MasterSpec[] = [
  flat("users", "users", USER_COLUMNS),
  {
    collection: "attendance",
    table: "attendance",
    columns: ATTENDANCE_COLUMNS,
    known: [...fieldsOf(ATTENDANCE_COLUMNS, ["staffKey"]), "lastPresence"],
    flattened: { lastPresence: LAST_PRESENCE_FIELDS },
  },
  flat("leaverequests", "leaveRequests", LEAVE_COLUMNS),
  flat("staff_tasks", "staffTasks", TASK_COLUMNS),
  {
    collection: "salaries",
    table: "salaries",
    columns: SALARY_COLUMNS,
    known: [...fieldsOf(SALARY_COLUMNS), "history"],
    children: [{ table: "salaryPayments", parentCol: "salaryId", columns: SALARY_PAYMENT_COLUMNS, rows: salaryPaymentRows }],
  },
  flat("incentive_payouts", "incentivePayouts", PAYOUT_COLUMNS),
  flat("shift_settings", "shiftSettings", SHIFT_COLUMNS),
  flat("notifications", "notifications", NOTIFICATION_COLUMNS),
  flat("push_subscriptions", "pushSubscriptions", PUSH_COLUMNS),
  flat("role_permissions", "rolePermissions", ROLE_COLUMNS),
  flat("price_unlock_settings", "priceUnlockSettings", PRICE_UNLOCK_COLUMNS),
  flat("scheduled_runs", "scheduledRuns", SCHEDULED_RUN_COLUMNS),
  flat("audit_logs", "auditLogs", AUDIT_COLUMNS),
];

/** Columns computed from other fields (not Mongo fields), per table. */
export const STAFF_SYSTEM_DERIVED: Record<string, string[]> = { attendance: ["staffKey"] };
