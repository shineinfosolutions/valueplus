import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBrand extends Document {
  name: string;
  description?: string;
  status: "active" | "inactive";
}

const BrandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, collection: "brands" }
);

const Brand: Model<IBrand> = mongoose.models.Brand || mongoose.model<IBrand>("Brand", BrandSchema);
export default Brand;
