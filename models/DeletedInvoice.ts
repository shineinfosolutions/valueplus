import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * The archive a deleted invoice moves into.
 *
 * A deleted bill has to stay on record — the dashboard has to be able to say what
 * was removed, for how much and why, and a GST audit has to see that an invoice
 * number was issued and then voided.
 *
 * The alternative was an `isDeleted` flag on Invoice itself, but every one of the
 * ~40 Invoice queries across the app (revenue, GST returns, stock movement, the
 * payment ledger) would then need a matching filter. One missed filter would
 * quietly report a deleted bill as revenue. Moving the document to its own
 * collection means not a single existing query changes behaviour.
 *
 * The schema is intentionally loose (`strict: false`): it takes whatever shape the
 * invoice had, so an old bill with fields the current model no longer defines is
 * archived whole rather than silently trimmed.
 */
export interface IDeletedInvoice extends Document {
  invoiceNumber: string;
  /** Which kind of document this was: an Invoice, a Proforma, an Estimate. */
  docType?: string;
  customerName: string;
  total: number;
  deletedAt: Date;
  deletedBy: string;
  deletedByRole?: string;
  deletedByUserId?: string;
  deleteReason: string;
  pinVerified: boolean;
  /** True when the legacy shared PIN was used because the user had set none. */
  usedLegacyPin?: boolean;
  snapshot: any;
}

const DeletedInvoiceSchema = new Schema<IDeletedInvoice>(
  {
    invoiceNumber: { type: String, required: true, index: true },
    docType: { type: String, default: "Invoice", index: true },
    customerName: { type: String, default: "" },
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
  { timestamps: true, collection: "deleted_invoices", strict: false }
);

DeletedInvoiceSchema.index({ deletedAt: -1 });

const DeletedInvoice: Model<IDeletedInvoice> =
  mongoose.models.DeletedInvoice ||
  mongoose.model<IDeletedInvoice>("DeletedInvoice", DeletedInvoiceSchema);
export default DeletedInvoice;
