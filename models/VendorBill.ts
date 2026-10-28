import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * A bill raised ON a vendor — the debit side of the vendor ledger.
 *
 * Kept apart from Invoice on purpose. Invoice is wired into stock movement, GST
 * returns, e-way bills, incentives and the revenue dashboard; adding a second
 * party type to it would change what every one of those reads. A vendor bill is
 * a plain account document, and the vendor ledger is computed from these plus
 * VendorPayment rows.
 */
export interface IVendorBillItem {
  name: string;
  description?: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface IVendorBill extends Document {
  billNo: string;
  vendorId: string;
  vendorName: string;
  date: string;
  dueDate: string;
  items: IVendorBillItem[];
  subtotal: number;
  gstRate: number;
  gstAmount: number;
  total: number;
  notes?: string;
  reference?: string;
  status: "open" | "cancelled";
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  createdBy?: string;
}

const VendorBillItemSchema = new Schema<IVendorBillItem>(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    quantity: { type: Number, default: 1 },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const VendorBillSchema = new Schema<IVendorBill>(
  {
    billNo: { type: String, required: true, unique: true, index: true },
    vendorId: { type: String, required: true, index: true },
    vendorName: { type: String, required: true },
    date: { type: String, required: true, index: true },
    dueDate: { type: String, default: "" },
    items: { type: [VendorBillItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    gstRate: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    notes: { type: String, default: "" },
    reference: { type: String, default: "" },
    status: { type: String, enum: ["open", "cancelled"], default: "open", index: true },
    cancelledAt: { type: String },
    cancelledBy: { type: String },
    cancelReason: { type: String },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true, collection: "vendor_bills" }
);

VendorBillSchema.index({ vendorId: 1, date: -1 });

const VendorBill: Model<IVendorBill> =
  mongoose.models.VendorBill || mongoose.model<IVendorBill>("VendorBill", VendorBillSchema);
export default VendorBill;
