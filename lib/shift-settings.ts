import ShiftSetting from "@/models/ShiftSetting";

export const SHIFT_NAME = "Showroom Shift (10:00 AM - 10:00 PM)";
export const DEFAULT_SHIFT = {
  shiftName: SHIFT_NAME,
  startTime: "10:00",
  endTime: "22:00",
  lateGraceMinutes: 15,
  halfDayLateCutoff: "12:00",
  minHoursForFullDay: 7.5,
  minHoursForHalfDay: 4.0,
  allowEarlyCheckoutWithoutPenalty: false,
  branchName: "All Branches",
  updatedBy: "SuperAdmin",
};

// Earlier built-in shifts. The store now stays open until 10:00 PM.
const OLD_BUILT_IN_SHIFTS: { name: string; endTime: string }[] = [
  { name: "Showroom Shift (10:00 AM - 06:00 PM)", endTime: "18:00" },
  { name: "Showroom Shift (10:00 AM - 09:00 PM)", endTime: "21:00" },
];

/**
 * The shift in force. The store works 10:00 AM to 10:00 PM, so a shift that is still one of the earlier
 * built-in ones (ending 06:00 PM or 09:00 PM) is moved to the new hours; a shift someone set up by hand is
 * left alone. The automatic check-out happens at the shift end (lib/attendance-alerts.ts).
 */
export async function getShift(): Promise<any> {
  let shift: any = await ShiftSetting.findOne().sort({ updatedAt: -1 });
  if (!shift) return ShiftSetting.create(DEFAULT_SHIFT);
  if (OLD_BUILT_IN_SHIFTS.some((o) => shift.endTime === o.endTime && shift.shiftName === o.name)) {
    shift.endTime = DEFAULT_SHIFT.endTime;
    shift.shiftName = SHIFT_NAME;
    shift.updatedBy = "System (shift moved to 10:00 AM - 10:00 PM)";
    await shift.save();
  }
  return shift;
}
