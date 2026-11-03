import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * One product line of the supplier warehouse's stock report ("STOCK REPORT FOR COCO
 * AND FOFO"). The report is uploaded every day; each upload refreshes these rows.
 */
export interface ISupplierStockItem extends Document {
  itemCode: string;
  description: string;
  brand: string;
  groupName: string;
  productDesc: string;
  charDesc: string;
  warehouse: string;
  availableStock: number;
  /** Stock in the upload before this one (0 for a product not seen before). */
  previousStock: number;
  /** True when the product was not in the report before this upload. */
  isNewArrival: boolean;
  /** False once a later upload no longer lists the product. */
  active: boolean;
  uploadId: string;
}

const SupplierStockItemSchema = new Schema<ISupplierStockItem>(
  {
    itemCode: { type: String, required: true, index: true },
    description: { type: String, default: "" },
    brand: { type: String, default: "" },
    groupName: { type: String, default: "" },
    productDesc: { type: String, default: "" },
    charDesc: { type: String, default: "" },
    warehouse: { type: String, default: "" },
    availableStock: { type: Number, default: 0 },
    previousStock: { type: Number, default: 0 },
    isNewArrival: { type: Boolean, default: false },
    active: { type: Boolean, default: true, index: true },
    uploadId: { type: String, default: "" },
  },
  { timestamps: true, collection: "supplier_stock_items" }
);
SupplierStockItemSchema.index({ itemCode: 1, warehouse: 1 }, { unique: true });

const SupplierStockItem: Model<ISupplierStockItem> =
  mongoose.models.SupplierStockItem || mongoose.model<ISupplierStockItem>("SupplierStockItem", SupplierStockItemSchema);
export default SupplierStockItem;
