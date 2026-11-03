import mongoose, { Schema, Document, Model } from "mongoose";

export type LeaveKind = "weekly_off" | "leave" | "break" | "emergency";

export interface ILeaveRequest extends Document {
  kind: LeaveKind;
  staffName: string;
  staffId: string;
  staffRole: string;
  /** First and last day (YYYY-MM-DD). A weekly off and a break are one day. */
  fromDate: string;
  toDate: string;
  days: number;
  /** Break only: 10, 20 or 30. */
  breakMinutes?: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  /** Break only: when the person started it, when it ends, when they were back at the store, last "not back" alert. */
  breakStartedAt?: Date;
  breakEndsAt?: Date;
  breakReturnedAt?: Date;
  lastOverAlertAt?: Date;
}

const LeaveRequestSchema = new Schema<ILeaveRequest>(
  {
    kind: { type: String, enum: ["weekly_off", "leave", "break", "emergency"], required: true, index: true },
    staffName: { type: String, required: true, index: true },
    staffId: { type: String, default: "", index: true },
    staffRole: { type: String, default: "" },
    fromDate: { type: String, required: true },
    toDate: { type: String, required: true },
    days: { type: Number, default: 1 },
    breakMinutes: { type: Number },
    reason: { type: String, default: "" },
    status: { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending", index: true },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: "" },
    breakStartedAt: { type: Date },
    breakEndsAt: { type: Date },
    breakReturnedAt: { type: Date },
    lastOverAlertAt: { type: Date },
  },
  { timestamps: true }
);

const LeaveRequest: Model<ILeaveRequest> =
  mongoose.models.LeaveRequest || mongoose.model<ILeaveRequest>("LeaveRequest", LeaveRequestSchema);
export default LeaveRequest;
