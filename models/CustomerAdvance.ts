import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICustomerAdvance extends Document {
  receiptNumber: string; // e.g. ADV-2026-0001
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;
  amount: number;
  paymentMode: "Cash" | "UPI" | "Card" | "Bank Transfer" | "Cheque" | "Other";
  transactionRef?: string;
  productBooked?: string;
  targetBrand?: string;
  targetCategory?: string;
  notes?: string;
  status: "Available" | "Partially Used" | "Fully Adjusted" | "Refunded" | "Cancelled";
  usedAmount: number;
  remainingBalance: number;
  linkedInvoiceNumber?: string;
  branchName?: string;
  receivedBy?: string;
  date: string;
  time: string;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerAdvanceSchema = new Schema<ICustomerAdvance>(
  {
    receiptNumber: { type: String, required: true, unique: true, index: true },
    customerId: { type: String, index: true },
    customerName: { type: String, required: true, index: true },
    customerPhone: { type: String, required: true, index: true },
    customerEmail: { type: String, default: "" },
    customerAddress: { type: String, default: "" },
    amount: { type: Number, required: true, min: 1 },
    paymentMode: {
      type: String,
      enum: ["Cash", "UPI", "Card", "Bank Transfer", "Cheque", "Other"],
      default: "Cash",
    },
    transactionRef: { type: String, default: "" },
    productBooked: { type: String, default: "" },
    targetBrand: { type: String, default: "" },
    targetCategory: { type: String, default: "" },
    notes: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Available", "Partially Used", "Fully Adjusted", "Refunded", "Cancelled"],
      default: "Available",
      index: true,
    },
    usedAmount: { type: Number, default: 0 },
    remainingBalance: { type: Number, required: true },
    linkedInvoiceNumber: { type: String, default: "", index: true },
    branchName: { type: String, default: "Ashoka Enterprises (Kunraghat Showroom)" },
    receivedBy: { type: String, default: "Store Staff" },
    date: { type: String, required: true, index: true },
    time: { type: String, required: true },
  },
  { timestamps: true, collection: "customer_advances" }
);

CustomerAdvanceSchema.index({ customerPhone: 1, status: 1 });
CustomerAdvanceSchema.index({ date: -1, createdAt: -1 });

const CustomerAdvance: Model<ICustomerAdvance> =
  mongoose.models.CustomerAdvance ||
  mongoose.model<ICustomerAdvance>("CustomerAdvance", CustomerAdvanceSchema);

export default CustomerAdvance;
