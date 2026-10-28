import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPurchaseEntry extends Document {
  billNo: string;
  supplierName: string;
  /** The supplier's GSTIN as it stood at billing time — needed for GST
   *  purchase-register reporting; not on the model previously even though
   *  the creation form already collects a matching Supplier record. */
  supplierGST?: string;
  /** Links this bill to its Supplier record so the payable ledger can match
   *  by id instead of a fragile exact-name lookup. Older entries predate this
   *  field and keep resolving via supplierName. */
  supplierId?: mongoose.Types.ObjectId;
  warehouse?: string;
  /** The real warehouse this bill's stock landed in — resolved once at creation
   *  time so cancel/delete reverse the same specific warehouse even if it's
   *  since been renamed. Older entries predate this and fall back to matching
   *  the `warehouse` name string above. */
  warehouseId?: mongoose.Types.ObjectId;
  linkedPoNo?: string;
  /** Why this entry was billed without going through a Purchase Order first — mandatory when linkedPoNo is empty. */
  noPoReason?: string;
  type: "entry" | "debit-note";
  /** Whose stock this bill brought in: Value Plus or Ashoka Enterprises. */
  billingEntity?: "valueplus" | "ashoka";
  billDate: string;
  dueDate?: string;
  items?: Array<{
    itemId: string;
    name: string;
    quantity: number;
    rate: number;
    gstRate: number;
    hsn?: string;
    serialNumbers?: string[];
  }>;
  subtotal: number;
  gst: number;
  total: number;
  paid: number;
  balance: number;
  status: "paid" | "partial" | "pending" | "overdue" | "cancelled";
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  /** Set whenever a non-cancel PUT touches the record, so the UI can flag it as edited. */
  lastModifiedReason?: "content-edit" | "cancel";
}

const PurchaseEntrySchema = new Schema<IPurchaseEntry>(
  {
    billNo: { type: String, required: true },
    supplierName: { type: String, required: true },
    supplierGST: { type: String, default: "" },
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier" },
    warehouse: { type: String, default: "Ashoka Enterprises (Kunraghat Showroom)" },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    linkedPoNo: { type: String },
    noPoReason: { type: String, default: "" },
    type: { type: String, enum: ["entry", "debit-note"], default: "entry" },
    billingEntity: { type: String, enum: ["valueplus", "ashoka"], default: "valueplus", index: true },
    billDate: { type: String, required: true },
    dueDate: { type: String },
    items: [
      {
        itemId: { type: String },
        name: { type: String },
        quantity: { type: Number },
        rate: { type: Number },
        gstRate: { type: Number },
        hsn: { type: String, default: "" },
        serialNumbers: [{ type: String }],
      }
    ],
    subtotal: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    total: { type: Number, required: true },
    paid: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    status: { type: String, enum: ["paid", "partial", "pending", "overdue", "cancelled"], default: "pending" },
    cancelledAt: { type: String },
    cancelledBy: { type: String },
    cancelReason: { type: String },
    lastModifiedReason: { type: String, enum: ["content-edit", "cancel"] },
  },
  { timestamps: true, collection: "purchase_entries" }
);

const PurchaseEntry: Model<IPurchaseEntry> = mongoose.models.PurchaseEntry || mongoose.model<IPurchaseEntry>("PurchaseEntry", PurchaseEntrySchema);
export default PurchaseEntry;
