import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAttendance extends Document {
  staffName: string;
  staffId?: string;
  staffEmail?: string;
  staffRole?: string;
  userId?: string;
  branchId?: string;
  branchName?: string;
  date: string; // YYYY-MM-DD
  checkInTime: string; // e.g. "10:05 AM"
  checkOutTime?: string; // e.g. "06:05 PM"
  workingDurationMinutes?: number;
  shiftName?: string;
  isLate?: boolean;
  isEarlyCheckout?: boolean;
  status: "Present" | "Late" | "Half-Day" | "Absent" | "On Leave";
  leaveType?: "Casual" | "Sick" | "Paid" | "Unpaid" | "Weekly Off" | "Emergency" | "None";
  leaveStatus?: "None" | "Pending" | "Approved" | "Rejected";
  leaveReason?: string;
  advanceRequested?: number;
  advanceStatus?: "None" | "Pending" | "Approved" | "Rejected";
  notes?: string;
  /** Minutes after the shift start (10:00) the person checked in. */
  lateMinutes?: number;
  /** Selfie taken at check-in (key in the R2 bucket) and where the phone was. */
  checkInPhotoKey?: string;
  checkInLat?: number;
  checkInLng?: number;
  checkInDistanceM?: number;
  /** Geofence (lib/presence.ts): times the person was outside the store during the shift. */
  awayPeriods?: IAwayPeriod[];
  /** Minutes outside, not counting approved breaks or the time the app was closed. */
  totalAwayMinutes?: number;
  /** Minutes the app was closed / in the background during the shift (location unknown). */
  unknownMinutes?: number;
  lastPresence?: { state: "in" | "out"; at: Date; distanceM?: number; lat?: number; lng?: number };
}

export interface IAwayPeriod {
  /** away = outside the store; break = outside during an approved break; unknown = app closed, location unknown. */
  kind: "away" | "break" | "unknown";
  leftAt: Date;
  backAt?: Date;
  minutes?: number;
  leftDistanceM?: number;
  maxDistanceM?: number;
  /** For a break: when the approved break ends (the rest of the time outside counts as away). */
  breakEndsAt?: Date;
  /** The end is not exactly known (the app was closed meanwhile): the minutes are the least it can have been. */
  endUncertain?: boolean;
  /** Last "outside too long" alert sent for this period. */
  lastAlertAt?: Date;
}

const AttendanceSchema = new Schema<IAttendance>(
  {
    staffName: { type: String, required: true, index: true },
    staffId: { type: String },
    staffEmail: { type: String },
    staffRole: { type: String, default: "salesman" },
    userId: { type: String },
    branchId: { type: String },
    branchName: { type: String, default: "Ashoka Enterprises (Kunraghat Showroom)" },
    date: { type: String, required: true, index: true },
    checkInTime: { type: String, required: true },
    checkOutTime: { type: String },
    workingDurationMinutes: { type: Number, default: 0 },
    shiftName: { type: String, default: "General Showroom Shift" },
    isLate: { type: Boolean, default: false },
    isEarlyCheckout: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["Present", "Late", "Half-Day", "Absent", "On Leave"],
      default: "Present",
      index: true,
    },
    leaveType: {
      type: String,
      enum: ["Casual", "Sick", "Paid", "Unpaid", "Weekly Off", "Emergency", "None"],
      default: "None",
    },
    leaveStatus: {
      type: String,
      enum: ["None", "Pending", "Approved", "Rejected"],
      default: "None",
    },
    leaveReason: { type: String, default: "" },
    advanceRequested: { type: Number, default: 0 },
    advanceStatus: {
      type: String,
      enum: ["None", "Pending", "Approved", "Rejected"],
      default: "None",
    },
    notes: { type: String, default: "" },
    lateMinutes: { type: Number, default: 0 },
    checkInPhotoKey: { type: String, default: "" },
    checkInLat: { type: Number },
    checkInLng: { type: Number },
    checkInDistanceM: { type: Number },
    awayPeriods: {
      type: [
        {
          _id: false,
          kind: { type: String, enum: ["away", "break", "unknown"], default: "away" },
          leftAt: { type: Date, required: true },
          backAt: { type: Date },
          minutes: { type: Number },
          leftDistanceM: { type: Number },
          maxDistanceM: { type: Number },
          breakEndsAt: { type: Date },
          endUncertain: { type: Boolean },
          lastAlertAt: { type: Date },
        },
      ],
      default: undefined,
    },
    totalAwayMinutes: { type: Number, default: 0 },
    unknownMinutes: { type: Number, default: 0 },
    lastPresence: {
      state: { type: String, enum: ["in", "out"] },
      at: { type: Date },
      distanceM: { type: Number },
      lat: { type: Number },
      lng: { type: Number },
    },
  },
  { timestamps: true, collection: "attendance" }
);

// Compound index to ensure uniqueness per staff per date
AttendanceSchema.index({ staffName: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ date: 1, status: 1 });

if (mongoose.models.Attendance) {
  delete mongoose.models.Attendance;
}
const Attendance: Model<IAttendance> = mongoose.model<IAttendance>("Attendance", AttendanceSchema);
export default Attendance;
