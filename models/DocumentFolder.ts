import mongoose, { Schema, Document, Model } from "mongoose";

/** A folder the office files documents into. Flat — one level, no nesting. */
export interface IDocumentFolder extends Document {
  name: string;
  /** Lower-cased name, so "Bank" and "bank" cannot both exist. */
  nameKey: string;
  createdBy: string;
  createdByUserId?: string;
}

const DocumentFolderSchema = new Schema<IDocumentFolder>(
  {
    name: { type: String, required: true },
    nameKey: { type: String, required: true, unique: true, index: true },
    createdBy: { type: String, required: true },
    createdByUserId: { type: String, default: "" },
  },
  { timestamps: true, collection: "document_folders" }
);

const DocumentFolder: Model<IDocumentFolder> =
  mongoose.models.DocumentFolder || mongoose.model<IDocumentFolder>("DocumentFolder", DocumentFolderSchema);

export default DocumentFolder;
