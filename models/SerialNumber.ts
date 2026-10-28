import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISerialNumber extends Document {
  serialNumber: string;
  itemId: string;
  vpCode: string;
  itemName: string;
  batchNo?: string;
  status: "AVAILABLE" | "SOLD" | "RETURNED" | "DEFECTIVE";
  warehouse?: string;
  purchaseEntryId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  customerName?: string;
  customerPhone?: string;
  soldDate?: string;
  price?: number;
  history?: Array<{
    action: string;
    date: Date;
    performedBy?: string;
    details?: string;
  }>;
}

const SerialNumberSchema = new Schema<ISerialNumber>(
  {
    serialNumber: { type: String, required: true, unique: true, index: true },
    itemId: { type: String, required: true, index: true },
    vpCode: { type: String, required: true, index: true },
    itemName: { type: String, required: true },
    batchNo: { type: String, default: "" },
    status: {
      type: String,
      enum: ["AVAILABLE", "SOLD", "RETURNED", "DEFECTIVE"],
      default: "AVAILABLE",
      index: true,
    },
    warehouse: { type: String, default: "Main Warehouse" },
    purchaseEntryId: { type: String },
    invoiceId: { type: String },
    invoiceNumber: { type: String, index: true },
    customerName: { type: String },
    customerPhone: { type: String },
    soldDate: { type: String },
    price: { type: Number },
    history: [
      {
        action: { type: String, required: true },
        date: { type: Date, default: Date.now },
        performedBy: { type: String, default: "System" },
        details: { type: String },
      },
    ],
  },
  { timestamps: true, collection: "serial_numbers" }
);

if (mongoose.models.SerialNumber) {
  delete mongoose.models.SerialNumber;
}
const SerialNumber: Model<ISerialNumber> = mongoose.model<ISerialNumber>("SerialNumber", SerialNumberSchema);
export default SerialNumber;
