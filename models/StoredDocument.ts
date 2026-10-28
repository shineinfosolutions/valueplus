import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * A file kept on record by the office — a bill, a bank statement, a signed
 * letter — with the date it belongs to and a line saying what it is.
 */
export interface IStoredDocument extends Document {
  docNo: string;
  date: string; // YYYY-MM-DD
  narration: string;
  fileUrl: string;
  filePublicId: string;
  fileResourceType: string;
  fileFormat: string;
  /** Cloudinary delivery type the file was stored under ("private"). */
  fileDeliveryType: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedByUserId?: string;
  uploadedByRole?: string;
}

const StoredDocumentSchema = new Schema<IStoredDocument>(
  {
    docNo: { type: String, required: true, unique: true, index: true },
    date: { type: String, required: true, index: true },
    narration: { type: String, required: true },
    fileUrl: { type: String, required: true },
    filePublicId: { type: String, default: "" },
    fileResourceType: { type: String, default: "" },
    fileFormat: { type: String, default: "" },
    fileDeliveryType: { type: String, default: "upload" },
    fileName: { type: String, default: "" },
    fileType: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    uploadedBy: { type: String, required: true },
    uploadedByUserId: { type: String, default: "" },
    uploadedByRole: { type: String, default: "" },
  },
  { timestamps: true, collection: "stored_documents" }
);

const StoredDocument: Model<IStoredDocument> =
  mongoose.models.StoredDocument || mongoose.model<IStoredDocument>("StoredDocument", StoredDocumentSchema);

export default StoredDocument;
