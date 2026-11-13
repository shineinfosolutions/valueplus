-- Phase 1 of docs/D1_MIGRATION_PLAN.md: the master-data tables, filled as a COPY of MongoDB by lib/d1/sync.ts.
-- MongoDB stays the only source of truth; nothing in the app reads these tables yet.
--
-- Conventions (plan §4.1):
--  - column names are the Mongo field names (camelCase); `_id` becomes `id` and keeps the same 24-hex string;
--  - 1:1 subdocuments are flattened (billing_line1 ...), arrays that are queried become child tables (itemStock,
--    itemSupplierCodes), arrays that are always read with the parent are JSON text (incentives, warrantyPlans);
--  - every Date is ISO-8601 UTC text with milliseconds, booleans are 0/1, money is REAL;
--  - `extra` holds (as JSON) any top-level field the schema does not know, so the copy loses nothing;
--  - `docHash` is the SHA-256 of the normalised Mongo document (lib/d1/masters-map.ts), so a row can be compared
--    with its source without reading every column; `syncedAt` is when the copy job last wrote the row.
--
-- Business columns are nullable on purpose: a field missing in Mongo is copied as NULL instead of failing the copy.
-- The UNIQUE constraints the plan lists (items.code, customers.code, brands.name, units.name/shortName,
-- warehouses.code, suppliers.code) are plain indexes for now: autoIndex is off on Workers, so live data may already
-- hold duplicates (memory §18: customer codes used to collide). They become UNIQUE in a later migration, after the
-- duplicates are found and fixed in Mongo.

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  code TEXT,
  vpCode TEXT,
  name TEXT,
  nameLower TEXT NOT NULL DEFAULT '',
  description TEXT,
  category TEXT,
  brand TEXT,
  unit TEXT,
  hsnCode TEXT,
  gstRate REAL,
  purchasePrice REAL,
  purchaseIncludesGst INTEGER NOT NULL DEFAULT 0,
  sellingPrice REAL,
  vsp REAL,
  vspUpdatedAt TEXT,
  vspUpdatedBy TEXT,
  vspUpdatedFrom TEXT,
  billingEntity TEXT,
  minSellingPrice REAL,
  lockedMinPrice REAL,
  priceLockedBy TEXT,
  priceLockedAt TEXT,
  maxDiscountPercent REAL,
  maxDiscountAmount REAL,
  incentiveTargetAmount REAL,
  incentiveAmount REAL,
  incentiveType TEXT,
  incentiveValue REAL,
  incentives TEXT,          -- JSON array, or NULL when the field is absent
  mrp REAL,
  openingStock REAL,
  currentStock REAL,
  showroomStock REAL,
  godownStock REAL,
  reorderLevel REAL,
  warehouse TEXT,
  mergedIntoItemId TEXT,
  status TEXT,
  imageUrl TEXT,
  isSerialized INTEGER NOT NULL DEFAULT 0,
  isBatchTracked INTEGER NOT NULL DEFAULT 0,
  batchNumber TEXT,
  warrantyPlans TEXT,       -- JSON array, or NULL when the field is absent
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX items_code ON items(code);
CREATE INDEX items_vpCode ON items(vpCode);
CREATE INDEX items_cat_brand ON items(category, brand);
CREATE INDEX items_status_wh ON items(status, warehouse);
CREATE INDEX items_stock_name ON items(currentStock DESC, name);
CREATE INDEX items_entity ON items(billingEntity);

-- Item.stockByWarehouse[]: the real per-warehouse stock. A legacy item listing the same warehouse twice is stored
-- once, with the quantities added (that is how lib/stock.ts totals them).
CREATE TABLE itemStock (
  itemId TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouseId TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (itemId, warehouseId)
);
CREATE INDEX itemStock_wh ON itemStock(warehouseId);

-- Item.supplierCodes[]: the purchase-PDF import looks items up by these.
CREATE TABLE itemSupplierCodes (
  itemId TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  PRIMARY KEY (itemId, code)
);
CREATE INDEX itemSupplierCodes_code ON itemSupplierCodes(code);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  parentId TEXT,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX categories_parent ON categories(parentId);

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX brands_name ON brands(name COLLATE NOCASE);

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  name TEXT,
  shortName TEXT,
  type TEXT,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX units_name ON units(name);
CREATE INDEX units_shortName ON units(shortName);

CREATE TABLE warehouses (
  id TEXT PRIMARY KEY,
  name TEXT,
  code TEXT,
  type TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  contactPerson TEXT,
  phone TEXT,
  email TEXT,
  status TEXT,
  isDefault INTEGER NOT NULL DEFAULT 0,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX warehouses_code ON warehouses(code);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT,
  nameLower TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  gstNumber TEXT,
  panNumber TEXT,
  billing_line1 TEXT,
  billing_line2 TEXT,
  billing_city TEXT,
  billing_state TEXT,
  billing_pincode TEXT,
  billing_country TEXT,
  shipping_line1 TEXT,
  shipping_line2 TEXT,
  shipping_city TEXT,
  shipping_state TEXT,
  shipping_pincode TEXT,
  shipping_country TEXT,
  creditLimit REAL,
  creditDays REAL,
  outstandingBalance REAL,
  advanceBalance REAL,
  loyaltyPoints REAL,
  customerGroup TEXT,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX customers_code ON customers(code);
CREATE INDEX customers_phone ON customers(phone);
CREATE INDEX customers_name ON customers(name COLLATE NOCASE);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT,
  nameLower TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  gstNumber TEXT,
  panNumber TEXT,
  address_line1 TEXT,
  address_city TEXT,
  address_state TEXT,
  address_pincode TEXT,
  address_country TEXT,
  creditLimit REAL,
  creditDays REAL,
  outstandingBalance REAL,
  bank_bankName TEXT,
  bank_accountNumber TEXT,
  bank_ifscCode TEXT,
  bank_accountType TEXT,
  status TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX suppliers_code ON suppliers(code);
CREATE INDEX suppliers_name ON suppliers(name COLLATE NOCASE);

-- One row per copied Mongo collection: where the copy job has got to (lib/d1/sync.ts).
CREATE TABLE sync_state (
  collection TEXT PRIMARY KEY,
  watermark TEXT,                 -- highest Mongo updatedAt copied; the next run copies updatedAt > watermark - 2 min
  fullCopyStartedAt TEXT,
  fullCopyLastId TEXT,            -- resume point of an unfinished full copy (Mongo _id order)
  fullCopyDoneAt TEXT,            -- NULL until the first full copy has finished
  lastRunAt TEXT,
  lastRunCopied INTEGER NOT NULL DEFAULT 0,
  totalCopied INTEGER NOT NULL DEFAULT 0,
  reconcileStartedAt TEXT,
  reconcileCursor TEXT,           -- 'repair:<id>' / 'delete:<id>' while a nightly reconciliation is unfinished
  lastReconcileAt TEXT,
  lastReconcileRepaired INTEGER NOT NULL DEFAULT 0,
  lastReconcileDeleted INTEGER NOT NULL DEFAULT 0,
  mongoCount INTEGER,             -- counted at the end of each reconciliation
  d1Count INTEGER
);

-- Every failure of the copy job (it never throws to its caller). Pruned to the newest 2,000 rows.
CREATE TABLE sync_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  collection TEXT,
  docId TEXT,
  phase TEXT NOT NULL,            -- full / incremental / reconcile / state / run
  message TEXT NOT NULL
);
CREATE INDEX sync_errors_at ON sync_errors(at);
