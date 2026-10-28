import mongoose, { Schema, Document, Model } from "mongoose";

export interface IEmiInstallment {
  installmentNumber: number; // 1, 2, 3...
  dueDate: string; // YYYY-MM-DD
  amount: number;
  status: "Pending" | "Paid" | "Overdue" | "Bounced";
  paidDate?: string;
  paymentChannel?: "Shop Counter" | "Bank Auto-Debit";
  paymentMode?: "Cash" | "UPI" | "Card" | "Bank Transfer" | "NACH Auto-Debit" | "e-Mandate" | "ECS";
  collectedBy?: string;
  bankRef?: string;
  receiptNumber?: string;
  bounceReason?: string;
  penaltyAmount?: number;
  notes?: string;
}

export interface IFinanceTransaction extends Document {
  financeProvider: string; // "Bajaj Finance Limited" | "HDB Financial" | "IDFC First" | "TVS Credit" | "Kotak" | "Other"
  customerName: string;
  customerId?: string;
  customerMobile: string;
  deliveryAddress: string;
  invoiceNumber: string;
  atosDealId?: string;
  doId: string;
  date: string;
  
  // Asset details
  assetCategory?: string;
  oemCategory?: string;
  manufacturer?: string;
  brand?: string;
  productModel?: string;
  eanNumber?: string;
  schemeCode?: string;
  
  // Breakdown matching DO Reference
  productPrice: number;
  grossLoanAmount: number;
  netLoanAmount: number;
  marginMoney: number;
  advanceEmi: number;
  serviceCharge: number;
  upfrontInterest: number;
  dealerInterestSubsidy: number;
  dealerSubsidyPercent?: number;
  mbdFromDealer?: number;
  cardCharges?: number;
  creditSurakshaFees?: number;
  healthCardCharges?: number;
  totalEmi: number;
  totalGst: number;
  convenienceFee: number;
  cashback?: number;
  customerDownPayment: number;
  totalDeductions: number;
  netDisbursement: number;
  
  // EMI Schedule & Ledger Lifecycle
  tenureMonths: number;
  monthlyEmiAmount: number;
  totalPaidEmiAmount: number;
  balanceDueAmount: number;
  emiSchedule: IEmiInstallment[];

  // Verification and disbursement workflow
  approvalStatus: "Pending" | "Under Review" | "Approved" | "Disbursed" | "Reconciled";
  uploadedPdfUrl?: string;
  approvedBy?: string;
  approvalDate?: string;
  actualReceivedAmount?: number;
  bankAccountRef?: string;
  bankAccountId?: string;
  transactionRef?: string;
  paymentReceivedDate?: string;
  remarks?: string;
  deliveryInstructions?: string;
}

const EmiInstallmentSchema = new Schema<IEmiInstallment>({
  installmentNumber: { type: Number, required: true },
  dueDate: { type: String, required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["Pending", "Paid", "Overdue", "Bounced"],
    default: "Pending",
  },
  paidDate: { type: String },
  paymentChannel: {
    type: String,
    enum: ["Shop Counter", "Bank Auto-Debit"],
  },
  paymentMode: { type: String },
  collectedBy: { type: String },
  bankRef: { type: String },
  receiptNumber: { type: String },
  bounceReason: { type: String },
  penaltyAmount: { type: Number, default: 0 },
  notes: { type: String, default: "" },
}, { _id: false });

const FinanceTransactionSchema = new Schema<IFinanceTransaction>(
  {
    financeProvider: { type: String, required: true, default: "Bajaj Finance Limited" },
    customerName: { type: String, required: true, index: true },
    customerId: { type: String, default: "" },
    customerMobile: { type: String, required: true, index: true },
    deliveryAddress: { type: String, default: "" },
    invoiceNumber: { type: String, required: true, index: true },
    atosDealId: { type: String, default: "" },
    doId: { type: String, required: true, unique: true, index: true },
    date: { type: String, required: true, default: () => new Date().toISOString().split("T")[0] },

    assetCategory: { type: String, default: "LED" },
    oemCategory: { type: String, default: "LLOYD - LED" },
    manufacturer: { type: String, default: "HAVELLS INDIA LTD(Lloyd)" },
    brand: { type: String, default: "" },
    productModel: { type: String, default: "" },

    eanNumber: { type: String, default: "N/A" },
    schemeCode: { type: String, default: "5089897 (8/0)" },

    productPrice: { type: Number, required: true },
    grossLoanAmount: { type: Number, required: true },
    netLoanAmount: { type: Number, required: true },
    marginMoney: { type: Number, default: 0 },
    advanceEmi: { type: Number, default: 0 },
    serviceCharge: { type: Number, default: 0 },
    upfrontInterest: { type: Number, default: 0 },
    dealerInterestSubsidy: { type: Number, default: 0 },
    dealerSubsidyPercent: { type: Number, default: 0 },
    mbdFromDealer: { type: Number, default: 0 },
    cardCharges: { type: Number, default: 0 },
    creditSurakshaFees: { type: Number, default: 0 },
    healthCardCharges: { type: Number, default: 0 },
    totalEmi: { type: Number, default: 0 },
    totalGst: { type: Number, default: 0 },
    convenienceFee: { type: Number, default: 0 },
    cashback: { type: Number, default: 0 },
    customerDownPayment: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    netDisbursement: { type: Number, required: true },

    // EMI Tracking
    tenureMonths: { type: Number, default: 8 },
    monthlyEmiAmount: { type: Number, default: 0 },
    totalPaidEmiAmount: { type: Number, default: 0 },
    balanceDueAmount: { type: Number, default: 0 },
    emiSchedule: { type: [EmiInstallmentSchema], default: [] },

    approvalStatus: {
      type: String,
      enum: ["Pending", "Under Review", "Approved", "Disbursed", "Reconciled"],
      default: "Pending",
      index: true,
    },
    uploadedPdfUrl: { type: String },
    approvedBy: { type: String },
    approvalDate: { type: String },
    actualReceivedAmount: { type: Number, default: 0 },
    bankAccountRef: { type: String, default: "" },
    bankAccountId: { type: String, default: "" },
    transactionRef: { type: String, default: "" },
    paymentReceivedDate: { type: String },
    remarks: { type: String, default: "" },
    deliveryInstructions: {
      type: String,
      default: "On delivery of the product kindly submit the invoice, receipted delivery challan and down payment receipt for disbursement.",
    },
  },
  { timestamps: true, collection: "finance_transactions" }
);

if (mongoose.models.FinanceTransaction) {
  delete mongoose.models.FinanceTransaction;
}
const FinanceTransaction: Model<IFinanceTransaction> = mongoose.model<IFinanceTransaction>(
  "FinanceTransaction",
  FinanceTransactionSchema
);
export default FinanceTransaction;
