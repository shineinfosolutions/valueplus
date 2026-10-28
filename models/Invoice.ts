import mongoose, { Schema, Document, Model } from "mongoose";

export interface ILineItem {
  itemId: string;
  itemName: string;
  itemCode: string;
  vpCode?: string;
  description?: string;
  /** The item's HSN code as it stood at billing time — frozen here rather
   *  than always read live off the Item master, since a GST return for a
   *  past period must keep showing whatever HSN the sale actually declared
   *  even if the catalog entry's code is corrected later. */
  hsn?: string;
  quantity: number;
  unit: string;
  rate: number;
  minSellingPrice?: number;
  /** The product's purchase price when this line was billed, set by the server.
   *  The P&L reads cost from here so a later price change (a brand price sheet,
   *  a new purchase rate) does not rewrite past profit. Absent on older bills. */
  costPrice?: number;
  adminOverrideRate?: boolean;
  incentiveTargetAmount?: number;
  incentiveAmount?: number;
  incentiveType?: "none" | "fixed" | "percentage";
  incentiveValue?: number;
  incentiveEarned?: number;
  discount: number;
  discountType: "percent" | "amount";
  taxableAmount: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  amount: number;
  serialNumber?: string;
  batchNumber?: string;
  extendedWarrantyProvider?: string;
  extendedWarrantyPlan?: string;
  extendedWarrantyAmount?: number;
  extendedWarrantyDuration?: number;
  extendedWarrantyPolicyNo?: string;
}

/**
 * One allocation of an invoice's value to a payment mode.
 *
 * An invoice may be settled across several modes at once (₹10,000 cash + ₹40,000
 * online against a ₹50,000 bill). The rows always add up to the invoice total.
 *
 * Collected modes (Cash/UPI/Card/Online) count towards `paidAmount` immediately.
 * "Finance" and "Due" are receivables — from the financier and the customer
 * respectively — so they stay in `balanceAmount`, which is exactly how the older
 * `financeDownPayment` and `dueAdvanceAmount` fields already behaved.
 */
export interface IInvoicePayment {
  mode: string;
  amount: number;
  txnId?: string;
  reference?: string;
  receivedBy?: string;
  notes?: string;
}

