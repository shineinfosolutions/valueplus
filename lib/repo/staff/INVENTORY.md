# STAFF & SYSTEM reads: inventory (D1 stage B2)

Every MongoDB read on the STAFF & SYSTEM collections (users, attendance, leaverequests, staff_tasks, salaries +
history, incentive_payouts, shift_settings, notifications, push_subscriptions, role_permissions,
price_unlock_settings, scheduled_runs, audit_logs) in the routes and libs of this stage, and its D1 version.

- `mongo`: `lib/repo/staff/mongo.ts`, the current query, verbatim.
- `d1`: `lib/repo/staff/d1.ts`, the same JSON from D1. Rows are rebuilt into documents by `lib/repo/staff/rebuild.ts`.
- Registry: `STAFF_READS` in `lib/repo/staff/index.ts` (46 entries). Test: `tests/d1-staff-reads.test.ts`.
- No route uses them yet.

## How a D1 row becomes the Mongo document

- **Fields:** each column is converted back to its type: REAL becomes a number, a bool becomes true/false, JSON
  columns are parsed (`awayPeriods`, `seenBy`, `assignedBrands`, `permissions`, `metadata`). `lastPresence_*` is
  rebuilt as the `lastPresence` object. `extra` puts back the unknown fields. `salaryPayments` (ordered by `idx`)
  becomes `history[]`, with each subdocument `_id`. `_id` is the 24-hex text, and dates are ISO text, as
  `JSON.stringify` writes a Date.
- **Absent, null or false:** columns cannot tell these apart, and they cannot tell a missing `__v` from 0. The first
  guess follows the schema: booleans present, `readAt` / `lastSuccessAt` null, `__v` present. That guess is checked
  against the row's `docHash`, the SHA-256 of the canonical Mongo document. When it does not match, other readings
  are tried (at most 128 hashes) until one does:
  - absent booleans;
  - absent null-defaults;
  - no `__v` (upserts store none);
  - no `history`;
  - one or two explicit nulls.

  Every seeded row in the test rebuilds exactly. That includes a raw legacy user, upserted documents, a
  `$set: null`, and a legacy salary with no history.
- **Projection:** the mongoose select string or object is applied after the rebuild. It covers inclusive, exclusive
  and `+path` selects. The `select: false` paths of `User` (securityPin, pinFailCount, pinLockedUntil,
  unlockPinFailCount, unlockPinLockedUntil) are left out unless `+` asks for them, as mongoose does. D1 reads the
  whole row, because the hash check needs it. Secrets are fetched, but only what the projection keeps is returned.
- **Non-lean reads:** `JSON.stringify` of a mongoose document is reproduced:
  - schema defaults for selected paths the stored copy lacks (including `joiningDate = istToday()`);
  - arrays as [];
  - element defaults in `history` / `awayPeriods`;
  - empty objects removed (`minimize`).

  `lib/repo/staff/meta.ts` holds that schema knowledge, and the test checks it against the real schemas.
- **Order:**
  - Every ORDER BY ends with `id`.
  - A find with no sort is ordered by `id`, which is creation time and so insertion order.
  - SQLite puts NULLs first when ascending, as Mongo does.
  - Strings compare as binary in both.
- **Filters:**
  - `$ne` / `$nin` also match a missing field: `(col IS NULL OR col NOT IN …)`.
  - `$exists: false` is `IS NULL`.
  - Lists are passed as one JSON parameter: `IN (SELECT value FROM json_each(?))`.
  - An anchored, escaped `/^x$/i` is `LIKE ? ESCAPE '\'` on the literal text.
  - `/^\s*x\s*$/i` is `trim(col, ' \t\n\r\f\v') LIKE ?`.
  - An unanchored `/x/i` is `LIKE '%x%'`.
  - Date ranges compare ISO text.
  - `$elemMatch` on awayPeriods is checked in JS on the parsed array.
  - The attendance `month` regex is a `substr()` prefix, or a JS RegExp when the month holds regex syntax.
  - An id that is not an ObjectId throws a CastError, as mongoose's findById does. The notify lookup by id gives [].

## Reads covered

