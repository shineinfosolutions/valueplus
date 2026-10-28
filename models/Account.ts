import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAccount extends Document {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  description?: string;
  balance: number;
}

const AccountSchema = new Schema<IAccount>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, unique: true },
    type: { type: String, enum: ["asset", "liability", "equity", "revenue", "expense"], required: true },
    description: { type: String },
    balance: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "accounts" }
);

const Account: Model<IAccount> = mongoose.models.Account || mongoose.model<IAccount>("Account", AccountSchema);
export default Account;
