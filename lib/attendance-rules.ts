/**
 * Who gets a Half-Day for coming late.
 *
 * Only the Store Manager and the Cashier: a check-in past the half-day cutoff, or a short day because they came late,
 * is a Half-Day for them. Everyone else (salesmen and the other staff) is only marked "Late" — they still get a
 * Half-Day for leaving before the shift ends, which is leaving early, not coming late.
 */
export const LATE_HALF_DAY_ROLES = ["manager", "cashier"];

export const lateMeansHalfDay = (role: any) => LATE_HALF_DAY_ROLES.includes(String(role || "").toLowerCase().trim());

/** The status for a check-in at `checkIn` minutes past midnight. */
export function checkInStatus(
  role: any,
  checkIn: number,
  shiftStart: number,
  graceMinutes: number,
  halfDayCutoff: number
): "Present" | "Late" | "Half-Day" {
  if (checkIn > halfDayCutoff) return lateMeansHalfDay(role) ? "Half-Day" : "Late";
  if (checkIn > shiftStart + graceMinutes) return "Late";
  return "Present";
}

/**
 * Is a finished day a Half-Day? For the Manager and Cashier: too few hours or leaving before the shift end (as before).
 * For everyone else: only leaving before the shift end — short hours from coming late do not count.
 */
export function checkoutIsHalfDay(
  role: any,
  workedHours: number,
  minHalfDayHours: number,
  minFullDayHours: number,
  checkOut: number,
  shiftEnd: number
): boolean {
  const leftEarly = checkOut < shiftEnd;
  if (lateMeansHalfDay(role)) return workedHours < minHalfDayHours || workedHours < minFullDayHours || leftEarly;
  return leftEarly;
}
