import mongoose, { Schema, Document, Model } from "mongoose";

export interface IStockOrderLine {
  itemCode: string;
  description: string;
  brand: string;
  groupName: string;
  productDesc: string;
  charDesc: string;
  warehouse: string;
  availableAtRequest: number;
  quantity: number;
}

/** A salesman's request to order products from the supplier warehouse; the Admin approves it and sends it on WhatsApp. */
export interface IStockOrderRequest extends Document {
  requestNumber: string;
  status: "pending" | "approved" | "rejected" | "sent" | "cancelled" | "merged";
  salesperson: string;
  salespersonId: string;
  note: string;
  items: IStockOrderLine[];
  totalQuantity: number;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  rejectReason?: string;
  message?: string;
  sentBy?: string;
  sentAt?: Date;
  /** A request folded into a combined order: the number of that order. */
  mergedInto?: string;
  /** On a combined order: the requests it was made from. */
  mergedFrom?: string[];
}

const LineSchema = new Schema<IStockOrderLine>(
  {
    itemCode: { type: String, required: true },
    description: { type: String, default: "" },
    brand: { type: String, default: "" },
    groupName: { type: String, default: "" },
    productDesc: { type: String, default: "" },
    charDesc: { type: String, default: "" },
    warehouse: { type: String, default: "" },
    availableAtRequest: { type: Number, default: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const StockOrderRequestSchema = new Schema<IStockOrderRequest>(
  {
    requestNumber: { type: String, required: true, unique: true },
    status: { type: String, enum: ["pending", "approved", "rejected", "sent", "cancelled", "merged"], default: "pending", index: true },
    salesperson: { type: String, required: true },
    salespersonId: { type: String, default: "", index: true },
    note: { type: String, default: "" },
    items: { type: [LineSchema], default: [] },
    totalQuantity: { type: Number, default: 0 },
    approvedBy: String,
    approvedAt: Date,
    rejectedBy: String,
    rejectedAt: Date,
    rejectReason: String,
    message: String,
    sentBy: String,
    sentAt: Date,
    mergedInto: String,
    mergedFrom: { type: [String], default: undefined },
  },
  { timestamps: true, collection: "stock_order_requests" }
);

const StockOrderRequest: Model<IStockOrderRequest> =
  mongoose.models.StockOrderRequest || mongoose.model<IStockOrderRequest>("StockOrderRequest", StockOrderRequestSchema);
export default StockOrderRequest;
