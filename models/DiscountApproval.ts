import mongoose, { Schema, Document, Model } from "mongoose";

export interface IDiscountApproval extends Document {
  requestedBy: string;
  requestedById: string;
  requestedByRole: string;
  context: "estimate" | "bill";
  customerName: string;
  itemId: string;
  itemName: string;
  brand: string;
  /** The product's selling price (the base the discount is measured from) and the price offered, per piece. */
  sellingPrice: number;
  price: number;
  quantity: number;
  percent: number;
  /** Who has to approve: the Cashier (above 5%, below 10%), the Store Manager (10–12%) or the Admin (above 12%). */
  tier: "cashier" | "manager" | "admin";
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNote?: string;
}

const DiscountApprovalSchema = new Schema<IDiscountApproval>(
  {
    requestedBy: { type: String, required: true },
    requestedById: { type: String, required: true, index: true },
    requestedByRole: { type: String, default: "" },
    context: { type: String, enum: ["estimate", "bill"], default: "bill" },
    customerName: { type: String, default: "" },
    itemId: { type: String, default: "" },
    itemName: { type: String, required: true },
    brand: { type: String, default: "" },
    sellingPrice: { type: Number, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, default: 1 },
    percent: { type: Number, required: true },
    tier: { type: String, enum: ["cashier", "manager", "admin"], required: true, index: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: "" },
  },
  { timestamps: true }
);

const DiscountApproval: Model<IDiscountApproval> =
  mongoose.models.DiscountApproval || mongoose.model<IDiscountApproval>("DiscountApproval", DiscountApprovalSchema);
export default DiscountApproval;
