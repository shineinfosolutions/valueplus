-- Purchase, stock and cash area of docs/D1_MIGRATION_PLAN.md (§4.2, §4.4, §4.5): a COPY of 25 MongoDB collections,
-- filled by lib/d1/sync.ts from the specs in lib/d1/maps/stock-cash.ts. MongoDB stays the only source of truth;
-- nothing in the app reads these tables yet.
--
-- Same conventions as 0001_masters.sql: camelCase Mongo field names, `id` = the Mongo _id (24-hex), every real Date
-- as ISO-8601 UTC text, business dates kept as the Mongo text (YYYY-MM-DD), booleans 0/1, money REAL, `extra` JSON
-- for fields the schema does not know, `docHash` / `syncedAt` for the copy job. Business columns are nullable so odd
-- legacy data never fails the copy. The plan's UNIQUE constraints (billNo-style numbers, codes, dates of day closes,
-- serial numbers, (itemCode, warehouse) of supplier stock, (auditId, productId) of audit lines) are plain indexes
-- for now: autoIndex is off on Workers, so live data may hold duplicates. They become UNIQUE in a later migration
-- once the data is checked.
--
-- Line tables (purchaseEntryItems, stockTransferItems, stockAdjustmentItems, stockJournalItems, inventoryAuditItems):
-- one row per array element, keyed by (parent, lineNo) in array order; `id` is the line subdocument's _id and
-- `extra` holds any key of the line the table does not know. The copy job deletes and re-inserts a parent's lines on
-- every write of the parent. Only these tables are created here, so this file does not depend on 0002.

-- ── Purchasing ──────────────────────────────────────────────────────────────────────────────────────────────────

