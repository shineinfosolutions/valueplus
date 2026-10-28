import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICustomer extends Document {
  code: string;
  name: string;
  email: string;
  phone: string;
  gstNumber?: string;
  panNumber?: string;
  billingAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  creditLimit: number;
  creditDays: number;
  outstandingBalance: number;
  advanceBalance: number;
  loyaltyPoints: number;
  customerGroup: string;
  status: "active" | "inactive";
}

// Counter billing must never be blocked by an address field a walk-in customer
// simply didn't give. `required: true` on pincode rejected the empty string the
// billing flow sends, so creating the customer threw and took the whole invoice
// POST down with it — bills silently failed to save. These stay optional with
// empty defaults; the Customer master form does its own validation for the
// fields it genuinely needs.
const AddressSchema = new Schema({
  line1: { type: String, default: "" },
  line2: { type: String, default: "" },
  city: { type: String, default: "" },
  state: { type: String, default: "" },
  pincode: { type: String, default: "" },
  country: { type: String, default: "India" },
});

const CustomerSchema = new Schema<ICustomer>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, default: "" },
    phone: { type: String, required: true },
    gstNumber: { type: String },
    panNumber: { type: String },
    billingAddress: { type: AddressSchema, required: true },
    shippingAddress: { type: AddressSchema },
    creditLimit: { type: Number, default: 50000 },
    creditDays: { type: Number, default: 30 },
    outstandingBalance: { type: Number, default: 0 },
    advanceBalance: { type: Number, default: 0 },
    loyaltyPoints: { type: Number, default: 0 },
    customerGroup: { type: String, default: "Retail" },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, collection: "customers" }
);

CustomerSchema.index({ phone: 1 });
CustomerSchema.index({ name: 1 });
CustomerSchema.index({ code: 1 });

const Customer: Model<ICustomer> = mongoose.models.Customer || mongoose.model<ICustomer>("Customer", CustomerSchema);
export default Customer;
