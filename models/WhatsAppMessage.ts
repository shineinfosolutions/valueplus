import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * The WhatsApp outbox: one row per message the system wants sent.
 *
 * Every notification lands here first, whichever provider is configured. That
 * gives a single place to see what went out, what is still waiting, and what
 * failed — and it means a message is never lost because a send failed, since the
 * row survives and can be retried.
 *
 * Status flow:
 *   pending  → queued, waiting for someone to click send (manual provider)
 *   sent     → delivered to the provider (or marked sent by hand)
 *   failed   → the provider rejected it; `error` says why
 *   skipped  → deliberately not sent (event switched off, no phone number)
 */
export interface IWhatsAppMessage extends Document {
  event: string;
  /** "admin" for the internal alert, "customer" for the party's own update. */
  audience: "admin" | "customer";
  toNumber: string;
  toName: string;
  message: string;
  /** Ready-to-open wa.me link for the manual provider. */
  waLink: string;

  entityType: string;
  entityRef: string;
  entityId?: string;

  status: "pending" | "sent" | "failed" | "skipped";
  provider: "manual" | "cloud-api";
  providerMessageId?: string;
  error?: string;
  attempts: number;
  sentAt?: Date;
  sentBy?: string;
  triggeredBy?: string;
}

const WhatsAppMessageSchema = new Schema<IWhatsAppMessage>(
  {
    event: { type: String, required: true, index: true },
    audience: { type: String, enum: ["admin", "customer"], required: true, index: true },
    toNumber: { type: String, required: true, index: true },
    toName: { type: String, default: "" },
    message: { type: String, required: true },
    waLink: { type: String, default: "" },

    entityType: { type: String, default: "" },
    entityRef: { type: String, default: "", index: true },
    entityId: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pending", "sent", "failed", "skipped"],
      default: "pending",
      index: true,
    },
    provider: { type: String, enum: ["manual", "cloud-api"], default: "manual" },
    providerMessageId: { type: String, default: "" },
    error: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date },
    sentBy: { type: String, default: "" },
    triggeredBy: { type: String, default: "" },
  },
  { timestamps: true, collection: "whatsapp_messages" }
);

WhatsAppMessageSchema.index({ status: 1, createdAt: -1 });
WhatsAppMessageSchema.index({ createdAt: -1 });

const WhatsAppMessage: Model<IWhatsAppMessage> =
  mongoose.models.WhatsAppMessage ||
  mongoose.model<IWhatsAppMessage>("WhatsAppMessage", WhatsAppMessageSchema);
export default WhatsAppMessage;
