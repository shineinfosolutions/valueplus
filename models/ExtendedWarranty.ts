import mongoose, { Schema, Document, Model } from "mongoose";

export interface IExtendedWarranty extends Document {
  warrantyId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  invoiceNumber: string;
  itemId?: string;
  productName: string;
  vpCode: string;
  serialNumber?: string;
  planName: string;
  durationMonths: number;
  startDate: string;
  endDate: string;
  warrantyAmount: number;
  salesStaff: string;
  status: "Active" | "Expired" | "Claimed" | "Cancelled";
  remarks?: string;
}

const ExtendedWarrantySchema = new Schema<IExtendedWarranty>(
  {
    warrantyId: { type: String, required: true, unique: true, index: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true, index: true },
    customerEmail: { type: String, default: "" },
    invoiceNumber: { type: String, required: true, index: true },
    itemId: { type: String },
    productName: { type: String, required: true },
    vpCode: { type: String, required: true, index: true },
    serialNumber: { type: String, default: "" },
    planName: { type: String, required: true },
    durationMonths: { type: Number, required: true, default: 12 },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    warrantyAmount: { type: Number, required: true, default: 0 },
    salesStaff: { type: String, default: "Sales Team" },
    status: {
      type: String,
      enum: ["Active", "Expired", "Claimed", "Cancelled"],
      default: "Active",
    },
    remarks: { type: String, default: "" },
  },
  { timestamps: true, collection: "extended_warranties" }
);

if (mongoose.models.ExtendedWarranty) {
  delete mongoose.models.ExtendedWarranty;
}
const ExtendedWarranty: Model<IExtendedWarranty> = mongoose.model<IExtendedWarranty>("ExtendedWarranty", ExtendedWarrantySchema);
export default ExtendedWarranty;
