-- Stage A of docs/D1_MIGRATION_PLAN.md, SALES & MONEY area (plan §4.3, §4.5): the tables lib/d1/sync.ts fills as a
-- COPY of MongoDB, mapped by lib/d1/maps/sales.ts. MongoDB stays the only source of truth; nothing reads these yet.
--
-- Same conventions as 0001_masters.sql: camelCase Mongo field names, `id` = the Mongo _id (24-hex), Dates as ISO-8601
-- UTC text (Mongo String fields such as invoices.date "YYYY-MM-DD" are copied verbatim), booleans 0/1, money REAL,
-- JSON text for display-only arrays and free-form objects, `extra` (JSON) for any top-level field the mapping does not
-- know, docHash / syncedAt for the copy job. Business columns are nullable so odd legacy data never fails the copy.
--
-- Invoice (~130 top-level fields) is split per the plan: `invoices` (lists, filters, totals; 90 columns),
-- `invoiceFinance` and `invoiceDelivery` (1:1, keyed by invoiceId, written only when the bill has any of their
-- fields), `invoiceItems` (lines) and `invoicePayments` (split payments). Child rows are deleted and re-inserted on
-- every copy of the parent. Child tables have their own `extra` (JSON) for keys an array element carries beyond the
-- mapped ones; an element that is not an object is kept as {"$value": ...} and a field that should be an array but
-- is not as one row with idx -1 and {"$raw": ...}.
--
-- The plan's UNIQUE constraints (invoiceNumber, transactionId, receiptNumber, estimateNumber, orderNo, challanNo,
-- ewayBillNo, doId, warrantyId, activityId, gstin, the pending-per-target rule on storeActivityApprovals) are plain
-- indexes for now, as in 0001: live data may hold duplicates. invoiceItems.id (the line's own _id) is not a key
-- either: a credit note copied from a bill can carry the same line _ids, so lines are keyed by (invoiceId, lineNo).
-- storeActivityApprovals.payloadKind / payloadTarget are ordinary columns the copy fills from payload.kind / .target
-- (instead of the plan's generated columns, so the copy job's plain INSERT works unchanged).

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  invoiceNumber TEXT,
  type TEXT,
  customerId TEXT,
  customerName TEXT,
  customerGST TEXT,
  customerPAN TEXT,
  customerCompanyName TEXT,
  customerPhone TEXT,
  customerAltPhone TEXT,
  customerEmail TEXT,
  customerAddress TEXT,
  customerCity TEXT,
  customerState TEXT,
  customerPin TEXT,
  placeOfSupply TEXT,
  vehicleNumber TEXT,
  shippingAddress TEXT,
  warehouseId TEXT,
  billingEntity TEXT,
  date TEXT,
  dueDate TEXT,
  status TEXT,
  subtotal REAL,
  discount REAL,
  taxableAmount REAL,
  cgst REAL,
  sgst REAL,
  igst REAL,
  totalGST REAL,
  extendedWarrantyTotal REAL,
  roundOff REAL,
  total REAL,
  paidAmount REAL,
  balanceAmount REAL,
  paymentMode TEXT,
  paymentTerms TEXT,
  cashReceivedBy TEXT,
  upiTxnId TEXT,
  onlineTxnId TEXT,
  onlineGateway TEXT,
  financeProvider TEXT,
  financeDoId TEXT,
  financeApprovalStatus TEXT,
  downPayment REAL,
  downPaymentMode TEXT,
  shippingCharges REAL,
  freightCharges REAL,
  freightPaidBy TEXT,
  dueAdvanceAmount REAL,
  dueAdvanceMode TEXT,
  dueClearedAt TEXT,
  dueClearedMode TEXT,
  dueClearedBy TEXT,
  dueClearedNotes TEXT,
  dueClearedTxnId TEXT,
  dueClearedBankAccountId TEXT,
  dueClearedBankAccount TEXT,
  advanceAdjusted REAL,
  advanceReceiptNo TEXT,
  advanceTransactionId TEXT,
  creditAdjusted REAL,
  dispatchType TEXT,
  deliveryStatus TEXT,
  expectedDeliveryDate TEXT,
  deliveredAt TEXT,
  backdateStatus TEXT,
  backdateRequestedBy TEXT,
  backdateMadeOn TEXT,
  deliveryChallanNo TEXT,
  creditNoteRef TEXT,
  notes TEXT,
  salesExecutive TEXT,
  salesExecutiveIncentive REAL,
  onsitegoIncentive REAL,
  adminOverridePinUsed INTEGER NOT NULL DEFAULT 0,
  reprintCount REAL,
  lastPrintedAt TEXT,
  printLogs TEXT,  -- JSON
  lastModifiedReason TEXT,
  cancelledAt TEXT,
  cancelledBy TEXT,
  cancelReason TEXT,
  offlineId TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE paymentTransactions (
  id TEXT PRIMARY KEY,
  transactionId TEXT,
  partyId TEXT,
  partyType TEXT,
  partyName TEXT,
  amount REAL,
  paymentMode TEXT,
  date TEXT,
  referenceId TEXT,
  notes TEXT,
  receivedBy TEXT,
  balanceAfter REAL,
  type TEXT,
  bankAccountId TEXT,
  bankAccountRef TEXT,
  bankTxnRef TEXT,
  lastEditedAt TEXT,
  lastEditedBy TEXT,
  editCount REAL,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE customerAdvances (
  id TEXT PRIMARY KEY,
  receiptNumber TEXT,
  customerId TEXT,
  customerName TEXT,
  customerPhone TEXT,
  customerEmail TEXT,
  customerAddress TEXT,
  amount REAL,
  paymentMode TEXT,
  transactionRef TEXT,
  productBooked TEXT,
  targetBrand TEXT,
  targetCategory TEXT,
  notes TEXT,
  reason TEXT,
  status TEXT,
  usedAmount REAL,
  remainingBalance REAL,
  linkedInvoiceNumber TEXT,
  branchName TEXT,
  receivedBy TEXT,
  date TEXT,
  time TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE estimates (
  id TEXT PRIMARY KEY,
  estimateNumber TEXT,
  date TEXT,
  expiryDate TEXT,
  customerName TEXT,
  customerPhone TEXT,
  customerAddress TEXT,
  customerGST TEXT,
  customerCompanyName TEXT,
  salesExecutive TEXT,
  salesperson TEXT,
  status TEXT,
  subTotal REAL,
  taxTotal REAL,
  total REAL,
  notes TEXT,
  convertedInvoiceNumber TEXT,
  kind TEXT,
  approvalStatus TEXT,
  approvedBy TEXT,
  approvedAt TEXT,
  rejectedBy TEXT,
  rejectedAt TEXT,
  rejectReason TEXT,
  dealAmount REAL,
  dealSalesperson TEXT,
  advanceAmount REAL,
  advanceMode TEXT,
  advanceTxnRef TEXT,
  financeProvider TEXT,
  financeDoId TEXT,
  financeAppId TEXT,
  financeDownPayment REAL,
  financeTenureMonths REAL,
  financeInterestRate REAL,
  financePdfUrl TEXT,
  financePdfUrls TEXT,  -- JSON
  financeDoData TEXT,  -- JSON
  priceUnlock TEXT,  -- JSON
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE salesOrders (
  id TEXT PRIMARY KEY,
  orderNo TEXT,
  date TEXT,
  customerName TEXT,
  deliveryDate TEXT,
  itemsCount REAL,
  totalAmount REAL,
  paidAmount REAL,
  balanceAmount REAL,
  paymentStatus TEXT,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE deletedInvoices (
  id TEXT PRIMARY KEY,
  invoiceNumber TEXT,
  docType TEXT,
  customerName TEXT,
  total REAL,
  deletedAt TEXT,
  deletedBy TEXT,
  deletedByRole TEXT,
  deletedByUserId TEXT,
  deleteReason TEXT,
  pinVerified INTEGER NOT NULL DEFAULT 0,
  usedLegacyPin INTEGER NOT NULL DEFAULT 0,
  snapshot TEXT,  -- JSON
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE deliveryChallans (
  id TEXT PRIMARY KEY,
  challanNo TEXT,
  type TEXT,
  invoiceNumber TEXT,
  sourceParty TEXT,
  sourceAddress TEXT,
  sourcePhone TEXT,
  destinationParty TEXT,
  destinationAddress TEXT,
  customerPhone TEXT,
  itemName TEXT,
  vpCode TEXT,
  hsn TEXT,
  serialImei TEXT,
  quantity REAL,
  unit TEXT,
  itemPrice REAL,
  defectDescription TEXT,
  financeDoId TEXT,
  reason TEXT,
  date TEXT,
  vehicleNo TEXT,
  transporterName TEXT,
  driverName TEXT,
  driverPhone TEXT,
  ewayBillNo TEXT,
  flowType TEXT,
  claimStatus TEXT,
  settledAt TEXT,
  settledBy TEXT,
  creditAmount REAL,
  replacementItemId TEXT,
  replacementItemName TEXT,
  replacementSerial TEXT,
  itemId TEXT,
  supplierId TEXT,
  warehouse TEXT,
  settlementNote TEXT,
  createdBy TEXT,
  approvalStatus TEXT,
  approvedAt TEXT,
  approvedBy TEXT,
  creditNoteRef TEXT,
  debitNoteRef TEXT,
  deliveryOtp TEXT,
  deliveredAt TEXT,
  deliveryProofKey TEXT,
  deliveryProofKeys TEXT,  -- JSON
  autoFromBill INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  remarks TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE ewayBills (
  id TEXT PRIMARY KEY,
  ewayBillNo TEXT,
  invoiceNumber TEXT,
  customerName TEXT,
  customerGstin TEXT,
  deliveryAddress TEXT,
  vehicleNumber TEXT,
  transporterName TEXT,
  transporterId TEXT,
  taxableValue REAL,
  totalGst REAL,
  totalAmount REAL,
  status TEXT,
  generatedDate TEXT,
  validUntil TEXT,
  errorDetails TEXT,
  items TEXT,  -- JSON
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE financeTransactions (
  id TEXT PRIMARY KEY,
  financeProvider TEXT,
  customerName TEXT,
  customerId TEXT,
  customerMobile TEXT,
  deliveryAddress TEXT,
  invoiceNumber TEXT,
  atosDealId TEXT,
  doId TEXT,
  date TEXT,
  assetCategory TEXT,
  oemCategory TEXT,
  manufacturer TEXT,
  brand TEXT,
  productModel TEXT,
  eanNumber TEXT,
  schemeCode TEXT,
  productPrice REAL,
  grossLoanAmount REAL,
  netLoanAmount REAL,
  marginMoney REAL,
  advanceEmi REAL,
  serviceCharge REAL,
  upfrontInterest REAL,
  dealerInterestSubsidy REAL,
  dealerSubsidyPercent REAL,
  mbdFromDealer REAL,
  cardCharges REAL,
  creditSurakshaFees REAL,
  healthCardCharges REAL,
  totalEmi REAL,
  totalGst REAL,
  convenienceFee REAL,
  cashback REAL,
  customerDownPayment REAL,
  totalDeductions REAL,
  netDisbursement REAL,
  tenureMonths REAL,
  monthlyEmiAmount REAL,
  totalPaidEmiAmount REAL,
  balanceDueAmount REAL,
  approvalStatus TEXT,
  uploadedPdfUrl TEXT,
  uploadedPdfUrls TEXT,  -- JSON
  approvedBy TEXT,
  approvalDate TEXT,
  actualReceivedAmount REAL,
  bankAccountRef TEXT,
  bankAccountId TEXT,
  transactionRef TEXT,
  paymentReceivedDate TEXT,
  remarks TEXT,
  deliveryInstructions TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE extendedWarranties (
  id TEXT PRIMARY KEY,
  warrantyId TEXT,
  customerName TEXT,
  customerPhone TEXT,
  customerEmail TEXT,
  invoiceNumber TEXT,
  itemId TEXT,
  productName TEXT,
  vpCode TEXT,
  serialNumber TEXT,
  planName TEXT,
  durationMonths REAL,
  startDate TEXT,
  endDate TEXT,
  warrantyAmount REAL,
  salesStaff TEXT,
  status TEXT,
  remarks TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE discountApprovals (
  id TEXT PRIMARY KEY,
  requestedBy TEXT,
  requestedById TEXT,
  requestedByRole TEXT,
  context TEXT,
  customerName TEXT,
  itemId TEXT,
  itemName TEXT,
  brand TEXT,
  sellingPrice REAL,
  price REAL,
  quantity REAL,
  percent REAL,
  tier TEXT,
  status TEXT,
  reviewedBy TEXT,
  reviewedAt TEXT,
  reviewNote TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE storeActivityApprovals (
  id TEXT PRIMARY KEY,
  activityId TEXT,
  storeName TEXT,
  storeInchargeName TEXT,
  storeInchargeEmail TEXT,
  activityType TEXT,
  title TEXT,
  description TEXT,
  amount REAL,
  payload TEXT,  -- JSON
  status TEXT,
  superAdminActionAt TEXT,
  superAdminNotes TEXT,
  payloadKind TEXT,
  payloadTarget TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

CREATE TABLE billingCompanies (
  id TEXT PRIMARY KEY,
  gstin TEXT,
  companyName TEXT,
  pan TEXT,
  usageCount REAL,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

-- Invoice.items[]: one row per line, lineNo = array position (storeExit.lines[].lineIndex refers to it).
CREATE TABLE invoiceItems (
  id TEXT,                  -- the line's own _id (not unique: see the header)
  invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  lineNo INTEGER NOT NULL,
  itemId TEXT,
  itemName TEXT,
  itemCode TEXT,
  vpCode TEXT,
  description TEXT,
  hsn TEXT,
  quantity REAL,
  unit TEXT,
  rate REAL,
  minSellingPrice REAL,
  costPrice REAL,
  adminOverrideRate INTEGER NOT NULL DEFAULT 0,
  incentiveTargetAmount REAL,
  incentiveAmount REAL,
  incentiveType TEXT,
  incentiveValue REAL,
  incentiveEarned REAL,
  incentiveRules TEXT,      -- JSON
  salesExecutive TEXT,
  discount REAL,
  discountType TEXT,
  taxableAmount REAL,
  gstRate REAL,
  cgst REAL,
  sgst REAL,
  igst REAL,
  amount REAL,
  serialNumber TEXT,
  batchNumber TEXT,
  extendedWarrantyProvider TEXT,
  extendedWarrantyPlan TEXT,
  extendedWarrantyAmount REAL,
  extendedWarrantyDuration REAL,
  extendedWarrantyPolicyNo TEXT,
  stockWarehouseId TEXT,
  extra TEXT,
  PRIMARY KEY (invoiceId, lineNo)
);

-- Invoice.payments[]: split payments (subdocuments have no _id), idx = array position.
CREATE TABLE invoicePayments (
  invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  mode TEXT,
  amount REAL,
  txnId TEXT,
  reference TEXT,
  receivedBy TEXT,
  notes TEXT,
  extra TEXT,
  PRIMARY KEY (invoiceId, idx)
);

-- Card and finance detail of a bill (1:1). financeProvider / financeDoId / financeApprovalStatus stay on invoices.
CREATE TABLE invoiceFinance (
  invoiceId TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  cardCategory TEXT,
  cardAmount REAL,
  cardType TEXT,
  cardTxnId TEXT,
  cardLast4 TEXT,
  cardMdrPercent REAL,
  cardMdrAmount REAL,
  cardNetSettlement REAL,
  financeAppId TEXT,
  financeGrossLoan REAL,
  financeNetLoan REAL,
  financeMarginMoney REAL,
  financeDownPayment REAL,
  financeDownPaymentMode TEXT,
  financeDealerSubsidy REAL,
  financeExpectedDisbursement REAL,
  financeActualDisbursement REAL,
  financePdfUrl TEXT,
  financePdfUrls TEXT,      -- JSON
  financeDos TEXT,          -- JSON
  financeApprovedBy TEXT,
  financeApprovalDate TEXT,
  financeBankRef TEXT,
  financeBankAccountId TEXT,
  financeBankAccount TEXT,
  financePayoutDate TEXT,
  financeTenureMonths REAL,
  financeSchemeType TEXT,
  financeInterestRate REAL,
  monthlyEMI REAL,
  totalInterest REAL
);

-- The delivery workflow of a bill (1:1): shipping address, OTP, proofs, store exit.
CREATE TABLE invoiceDelivery (
  invoiceId TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  isShippingSameAsBilling INTEGER NOT NULL DEFAULT 0,
  shippingStreet TEXT,
  shippingCity TEXT,
  shippingState TEXT,
  shippingPin TEXT,
  deliveryOtp TEXT,
  deliveryNote TEXT,
  deliveryReminderSentAt TEXT,
  driverName TEXT,
  driverPhone TEXT,
  driverVehicleNo TEXT,
  deliveryProofKey TEXT,
  deliveryProofKeys TEXT,   -- JSON
  receivedBySelf INTEGER NOT NULL DEFAULT 0,
  receivedBySelfBy TEXT,
  deliverySerial TEXT,
  deliverySerialMatched INTEGER NOT NULL DEFAULT 0,
  deliveryProofAt TEXT,
  deliveryProofBy TEXT,
  storeExit TEXT            -- JSON
);

-- Estimate.items[] (subdocuments have no _id).
CREATE TABLE estimateItems (
  estimateId TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  itemCode TEXT,
  name TEXT,
  quantity REAL,
  rate REAL,
  discount REAL,
  itemId TEXT,
  tax REAL,
  amount REAL,
  extra TEXT,
  PRIMARY KEY (estimateId, idx)
);

-- FinanceTransaction.emiSchedule[]: EMI cycles and overdue lists filter by due date and status.
CREATE TABLE financeEmiInstallments (
  financeId TEXT NOT NULL REFERENCES financeTransactions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  installmentNumber REAL,
  dueDate TEXT,
  amount REAL,
  status TEXT,
  paidDate TEXT,
  paymentChannel TEXT,
  paymentMode TEXT,
  collectedBy TEXT,
  bankRef TEXT,
  receiptNumber TEXT,
  bounceReason TEXT,
  penaltyAmount REAL,
  notes TEXT,
  extra TEXT,
  PRIMARY KEY (financeId, idx)
);

-- FinanceTransaction.linkedInvoices[]: other bills financed under the same DO (settlement looks up by invoice).
CREATE TABLE financeLinkedInvoices (
  financeId TEXT NOT NULL REFERENCES financeTransactions(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  invoiceNumber TEXT,
  amount REAL,
  linkedAt TEXT,
  extra TEXT,
  PRIMARY KEY (financeId, idx)
);

-- Indexes: the Mongo index list plus the plan's hot paths (plain, non-unique).
CREATE INDEX invoices_invoiceNumber ON invoices(invoiceNumber);
CREATE INDEX invoices_offlineId ON invoices(offlineId) WHERE offlineId IS NOT NULL;
CREATE INDEX invoices_customerId ON invoices(customerId);
CREATE INDEX invoices_customerPhone ON invoices(customerPhone);
CREATE INDEX invoices_customerName ON invoices(customerName COLLATE NOCASE);
CREATE INDEX invoices_date ON invoices(date DESC, createdAt DESC);
CREATE INDEX invoices_type_created ON invoices(type, createdAt DESC);
CREATE INDEX invoices_status ON invoices(status);
CREATE INDEX invoices_billingEntity ON invoices(billingEntity);
CREATE INDEX invoices_warehouseId ON invoices(warehouseId);
CREATE INDEX invoices_financeDoId ON invoices(financeDoId);
CREATE INDEX invoices_expectedDeliveryDate ON invoices(expectedDeliveryDate);
CREATE INDEX invoices_dueDate ON invoices(dueDate);
CREATE INDEX invoices_delayed_delivery ON invoices(deliveryStatus) WHERE dispatchType = 'delayed_delivery';
CREATE INDEX invoiceItems_itemId ON invoiceItems(itemId);
CREATE INDEX invoiceItems_serialNumber ON invoiceItems(serialNumber) WHERE serialNumber <> '';
CREATE INDEX invoiceItems_salesExecutive ON invoiceItems(salesExecutive);

CREATE INDEX paymentTransactions_transactionId ON paymentTransactions(transactionId);
CREATE INDEX paymentTransactions_party_date ON paymentTransactions(partyId, date);
CREATE INDEX paymentTransactions_date ON paymentTransactions(date);
CREATE INDEX paymentTransactions_referenceId ON paymentTransactions(referenceId);

CREATE INDEX customerAdvances_receiptNumber ON customerAdvances(receiptNumber);
CREATE INDEX customerAdvances_phone_status ON customerAdvances(customerPhone, status);
CREATE INDEX customerAdvances_date ON customerAdvances(date DESC, createdAt DESC);
CREATE INDEX customerAdvances_linkedInvoiceNumber ON customerAdvances(linkedInvoiceNumber);
CREATE INDEX customerAdvances_customerId ON customerAdvances(customerId);

CREATE INDEX estimates_estimateNumber ON estimates(estimateNumber);
CREATE INDEX estimates_approvalStatus ON estimates(approvalStatus);
CREATE INDEX estimates_salesperson ON estimates(salesperson);
CREATE INDEX estimates_customerPhone ON estimates(customerPhone);

CREATE INDEX salesOrders_orderNo ON salesOrders(orderNo);

CREATE INDEX deletedInvoices_invoiceNumber ON deletedInvoices(invoiceNumber);
CREATE INDEX deletedInvoices_deletedAt ON deletedInvoices(deletedAt DESC);

CREATE INDEX deliveryChallans_challanNo ON deliveryChallans(challanNo);
CREATE INDEX deliveryChallans_invoiceNumber ON deliveryChallans(invoiceNumber);
CREATE INDEX deliveryChallans_flowType ON deliveryChallans(flowType);
CREATE INDEX deliveryChallans_claimStatus ON deliveryChallans(claimStatus);
CREATE INDEX deliveryChallans_approvalStatus ON deliveryChallans(approvalStatus);

CREATE INDEX ewayBills_ewayBillNo ON ewayBills(ewayBillNo);
CREATE INDEX ewayBills_invoiceNumber ON ewayBills(invoiceNumber);
CREATE INDEX ewayBills_status ON ewayBills(status);

CREATE INDEX financeTransactions_doId ON financeTransactions(doId);
CREATE INDEX financeTransactions_invoiceNumber ON financeTransactions(invoiceNumber);
CREATE INDEX financeTransactions_customerMobile ON financeTransactions(customerMobile);
CREATE INDEX financeTransactions_approvalStatus ON financeTransactions(approvalStatus);
CREATE INDEX financeEmiInstallments_due_status ON financeEmiInstallments(dueDate, status);
CREATE INDEX financeLinkedInvoices_invoiceNumber ON financeLinkedInvoices(invoiceNumber);

CREATE INDEX extendedWarranties_warrantyId ON extendedWarranties(warrantyId);
CREATE INDEX extendedWarranties_invoiceNumber ON extendedWarranties(invoiceNumber);
CREATE INDEX extendedWarranties_customerPhone ON extendedWarranties(customerPhone);
CREATE INDEX extendedWarranties_vpCode ON extendedWarranties(vpCode);

CREATE INDEX discountApprovals_requestedById ON discountApprovals(requestedById);
CREATE INDEX discountApprovals_tier_status ON discountApprovals(tier, status);

CREATE INDEX storeActivityApprovals_activityId ON storeActivityApprovals(activityId);
CREATE INDEX storeActivityApprovals_status ON storeActivityApprovals(status);
CREATE INDEX storeActivityApprovals_activityType ON storeActivityApprovals(activityType);
CREATE INDEX storeActivityApprovals_storeName ON storeActivityApprovals(storeName);
CREATE INDEX storeActivityApprovals_pending_target ON storeActivityApprovals(payloadTarget) WHERE status = 'pending';

CREATE INDEX billingCompanies_gstin ON billingCompanies(gstin);
