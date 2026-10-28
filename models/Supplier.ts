import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISupplier extends Document {
  code: string;
  name: string;
  email: string;
  phone: string;
  gstNumber?: string;
  panNumber?: string;
  address: {
    line1: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  creditLimit: number;
  creditDays: number;
  outstandingBalance: number;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    accountType: string;
  };
  status: "active" | "inactive";
}

const SupplierSchema = new Schema<ISupplier>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, default: "" },
    phone: { type: String, required: true },
    gstNumber: { type: String },
    panNumber: { type: String },
    address: {
      line1: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      country: { type: String, default: "India" },
    },
    creditLimit: { type: Number, default: 100000 },
    creditDays: { type: Number, default: 45 },
    outstandingBalance: { type: Number, default: 0 },
    bankDetails: {
      bankName: String,
      accountNumber: String,
      ifscCode: String,
      accountType: String,
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, collection: "suppliers" }
);

const Supplier: Model<ISupplier> = mongoose.models.Supplier || mongoose.model<ISupplier>("Supplier", SupplierSchema);
export default Supplier;
