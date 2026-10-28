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
  type: "received" | "paid"; // received from customer, paid to supplier
  // Which store bank account the money landed in (non-cash receipts, finance payouts)
  bankAccountId?: string;
  bankAccountRef?: string;
  bankTxnRef?: string; // UTR / bank reference
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
    type: { type: String, enum: ["received", "paid"], required: true },
    bankAccountId: { type: String, default: "" },
    bankAccountRef: { type: String, default: "" },
    bankTxnRef: { type: String, default: "" },
  },
  { timestamps: true, collection: "payment_transactions" }
);

const PaymentTransaction: Model<IPaymentTransaction> = mongoose.models.PaymentTransaction || mongoose.model<IPaymentTransaction>("PaymentTransaction", PaymentTransactionSchema);
export default PaymentTransaction;
