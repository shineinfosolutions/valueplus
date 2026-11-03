import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * One plan of Onsitego's price list, read from the PDF the Admin uploads to the "On Site Go" documents folder
 * (lib/onsitego-server.ts). Each upload replaces the whole list. The bill form shows the plans whose product
 * group and price slab fit the product (lib/onsitego.ts `plansFor`).
 */
export interface IOnsitegoPlan extends Document {
  category: string;
  device: string;
  kind: string;
  vpCode: string;
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
    device: { type: String, default: "" },
    kind: { type: String, default: "" },
    vpCode: { type: String, default: "" },
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
