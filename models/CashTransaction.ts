import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICashTransaction extends Document {
  type: "INFLOW" | "OUTFLOW";
  category: 
    | "CASH_SALE" 
    | "EMI_COLLECTION" 
    | "DOWN_PAYMENT" 
    | "BANK_DEPOSIT" 
    | "MD_HANDOVER" 
    | "CASH_EXPENSE" 
    | "OPENING_BALANCE" 
    | "OTHER_RECEIPT";
  amount: number;
  date: string; // YYYY-MM-DD
  time: string;
  referenceNo: string;
  description?: string;
  partyName?: string;
  targetBankAccount?: string;
  handedTo?: string;
  recordedBy?: string;
  /** A handover from the cashier counts only once the Admin confirms receiving it. Empty = an older entry, already counted. */
  adminStatus?: "pending" | "confirmed" | "rejected";
  adminReviewedBy?: string;
  adminReviewedAt?: string;
  adminRejectReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CashTransactionSchema = new Schema<ICashTransaction>(
  {
    type: {
      type: String,
      enum: ["INFLOW", "OUTFLOW"],
      required: true,
    },
    category: {
      type: String,
      enum: [
        "CASH_SALE",
        "EMI_COLLECTION",
        "DOWN_PAYMENT",
        "BANK_DEPOSIT",
        "MD_HANDOVER",
        "CASH_EXPENSE",
        "OPENING_BALANCE",
        "OTHER_RECEIPT",
      ],
      required: true,
    },
    amount: { type: Number, required: true },
    date: { type: String, required: true },
    time: { type: String, default: () => new Date().toLocaleTimeString("en-IN") },
    referenceNo: { type: String, required: true },
    description: { type: String, default: "" },
    partyName: { type: String, default: "" },
    targetBankAccount: { type: String, default: "" },
    handedTo: { type: String, default: "" },
    recordedBy: { type: String, default: "Cashier / Admin" },
    adminStatus: { type: String, enum: ["pending", "confirmed", "rejected"] },
    adminReviewedBy: String,
    adminReviewedAt: String,
    adminRejectReason: String,
  },
  { timestamps: true, collection: "cash_transactions" }
);

const CashTransaction: Model<ICashTransaction> =
  mongoose.models.CashTransaction ||
  mongoose.model<ICashTransaction>("CashTransaction", CashTransactionSchema);

export default CashTransaction;
