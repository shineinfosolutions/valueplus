import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBankAccount extends Document {
  name: string;
  bank: string;
  number: string;
  ifsc: string;
  branch?: string;
  type: "current" | "savings" | "cash";
  balance?: number;
  status: "active" | "inactive";
}

const BankAccountSchema = new Schema<IBankAccount>(
  {
    name: { type: String, required: true },
    bank: { type: String, required: true },
    number: { type: String, required: true },
    ifsc: { type: String, default: "HDFC0000492" },
    branch: { type: String, default: "Kunraghat, Gorakhpur" },
    type: { type: String, enum: ["current", "savings", "cash"], required: true },
    balance: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, collection: "bank_accounts" }
);

const BankAccount: Model<IBankAccount> =
  mongoose.models.BankAccount || mongoose.model<IBankAccount>("BankAccount", BankAccountSchema);

export default BankAccount;
