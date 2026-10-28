import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUnit extends Document {
  name: string;
  shortName: string;
  type: string;
  status: "active" | "inactive";
}

const UnitSchema = new Schema<IUnit>(
  {
    name: { type: String, required: true, unique: true },
    shortName: { type: String, required: true, unique: true },
    type: { type: String, default: "count" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, collection: "units" }
);

const Unit: Model<IUnit> = mongoose.models.Unit || mongoose.model<IUnit>("Unit", UnitSchema);
export default Unit;
