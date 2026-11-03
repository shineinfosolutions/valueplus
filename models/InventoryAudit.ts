import mongoose, { Schema, Document, Model } from "mongoose";

export interface IInventoryAuditItem {
  productId: string;
  productName: string;
  vpCode: string;
  category: string;
  expectedStock: number;
  physicalStock: number;
  difference: number;
  condition: "Good" | "Damaged" | "Missing" | "Other";
  remarks?: string;
  /** Live audit: set the moment someone enters this product's physical count. */
  counted?: boolean;
  countedBy?: string;
  countedAt?: Date;
}

export interface IInventoryAudit extends Document {
  auditDate: string;
  auditor: string;
  category: string;
  items: IInventoryAuditItem[];
  totalExpected: number;
  totalPhysical: number;
  totalDiscrepancy: number;
  status: "In Progress" | "Completed" | "Discrepancy Found" | "Resolved";
  /** User who started / finished the audit (server-side, from the session). */
  auditorId?: string;
  completedBy?: string;
  completedAt?: Date;
  warehouse?: string;
  /** "mobile" = the Mobile Live Audit (phones only); anything else is the full daily audit. */
  kind?: string;
  completionTime?: string;
  notes?: string;
}

const AuditItemSchema = new Schema({
  productId: { type: String, required: true },
  productName: { type: String, required: true },
  vpCode: { type: String, default: "" },
  category: { type: String, default: "Electronics" },
  expectedStock: { type: Number, required: true },
  physicalStock: { type: Number, default: 0 },
  difference: { type: Number, default: 0 },
  condition: {
    type: String,
    enum: ["Good", "Damaged", "Missing", "Other"],
    default: "Good",
  },
  remarks: { type: String, default: "" },
  counted: { type: Boolean, default: false },
  countedBy: { type: String, default: "" },
  countedAt: { type: Date },
});

const InventoryAuditSchema = new Schema<IInventoryAudit>(
  {
    auditDate: { type: String, required: true, index: true },
    auditor: { type: String, required: true, default: "Inventory Manager" },
    category: { type: String, default: "All Categories" },
    items: [AuditItemSchema],
    totalExpected: { type: Number, default: 0 },
    totalPhysical: { type: Number, default: 0 },
    totalDiscrepancy: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["In Progress", "Completed", "Discrepancy Found", "Resolved"],
      default: "Completed",
      index: true,
    },
    auditorId: { type: String, default: "" },
    completedBy: { type: String, default: "" },
    completedAt: { type: Date },
    warehouse: { type: String, default: "" },
    kind: { type: String, default: "all", index: true },
    completionTime: { type: String, default: () => new Date().toLocaleTimeString("en-IN") },
    notes: { type: String, default: "" },
  },
  { timestamps: true, collection: "inventory_audits" }
);

if (mongoose.models.InventoryAudit) {
  delete mongoose.models.InventoryAudit;
}
const InventoryAudit: Model<IInventoryAudit> = mongoose.model<IInventoryAudit>("InventoryAudit", InventoryAuditSchema);
export default InventoryAudit;
