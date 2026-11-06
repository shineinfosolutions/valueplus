import mongoose, { Schema, Document, Model } from "mongoose";

export interface IEstimateItem {
  itemCode: string;
  name: string;
  quantity: number;
  rate: number;
  discount?: number;
  tax: number;
  amount: number;
  itemId?: string;
}

export interface IEstimate extends Document {
  estimateNumber: string;
  date: Date;
  expiryDate?: Date;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  customerGST?: string;
  customerCompanyName?: string;
  salesExecutive?: string;
  salesperson?: string;
  status: "Draft" | "Sent" | "Accepted" | "Rejected" | "Expired" | "Converted";
  items?: IEstimateItem[];
  subTotal?: number;
  taxTotal?: number;
  total: number;
  notes?: string;
  /** pending -> approved | rejected. An estimate with no value predates the approval step and counts as approved. */
  /** "estimate" = a quotation for the customer (no approval); "bill" = a sale the salesman sends to the cashier to invoice. */
  kind?: "estimate" | "bill";
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  rejectReason?: string;
  /** What the salesman closed the deal at: the estimate total, frozen when the cashier approves. */
  dealAmount?: number;
  convertedInvoiceNumber?: string;
  dealSalesperson?: string;
  /** The advance token the customer paid with this estimate (shown at the top of the printed estimate). */
  advanceAmount?: number;
  advanceMode?: string;
  advanceTxnRef?: string;
  priceUnlock?: {
    by: string;
    byRole: string;
    at: Date;
    lines: { itemName: string; rate: number; lockedMin: number }[];
  };
}

const EstimateItemSchema = new Schema<IEstimateItem>({
  itemCode: { type: String, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  rate: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0 },
  itemId: { type: String, default: "" },
  tax: { type: Number, default: 0 },
  amount: { type: Number, required: true },
}, { _id: false });

const EstimateSchema = new Schema<IEstimate>(
  {
    estimateNumber: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now },
    expiryDate: { type: Date },
    customerName: { type: String, required: true },
    customerPhone: { type: String, default: "" },
    customerAddress: { type: String, default: "" },
    customerGST: { type: String, default: "" },
    customerCompanyName: { type: String, default: "" },
    salesExecutive: { type: String, default: "AMIT SINGH" },
    salesperson: { type: String, default: "AMIT SINGH" },
    status: { type: String, enum: ["Draft", "Sent", "Accepted", "Rejected", "Expired", "Converted"], default: "Draft" },
    items: { type: [EstimateItemSchema], default: [] },
    subTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    total: { type: Number, required: true },
    notes: { type: String },
    convertedInvoiceNumber: { type: String },
    kind: { type: String, enum: ["estimate", "bill"], default: "estimate" },
    approvalStatus: { type: String, enum: ["pending", "approved", "rejected"] },
    approvedBy: { type: String },
    approvedAt: { type: Date },
    rejectedBy: { type: String },
    rejectedAt: { type: Date },
    rejectReason: { type: String },
    dealAmount: { type: Number },
    dealSalesperson: { type: String },
    advanceAmount: { type: Number, default: 0 },
    advanceMode: { type: String, default: "" },
    advanceTxnRef: { type: String, default: "" },
    priceUnlock: {
      type: new Schema(
        {
          by: String,
          byRole: String,
          at: Date,
          lines: [{ _id: false, itemName: String, rate: Number, lockedMin: Number }],
        },
        { _id: false }
      ),
    },
  },
  { timestamps: true, collection: "estimates" }
);

if (mongoose.models.Estimate) {
  delete mongoose.models.Estimate;
}
const Estimate: Model<IEstimate> = mongoose.model<IEstimate>("Estimate", EstimateSchema);
export default Estimate;
