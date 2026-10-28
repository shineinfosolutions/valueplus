import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * One phone or browser that agreed to notifications. A person can have several
 * (phone + office computer). The address belongs to whoever logged in on that device
 * last, so a shared phone never keeps sending the previous user's notifications.
 */
export interface IPushSubscription extends Document {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  failCount: number;
  lastSuccessAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: { type: String, required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
    userAgent: { type: String, default: "" },
    failCount: { type: Number, default: 0 },
    lastSuccessAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "push_subscriptions" }
);

const PushSubscription: Model<IPushSubscription> =
  mongoose.models.PushSubscription || mongoose.model<IPushSubscription>("PushSubscription", PushSubscriptionSchema);
export default PushSubscription;
