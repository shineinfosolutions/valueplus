import mongoose, { Schema, Document, Model } from "mongoose";

export interface IEWayBill extends Document {
  ewayBillNo: string;
  invoiceNumber: string;
  customerName: string;
  customerGstin?: string;
  deliveryAddress: string;
  vehicleNumber: string;
  transporterName?: string;
  transporterId?: string;
  items: Array<{
    itemName: string;
    hsn: string;
    quantity: number;
    taxableValue: number;
    gstRate: number;
  }>;
  taxableValue: number;
  totalGst: number;
  totalAmount: number;
  status: "Draft" | "Prepared" | "Generated" | "Failed";
  generatedDate?: string;
  validUntil?: string;
  errorDetails?: string;
}

const EWayBillSchema = new Schema<IEWayBill>(
  {
    ewayBillNo: { type: String, required: true, unique: true, index: true },
    invoiceNumber: { type: String, required: true, index: true },
    customerName: { type: String, required: true },
    customerGstin: { type: String, default: "" },
    deliveryAddress: { type: String, required: true },
    vehicleNumber: { type: String, required: true },
    transporterName: { type: String, default: "" },
    transporterId: { type: String, default: "" },
    items: [
      {
        itemName: { type: String, required: true },
        hsn: { type: String, default: "" },
        quantity: { type: Number, required: true },
        taxableValue: { type: Number, required: true },
        gstRate: { type: Number, required: true },
      },
    ],
    taxableValue: { type: Number, required: true },
    totalGst: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["Draft", "Prepared", "Generated", "Failed"],
      default: "Prepared",
      index: true,
    },
    generatedDate: { type: String },
    validUntil: { type: String },
    errorDetails: { type: String, default: "" },
  },
  { timestamps: true, collection: "eway_bills" }
);

if (mongoose.models.EWayBill) {
  delete mongoose.models.EWayBill;
}
const EWayBill: Model<IEWayBill> = mongoose.model<IEWayBill>("EWayBill", EWayBillSchema);
export default EWayBill;
