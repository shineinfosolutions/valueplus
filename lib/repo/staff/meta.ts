import { istToday } from "@/lib/ist";

/**
 * What the D1 read side must know about the mongoose schemas of the STAFF & SYSTEM models (models/*.ts) to give
 * back exactly what a Mongo read gives, without importing mongoose: tests/d1-staff-reads.test.ts checks every
 * entry here against the real schemas, so a schema change that is not reflected here fails the tests.
 *
 *  - SELECT_FALSE: paths with `select: false`. Mongoose leaves them out of every read unless a projection asks for
 *    them with "+path" (or names them in an inclusive projection).
 *  - NULL_DEFAULTS: paths whose default is `null`, so a document saved by mongoose holds an explicit null.
 *  - DEFAULTS / ARRAY_PATHS / ELEMENT_DEFAULTS: what mongoose fills in when it HYDRATES a document whose stored copy
 *    lacks the path (non-lean reads only): scalar defaults, arrays that start as [], and the defaults inside each
 *    element of a document array. Function defaults are functions here too.
 */

export const SELECT_FALSE: Record<string, string[]> = {
  users: ["securityPin", "pinFailCount", "pinLockedUntil", "unlockPinFailCount", "unlockPinLockedUntil"],
};

export const NULL_DEFAULTS: Record<string, string[]> = {
  notifications: ["readAt"],
  push_subscriptions: ["lastSuccessAt"],
};

type Def = unknown | (() => unknown);

export const DEFAULTS: Record<string, Record<string, Def>> = {
  users: {
    role: "salesman",
    mobile: "",
    avatar: "",
    address: "",
    city: "Gorakhpur",
    state: "Uttar Pradesh",
    pincode: "273008",
    idProofType: "Aadhaar Card",
    idProofNumber: "",
    idProofDoc: "",
    designation: "Sales Executive",
    monthlySalary: 0,
    salaryType: "Fixed",
    salaryPaymentDay: 7,
    joiningDate: () => istToday(),
    advanceBalance: 0,
    monthlyAdvanceDeduction: 0,
    vehicleNumber: "",
    drivingLicenseNo: "",
    bankName: "",
    bankAccountNo: "",
    bankIfsc: "",
    assignedWarehouseId: "",
    assignedWarehouseName: "",
    assignedBrand: "",
    pinFailCount: 0,
    unlockPinFailCount: 0,
    liveAuditAccess: false,
    status: "active",
  },
  attendance: {
    staffRole: "salesman",
    branchName: "Ashoka Enterprises (Kunraghat Showroom)",
    workingDurationMinutes: 0,
    shiftName: "General Showroom Shift",
    isLate: false,
    isEarlyCheckout: false,
    status: "Present",
    leaveType: "None",
    leaveStatus: "None",
    leaveReason: "",
    advanceRequested: 0,
    advanceStatus: "None",
    notes: "",
    lateMinutes: 0,
    checkInPhotoKey: "",
    totalAwayMinutes: 0,
    unknownMinutes: 0,
  },
  leaverequests: {
    staffId: "",
    staffRole: "",
    days: 1,
    reason: "",
    status: "pending",
    reviewedBy: "",
    reviewNote: "",
  },
  salaries: {
    designation: "Sales Executive",
    salaryType: "Fixed",
    joiningDate: "2024-01-01",
    deductions: 0,
    incentives: 0,
    commission: 0,
    paymentStatus: "Pending",
    paymentMode: "Bank Transfer",
    year: 2026,
    notes: "",
  },
  shift_settings: {
    shiftName: "General Showroom Shift",
    startTime: "10:00",
    endTime: "18:00",
    lateGraceMinutes: 15,
    halfDayLateCutoff: "12:00",
    minHoursForFullDay: 7.5,
    minHoursForHalfDay: 4,
    allowEarlyCheckoutWithoutPenalty: false,
    branchName: "All Branches",
    updatedBy: "SuperAdmin",
  },
};

/** Array paths that hydrate to [] when the stored document has none (awayPeriods has `default: undefined`). */
export const ARRAY_PATHS: Record<string, string[]> = {
  users: ["assignedBrands"],
  attendance: [],
  leaverequests: [],
  salaries: ["history"],
  shift_settings: [],
};

/** Defaults inside each element of a document array, applied on hydration. */
export const ELEMENT_DEFAULTS: Record<string, Record<string, Record<string, Def>>> = {
  attendance: { awayPeriods: { kind: "away" } },
  salaries: { history: { paymentMode: "Bank Transfer", txnRef: "", notes: "" } },
};

export function defaultValue(d: Def): unknown {
  return typeof d === "function" ? (d as () => unknown)() : Array.isArray(d) ? [...d] : d;
}