-- purchase_entries (32 columns)
CREATE TABLE purchaseEntries (
  id TEXT PRIMARY KEY,
  billNo TEXT,
  supplierName TEXT,
  supplierGST TEXT,
  supplierId TEXT,
  warehouse TEXT,
  warehouseId TEXT,
  linkedPoNo TEXT,
  noPoReason TEXT,
  type TEXT,
  billingEntity TEXT,
  billDate TEXT,                -- YYYY-MM-DD text, as in Mongo
  dueDate TEXT,
  subtotal REAL,
  gst REAL,
  total REAL,
  paid REAL,
  balance REAL,
  status TEXT,
  cancelledAt TEXT,
  cancelledBy TEXT,
  cancelReason TEXT,
  lastModifiedReason TEXT,
  backdateStatus TEXT,
  backdateRequestedBy TEXT,
  backdateMadeOn TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX purchaseEntries_billNo ON purchaseEntries(billNo);
CREATE INDEX purchaseEntries_supplier ON purchaseEntries(supplierId);
CREATE INDEX purchaseEntries_supplierName ON purchaseEntries(supplierName);
CREATE INDEX purchaseEntries_billDate ON purchaseEntries(billDate);
CREATE INDEX purchaseEntries_entity ON purchaseEntries(billingEntity);
CREATE INDEX purchaseEntries_status ON purchaseEntries(status);

-- PurchaseEntry.items[]: the stock flow and the product ledger read purchase lines by item.
CREATE TABLE purchaseEntryItems (
  purchaseEntryId TEXT NOT NULL REFERENCES purchaseEntries(id) ON DELETE CASCADE,
  lineNo INTEGER NOT NULL,
  id TEXT,
  itemId TEXT,
  name TEXT,
  quantity REAL,
  rate REAL,
  gstRate REAL,
  hsn TEXT,
  serialNumbers TEXT,           -- JSON array of serial number strings
  extra TEXT,
  PRIMARY KEY (purchaseEntryId, lineNo)
);
CREATE INDEX purchaseEntryItems_item ON purchaseEntryItems(itemId);

-- deleted_purchase_entries (18 columns): strict:false in Mongo, so unknown keys land in `extra`.
CREATE TABLE deletedPurchaseEntries (
  id TEXT PRIMARY KEY,
  billNo TEXT,
  supplierName TEXT,
  total REAL,
  deletedAt TEXT,
  deletedBy TEXT,
  deletedByRole TEXT,
  deletedByUserId TEXT,
  deleteReason TEXT,
  pinVerified INTEGER NOT NULL DEFAULT 0,
  usedLegacyPin INTEGER NOT NULL DEFAULT 0,
  snapshot TEXT,                -- JSON: the whole purchase entry as it was (a few KB)
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX deletedPurchaseEntries_billNo ON deletedPurchaseEntries(billNo);
CREATE INDEX deletedPurchaseEntries_deletedAt ON deletedPurchaseEntries(deletedAt DESC);

-- purchase_orders (16 columns)
CREATE TABLE purchaseOrders (
  id TEXT PRIMARY KEY,
  poNo TEXT,
  supplierName TEXT,
  date TEXT,                    -- a real Date in Mongo: ISO text
  expectedDate TEXT,
  totalAmount REAL,
  subtotal REAL,
  gst REAL,
  status TEXT,
  items TEXT,                   -- JSON: printed and copied into a purchase entry, never aggregated
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX purchaseOrders_poNo ON purchaseOrders(poNo);
CREATE INDEX purchaseOrders_date ON purchaseOrders(date);

-- expenses (14 columns; the model sets no collection name, so mongoose's plural `expenses`)
CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  expenseNo TEXT,
  category TEXT,
  description TEXT,
  amount REAL,
  date TEXT,
  paymentMode TEXT,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX expenses_expenseNo ON expenses(expenseNo);
CREATE INDEX expenses_date ON expenses(date);

-- ── Stock documents ─────────────────────────────────────────────────────────────────────────────────────────────

-- stock_adjustments (11 columns)
CREATE TABLE stockAdjustments (
  id TEXT PRIMARY KEY,
  adjustmentNo TEXT,
  date TEXT,
  reason TEXT,
  warehouseId TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX stockAdjustments_no ON stockAdjustments(adjustmentNo);
CREATE INDEX stockAdjustments_date ON stockAdjustments(date);

CREATE TABLE stockAdjustmentItems (
  stockAdjustmentId TEXT NOT NULL REFERENCES stockAdjustments(id) ON DELETE CASCADE,
  lineNo INTEGER NOT NULL,
  id TEXT,
  itemId TEXT,
  itemName TEXT,
  quantity REAL,
  type TEXT,                    -- in / out
  remarks TEXT,
  extra TEXT,
  PRIMARY KEY (stockAdjustmentId, lineNo)
);
CREATE INDEX stockAdjustmentItems_item ON stockAdjustmentItems(itemId);

-- stock_journals (10 columns)
CREATE TABLE stockJournals (
  id TEXT PRIMARY KEY,
  journalNumber TEXT,
  date TEXT,
  purpose TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX stockJournals_no ON stockJournals(journalNumber);
CREATE INDEX stockJournals_date ON stockJournals(date);

CREATE TABLE stockJournalItems (
  stockJournalId TEXT NOT NULL REFERENCES stockJournals(id) ON DELETE CASCADE,
  lineNo INTEGER NOT NULL,
  id TEXT,
  itemId TEXT,
  itemName TEXT,
  warehouseId TEXT,
  quantity REAL,
  type TEXT,                    -- in / out
  extra TEXT,
  PRIMARY KEY (stockJournalId, lineNo)
);
CREATE INDEX stockJournalItems_item ON stockJournalItems(itemId);

-- stock_order_requests (24 columns)
CREATE TABLE stockOrderRequests (
  id TEXT PRIMARY KEY,
  requestNumber TEXT,
  status TEXT,
  salesperson TEXT,
  salespersonId TEXT,
  note TEXT,
  totalQuantity REAL,
  approvedBy TEXT,
  approvedAt TEXT,
  rejectedBy TEXT,
  rejectedAt TEXT,
  rejectReason TEXT,
  message TEXT,
  sentBy TEXT,
  sentAt TEXT,
  mergedInto TEXT,
  items TEXT,                   -- JSON: lines are edited as a whole set (merge)
  mergedFrom TEXT,              -- JSON array of request numbers, NULL when absent
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX stockOrderRequests_no ON stockOrderRequests(requestNumber);
CREATE INDEX stockOrderRequests_status ON stockOrderRequests(status);
CREATE INDEX stockOrderRequests_salesperson ON stockOrderRequests(salespersonId);

-- stock_requests (13 columns)
CREATE TABLE stockRequests (
  id TEXT PRIMARY KEY,
  requestNumber TEXT,
  date TEXT,
  requestingWarehouseId TEXT,
  supplyingWarehouseId TEXT,
  status TEXT,
  items TEXT,                   -- JSON
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX stockRequests_no ON stockRequests(requestNumber);

-- stock_returns (13 columns)
CREATE TABLE stockReturns (
  id TEXT PRIMARY KEY,
  returnNumber TEXT,
  date TEXT,
  returnType TEXT,
  referenceId TEXT,
  status TEXT,
  items TEXT,                   -- JSON
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX stockReturns_no ON stockReturns(returnNumber);

-- stocktransfers (15 columns; the model sets no collection name, so mongoose's plural `stocktransfers`)
CREATE TABLE stockTransfers (
  id TEXT PRIMARY KEY,
  transferNo TEXT,
  fromWarehouse TEXT,
  toWarehouse TEXT,
  fromWarehouseId TEXT,
  toWarehouseId TEXT,
  totalValue REAL,
  date TEXT,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX stockTransfers_no ON stockTransfers(transferNo);
CREATE INDEX stockTransfers_date ON stockTransfers(date);

-- StockTransfer.items[]: the product ledger and the stock flow read transfer lines by item.
CREATE TABLE stockTransferItems (
  stockTransferId TEXT NOT NULL REFERENCES stockTransfers(id) ON DELETE CASCADE,
  lineNo INTEGER NOT NULL,
  id TEXT,
  itemId TEXT,
  itemName TEXT,
  quantity REAL,
  unit TEXT,
  costPrice REAL,
  extra TEXT,
  PRIMARY KEY (stockTransferId, lineNo)
);
CREATE INDEX stockTransferItems_item ON stockTransferItems(itemId);

-- serial_numbers (22 columns)
CREATE TABLE serialNumbers (
  id TEXT PRIMARY KEY,
  serialNumber TEXT,
  itemId TEXT,
  vpCode TEXT,
  itemName TEXT,
  batchNo TEXT,
  status TEXT,
  warehouse TEXT,
  purchaseEntryId TEXT,
  invoiceId TEXT,
  invoiceNumber TEXT,
  customerName TEXT,
  customerPhone TEXT,
  soldDate TEXT,
  price REAL,
  history TEXT,                 -- JSON: only displayed
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX serialNumbers_serial ON serialNumbers(serialNumber);
CREATE INDEX serialNumbers_item ON serialNumbers(itemId);
CREATE INDEX serialNumbers_vpCode ON serialNumbers(vpCode);
CREATE INDEX serialNumbers_status ON serialNumbers(status);
CREATE INDEX serialNumbers_invoice ON serialNumbers(invoiceNumber);

-- inventory_audits (21 columns). The ~450 counted lines live in inventoryAuditItems, so the parent row stays small
-- (far under D1's 2 MB row limit) and several staff can count at once with row-level updates later.
CREATE TABLE inventoryAudits (
  id TEXT PRIMARY KEY,
  auditDate TEXT,
  auditor TEXT,
  category TEXT,
  totalExpected REAL,
  totalPhysical REAL,
  totalDiscrepancy REAL,
  status TEXT,
  auditorId TEXT,
  completedBy TEXT,
  completedAt TEXT,
  warehouse TEXT,
  kind TEXT,
  completionTime TEXT,
  notes TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX inventoryAudits_date ON inventoryAudits(auditDate);
CREATE INDEX inventoryAudits_status ON inventoryAudits(status);
CREATE INDEX inventoryAudits_kind ON inventoryAudits(kind);

CREATE TABLE inventoryAuditItems (
  auditId TEXT NOT NULL REFERENCES inventoryAudits(id) ON DELETE CASCADE,
  lineNo INTEGER NOT NULL,
  id TEXT,
  productId TEXT,
  productName TEXT,
  vpCode TEXT,
  category TEXT,
  expectedStock REAL,
  physicalStock REAL,
  difference REAL,
  condition TEXT,
  remarks TEXT,
  counted INTEGER NOT NULL DEFAULT 0,
  countedBy TEXT,
  countedAt TEXT,
  extra TEXT,
  PRIMARY KEY (auditId, lineNo)
);
CREATE INDEX inventoryAuditItems_product ON inventoryAuditItems(auditId, productId);
CREATE INDEX inventoryAuditItems_counted ON inventoryAuditItems(auditId, counted);

-- bill_of_materials (13 columns; unused module, kept so the copy is complete)
CREATE TABLE billOfMaterials (
  id TEXT PRIMARY KEY,
  bomNumber TEXT,
  finishedGoodItemId TEXT,
  finishedGoodName TEXT,
  expectedQuantity REAL,
  totalCost REAL,
  components TEXT,              -- JSON
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX billOfMaterials_no ON billOfMaterials(bomNumber);

-- supplier_stock_items (19 columns)
CREATE TABLE supplierStockItems (
  id TEXT PRIMARY KEY,
  itemCode TEXT,
  description TEXT,
  brand TEXT,
  groupName TEXT,
  productDesc TEXT,
  charDesc TEXT,
  warehouse TEXT,
  availableStock REAL,
  previousStock REAL,
  isNewArrival INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  uploadId TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX supplierStockItems_code_wh ON supplierStockItems(itemCode, warehouse);
CREATE INDEX supplierStockItems_active ON supplierStockItems(active);

-- supplier_stock_uploads (13 columns)
CREATE TABLE supplierStockUploads (
  id TEXT PRIMARY KEY,
  fileName TEXT,
  uploadedBy TEXT,
  uploadedByRole TEXT,
  rowCount REAL,
  newProducts REAL,
  totalUnits REAL,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX supplierStockUploads_created ON supplierStockUploads(createdAt DESC);

-- ── Vendors (parties that buy from us on account) ───────────────────────────────────────────────────────────────

-- vendors (32 columns): address and bankDetails flattened
CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT,
  nameLower TEXT NOT NULL DEFAULT '',
  contactPerson TEXT,
  email TEXT,
  phone TEXT,
  altPhone TEXT,
  gstNumber TEXT,
  panNumber TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_pincode TEXT,
  address_country TEXT,
  creditLimit REAL,
  creditDays REAL,
  openingBalance REAL,
  openingBalanceDate TEXT,
  bank_bankName TEXT,
  bank_accountNumber TEXT,
  bank_ifscCode TEXT,
  bank_accountType TEXT,
  notes TEXT,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX vendors_code ON vendors(code);
CREATE INDEX vendors_name ON vendors(name COLLATE NOCASE);
CREATE INDEX vendors_phone ON vendors(phone);

-- vendor_bills (24 columns)
CREATE TABLE vendorBills (
  id TEXT PRIMARY KEY,
  billNo TEXT,
  vendorId TEXT,
  vendorName TEXT,
  date TEXT,
  dueDate TEXT,
  subtotal REAL,
  gstRate REAL,
  gstAmount REAL,
  total REAL,
  notes TEXT,
  reference TEXT,
  status TEXT,
  cancelledAt TEXT,
  cancelledBy TEXT,
  cancelReason TEXT,
  createdBy TEXT,
  items TEXT,                   -- JSON
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX vendorBills_billNo ON vendorBills(billNo);
CREATE INDEX vendorBills_vendor_date ON vendorBills(vendorId, date DESC);
CREATE INDEX vendorBills_status ON vendorBills(status);

-- vendor_payments (20 columns)
CREATE TABLE vendorPayments (
  id TEXT PRIMARY KEY,
  paymentId TEXT,
  vendorId TEXT,
  vendorName TEXT,
  date TEXT,
  amount REAL,
  mode TEXT,
  refNo TEXT,
  againstBillNo TEXT,
  receivedBy TEXT,
  notes TEXT,
  type TEXT,
  createdBy TEXT,
  createdByRole TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX vendorPayments_paymentId ON vendorPayments(paymentId);
CREATE INDEX vendorPayments_vendor_date ON vendorPayments(vendorId, date DESC);
CREATE INDEX vendorPayments_type ON vendorPayments(type);

-- ── Cash ────────────────────────────────────────────────────────────────────────────────────────────────────────

-- cash_transactions (22 columns) [HOT: the dashboard cash card]
CREATE TABLE cashTransactions (
  id TEXT PRIMARY KEY,
  type TEXT,
  category TEXT,
  amount REAL,
  date TEXT,                    -- YYYY-MM-DD text
  time TEXT,
  referenceNo TEXT,
  description TEXT,
  partyName TEXT,
  targetBankAccount TEXT,
  handedTo TEXT,
  recordedBy TEXT,
  adminStatus TEXT,
  adminReviewedBy TEXT,
  adminReviewedAt TEXT,
  adminRejectReason TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX cashTransactions_date ON cashTransactions(date);
CREATE INDEX cashTransactions_category_date ON cashTransactions(category, date);
CREATE INDEX cashTransactions_adminStatus ON cashTransactions(adminStatus);
CREATE INDEX cashTransactions_ref ON cashTransactions(referenceNo);

-- day_closes (26 columns)
CREATE TABLE dayCloses (
  id TEXT PRIMARY KEY,
  date TEXT,
  openingCash REAL,
  systemExpectedCash REAL,
  systemOpeningCash REAL,
  dayCashIn REAL,
  dayCashFromInvoices REAL,
  dayCashOut REAL,
  originalSystemExpectedCash REAL,
  originalDifference REAL,
  recalculatedAt TEXT,
  recalculatedBy TEXT,
  countedCash REAL,
  denominations TEXT,           -- JSON [{value, count}]: at most ~10 notes, always read with the day
  coinsAmount REAL,
  difference REAL,
  notes TEXT,
  closedBy TEXT,
  closedByRole TEXT,
  closedAt TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX dayCloses_date ON dayCloses(date);

-- admin_cash_entries (21 columns)
CREATE TABLE adminCashEntries (
  id TEXT PRIMARY KEY,
  type TEXT,
  amount REAL,
  date TEXT,
  time TEXT,
  bankAccountId TEXT,
  bankAccount TEXT,
  referenceNo TEXT,
  description TEXT,
  recordedBy TEXT,
  recordedByUserId TEXT,
  voided INTEGER NOT NULL DEFAULT 0,
  voidedBy TEXT,
  voidedAt TEXT,
  voidReason TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX adminCashEntries_type ON adminCashEntries(type);
CREATE INDEX adminCashEntries_date ON adminCashEntries(date);

-- bank_accounts (15 columns)
CREATE TABLE bankAccounts (
  id TEXT PRIMARY KEY,
  name TEXT,
  bank TEXT,
  number TEXT,
  ifsc TEXT,
  branch TEXT,
  type TEXT,
  balance REAL,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX bankAccounts_status ON bankAccounts(status);

-- cash_register_settings (12 columns; a singleton per key)
CREATE TABLE cashRegisterSettings (
  id TEXT PRIMARY KEY,
  key TEXT,
  openingCash REAL,
  countedCash REAL,
  calibratedBy TEXT,
  calibratedAt TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX cashRegisterSettings_key ON cashRegisterSettings(key);

-- ── Small masters used by purchasing ────────────────────────────────────────────────────────────────────────────

-- variants (10 columns). Variant.values is stored in `valuesJson`: VALUES is a reserved SQL word and the copy job
-- writes column names unquoted.
CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  name TEXT,
  valuesJson TEXT,              -- JSON array of strings (Mongo field `values`)
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX variants_name ON variants(name);

-- product_catalog_references (14 columns)
CREATE TABLE productCatalogReferences (
  id TEXT PRIMARY KEY,
  vpCode TEXT,
  description TEXT,
  brand TEXT,
  groupName TEXT,
  category TEXT,
  productDesc TEXT,
  charDesc TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX productCatalogReferences_vpCode ON productCatalogReferences(vpCode);
