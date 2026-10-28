import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * A vendor is a party that BUYS from us on account — a dealer, a reseller, an
 * institutional buyer — as opposed to a Supplier, whom we buy from.
 *
 * It is deliberately a separate collection rather than a flag on Customer: the
 * counter billing flow creates Customer rows freely (walk-ins, one-off buyers)
 * and mixing account-holding trade parties into that list would change how every
 * existing customer screen behaves. Vendors carry their own bills and payments.
 */
export interface IVendor extends Document {
  code: string;
  name: string;
  contactPerson?: string;
  email: string;
  phone: string;
  altPhone?: string;
  gstNumber?: string;
  panNumber?: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  creditLimit: number;
  creditDays: number;
  /** Balance carried in from before the ledger started. Positive = vendor owes us. */
  openingBalance: number;
  openingBalanceDate?: string;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    accountType: string;
  };
  notes?: string;
  status: "active" | "inactive";
}

const VendorAddressSchema = new Schema(
  {
    line1: { type: String, default: "" },
    line2: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "Uttar Pradesh" },
    pincode: { type: String, default: "" },
    country: { type: String, default: "India" },
  },
  { _id: false }
);

const VendorSchema = new Schema<IVendor>(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, index: true },
    contactPerson: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, required: true, index: true },
    altPhone: { type: String, default: "" },
    gstNumber: { type: String, default: "" },
    panNumber: { type: String, default: "" },
    address: { type: VendorAddressSchema, default: () => ({}) },
    creditLimit: { type: Number, default: 100000 },
    creditDays: { type: Number, default: 30 },
    openingBalance: { type: Number, default: 0 },
    openingBalanceDate: { type: String, default: "" },
    bankDetails: {
      bankName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      accountType: { type: String, default: "Current" },
    },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, collection: "vendors" }
);

const Vendor: Model<IVendor> =
  mongoose.models.Vendor || mongoose.model<IVendor>("Vendor", VendorSchema);
export default Vendor;
