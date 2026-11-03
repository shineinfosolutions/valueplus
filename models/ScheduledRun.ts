import mongoose, { Schema, Document, Model } from "mongoose";

/** One row per scheduled job and day (e.g. "office-start:2026-10-31"), so a job runs once however often it is triggered. */
export interface IScheduledRun extends Document {
  key: string;
  ranAt: Date;
}

const ScheduledRunSchema = new Schema<IScheduledRun>(
  {
    key: { type: String, required: true, unique: true },
    ranAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "scheduled_runs" }
);

const ScheduledRun: Model<IScheduledRun> =
  mongoose.models.ScheduledRun || mongoose.model<IScheduledRun>("ScheduledRun", ScheduledRunSchema);
export default ScheduledRun;
