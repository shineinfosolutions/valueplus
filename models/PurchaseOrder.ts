import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPurchaseOrder extends Document {
  poNo: string;
  supplierName: string;
  date: Date;
  expectedDate?: Date;
  totalAmount: number;
  subtotal?: number;
  gst?: number;
  status: "sent" | "received" | "partial" | "pending";
  items?: Array<{
    itemId: string;
    name: string;
    quantity: number;
    rate: number;
    gstRate: number;
  }>;
}

const PurchaseOrderSchema = new Schema<IPurchaseOrder>(
  {
    poNo: { type: String, required: true, unique: true },
    supplierName: { type: String, required: true },
    date: { type: Date, default: Date.now },
    expectedDate: { type: Date },
    totalAmount: { type: Number, required: true },
    subtotal: { type: Number },
    gst: { type: Number },
    status: { type: String, enum: ["sent", "received", "partial", "pending"], default: "sent" },
    items: [
      {
        itemId: { type: String, required: true },
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        rate: { type: Number, required: true },
        gstRate: { type: Number, required: true },
      }
    ],
  },
  { timestamps: true, collection: "purchase_orders" }
);

const PurchaseOrder: Model<IPurchaseOrder> = mongoose.models.PurchaseOrder || mongoose.model<IPurchaseOrder>("PurchaseOrder", PurchaseOrderSchema);
export default PurchaseOrder;
