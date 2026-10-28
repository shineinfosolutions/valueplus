import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * WhatsApp notification configuration — a single document.
 *
 * `provider` decides what actually happens when a message is raised:
 *
 *   "manual"    — the message is queued in the outbox with a wa.me link. A person
 *                 clicks it, WhatsApp opens with the text already written, and
 *                 they press send. No credentials, works from day one.
 *   "cloud-api" — the message is posted straight to Meta's WhatsApp Cloud API.
 *
 * Both paths raise and log the same message, so switching provider changes only
 * how it is delivered, never what is sent or what the outbox shows.
 */
export interface IWhatsAppSetting extends Document {
  provider: "manual" | "cloud-api";
  enabled: boolean;
  /** Numbers that receive the internal alert, digits only with country code. */
  adminNumbers: string[];
  /** Whether the customer also receives an update on their own number. */
  notifyCustomer: boolean;
  /** Per-event switches, keyed by the event name in lib/whatsapp/events.ts. */
  events: Record<string, boolean>;
  businessName: string;
  /** Meta Cloud API credentials, only read when provider is "cloud-api". */
  cloudApi?: {
    phoneNumberId: string;
    accessToken: string;
    apiVersion: string;
    /** Meta-approved template name used for business-initiated messages. */
    templateName: string;
    templateLanguage: string;
  };
  updatedBy?: string;
}

const WhatsAppSettingSchema = new Schema<IWhatsAppSetting>(
  {
    provider: { type: String, enum: ["manual", "cloud-api"], default: "manual" },
    enabled: { type: Boolean, default: true },
    adminNumbers: [{ type: String }],
    notifyCustomer: { type: Boolean, default: true },
    events: { type: Schema.Types.Mixed, default: {} },
    businessName: { type: String, default: "Value Plus" },
    cloudApi: {
      phoneNumberId: { type: String, default: "" },
      // Stored so the server can send; never returned to the browser.
      accessToken: { type: String, default: "", select: false },
      apiVersion: { type: String, default: "v21.0" },
      templateName: { type: String, default: "" },
      templateLanguage: { type: String, default: "en" },
    },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true, collection: "whatsapp_settings" }
);

const WhatsAppSetting: Model<IWhatsAppSetting> =
  mongoose.models.WhatsAppSetting ||
  mongoose.model<IWhatsAppSetting>("WhatsAppSetting", WhatsAppSettingSchema);
export default WhatsAppSetting;
