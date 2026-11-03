import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * The Admin's own cash book. Cash the cashier hands over comes from the cash register
 * ledger (MD handovers); this holds what the Admin then does with it: deposits it in a
 * bank, spends it, or takes it out some other way, plus an opening figure for the cash
 * the Admin already held when this book was started.
 */
export interface IAdminCashEntry extends Document {
  type: "OPENING" | "DEPOSIT" | "EXPENSE" | "OTHER_OUT";
  amount: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, India time
  bankAccountId?: string;
  bankAccount?: string;
  referenceNo?: string;
  description?: string;
  recordedBy: string;
  recordedByUserId?: string;
  voided?: boolean;
  voidedBy?: string;
  voidedAt?: string;
  voidReason?: string;
}

const AdminCashEntrySchema = new Schema<IAdminCashEntry>(
  {
    type: { type: String, enum: ["OPENING", "DEPOSIT", "EXPENSE", "OTHER_OUT"], required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: String, required: true, index: true },
    time: { type: String, default: "12:00" },
    bankAccountId: { type: String, default: "" },
    bankAccount: { type: String, default: "" },
    referenceNo: { type: String, default: "" },
    description: { type: String, default: "" },
    recordedBy: { type: String, required: true },
    recordedByUserId: { type: String, default: "" },
    voided: { type: Boolean, default: false },
    voidedBy: String,
    voidedAt: String,
    voidReason: String,
  },
  { timestamps: true, collection: "admin_cash_entries" }
);

const AdminCashEntry: Model<IAdminCashEntry> =
  mongoose.models.AdminCashEntry || mongoose.model<IAdminCashEntry>("AdminCashEntry", AdminCashEntrySchema);
export default AdminCashEntry;
