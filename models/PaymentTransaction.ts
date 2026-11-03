import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPaymentTransaction extends Document {
  transactionId: string;
  partyId: string;
  partyType: "Customer" | "Supplier";
  partyName: string;
  amount: number;
  paymentMode: string;
  date: string;
  referenceId?: string; // e.g. Invoice Number or Bill Number
  notes?: string;
  /** Who took the money (from the login). */
  receivedBy?: string;
  /** Customer's balance right after this payment (below 0 = advance with the store). For the receipt. */
  balanceAfter?: number;
  type: "received" | "paid"; // received from customer, paid to supplier
  // Which store bank account the money landed in (non-cash receipts, finance payouts)
  bankAccountId?: string;
  bankAccountRef?: string;
  bankTxnRef?: string; // UTR / bank reference
  /** Set when an approved edit changed this payment. */
  lastEditedAt?: Date;
  lastEditedBy?: string;
  editCount?: number;
}

const PaymentTransactionSchema = new Schema<IPaymentTransaction>(
  {
    transactionId: { type: String, required: true, unique: true },
    partyId: { type: String, required: true },
    partyType: { type: String, enum: ["Customer", "Supplier"], required: true },
    partyName: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentMode: { type: String, required: true },
    date: { type: String, required: true },
    referenceId: { type: String },
    notes: { type: String },
    receivedBy: { type: String, default: "" },
    balanceAfter: { type: Number },
    type: { type: String, enum: ["received", "paid"], required: true },
    bankAccountId: { type: String, default: "" },
    bankAccountRef: { type: String, default: "" },
    bankTxnRef: { type: String, default: "" },
    lastEditedAt: { type: Date },
    lastEditedBy: { type: String, default: "" },
    editCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "payment_transactions" }
);

const PaymentTransaction: Model<IPaymentTransaction> = mongoose.models.PaymentTransaction || mongoose.model<IPaymentTransaction>("PaymentTransaction", PaymentTransactionSchema);
export default PaymentTransaction;
