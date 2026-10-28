import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * A company an invoice was ever billed to by GSTIN — saved so the next
 * invoice for the same company can be picked from a dropdown by name instead
 * of retyping its GSTIN, and so its PAN (derived from the GSTIN itself) is
 * remembered too.
 */
export interface IBillingCompany extends Document {
  gstin: string;
  companyName: string;
  pan?: string;
  usageCount: number;
}

const BillingCompanySchema = new Schema<IBillingCompany>(
  {
    gstin: { type: String, required: true, unique: true, uppercase: true, trim: true },
    companyName: { type: String, required: true, trim: true },
    pan: { type: String, default: "" },
    usageCount: { type: Number, default: 1 },
  },
  { timestamps: true, collection: "billing_companies" }
);

const BillingCompany: Model<IBillingCompany> =
  mongoose.models.BillingCompany || mongoose.model<IBillingCompany>("BillingCompany", BillingCompanySchema);
export default BillingCompany;
