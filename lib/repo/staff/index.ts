/**
 * Every STAFF & SYSTEM read, as a pair: `mongo` is the current MongoDB query, wrapped verbatim
 * (lib/repo/staff/mongo.ts); `d1` gives the same JSON from D1 (lib/repo/staff/d1.ts). Both take the same arguments.
 * A shadow comparison or a test calls both and compares JSON.stringify of the results (object keys in sorted order:
 * D1 cannot know the order the fields were first saved in). The list of reads, and what each covers, is in
 * lib/repo/staff/INVENTORY.md. The routes call them through readStaff (lib/repo/staff/shadow.ts).
 */
import * as mongo from "./mongo";
import * as d1 from "./d1";
import type { D1DatabaseLike } from "@/lib/d1/types";

export interface ReadPair {
  mongo: (...args: any[]) => Promise<any>;
  /** The D1 read on the Worker binding (or setStaffD1's database), same arguments as `mongo`. */
  d1: (...args: any[]) => Promise<any>;
  /** The D1 read on a given database (the shadow-read framework passes the one it resolved), then `mongo`'s arguments. */
  d1On: (db: D1DatabaseLike | null | undefined, ...args: any[]) => Promise<any>;
}

type D1Read = (db: d1.DbArg, ...args: any[]) => Promise<any>;

const pair = (name: keyof typeof d1 & keyof typeof mongo): ReadPair => {
  const read = d1[name] as unknown as D1Read;
  return {
    mongo: mongo[name] as (...args: any[]) => Promise<any>,
    d1: (...args: any[]) => read(null, ...args),
    d1On: (db, ...args) => read(db, ...args),
  };
};

export const STAFF_READS: Record<string, ReadPair> = {
  // users
  "users.list": pair("usersList"),
  "auth.loginLookup": pair("authLoginLookup"),
  "users.findById": pair("usersFindById"),
  "users.active": pair("usersActive"),
  "users.directory": pair("usersDirectory"),
  "users.securityPinState": pair("usersSecurityPinState"),
  "users.idByExactName": pair("usersIdByExactName"),
  "users.notifyById": pair("usersNotifyById"),
  "users.notifyAllStaff": pair("usersNotifyAllStaff"),
  "users.notifySalesStaff": pair("usersNotifySalesStaff"),
  "users.notifyByName": pair("usersNotifyByName"),
  "users.notifyRoles": pair("usersNotifyRoles"),
  "users.notifyEmail": pair("usersNotifyEmail"),
  "users.workingStaff": pair("usersWorkingStaff"),
  // permissions
  "rolePermissions.all": pair("rolePermissionsAll"),
  // attendance
  "attendance.list": pair("attendanceList"),
  "attendance.photoRef": pair("attendancePhotoRef"),
  "attendance.between": pair("attendanceBetween"),
  "attendance.overviewDay": pair("attendanceOverviewDay"),
  "attendance.recentForStaff": pair("attendanceRecentForStaff"),
  "attendance.presenceRows": pair("attendancePresenceRows"),
  "attendance.dayCheckins": pair("attendanceDayCheckins"),
  "attendance.findByStaffDate": pair("attendanceFindByStaffDate"),
  "attendance.autoCheckoutCandidates": pair("attendanceAutoCheckoutCandidates"),
  "attendance.openAway": pair("attendanceOpenAway"),
  // leave and breaks
  "leave.list": pair("leaveList"),
  "leave.forStaffBetween": pair("leaveForStaffBetween"),
  "leave.approvedAwayOn": pair("leaveApprovedAwayOn"),
  "leave.breakOverCandidates": pair("leaveBreakOverCandidates"),
  "leave.runningBreak": pair("leaveRunningBreak"),
  // tasks
  "tasks.list": pair("tasksList"),
  "tasks.ownership": pair("tasksOwnership"),
  "tasks.findById": pair("tasksFindById"),
  // salary and incentive
  "salaries.list": pair("salariesList"),
  "salaries.paidIncentives": pair("salariesPaidIncentives"),
  "payouts.forUser": pair("payoutsForUser"),
  "payouts.amounts": pair("payoutsAmounts"),
  // settings
  "shift.latest": pair("shiftLatest"),
  "priceUnlock.setting": pair("priceUnlockSetting"),
  "scheduledRuns.exists": pair("scheduledRunExists"),
  // notifications and push
  "notifications.latest": pair("notificationsLatest"),
  "notifications.unreadCount": pair("notificationsUnreadCount"),
  "notifications.unreadTaskRefs": pair("notificationsUnreadTaskRefs"),
  "push.idsForUser": pair("pushIdsForUser"),
  "push.subsForUsers": pair("pushSubsForUsers"),
  // audit
  "audit.list": pair("auditList"),
};

export { setStaffD1 } from "./d1";
