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
}

export interface IInventoryAudit extends Document {
  auditDate: string;
  auditor: string;
  category: string;
  items: IInventoryAuditItem[];
  totalExpected: number;
  totalPhysical: number;
  totalDiscrepancy: number;
  status: "Completed" | "Discrepancy Found" | "Resolved";
  completionTime?: string;
  notes?: string;
}

const AuditItemSchema = new Schema({
  productId: { type: String, required: true },
  productName: { type: String, required: true },
  vpCode: { type: String, default: "" },
  category: { type: String, default: "Electronics" },
  expectedStock: { type: Number, required: true },
  physicalStock: { type: Number, required: true },
  difference: { type: Number, required: true },
  condition: {
    type: String,
    enum: ["Good", "Damaged", "Missing", "Other"],
    default: "Good",
  },
  remarks: { type: String, default: "" },
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
      enum: ["Completed", "Discrepancy Found", "Resolved"],
      default: "Completed",
      index: true,
    },
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
