-- Stage A of docs/D1_MIGRATION_PLAN.md, STAFF & SYSTEM area: people / HR (plan §4.6), logs and notifications
-- (§4.8) and the small settings singletons (§4.2), filled as a COPY of MongoDB by lib/d1/sync.ts with the mapping
-- in lib/d1/maps/staff-system.ts. MongoDB stays the only source of truth; nothing in the app reads these tables yet.
--
-- Same conventions as 0001_masters.sql: camelCase Mongo field names, `_id` -> `id` (24-hex), Dates as ISO-8601 UTC
-- text with milliseconds, booleans 0/1, money REAL, 1:1 subdocuments flattened with a prefix (lastPresence_state),
-- arrays read whole with their parent as JSON text (awayPeriods, seenBy, assignedBrands, permissions), unknown
-- top-level fields in `extra` (JSON), then createdAt / updatedAt / v / docHash / syncedAt.
--
-- Every UNIQUE the plan lists (users.email, attendance(staffName, date), pushSubscriptions.endpoint,
-- rolePermissions.role, priceUnlockSettings.key, scheduledRuns.key) is a plain index here: the copy must never fail
-- on a duplicate that live data may already hold (autoIndex is off on Workers). They become UNIQUE in a later
-- migration, after the duplicates are checked in Mongo.
--
-- users holds secrets copied as they are in Mongo (password and securityPin are bcrypt hashes; bank and ID-proof
-- details are plain text): the database is in the same Cloudflare account and the app will read users from it.
-- priceUnlockSettings.pinHash is a bcrypt hash too.

-- User (collection users) [HOT]: login, session, /api/users.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  password TEXT,                  -- secret: bcrypt hash
  role TEXT,
  mobile TEXT,
  avatar TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  idProofType TEXT,
  idProofNumber TEXT,             -- personal data
  idProofDoc TEXT,
  designation TEXT,
  monthlySalary REAL,
  salaryType TEXT,
  salaryPaymentDay REAL,
  joiningDate TEXT,               -- business date YYYY-MM-DD, kept as written
  advanceBalance REAL,
  monthlyAdvanceDeduction REAL,
  vehicleNumber TEXT,
  drivingLicenseNo TEXT,
  bankName TEXT,
  bankAccountNo TEXT,             -- personal data
  bankIfsc TEXT,
  assignedWarehouseId TEXT,
  assignedWarehouseName TEXT,
  assignedBrand TEXT,
  assignedBrands TEXT,            -- JSON array
  securityPin TEXT,               -- secret: bcrypt hash
  pinUpdatedAt TEXT,
  pinFailCount INTEGER,           -- secret
  pinLockedUntil TEXT,            -- secret
  unlockPinFailCount INTEGER,     -- secret
  unlockPinLockedUntil TEXT,      -- secret
  liveAuditAccess INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX users_email ON users(email COLLATE NOCASE);
CREATE INDEX users_role ON users(role);
CREATE INDEX users_mobile ON users(mobile);

