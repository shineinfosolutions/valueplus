import ShiftSetting from "@/models/ShiftSetting";

export const SHIFT_NAME = "Showroom Shift (10:00 AM - 09:00 PM)";
export const DEFAULT_SHIFT = {
  shiftName: SHIFT_NAME,
  startTime: "10:00",
  endTime: "21:00",
  lateGraceMinutes: 15,
  halfDayLateCutoff: "12:00",
  minHoursForFullDay: 7.5,
  minHoursForHalfDay: 4.0,
  allowEarlyCheckoutWithoutPenalty: false,
  branchName: "All Branches",
  updatedBy: "SuperAdmin",
};

const OLD_SHIFT_NAME = "Showroom Shift (10:00 AM - 06:00 PM)";

/**
 * The shift in force. The store now works 10:00 AM to 09:00 PM, so a shift that is still the old built-in
 * 10:00 AM - 06:00 PM one is moved to the new hours; a shift someone set up by hand is left alone.
 */
export async function getShift(): Promise<any> {
  let shift: any = await ShiftSetting.findOne().sort({ updatedAt: -1 });
  if (!shift) return ShiftSetting.create(DEFAULT_SHIFT);
  if (shift.endTime === "18:00" && shift.shiftName === OLD_SHIFT_NAME) {
    shift.endTime = DEFAULT_SHIFT.endTime;
    shift.shiftName = SHIFT_NAME;
    shift.updatedBy = "System (shift moved to 10:00 AM - 09:00 PM)";
    await shift.save();
  }
  return shift;
}
