import mongoose, { Schema, Document, Model } from "mongoose";

export interface IWarehouse extends Document {
  name: string;
  code: string;
  /** Replaces the keyword-guessing on `name` ("godown"/"warehouse"/"gida"/"logistics")
   *  that used to be reimplemented separately in several places — this is now the
   *  single source of truth for which stock bucket a warehouse rolls up into. */
  type: "showroom" | "godown";
  address: string;
  city: string;
  state: string;
  pincode: string;
  contactPerson: string;
  phone: string;
  email: string;
  status: "active" | "inactive";
  isDefault: boolean;
}

const WarehouseSchema = new Schema<IWarehouse>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    type: { type: String, enum: ["showroom", "godown"], required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    contactPerson: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "warehouses" }
);

const Warehouse: Model<IWarehouse> = mongoose.models.Warehouse || mongoose.model<IWarehouse>("Warehouse", WarehouseSchema);
export default Warehouse;
