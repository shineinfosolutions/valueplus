// ==============================
// MASTER TYPES
// ==============================

export interface Item {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryId: string;
  brandId: string;
  unitId: string;
  hsnCode: string;
  gstRate: number;
  purchasePrice: number;
  sellingPrice: number;
  mrp: number;
  openingStock: number;
  currentStock: number;
  reorderLevel: number;
  warehouseId: string;
  status: "active" | "inactive";
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  parentId?: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface Brand {
  id: string;
  name: string;
  description: string;
  logo?: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface Unit {
  id: string;
  name: string;
  abbreviation: string;
  type: "weight" | "volume" | "length" | "count" | "other";
  status: "active" | "inactive";
}

export interface Variant {
  id: string;
  name: string;
  values: string[];
  status: "active" | "inactive";
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  contactPerson: string;
  phone: string;
  email: string;
  status: "active" | "inactive";
  isDefault: boolean;
  createdAt: string;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  gstNumber?: string;
  panNumber?: string;
  billingAddress: Address;
  shippingAddress?: Address;
  creditLimit: number;
  creditDays: number;
  outstandingBalance: number;
  loyaltyPoints: number;
  customerGroup: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  gstNumber?: string;
  panNumber?: string;
  address: Address;
  creditLimit: number;
  creditDays: number;
  outstandingBalance: number;
  bankDetails?: BankDetails;
  status: "active" | "inactive";
  createdAt: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface BankDetails {
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  accountType: string;
}

// ==============================
// SALES TYPES
// ==============================

export interface LineItem {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  description?: string;
  quantity: number;
  unit: string;
  rate: number;
  discount: number;
  discountType: "percent" | "amount";
  taxableAmount: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  amount: number;
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  deliveryDate?: string;
  status: "draft" | "confirmed" | "delivered" | "cancelled";
  items: LineItem[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  totalGST: number;
  roundOff: number;
  total: number;
  notes?: string;
  termsAndConditions?: string;
  warehouseId: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: "tax-invoice" | "proforma" | "credit-note";
  customerId: string;
  customerName: string;
  customerGST?: string;
  date: string;
  dueDate: string;
  salesOrderId?: string;
  status: "draft" | "sent" | "paid" | "partial" | "overdue" | "cancelled";
  items: LineItem[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGST: number;
  roundOff: number;
  total: number;
  paidAmount: number;
  balanceAmount: number;
  paymentTerms: string;
  notes?: string;
  bankDetails?: BankDetails;
  createdAt: string;
}

export interface Payment {
  id: string;
  paymentNumber: string;
  type: "receipt" | "payment";
  partyId: string;
  partyName: string;
  partyType: "customer" | "supplier";
  date: string;
  amount: number;
  paymentMode: "cash" | "bank-transfer" | "cheque" | "upi" | "card";
  reference?: string;
  bankAccountId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  notes?: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
}

export interface Estimate {
  id: string;
  estimateNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  expiryDate: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired";
  items: LineItem[];
  subtotal: number;
  discount: number;
  total: number;
  notes?: string;
  createdAt: string;
}

export interface DeliveryChallan {
  id: string;
  challanNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  salesOrderId?: string;
  invoiceId?: string;
  status: "draft" | "dispatched" | "delivered" | "returned";
  items: LineItem[];
  vehicleNumber?: string;
  driverName?: string;
  notes?: string;
  createdAt: string;
}

export interface CreditNote {
  id: string;
  creditNoteNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  reason: string;
  items: LineItem[];
  total: number;
  status: "draft" | "approved" | "applied";
  createdAt: string;
}

// ==============================
// PURCHASE TYPES
// ==============================

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  date: string;
  expectedDate?: string;
  status: "draft" | "sent" | "received" | "partial" | "cancelled";
  items: LineItem[];
  subtotal: number;
  totalGST: number;
  total: number;
  notes?: string;
  createdAt: string;
}

export interface PurchaseEntry {
  id: string;
  billNumber: string;
  supplierId: string;
  supplierName: string;
  date: string;
  dueDate: string;
  purchaseOrderId?: string;
  status: "draft" | "received" | "paid" | "partial" | "overdue";
  items: LineItem[];
  subtotal: number;
  totalGST: number;
  total: number;
  paidAmount: number;
  balanceAmount: number;
  notes?: string;
  createdAt: string;
}

export interface DebitNote {
  id: string;
  debitNoteNumber: string;
  purchaseEntryId: string;
  supplierId: string;
  supplierName: string;
  date: string;
  reason: string;
  items: LineItem[];
  total: number;
  status: "draft" | "approved" | "applied";
  createdAt: string;
}

export interface Expense {
  id: string;
  expenseNumber: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  paymentMode: "cash" | "bank-transfer" | "card";
  supplierId?: string;
  supplierName?: string;
  taxable: boolean;
  gstRate: number;
  status: "draft" | "approved" | "paid";
  createdAt: string;
}

// ==============================
// INVENTORY TYPES
// ==============================

export interface StockAdjustment {
  id: string;
  adjustmentNumber: string;
  warehouseId: string;
  date: string;
  reason: string;
  type: "addition" | "reduction";
  items: { itemId: string; itemName: string; quantity: number; unit: string; currentStock: number }[];
  notes?: string;
  status: "draft" | "approved";
  createdAt: string;
}

export interface StockTransfer {
  id: string;
  transferNumber: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  date: string;
  status: "draft" | "in-transit" | "received" | "cancelled";
  items: { itemId: string; itemName: string; quantity: number; unit: string }[];
  notes?: string;
  createdAt: string;
}

// ==============================
// BANKING TYPES
// ==============================

export interface BankAccount {
  id: string;
  name: string;
  accountNumber: string;
  bankName: string;
  ifscCode: string;
  branch: string;
  type: "current" | "savings" | "cash";
  openingBalance: number;
  currentBalance: number;
  status: "active" | "inactive";
  createdAt: string;
}

export interface BankTransaction {
  id: string;
  transactionNumber: string;
  bankAccountId: string;
  date: string;
  type: "credit" | "debit";
  amount: number;
  description: string;
  reference?: string;
  partyName?: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
}

// ==============================
// ACCOUNTING TYPES
// ==============================

export interface JournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  description: string;
  reference?: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  status: "draft" | "posted";
  createdAt: string;
}

export interface JournalLine {
  id: string;
  accountId: string;
  accountName: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  group: string;
  openingBalance: number;
  currentBalance: number;
  status: "active" | "inactive";
}

// ==============================
// GST TYPES
// ==============================

export interface GSTReturn {
  id: string;
  period: string;
  type: "GSTR1" | "GSTR2" | "GSTR3B";
  totalTaxableValue: number;
  totalIGST: number;
  totalCGST: number;
  totalSGST: number;
  totalTax: number;
  status: "draft" | "filed";
  filedDate?: string;
  createdAt: string;
}

// ==============================
// DASHBOARD TYPES
// ==============================

export interface DashboardMetric {
  label: string;
  value: number;
  change: number;
  changeType: "increase" | "decrease";
  icon: string;
  color: string;
  prefix?: string;
  suffix?: string;
}

export interface ChartDataPoint {
  month: string;
  revenue: number;
  expense: number;
  profit: number;
}

// ==============================
// COMPANY SETTINGS TYPES
// ==============================

export interface CompanySettings {
  id: string;
  name: string;
  legalName: string;
  gstin: string;
  pan: string;
  cin?: string;
  address: Address;
  phone: string;
  email: string;
  website?: string;
  logo?: string;
  industry: string;
  financialYear: string;
  currency: string;
  dateFormat: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: "active" | "inactive";
  lastLogin: string;
  createdAt: string;
}
