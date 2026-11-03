import mongoose, { Schema, Document, Model } from "mongoose";

/** Incentive actually paid to a staff member (one row per payment), recorded by the Admin. */
export interface IIncentivePayout extends Document {
  userId: string;
  employeeName: string;
  amount: number;
  date: string; // YYYY-MM-DD
  paymentMode: string;
  note?: string;
  paidBy: string;
  paidByUserId?: string;
}

const IncentivePayoutSchema = new Schema<IIncentivePayout>(
  {
    userId: { type: String, required: true, index: true },
    employeeName: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: String, required: true, index: true },
    paymentMode: { type: String, default: "Cash" },
    note: { type: String, default: "" },
    paidBy: { type: String, required: true },
    paidByUserId: { type: String, default: "" },
  },
  { timestamps: true, collection: "incentive_payouts" }
);

const IncentivePayout: Model<IIncentivePayout> =
  mongoose.models.IncentivePayout || mongoose.model<IIncentivePayout>("IncentivePayout", IncentivePayoutSchema);
export default IncentivePayout;
