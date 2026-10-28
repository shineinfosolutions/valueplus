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
  leaveType?: "Casual" | "Sick" | "Paid" | "Unpaid" | "None";
  leaveStatus?: "None" | "Pending" | "Approved" | "Rejected";
  leaveReason?: string;
  advanceRequested?: number;
  advanceStatus?: "None" | "Pending" | "Approved" | "Rejected";
  notes?: string;
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
      enum: ["Casual", "Sick", "Paid", "Unpaid", "None"],
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
