import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Money moving between us and a vendor — the credit side of the vendor ledger.
 *
 * `type: "received"` is the normal case (the vendor pays us); `"paid"` covers a
 * refund going back out. `mode` is free text so it can hold whatever the counter
 * actually used; lib/payment-modes.ts classifies it into the same cash / UPI /
 * online / card buckets the sales dashboard already uses, so NEFT, IMPS and RTGS
 * all land in "online" without a second keyword list.
 */
export interface IVendorPayment extends Document {
  paymentId: string;
  vendorId: string;
  vendorName: string;
  date: string;
  amount: number;
  mode: string;
  refNo?: string;
  againstBillNo?: string;
  receivedBy?: string;
  notes?: string;
  type: "received" | "paid";
  createdBy?: string;
  createdByRole?: string;
}

const VendorPaymentSchema = new Schema<IVendorPayment>(
  {
    paymentId: { type: String, required: true, unique: true, index: true },
    vendorId: { type: String, required: true, index: true },
    vendorName: { type: String, required: true },
    date: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    mode: { type: String, required: true, default: "Cash" },
    refNo: { type: String, default: "" },
    againstBillNo: { type: String, default: "" },
    receivedBy: { type: String, default: "" },
    notes: { type: String, default: "" },
    type: { type: String, enum: ["received", "paid"], default: "received", index: true },
    createdBy: { type: String, default: "" },
    createdByRole: { type: String, default: "" },
  },
  { timestamps: true, collection: "vendor_payments" }
);

VendorPaymentSchema.index({ vendorId: 1, date: -1 });

const VendorPayment: Model<IVendorPayment> =
  mongoose.models.VendorPayment ||
  mongoose.model<IVendorPayment>("VendorPayment", VendorPaymentSchema);
export default VendorPayment;
