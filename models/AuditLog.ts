import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * One row per authorised destructive action.
 *
 * Cancel already left traces on the invoice itself (`cancelReason`, `cancelledBy`)
 * but a hard delete left none at all, which is exactly the action most worth
 * knowing about. This collection records both in one shape so the audit screen and
 * the dashboard's leakage panel have a single place to read from, and so the same
 * trail can cover other actions later without another model.
 */
export type AuditAction =
  | "invoice.cancel"
  | "invoice.delete"
  | "purchase-entry.cancel"
  | "purchase-entry.delete"
  | "vendor.bill.cancel"
  | "payment.delete";

export interface IAuditLog extends Document {
  action: AuditAction | string;
  entityType: string;
  /** Human-facing identifier — an invoice number, a bill number. */
  entityRef: string;
  entityId?: string;
  partyName?: string;
  amount: number;
  reason: string;
  performedBy: string;
  performedByUserId?: string;
  performedByRole?: string;
  pinVerified: boolean;
  usedLegacyPin?: boolean;
  ip?: string;
  userAgent?: string;
  metadata?: any;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityRef: { type: String, required: true, index: true },
    entityId: { type: String, default: "" },
    partyName: { type: String, default: "" },
    amount: { type: Number, default: 0 },
    reason: { type: String, required: true },
    performedBy: { type: String, required: true },
    performedByUserId: { type: String, default: "" },
    performedByRole: { type: String, default: "" },
    pinVerified: { type: Boolean, default: false },
    usedLegacyPin: { type: Boolean, default: false },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: "audit_logs" }
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog || mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
export default AuditLog;
