import mongoose, { Schema, Document, Model } from "mongoose";

export interface IShiftSetting extends Document {
  shiftName: string;
  startTime: string; // e.g. "10:00" (10:00 AM)
  endTime: string; // e.g. "18:00" (06:00 PM)
  lateGraceMinutes: number; // e.g. 15 minutes (checkin up to 10:15 AM is on time)
  halfDayLateCutoff: string; // e.g. "12:00" (checkin after 12:00 PM is Half-Day)
  minHoursForFullDay: number; // e.g. 7.5 hours
  minHoursForHalfDay: number; // e.g. 4.0 hours
  allowEarlyCheckoutWithoutPenalty: boolean;
  branchName?: string;
  updatedBy?: string;
}

const ShiftSettingSchema = new Schema<IShiftSetting>(
  {
    shiftName: { type: String, default: "General Showroom Shift", required: true },
    startTime: { type: String, default: "10:00", required: true },
    endTime: { type: String, default: "18:00", required: true },
    lateGraceMinutes: { type: Number, default: 15 },
    halfDayLateCutoff: { type: String, default: "12:00" },
    minHoursForFullDay: { type: Number, default: 7.5 },
    minHoursForHalfDay: { type: Number, default: 4.0 },
    allowEarlyCheckoutWithoutPenalty: { type: Boolean, default: false },
    branchName: { type: String, default: "All Branches" },
    updatedBy: { type: String, default: "SuperAdmin" },
  },
  { timestamps: true, collection: "shift_settings" }
);

if (mongoose.models.ShiftSetting) {
  delete mongoose.models.ShiftSetting;
}
const ShiftSetting: Model<IShiftSetting> = mongoose.model<IShiftSetting>("ShiftSetting", ShiftSettingSchema);
export default ShiftSetting;