-- Attendance (collection attendance) [HOT]: presence posts, the 5-minute cron, dashboard cards. One row per person
-- per day; awayPeriods (read and rewritten whole by lib/presence.ts) is JSON, lastPresence is flattened.
CREATE TABLE attendance (
  id TEXT PRIMARY KEY,
  staffName TEXT,
  staffKey TEXT NOT NULL DEFAULT '',  -- search helper: staffName trimmed, spaces collapsed, lower case (not in Mongo)
  staffId TEXT,
  staffEmail TEXT,
  staffRole TEXT,
  userId TEXT,
  branchId TEXT,
  branchName TEXT,
  date TEXT,                      -- business date YYYY-MM-DD (IST)
  checkInTime TEXT,
  checkOutTime TEXT,
  workingDurationMinutes REAL,
  shiftName TEXT,
  isLate INTEGER NOT NULL DEFAULT 0,
  isEarlyCheckout INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  leaveType TEXT,
  leaveStatus TEXT,
  leaveReason TEXT,
  advanceRequested REAL,
  advanceStatus TEXT,
  notes TEXT,
  lateMinutes REAL,
  checkInPhotoKey TEXT,
  checkInLat REAL,
  checkInLng REAL,
  checkInDistanceM REAL,
  awayPeriods TEXT,               -- JSON array, or NULL when the field is absent
  totalAwayMinutes REAL,
  unknownMinutes REAL,
  lastPresence_state TEXT,
  lastPresence_at TEXT,
  lastPresence_distanceM REAL,
  lastPresence_lat REAL,
  lastPresence_lng REAL,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX attendance_staff_date ON attendance(staffName, date);
CREATE INDEX attendance_date_status ON attendance(date, status);
CREATE INDEX attendance_user_date ON attendance(userId, date);

-- LeaveRequest (collection leaverequests: the model sets no name, mongoose pluralises it).
CREATE TABLE leaveRequests (
  id TEXT PRIMARY KEY,
  kind TEXT,
  staffName TEXT,
  staffId TEXT,
  staffRole TEXT,
  fromDate TEXT,
  toDate TEXT,
  days REAL,
  breakMinutes REAL,
  reason TEXT,
  status TEXT,
  reviewedBy TEXT,
  reviewedAt TEXT,
  reviewNote TEXT,
  breakStartedAt TEXT,
  breakEndsAt TEXT,
  breakReturnedAt TEXT,
  lastOverAlertAt TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX leaveRequests_kind ON leaveRequests(kind);
CREATE INDEX leaveRequests_staffId ON leaveRequests(staffId);
CREATE INDEX leaveRequests_staffName ON leaveRequests(staffName);
CREATE INDEX leaveRequests_status ON leaveRequests(status);
CREATE INDEX leaveRequests_dates ON leaveRequests(fromDate, toDate);

-- StaffTask (collection staff_tasks): dashboard, bell. seenBy is JSON; target progress stays a plain column.
CREATE TABLE staffTasks (
  id TEXT PRIMARY KEY,
  taskTitle TEXT,
  assignedStaff TEXT,
  assignedStaffId TEXT,
  assignedDate TEXT,
  dueDate TEXT,
  dueTime TEXT,
  priority TEXT,
  description TEXT,
  reminder INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  taskType TEXT,
  targetProduct TEXT,
  targetBrand TEXT,
  targetQty REAL,
  targetAmount REAL,
  currentQty REAL,
  currentAmount REAL,
  linkedInvoiceNumber TEXT,
  createdBy TEXT,
  groupId TEXT,
  seenBy TEXT,                    -- JSON array of {userId, name, at}
  completedAt TEXT,
  completionRemarks TEXT,
  notes TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX staffTasks_staff_status ON staffTasks(assignedStaff, status);
CREATE INDEX staffTasks_type_status ON staffTasks(taskType, status);
CREATE INDEX staffTasks_assignedDate ON staffTasks(assignedDate);
CREATE INDEX staffTasks_dueDate ON staffTasks(dueDate);
CREATE INDEX staffTasks_groupId ON staffTasks(groupId);
CREATE INDEX staffTasks_staffId ON staffTasks(assignedStaffId);

-- Salary (collection salaries); history[] goes to the child table salaryPayments.
CREATE TABLE salaries (
  id TEXT PRIMARY KEY,
  employeeName TEXT,
  employeeId TEXT,
  designation TEXT,
  monthlySalary REAL,
  salaryType TEXT,
  joiningDate TEXT,
  deductions REAL,
  incentives REAL,
  commission REAL,
  payableAmount REAL,
  paymentStatus TEXT,
  paymentDate TEXT,
  paymentMode TEXT,
  month TEXT,                     -- e.g. "August 2026", as written
  year INTEGER,
  notes TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX salaries_employeeId ON salaries(employeeId);
CREATE INDEX salaries_employeeName ON salaries(employeeName);
CREATE INDEX salaries_month_year ON salaries(month, year);
CREATE INDEX salaries_paymentStatus ON salaries(paymentStatus);

-- Salary.history[]: one row per payment, in array order (idx). `id` is the subdocument _id (NULL for a legacy entry
-- without one); `extra` keeps any other key of the entry, or the whole entry when it is not an object.
CREATE TABLE salaryPayments (
  salaryId TEXT NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  id TEXT,
  date TEXT,
  amount REAL,
  paymentMode TEXT,
  txnRef TEXT,
  notes TEXT,
  extra TEXT,
  PRIMARY KEY (salaryId, idx)
);
CREATE INDEX salaryPayments_id ON salaryPayments(id);
CREATE INDEX salaryPayments_date ON salaryPayments(date);

-- IncentivePayout (collection incentive_payouts).
CREATE TABLE incentivePayouts (
  id TEXT PRIMARY KEY,
  userId TEXT,
  employeeName TEXT,
  amount REAL,
  date TEXT,
  paymentMode TEXT,
  note TEXT,
  paidBy TEXT,
  paidByUserId TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX incentivePayouts_userId ON incentivePayouts(userId);
CREATE INDEX incentivePayouts_date ON incentivePayouts(date);

-- ShiftSetting (collection shift_settings): singleton-ish.
CREATE TABLE shiftSettings (
  id TEXT PRIMARY KEY,
  shiftName TEXT,
  startTime TEXT,
  endTime TEXT,
  lateGraceMinutes REAL,
  halfDayLateCutoff TEXT,
  minHoursForFullDay REAL,
  minHoursForHalfDay REAL,
  allowEarlyCheckoutWithoutPenalty INTEGER NOT NULL DEFAULT 0,
  branchName TEXT,
  updatedBy TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

-- Notification (collection notifications) [HOT]: the bell on every page. High volume (plan §8.1: 30,000 to 60,000).
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  recipientId TEXT,
  recipientName TEXT,
  type TEXT,
  title TEXT,
  message TEXT,
  link TEXT,
  readAt TEXT,
  refType TEXT,
  refId TEXT,
  createdBy TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX notifications_recipient_created ON notifications(recipientId, createdAt DESC);
CREATE INDEX notifications_unread ON notifications(recipientId) WHERE readAt IS NULL;
CREATE INDEX notifications_ref ON notifications(refType, refId);

-- PushSubscription (collection push_subscriptions).
CREATE TABLE pushSubscriptions (
  id TEXT PRIMARY KEY,
  userId TEXT,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT,
  userAgent TEXT,
  failCount INTEGER,
  lastSuccessAt TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX pushSubscriptions_endpoint ON pushSubscriptions(endpoint);
CREATE INDEX pushSubscriptions_userId ON pushSubscriptions(userId);

-- RolePermission (collection role_permissions): per-role override, read whole.
CREATE TABLE rolePermissions (
  id TEXT PRIMARY KEY,
  role TEXT,
  permissions TEXT,               -- JSON array of permission keys
  updatedBy TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX rolePermissions_role ON rolePermissions(role);

-- PriceUnlockSetting (collection price_unlock_settings): singleton.
CREATE TABLE priceUnlockSettings (
  id TEXT PRIMARY KEY,
  key TEXT,
  pinHash TEXT,                   -- secret: bcrypt hash
  updatedBy TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX priceUnlockSettings_key ON priceUnlockSettings(key);

-- ScheduledRun (collection scheduled_runs): the cron "once a day" guards.
CREATE TABLE scheduledRuns (
  id TEXT PRIMARY KEY,
  key TEXT,
  ranAt TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX scheduledRuns_key ON scheduledRuns(key);

-- AuditLog (collection audit_logs): append-only. metadata (before / after and the like) is JSON text, never cut.
-- A row is bounded by D1's 2 MB; one that does not fit fails its write, lands in sync_errors and is retried by the
-- nightly reconciliation (none expected: an invoice before/after is about 5 to 30 KB).
CREATE TABLE auditLogs (
  id TEXT PRIMARY KEY,
  action TEXT,
  entityType TEXT,
  entityRef TEXT,
  entityId TEXT,
  partyName TEXT,
  amount REAL,
  reason TEXT,
  performedBy TEXT,
  performedByUserId TEXT,
  performedByRole TEXT,
  pinVerified INTEGER NOT NULL DEFAULT 0,
  usedLegacyPin INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  userAgent TEXT,
  metadata TEXT,                  -- JSON, or NULL when absent
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX auditLogs_created ON auditLogs(createdAt DESC);
CREATE INDEX auditLogs_action_created ON auditLogs(action, createdAt DESC);
CREATE INDEX auditLogs_entityType ON auditLogs(entityType);
CREATE INDEX auditLogs_entityRef ON auditLogs(entityRef);
