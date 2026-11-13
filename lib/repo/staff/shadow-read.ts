/**
 * Stage B2 wiring of the STAFF & SYSTEM reads: a route or helper calls
 *
 *   const list = await readStaff("leave.list", { status, mineOf, kinds });
 *
 * which is readWithShadow("staff", name, () => STAFF_READS[name].mongo(...args), (db) => STAFF_READS[name].d1On(db, ...args))
 * with the comparison rules below. The `mongo` side is the old query, verbatim (lib/repo/staff/mongo.ts connects to
 * MongoDB itself), so with the switch `read:staff` on 'mongo' (or missing) nothing changes.
 *
 * Comparison rules (lib/d1/compare.ts): the D1 rebuild is exact (every row is checked against its document hash),
 * so only ORDER is relaxed:
 *  - sorted reads (`tieOrder` on the sort key): rows with an equal sort key have no defined order in MongoDB, D1
 *    gives them in _id order; the sequence of sort keys must still match;
 *  - reads without a sort (`unorderedPaths`): MongoDB's natural order depends on the query plan, D1 uses _id order.
 * Secret fields (password / PIN hashes, push keys) are compared like any field, but a difference in them is stored
 * masked (lib/d1/compare.ts SECRET_KEY), never with its value.
 */
import { readWithShadow } from "@/lib/d1/shadow";
import type { CompareOptions } from "@/lib/d1/compare";
import { STAFF_READS } from "./index";

const sorted = (key: (d: any) => unknown): CompareOptions => ({ tieOrder: [{ path: "", key }] });
const unordered: CompareOptions = { unorderedPaths: [""] };
const exact: CompareOptions = {};

const byCreatedAt = sorted((d) => d?.createdAt ?? null);

export const STAFF_COMPARE: Record<string, CompareOptions> = {
  "users.list": byCreatedAt,
  "auth.loginLookup": exact,
  "users.findById": exact,
  "users.active": unordered,
  "users.directory": sorted((d) => d?.name ?? null),
  "users.securityPinState": exact,
  "users.idByExactName": exact,
  "users.notifyById": unordered,
  "users.notifyAllStaff": unordered,
  "users.notifySalesStaff": unordered,
  "users.notifyByName": unordered,
  "users.notifyRoles": unordered,
  "users.notifyEmail": unordered,
  "users.workingStaff": unordered,
  "rolePermissions.all": unordered,
  "attendance.list": sorted((d) => [d?.date ?? null, d?.createdAt ?? null]),
  "attendance.photoRef": exact,
  "attendance.between": sorted((d) => d?.date ?? null),
  "attendance.overviewDay": unordered,
  "attendance.recentForStaff": sorted((d) => d?.date ?? null),
  "attendance.presenceRows": sorted((d) => d?.staffName ?? null),
  "attendance.dayCheckins": unordered,
  "attendance.findByStaffDate": exact,
  "attendance.autoCheckoutCandidates": unordered,
  "attendance.openAway": unordered,
  "leave.list": byCreatedAt,
  "leave.forStaffBetween": sorted((d) => d?.fromDate ?? null),
  "leave.approvedAwayOn": unordered,
  "leave.breakOverCandidates": unordered,
  "leave.runningBreak": exact,
  "tasks.list": sorted((d) => [d?.dueDate ?? null, d?.createdAt ?? null]),
  "tasks.ownership": unordered,
  "tasks.findById": exact,
  "salaries.list": sorted((d) => d?.employeeName ?? null),
  "salaries.paidIncentives": unordered,
  "payouts.forUser": sorted((d) => [d?.date ?? null, d?.createdAt ?? null]),
  "payouts.amounts": unordered,
  "shift.latest": exact,
  "priceUnlock.setting": exact,
  "scheduledRuns.exists": exact,
  "notifications.latest": byCreatedAt,
  "notifications.unreadCount": exact,
  "notifications.unreadTaskRefs": unordered,
  "push.idsForUser": sorted((d) => d?.updatedAt ?? null),
  "push.subsForUsers": unordered,
  "audit.list": byCreatedAt,
};

/** One STAFF_READS entry through the `read:staff` switch (mongo / shadow / d1); `args` are the Mongo read's arguments. */
export function readStaff<T = any>(name: string, ...args: any[]): Promise<T> {
  const entry = STAFF_READS[name];
  if (!entry) throw new Error(`readStaff: unknown read ${name}`);
  return readWithShadow<T>(
    "staff",
    name,
    () => entry.mongo(...args),
    (db) => entry.d1On(db, ...args),
    { compare: STAFF_COMPARE[name] ?? exact }
  );
}
