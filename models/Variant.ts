import mongoose, { Schema, Document, Model } from "mongoose";

export interface IVariant extends Document {
  name: string;
  values: string[];
  status: "active" | "inactive";
}

const VariantSchema = new Schema<IVariant>(
  {
    name: { type: String, required: true, unique: true },
    values: [{ type: String }],
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, collection: "variants" }
);

const Variant: Model<IVariant> = mongoose.models.Variant || mongoose.model<IVariant>("Variant", VariantSchema);
export default Variant;