| Key | Where | Mongo query | Notes |
|---|---|---|---|
| users.list | GET /api/users | `User.find({}).select("-password").sort({createdAt:-1}).lean()` | No password and no select:false fields. The route's `assignedBrand` fallback stays in the route. |
| auth.loginLookup | lib/authOptions.ts authorize | `User.findOne({$or:[{email:/^x$/i},{mobile:x}]}).lean()` | **Returns the password hash** (needed for bcrypt), like Mongo. No PIN fields. |
| users.findById | brand-sales, member-activity, overview `?id=`, incentive-payout, fix-name, users PUT | `User.findById(id).select(sel).lean()` | `sel` as the caller passes it. fix-name's `{name:1}` is `"name"`. |
| users.active | POST /api/staff/attendance (bulk) | `User.find({status:"active"}).lean()` | Includes the password hash, like the Mongo query (the route never sends it out). |
| users.directory | GET /api/staff/overview | `User.find({role:{$nin:["supplier","vendor"]}}).select(…).sort({name:1}).lean()` | |
| users.securityPinState | GET /api/auth/security-pin | `User.findById(id).select("+securityPin +pinLockedUntil")` (non-lean) | **Carries securityPin and the password hash**, as the query stands. The route reads only booleans from it. |
| users.idByExactName | POST/PUT /api/staff/tasks | `User.findOne({name:/^\s*x\s*$/i},{_id:1}).lean()` | |
| users.notifyById / notifyAllStaff / notifySalesStaff / notifyByName / notifyRoles / notifyEmail | lib/notify.ts | `User.find(…, {name:1}).lean()` | notifyRoles also covers notifyAdmins (`["admin","superadmin"]`). |
| users.workingStaff | lib/attendance-alerts.ts staffNotCheckedIn | `User.find({role:{$in:STAFF_ROLES},status:{$nin:[…]}}).select("name role").lean()` | |
| rolePermissions.all | lib/requirePermission.ts loadPermissionOverrides (so getActor, /api/auth/permissions), GET /api/roles | `RolePermission.find({}).lean()` | Rows are upserts with no `__v`. |
| attendance.list | GET /api/staff/attendance | `Attendance.find(filter).sort({date:-1,createdAt:-1}).lean()` | Filter rebuilt from date / month / staff / staffId, with `today` passed in. |
| attendance.photoRef | GET /api/staff/attendance/photo | `findById(id).select("checkInPhotoKey userId staffId staffName").lean()` | |
| attendance.between | GET /api/staff/member-activity | `find({date:{$gte,$lte}}).sort({date:-1}).lean()` | |
| attendance.overviewDay | GET /api/staff/overview | `find({date},{staffName,checkInTime,checkOutTime,status,lateMinutes,isLate}).lean()` | |
| attendance.recentForStaff | GET /api/staff/overview `?id=` | `find({staffName}).sort({date:-1}).limit(60).lean()` | |
| attendance.presenceRows | GET /api/staff/presence | `find({date,staffName?}).select(…awayPeriods…lastPresence).sort({staffName:1}).lean()` | |
| attendance.dayCheckins | lib/attendance-alerts.ts | `find({date},{staffName,checkInTime,status}).lean()` | |
| attendance.findByStaffDate | POST /api/staff/presence, check-in / check-out | `Attendance.findOne({staffName,date})` (non-lean) | The JSON only. The callers mutate and save the document, so they stay on Mongo until writes move. |
| attendance.autoCheckoutCandidates | lib/attendance-alerts.ts autoCheckOut | non-lean `find({checkInTime:{$nin:[null,"","--"]},$or:[…checkOutTime…],status:{$ne},date:{$lte}})` | JSON only (read-modify-write). |
| attendance.openAway | lib/presence.ts awayTooLongAlerts | non-lean `find({date, awayPeriods:{$elemMatch:{backAt:{$exists:false},kind:{$in:["away","break"]}}}})` | JSON only. |
| leave.list | GET /api/staff/leave-requests | `find(query).sort({createdAt:-1}).limit(1000).lean()` | The route still decides `mineOf` / `kinds` from the session. |
| leave.forStaffBetween | GET /api/staff/member-activity | `find({fromDate:{$lte},toDate:{$gte},$or:[{staffId},{staffName}]}).sort({fromDate:-1}).lean()` | |
| leave.approvedAwayOn | GET /api/staff/overview, lib/attendance-alerts.ts | `find({status:"approved",kind:{$ne:"break"},fromDate:{$lte},toDate:{$gte}},{staffName:1}).lean()` | |
| leave.breakOverCandidates | lib/attendance-alerts.ts breakOverAlerts | non-lean `find({kind:"break",status:"approved",breakStartedAt:{$exists:true},breakEndsAt:{$lte:now},breakReturnedAt:{$exists:false}})` | JSON only. |
| leave.runningBreak | lib/presence.ts runningBreak | `findOne({…}).select("breakEndsAt").lean()` | |
| tasks.list | GET /api/staff/tasks | `StaffTask.find(filter).sort({dueDate:1,createdAt:-1}).lean()` | Filter rebuilt from the actor, `staff` and `status`. |
| tasks.ownership | GET /api/staff/overview `?id=` | `find({}, {assignedStaff,assignedStaffId,status}).lean()` | |
| tasks.findById | PUT /api/staff/tasks (before) | `findById(id).lean()` | |
| salaries.list | GET /api/staff/salary | `Salary.find(filter).sort({employeeName:1})` (non-lean) | History is rebuilt from salaryPayments in order, with subdocument `_id`s. |
| salaries.paidIncentives | lib/staff-incentive.ts loadIncentiveBook | `find({paymentStatus:"Paid"},{employeeName:1,incentives:1}).lean()` | |
| payouts.forUser | GET /api/staff/my-incentive `?detail=1`, overview `?id=` (limit 200) | `IncentivePayout.find({userId}).sort({date:-1,createdAt:-1})[.limit(n)].lean()` | |
| payouts.amounts | lib/staff-incentive.ts | `find({}, {userId:1,amount:1}).lean()` | |
| shift.latest | lib/shift-settings.ts getShift (GET /api/staff/shifts, attendance POST, cron) | `ShiftSetting.findOne().sort({updatedAt:-1})` (non-lean) | null means "none yet". Creating the default, or moving the old shift, stays in getShift (a write). |
| priceUnlock.setting | lib/priceLock.ts isUnlockPinSet / verifyUnlockPin, GET /api/price-lock/pin | `PriceUnlockSetting.findOne({key:"price-unlock"}).lean()` | **Returns pinHash**, like Mongo. The callers only test it or bcrypt-compare it. |
| scheduledRuns.exists | lib/ensure-indexes.ts | `ScheduledRun.exists({key})` | `{_id}` or null. |
| notifications.latest | GET /api/notifications (and /api/me/summary through it) | `find({recipientId}).sort({createdAt:-1}).limit(30).lean()` | |
| notifications.unreadCount | GET /api/notifications | `countDocuments({recipientId, readAt:null})` | `readAt IS NULL` (missing or null). |
| notifications.unreadTaskRefs | PATCH /api/notifications markSeen | `find({_id?, recipientId, readAt:null, refType:"task"}, {refId:1}).lean()` | |
| push.idsForUser | POST /api/push/subscribe | `find({userId}).sort({updatedAt:-1}).select("_id").lean()` | |
| push.subsForUsers | lib/push.ts pushToUsers | `find({userId:{$in}}).limit(300).lean()` | Returns the device keys (`p256dh`, `auth`), like Mongo. |
| audit.list | GET /api/audit (log view) | `AuditLog.find(filter).sort({createdAt:-1}).limit(limit).lean()` | action / from–to (IST days) / refs / q (`LIKE` on entityRef, partyName, performedBy, reason) / limit. |

