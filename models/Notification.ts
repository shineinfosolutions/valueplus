import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * One notification for one user — shown in the bell at the top of every page.
 * A message for several people (e.g. a task for "All Sales Staff") is saved as
 * one document per person, so each can read it on their own.
 */
export interface INotification extends Document {
  recipientId: string;
  recipientName: string;
  type: "task_assigned" | "target_assigned" | "task_updated" | "approval_request" | "approval_result" | "general";
  title: string;
  message: string;
  /** Page the notification opens, e.g. "/staff/tasks". */
  link: string;
  readAt?: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipientId: { type: String, required: true, index: true },
    recipientName: { type: String, default: "" },
    type: {
      type: String,
      enum: ["task_assigned", "target_assigned", "task_updated", "approval_request", "approval_result", "general"],
      default: "general",
    },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    link: { type: String, default: "" },
    readAt: { type: Date, default: null },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true, collection: "notifications" }
);

NotificationSchema.index({ recipientId: 1, createdAt: -1 });

const Notification: Model<INotification> =
  mongoose.models.Notification || mongoose.model<INotification>("Notification", NotificationSchema);

export default Notification;
