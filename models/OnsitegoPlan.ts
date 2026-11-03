import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * One row of Onsitego's plan price list, read from the Excel the Admin uploads to the "On Site Go" documents
 * folder (lib/onsitego-server.ts). Each upload replaces the whole list. The bill form suggests the plans
 * whose price band fits the product (lib/onsitego.ts `plansFor`).
 */
export interface IOnsitegoPlan extends Document {
  category: string;
  minPrice: number;
  maxPrice: number;
  planName: string;
  years: number;
  price: number;
  sourceDocId: string;
  sourceFileName: string;
}

const OnsitegoPlanSchema = new Schema<IOnsitegoPlan>(
  {
    category: { type: String, default: "" },
    minPrice: { type: Number, default: 0 },
    maxPrice: { type: Number, default: 0 },
    planName: { type: String, required: true },
    years: { type: Number, default: 0 },
    price: { type: Number, required: true },
    sourceDocId: { type: String, default: "" },
    sourceFileName: { type: String, default: "" },
  },
  { timestamps: true, collection: "onsitego_plans" }
);

const OnsitegoPlan: Model<IOnsitegoPlan> =
  mongoose.models.OnsitegoPlan || mongoose.model<IOnsitegoPlan>("OnsitegoPlan", OnsitegoPlanSchema);
export default OnsitegoPlan;
