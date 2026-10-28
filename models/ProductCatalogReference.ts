import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * A VP code's known Brand/Category, read from a supplier/accounting stock
 * report (e.g. a Tally "Stock Report" export) rather than this app's own
 * Item catalog. Purchase-entry PDF import consults this when a line item's
 * VP code doesn't match any existing Item, so a brand-new product gets a
 * real Brand/Category instead of forcing the admin to pick one by hand.
 *
 * `category` is deliberately the admin-CONFIRMED mapping, not the sheet's
 * own `groupName` verbatim — the source report's wording ("AUDIO & VIDEO")
 * doesn't match this app's real Category names ("Audio & Sound Systems"),
 * and filing products under a near-duplicate category by blind string
 * guessing would be worse than the manual picker it's meant to replace.
 */
export interface IProductCatalogReference extends Document {
  vpCode: string;
  description?: string;
  brand?: string;
  /** Raw text from the source sheet, kept for audit and so a later re-upload
   *  can pre-fill its mapping screen from what was already decided. */
  groupName?: string;
  category?: string;
  productDesc?: string;
  charDesc?: string;
}

const ProductCatalogReferenceSchema = new Schema<IProductCatalogReference>(
  {
    vpCode: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    description: { type: String, default: "" },
    brand: { type: String, default: "" },
    groupName: { type: String, default: "" },
    category: { type: String, default: "" },
    productDesc: { type: String, default: "" },
    charDesc: { type: String, default: "" },
  },
  { timestamps: true, collection: "product_catalog_references" }
);

const ProductCatalogReference: Model<IProductCatalogReference> =
  mongoose.models.ProductCatalogReference ||
  mongoose.model<IProductCatalogReference>("ProductCatalogReference", ProductCatalogReferenceSchema);
export default ProductCatalogReference;
