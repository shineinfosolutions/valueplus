import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStoreActivityApproval extends Document {
  activityId: string;
  storeName: string;
  storeInchargeName: string;
  storeInchargeEmail: string;
  activityType: "discount_override" | "expense_approval" | "stock_transfer" | "credit_limit" | "advance_salary" | "purchase_order" | "price_change" | "general";
  title: string;
  description: string;
  amount?: number;
  payload?: any;
  status: "pending" | "approved" | "rejected";
  superAdminActionAt?: Date;
  superAdminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StoreActivityApprovalSchema = new Schema<IStoreActivityApproval>(
  {
    activityId: { type: String, required: true, unique: true, index: true },
    storeName: { type: String, required: true, index: true },
    storeInchargeName: { type: String, required: true },
    storeInchargeEmail: { type: String, required: true },
    activityType: {
      type: String,
      enum: ["discount_override", "expense_approval", "stock_transfer", "credit_limit", "advance_salary", "purchase_order", "price_change", "general"],
      default: "general",
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    amount: { type: Number, default: 0 },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    superAdminActionAt: { type: Date },
    superAdminNotes: { type: String, default: "" },
  },
  { timestamps: true, collection: "store_activity_approvals" }
);

if (mongoose.models.StoreActivityApproval) {
  delete mongoose.models.StoreActivityApproval;
}

const StoreActivityApproval: Model<IStoreActivityApproval> =
  mongoose.model<IStoreActivityApproval>("StoreActivityApproval", StoreActivityApprovalSchema);

export default StoreActivityApproval;
