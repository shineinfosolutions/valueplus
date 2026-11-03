import mongoose, { Schema, Document, Model } from "mongoose";

/** One upload of the supplier stock report: who, when, and how much it held. */
export interface ISupplierStockUpload extends Document {
  fileName: string;
  uploadedBy: string;
  uploadedByRole: string;
  rowCount: number;
  newProducts: number;
  totalUnits: number;
}

const SupplierStockUploadSchema = new Schema<ISupplierStockUpload>(
  {
    fileName: { type: String, default: "" },
    uploadedBy: { type: String, default: "" },
    uploadedByRole: { type: String, default: "" },
    rowCount: { type: Number, default: 0 },
    newProducts: { type: Number, default: 0 },
    totalUnits: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "supplier_stock_uploads" }
);

const SupplierStockUpload: Model<ISupplierStockUpload> =
  mongoose.models.SupplierStockUpload || mongoose.model<ISupplierStockUpload>("SupplierStockUpload", SupplierStockUploadSchema);
export default SupplierStockUpload;
