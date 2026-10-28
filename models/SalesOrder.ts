import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISalesOrder extends Document {
  orderNo: string;
  date: Date;
  customerName: string;
  deliveryDate?: Date;
  itemsCount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: "Pending" | "Partial" | "Paid";
  status: "processing" | "confirmed" | "delivered" | "cancelled";
}

const SalesOrderSchema = new Schema<ISalesOrder>(
  {
    orderNo: { type: String, required: true, unique: true },
    date: { type: Date, default: Date.now },
    customerName: { type: String, required: true },
    deliveryDate: { type: Date },
    itemsCount: { type: Number, default: 1 },
    totalAmount: { type: Number, required: true },
    paidAmount: { type: Number, default: 0 },
    balanceAmount: { type: Number, required: true },
    paymentStatus: { type: String, enum: ["Pending", "Partial", "Paid"], default: "Pending" },
    status: { type: String, enum: ["processing", "confirmed", "delivered", "cancelled"], default: "processing" },
  },
  { timestamps: true, collection: "sales_orders" }
);

const SalesOrder: Model<ISalesOrder> = mongoose.models.SalesOrder || mongoose.model<ISalesOrder>("SalesOrder", SalesOrderSchema);
export default SalesOrder;
