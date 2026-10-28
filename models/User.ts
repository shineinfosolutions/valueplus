import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  name: string;
  email: string;
  password?: string;
  role: "admin" | "warehouse" | "salesman" | "cashier" | "accounts" | "hr" | "supplier" | "manager" | "sales" | "driver";
  mobile?: string;
  avatar?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  idProofType?: "Aadhaar Card" | "PAN Card" | "Voter ID" | "Driving License" | "Passport";
  idProofNumber?: string;
  idProofDoc?: string;
  designation?: string;
  monthlySalary?: number;
  salaryType?: "Fixed" | "Fixed + Incentive" | "Commission Only";
  salaryPaymentDay?: number;
  joiningDate?: string;
  advanceBalance?: number;
  monthlyAdvanceDeduction?: number;
  vehicleNumber?: string;
  drivingLicenseNo?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  assignedWarehouseId?: string;
  assignedWarehouseName?: string;
  assignedBrand?: string;
  assignedBrands?: string[];
  /**
   * Bcrypt hash of the 4-digit PIN that authorises a cancel or delete.
   *
   * Optional on purpose: a user who has never set one falls back to the legacy
   * shared PIN, so nobody is locked out the day this ships. `select: false`
   * keeps the hash out of every ordinary user query, including the staff
   * directory screens that dump the whole document to the client.
   */
  securityPin?: string;
  pinUpdatedAt?: Date;
  pinFailCount?: number;
  pinLockedUntil?: Date;
  status: "active" | "inactive";
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    role: {
      type: String,
      enum: ["admin", "warehouse", "salesman", "cashier", "accounts", "hr", "supplier", "manager", "sales", "driver", "courier", "delivery"],
      default: "salesman",
      index: true,
    },
    mobile: { type: String, default: "" },
    avatar: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "Gorakhpur" },
    state: { type: String, default: "Uttar Pradesh" },
    pincode: { type: String, default: "273008" },
    idProofType: {
      type: String,
      enum: ["Aadhaar Card", "PAN Card", "Voter ID", "Driving License", "Passport"],
      default: "Aadhaar Card",
    },
    idProofNumber: { type: String, default: "" },
    idProofDoc: { type: String, default: "" },
    designation: { type: String, default: "Sales Executive" },
    monthlySalary: { type: Number, default: 0 },
    salaryType: {
      type: String,
      enum: ["Fixed", "Fixed + Incentive", "Commission Only"],
      default: "Fixed",
    },
    salaryPaymentDay: { type: Number, default: 7 },
    joiningDate: { type: String, default: () => new Date().toISOString().split("T")[0] },
    advanceBalance: { type: Number, default: 0 },
    monthlyAdvanceDeduction: { type: Number, default: 0 },
    vehicleNumber: { type: String, default: "" },
    drivingLicenseNo: { type: String, default: "" },
    bankName: { type: String, default: "" },
    bankAccountNo: { type: String, default: "" },
    bankIfsc: { type: String, default: "" },
    assignedWarehouseId: { type: String, default: "" },
    assignedWarehouseName: { type: String, default: "" },
    assignedBrand: { type: String, default: "" },
    assignedBrands: [{ type: String }],
    securityPin: { type: String, select: false },
    pinUpdatedAt: { type: Date },
    pinFailCount: { type: Number, default: 0, select: false },
    pinLockedUntil: { type: Date, select: false },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true, collection: "users" }
);

if (mongoose.models && (mongoose.models as any).User) {
  delete (mongoose.models as any).User;
}

const User: Model<IUser> = mongoose.model<IUser>("User", UserSchema);
export default User;