export interface IInvoice extends Document {
  invoiceNumber: string;
  type: "tax-invoice" | "proforma" | "credit-note" | "sales-order";
  customerId: string;
  customerName: string;
  customerGST?: string;
  customerPAN?: string;
  /** The GST-registered company being billed, when this is a B2B sale —
   *  shown on the printed invoice in place of the walk-in customer's name. */
  customerCompanyName?: string;
  customerPhone?: string;
  customerAltPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  customerCity?: string;
  customerState?: string;
  customerPin?: string;
  placeOfSupply?: string;
  vehicleNumber?: string;
  shippingAddress?: string;
  /** Which warehouse this sale's stock was deducted from — resolved once at
   *  creation time (the cashier's assigned location, or their chosen one if
   *  they're allowed to switch) so edits/cancellations reverse the same real
   *  warehouse rather than re-guessing it later. */
  warehouseId?: mongoose.Types.ObjectId;
  /** The name this bill was raised under: Value Plus or Ashoka Enterprises. */
  billingEntity?: "valueplus" | "ashoka";
  date: string;
  dueDate: string;
  status: "draft" | "sent" | "paid" | "partial" | "overdue" | "cancelled" | "pending";
  items: ILineItem[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGST: number;
  // These four are on the schema below but were never declared here, so every
  // route that reads an invoice's money fields did so untyped.
  roundOff: number;
  total: number;
  paidAmount: number;
  balanceAmount: number;
  extendedWarrantyTotal?: number;
  paymentMode: "Cash" | "UPI" | "Online" | "Card" | "Credit Card" | "Debit Card" | "Finance" | "Due / Credit" | "Multiple" | "Unclassified";
  /**
   * Split payment breakdown. Empty/absent on every invoice created before split
   * payments existed — all readers fall back to `paymentMode` + `paidAmount`, so
   * historical invoices keep reporting exactly as they did.
   */
  payments?: IInvoicePayment[];
  paymentTerms: string;
  
  // Payment Details
  cashReceivedBy?: string;
  upiTxnId?: string;
  onlineTxnId?: string;
  onlineGateway?: string;
  cardCategory?: "Credit Card" | "Debit Card" | "Card";
  cardAmount?: number;
  cardType?: string;
  cardTxnId?: string;
  cardLast4?: string;
  cardMdrPercent?: number;
  cardMdrAmount?: number;
  cardNetSettlement?: number;

  // Finance Workflow Details
  financeProvider?: string;
  financeDoId?: string;
  financeAppId?: string;
  financeGrossLoan?: number;
  financeNetLoan?: number;
  financeMarginMoney?: number;
  financeDownPayment?: number;
  financeDownPaymentMode?: string;
  financeDealerSubsidy?: number;
  financeExpectedDisbursement?: number;
  financeActualDisbursement?: number;
  financeApprovalStatus?: "Pending" | "Under Review" | "Approved" | "Disbursed" | "Reconciled";
  financePdfUrl?: string;
  financeApprovedBy?: string;
  financeApprovalDate?: string;
  financeBankRef?: string;
  financeBankAccountId?: string;
  financeBankAccount?: string;
  financePayoutDate?: string;

  downPayment?: number;
  downPaymentMode?: string;
  shippingCharges?: number;
  freightCharges?: number;
  financeTenureMonths?: number;
  financeSchemeType?: string;
  financeInterestRate?: number;
  monthlyEMI?: number;
  totalInterest?: number;

  // Due / Credit Details & Clearance
  dueAdvanceAmount?: number;
  dueAdvanceMode?: string;
  dueClearedAt?: string;
  dueClearedMode?: string;
  dueClearedBy?: string;
  dueClearedBankAccountId?: string;
  dueClearedBankAccount?: string;
  // Advance Payment & Pre-Booking Adjustment
  advanceAdjusted?: number;
  advanceReceiptNo?: string;
  creditAdjusted?: number;
  advanceTransactionId?: string;

  isShippingSameAsBilling?: boolean;
  shippingStreet?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingPin?: string;
  dispatchType?: "immediate" | "delayed_delivery";
  deliveryStatus?: "pending_dispatch" | "packed" | "out_for_delivery" | "delivered";
  deliveryOtp?: string;
  /** When the goods are to be handed over, for a bill delivered later
   *  ("YYYY-MM-DD"). Sold and off stock already, kept aside till then. */
  expectedDeliveryDate?: string;
  /** A bill dated before the day it was made. "pending" when a Store Manager
   *  made it and the Admin has not yet approved; "rejected" bills are moved back
   *  to the day they were made. */
  backdateStatus?: "approved" | "pending" | "rejected";
  backdateRequestedBy?: string;
  backdateMadeOn?: string;
  deliveryNote?: string;
  /** Set once the "delivery due soon" reminder has gone out. */
  deliveryReminderSentAt?: Date;
  driverName?: string;
  driverPhone?: string;
  driverVehicleNo?: string;
  deliveredAt?: Date | string;

  deliveryChallanNo?: string;
  creditNoteRef?: string;
  notes?: string;
  salesExecutive?: string;
  salesExecutiveIncentive?: number;
  adminOverridePinUsed?: boolean;
  reprintCount?: number;
  lastPrintedAt?: string;
  printLogs?: Array<{ printedAt: string; printedBy?: string }>;

  // Tracks WHY this invoice was last touched, so dashboard audit tracking can tell a
  // real content edit apart from incidental system updates (reprint, due-clear, etc.)
  lastModifiedReason?: "content-edit" | "reprint" | "due-clear" | "finance-sync" | "cancel";

  // Soft-cancel audit trail (invoice stays on record, unlike a hard delete)
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
}

const LineItemSchema = new Schema({
  itemId: { type: String, required: true },
  itemName: { type: String, required: true },
  itemCode: { type: String, required: true },
  vpCode: { type: String, default: "" },
  description: String,
  hsn: { type: String, default: "" },
  quantity: { type: Number, required: true },
  unit: { type: String, required: true, default: "Pcs" },
  rate: { type: Number, required: true },
  minSellingPrice: { type: Number, default: 0 },
  // No default: a missing value means "billed before cost was kept on the line".
  costPrice: { type: Number },
  adminOverrideRate: { type: Boolean, default: false },
  incentiveTargetAmount: { type: Number, default: 0 },
  incentiveAmount: { type: Number, default: 0 },
  incentiveType: { type: String, default: "none" },
  incentiveValue: { type: Number, default: 0 },
  incentiveEarned: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  discountType: { type: String, enum: ["percent", "amount"], default: "amount" },
  taxableAmount: { type: Number, required: true },
  gstRate: { type: Number, required: true },
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
  amount: { type: Number, required: true },
  serialNumber: { type: String, default: "" },
  batchNumber: { type: String, default: "" },
  extendedWarrantyProvider: { type: String, default: "" },
  extendedWarrantyPlan: { type: String, default: "" },
  extendedWarrantyAmount: { type: Number, default: 0 },
  extendedWarrantyDuration: { type: Number, default: 0 },
  extendedWarrantyPolicyNo: { type: String, default: "" },
});

const PaymentSplitSchema = new Schema<IInvoicePayment>(
  {
    mode: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 },
    txnId: { type: String, default: "" },
    reference: { type: String, default: "" },
    receivedBy: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const InvoiceSchema = new Schema<IInvoice>(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ["tax-invoice", "proforma", "credit-note", "sales-order"], default: "tax-invoice" },
    customerId: { type: String, required: true, index: true },
    customerName: { type: String, required: true, index: true },
    customerGST: { type: String, default: "" },
    customerPAN: { type: String, default: "" },
    customerCompanyName: { type: String, default: "" },
    customerPhone: { type: String, index: true },
    customerAltPhone: { type: String, default: "" },
    customerEmail: String,
    customerAddress: String,
    customerCity: String,
    customerState: { type: String, default: "Uttar Pradesh" },
    customerPin: String,
    placeOfSupply: { type: String, default: "Uttar Pradesh(09)" },
    vehicleNumber: { type: String, default: "" },
    shippingAddress: String,
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    billingEntity: { type: String, enum: ["valueplus", "ashoka"], default: "valueplus", index: true },
    date: { type: String, required: true, index: true },
    dueDate: { type: String, required: true, index: true },
    status: { type: String, enum: ["draft", "sent", "paid", "partial", "overdue", "cancelled", "pending"], default: "sent", index: true },
    items: [LineItemSchema],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    taxableAmount: { type: Number, required: true },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    totalGST: { type: Number, required: true },
    extendedWarrantyTotal: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    total: { type: Number, required: true },
    paidAmount: { type: Number, default: 0 },
    balanceAmount: { type: Number, required: true },
    // No longer defaults to "Cash" — that silently mislabeled every invoice saved
    // without an explicit mode (credit notes, sales orders, admin tooling) as a
    // real cash sale, which is exactly what polluted the cash register's totals.
    paymentMode: { type: String, default: "Unclassified" },
    payments: { type: [PaymentSplitSchema], default: [] },
    paymentTerms: { type: String, default: "Net 30" },

    cashReceivedBy: String,
    upiTxnId: String,
    onlineTxnId: String,
    onlineGateway: String,
    cardCategory: { type: String, default: "Credit Card" },
    cardAmount: Number,
    cardType: String,
    cardTxnId: String,
    cardLast4: String,
    cardMdrPercent: Number,
    cardMdrAmount: Number,
    cardNetSettlement: Number,

    financeProvider: String,
    financeDoId: { type: String, index: true },
    financeAppId: String,
    financeGrossLoan: Number,
    financeNetLoan: Number,
    financeMarginMoney: Number,
    financeDownPayment: Number,
    financeDownPaymentMode: { type: String, default: "Cash" },
    financeDealerSubsidy: Number,
    financeExpectedDisbursement: Number,
    financeActualDisbursement: Number,
    financeApprovalStatus: {
      type: String,
      enum: ["Pending", "Under Review", "Approved", "Disbursed", "Reconciled"],
      default: "Pending",
    },
    financePdfUrl: String,
    financeApprovedBy: String,
    financeApprovalDate: String,
    financeBankRef: String,
    // Where and when the financier's payout actually landed
    financeBankAccountId: String,
    financeBankAccount: String,
    financePayoutDate: String,

    downPayment: Number,
    downPaymentMode: String,
    shippingCharges: { type: Number, default: 0 },
    freightCharges: { type: Number, default: 0 },
    financeTenureMonths: Number,
    financeSchemeType: String,
    financeInterestRate: Number,
    monthlyEMI: Number,
    totalInterest: Number,

    // Due / Credit tracking & clearance
    dueAdvanceAmount: { type: Number, default: 0 },
    dueAdvanceMode: { type: String, default: "Cash" },
    dueClearedAt: { type: String },
    dueClearedMode: { type: String },
    dueClearedBy: { type: String },
    dueClearedNotes: { type: String },
    dueClearedTxnId: { type: String },
    dueClearedBankAccountId: { type: String },
    dueClearedBankAccount: { type: String },

    // Advance Payment / Pre-Booking Adjustment
    advanceAdjusted: { type: Number, default: 0 },
    // Part of advanceAdjusted taken from money the customer paid earlier
    // through Receive Payment (their negative outstandingBalance), rather
    // than from an Advance Booking receipt.
    creditAdjusted: { type: Number, default: 0 },
    // Address & Dispatch Details
    isShippingSameAsBilling: { type: Boolean, default: true },
    shippingStreet: { type: String, default: "" },
    shippingCity: { type: String, default: "" },
    shippingState: { type: String, default: "" },
    shippingPin: { type: String, default: "" },
    dispatchType: { type: String, enum: ["immediate", "delayed_delivery"], default: "immediate" },
    deliveryStatus: { type: String, enum: ["pending_dispatch", "packed", "out_for_delivery", "delivered"], default: "delivered" },
    deliveryOtp: { type: String, default: "" },
    expectedDeliveryDate: { type: String, default: "", index: true },
    backdateStatus: { type: String, enum: ["approved", "pending", "rejected", ""], default: "" },
    backdateRequestedBy: { type: String, default: "" },
    backdateMadeOn: { type: String, default: "" },
    deliveryNote: { type: String, default: "" },
    deliveryReminderSentAt: { type: Date },
    driverName: { type: String, default: "" },
    driverPhone: { type: String, default: "" },
    driverVehicleNo: { type: String, default: "" },
    deliveredAt: { type: Date },

    deliveryChallanNo: String,
    creditNoteRef: String,
    notes: String,
    salesExecutive: { type: String, default: "" },
    salesExecutiveIncentive: { type: Number, default: 0 },
    adminOverridePinUsed: { type: Boolean, default: false },
    reprintCount: { type: Number, default: 0 },
    lastPrintedAt: { type: String },
    printLogs: [
      {
        printedAt: { type: String },
        printedBy: { type: String, default: "User" },
      }
    ],
    lastModifiedReason: {
      type: String,
      enum: ["content-edit", "reprint", "due-clear", "finance-sync", "cancel"],
    },
    cancelledAt: { type: String },
    cancelledBy: { type: String },
    cancelReason: { type: String },
  },
  { timestamps: true, collection: "invoices" }
);

InvoiceSchema.index({ type: 1, createdAt: -1 });
InvoiceSchema.index({ date: -1, createdAt: -1 });
InvoiceSchema.index({ customerPhone: 1 });
InvoiceSchema.index({ invoiceNumber: 1 });
InvoiceSchema.index({ status: 1 });
InvoiceSchema.index({ warehouseId: 1 });

const Invoice: Model<IInvoice> = mongoose.models.Invoice || mongoose.model<IInvoice>("Invoice", InvoiceSchema);
export default Invoice;
