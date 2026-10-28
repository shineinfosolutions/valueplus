import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * The archive a deleted purchase entry (supplier bill) moves into — mirrors
 * models/DeletedInvoice.ts. Kept as its own collection rather than an
 * `isDeleted` flag so none of the existing purchase-entry queries (payables,
 * stock reports, GST) need a matching filter to keep excluding it.
 */
export interface IDeletedPurchaseEntry extends Document {
  billNo: string;
  supplierName: string;
  total: number;
  deletedAt: Date;
  deletedBy: string;
  deletedByRole?: string;
  deletedByUserId?: string;
  deleteReason: string;
  pinVerified: boolean;
  usedLegacyPin?: boolean;
  snapshot: any;
}

const DeletedPurchaseEntrySchema = new Schema<IDeletedPurchaseEntry>(
  {
    billNo: { type: String, required: true, index: true },
    supplierName: { type: String, default: "" },
    total: { type: Number, default: 0 },
    deletedAt: { type: Date, required: true, index: true },
    deletedBy: { type: String, required: true },
    deletedByRole: { type: String, default: "" },
    deletedByUserId: { type: String, default: "" },
    deleteReason: { type: String, required: true },
    pinVerified: { type: Boolean, default: false },
    usedLegacyPin: { type: Boolean, default: false },
    snapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: "deleted_purchase_entries", strict: false }
);

DeletedPurchaseEntrySchema.index({ deletedAt: -1 });

const DeletedPurchaseEntry: Model<IDeletedPurchaseEntry> =
  mongoose.models.DeletedPurchaseEntry ||
  mongoose.model<IDeletedPurchaseEntry>("DeletedPurchaseEntry", DeletedPurchaseEntrySchema);
export default DeletedPurchaseEntry;