## Reads NOT covered (and why)

- **Read-modify-write reads:** these load a mongoose document and `save()` it, or check it right before writing in
  the same request:
  - `LeaveRequest.findById` in break / PATCH leave;
  - the `findOne` clash checks in POST leave;
  - `Attendance.findOne` in check-in / leave / manual (their JSON is covered by `attendance.findByStaffDate`);
  - `Salary.findById` in PUT salary;
  - `ShiftSetting.findOne` in POST shifts;
  - `User.findById(...).select("+password")` in PUT /api/price-lock/pin;
  - `User.findById(...).select("+unlockPinFailCount +unlockPinLockedUntil")` in verifyUnlockPin;
  - lib/securityPin.ts.

  They stay on Mongo until the writes of these collections move.
- **Claims are writes:** `ScheduledRun.findOneAndUpdate` (attendance-alerts claim, office-reminder),
  `RolePermission.findOneAndUpdate`, `PriceUnlockSetting.findOneAndUpdate`, `PushSubscription.findOneAndUpdate`.
- **No reads, or another area's reads:**
  - `/api/auth/permissions` reads nothing itself (it goes through `rolePermissions.all` via getActor).
  - `/api/push/key` reads nothing.
  - `/api/push/test` reads through `push.subsForUsers`.
  - `/api/auth/seed` only writes.
  - `/api/staff/fix-name` GET: the user is `users.findById`, and the counts in lib/staff-rename.ts span invoices,
    leads and others (other areas).
  - brand-sales `brandSalesFor`, the Invoice part of `loadIncentiveBook`, `Lead.find` in the overview, and the
    deleted-invoice / deleted-purchase views of /api/audit belong to the SALES / CRM / STOCK areas.
- **Outside this stage's list:** other files that read these collections, such as dashboard/stats, delivery/*,
  estimates, invoices, cash-register, admin-cash, inventory/audit, items/*, purchase-*, stock-orders,
  supplier-stock, test-login, lib/change-requests, lib/invoice-full-edit and lib/stock-order-retention.

## Where D1 can differ from Mongo (known, not seen in the test data)

- **Case folding:** `LIKE` folds ASCII letters only. Mongo's `/i` also folds other alphabets (e.g. "É" / "é").
  This affects login by email, notify by name / email, task assignee names and the audit search.
- **Explicit null vs missing:** `IS NULL` also matches an explicit `null` where Mongo's `$exists: false` does not.
  This affects:
  - `checkOutTime`, `breakReturnedAt`, `backAt`;
  - the notify ACTIVE rule (`status` missing).

  It also works the other way: `$exists: true` matches an explicit null and `IS NOT NULL` does not (`breakStartedAt`).
  The app never writes these nulls.
- **Lossy legacy values:** a value saved with another type, such as a number as text in a REAL column, a date
  string in a date column, or an object in a text column, is converted by the copy. The rebuild then fails its
  hash check and returns the first guess.
- **Ties and natural order:** Mongo leaves the order of rows with equal sort keys, and of a find with no sort, to
  the query plan (an index on the filter changes it). D1 uses `id` order. The test compares those rows in `_id`
  order. Order between different sort keys is still compared strictly.
- **Non-lean history entries without an `_id`:** mongoose gives each one a random new `_id` on every read, so even
  two Mongo reads differ.
- **Regex edge:** the `$` of PCRE also matches before a final newline in the value. `LIKE` does not.
