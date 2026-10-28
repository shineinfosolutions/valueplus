import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISalaryPaymentHistory {
  date: string;
  amount: number;
  paymentMode: string;
  txnRef?: string;
  notes?: string;
}

export interface ISalary extends Document {
  employeeName: string;
  employeeId: string;
  designation: string;
  monthlySalary: number;
  salaryType: "Fixed" | "Fixed + Incentive" | "Commission Only";
  joiningDate: string;
  deductions: number;
  incentives: number;
  commission: number;
  payableAmount: number;
  paymentStatus: "Paid" | "Pending" | "Processing" | "Partial";
  paymentDate?: string;
  paymentMode?: string;
  month: string; // e.g. "August 2026"
  year: number;
  history: ISalaryPaymentHistory[];
  notes?: string;
}

const HistorySchema = new Schema({
  date: { type: String, required: true },
  amount: { type: Number, required: true },
  paymentMode: { type: String, default: "Bank Transfer" },
  txnRef: { type: String, default: "" },
  notes: { type: String, default: "" },
});

const SalarySchema = new Schema<ISalary>(
  {
    employeeName: { type: String, required: true, index: true },
    employeeId: { type: String, required: true, index: true },
    designation: { type: String, default: "Sales Executive" },
    monthlySalary: { type: Number, required: true },
    salaryType: {
      type: String,
      enum: ["Fixed", "Fixed + Incentive", "Commission Only"],
      default: "Fixed",
    },
    joiningDate: { type: String, default: "2024-01-01" },
    deductions: { type: Number, default: 0 },
    incentives: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    payableAmount: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ["Paid", "Pending", "Processing", "Partial"],
      default: "Pending",
      index: true,
    },
    paymentDate: { type: String },
    paymentMode: { type: String, default: "Bank Transfer" },
    month: { type: String, required: true, index: true },
    year: { type: Number, required: true, default: 2026 },
    history: [HistorySchema],
    notes: { type: String, default: "" },
  },
  { timestamps: true, collection: "salaries" }
);

if (mongoose.models.Salary) {
  delete mongoose.models.Salary;
}
const Salary: Model<ISalary> = mongoose.model<ISalary>("Salary", SalarySchema);
export default Salary;
