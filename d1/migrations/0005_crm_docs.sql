-- docs/D1_MIGRATION_PLAN.md §4.2, §4.5, §4.7, §4.8: CRM, documents and accounting tables, filled as a COPY of
-- MongoDB by lib/d1/sync.ts (specs in lib/d1/maps/crm-docs.ts). MongoDB stays the only source of truth; nothing in
-- the app reads these tables yet. Same conventions as 0001_masters.sql (camelCase Mongo field names, `_id` -> `id`,
-- ISO-8601 UTC text dates, 0/1 booleans, REAL money, `extra` JSON for anything the columns do not hold, then
-- createdAt / updatedAt / v / docHash / syncedAt).
--
-- Child tables (one row per element of a Mongo array, replaced as a whole on every copy of the parent) have
-- `idx` = the element's position in the array, and their own `extra` for keys / values the columns do not hold.
-- The UNIQUE constraints the plan lists (leads.leadId, customerComplaints.ticketNumber, storedDocuments.docNo,
-- documentFolders.nameKey, journalEntries.entryNumber, accounts.code / name) are plain indexes for now, as in 0001:
-- autoIndex is off on Workers, so live data may hold duplicates. They become UNIQUE after the data is checked.

-- Lead (plan §4.7) [HOT]. `items` and `timeline` stay JSON (display only).
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  leadId TEXT,
  customerName TEXT,
  mobile TEXT,
  email TEXT,
  source TEXT,
  walkInReason TEXT,
  interestedProduct TEXT,
  vpCode TEXT,
  assignedStaff TEXT,
  estimatedValue REAL,
  priority TEXT,
  status TEXT,
  followUpDate TEXT,          -- YYYY-MM-DD text, as in Mongo
  lastFollowUpDate TEXT,
  callCount INTEGER,
  lastCalledAt TEXT,
  notes TEXT,
  estimateNumber TEXT,
  estimateId TEXT,
  convertedInvoiceNumber TEXT,
  items TEXT,                 -- JSON array
  timeline TEXT,              -- JSON array (with each entry's _id)
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX leads_leadId ON leads(leadId);
CREATE INDEX leads_mobile ON leads(mobile);
CREATE INDEX leads_customerName ON leads(customerName);
CREATE INDEX leads_status ON leads(status);
-- The plan's (assignedStaffKey, status): no such field exists in Mongo, the leads page filters on assignedStaff.
CREATE INDEX leads_staff_status ON leads(assignedStaff, status);
CREATE INDEX leads_followUpDate ON leads(followUpDate);
CREATE INDEX leads_estimateNumber ON leads(estimateNumber);
CREATE INDEX leads_createdAt ON leads(createdAt);

-- Lead.followUps[]: "follow-ups today / overdue" and Staff Activity query by date and staff.
CREATE TABLE leadFollowUps (
  leadId TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  date TEXT,
  nextDate TEXT,
  outcome TEXT,
  notes TEXT,
  staff TEXT,
  staffId TEXT,
  loggedAt TEXT,
  extra TEXT,
  PRIMARY KEY (leadId, idx)
);
CREATE INDEX leadFollowUps_date ON leadFollowUps(date);
CREATE INDEX leadFollowUps_staff_loggedAt ON leadFollowUps(staffId, loggedAt);

-- Lead.calls[]: Staff Activity counts calls per staff per day.
CREATE TABLE leadCalls (
  leadId TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  at TEXT,
  staff TEXT,
  staffId TEXT,
  extra TEXT,
  PRIMARY KEY (leadId, idx)
);
CREATE INDEX leadCalls_staff_at ON leadCalls(staffId, at);
CREATE INDEX leadCalls_at ON leadCalls(at);

-- Lead.sharedWith[]: the staff filter and "shared with me".
CREATE TABLE leadShares (
  leadId TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  staff TEXT,
  staffId TEXT,
  brand TEXT,
  products TEXT,
  note TEXT,
  status TEXT,
  requestedBy TEXT,
  requestedById TEXT,
  requestedAt TEXT,
  respondedAt TEXT,
  extra TEXT,
  PRIMARY KEY (leadId, idx)
);
CREATE INDEX leadShares_staff_status ON leadShares(staffId, status);

CREATE TABLE walkInQueries (
  id TEXT PRIMARY KEY,
  customerName TEXT,
  mobile TEXT,
  date TEXT,                  -- YYYY-MM-DD text, as in Mongo
  time TEXT,
  reason TEXT,
  interestedProduct TEXT,
  category TEXT,
  budget REAL,
  staff TEXT,
  notes TEXT,
  followUpDate TEXT,
  status TEXT,
  leadId TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX walkInQueries_mobile ON walkInQueries(mobile);
CREATE INDEX walkInQueries_date ON walkInQueries(date);

CREATE TABLE customerComplaints (
  id TEXT PRIMARY KEY,
  ticketNumber TEXT,
  complaintType TEXT,
  accusedStaffId TEXT,
  accusedStaffName TEXT,
  accusedStaffRole TEXT,
  accusedStaffBrand TEXT,
  customerName TEXT,
  customerPhone TEXT,
  customerEmail TEXT,
  customerAddress TEXT,
  productName TEXT,
  vpCode TEXT,
  serialNumber TEXT,
  invoiceNumber TEXT,
  purchaseDate TEXT,
  issueTitle TEXT,
  issueDescription TEXT,
  priority TEXT,
  status TEXT,
  assignedTo TEXT,
  assignedStaffRole TEXT,
  assignedDate TEXT,
  actionTaken TEXT,
  resolutionNotes TEXT,
  resolvedAt TEXT,
  resolvedBy TEXT,
  customerFeedback TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX customerComplaints_ticketNumber ON customerComplaints(ticketNumber);
CREATE INDEX customerComplaints_status_priority ON customerComplaints(status, priority, createdAt DESC);
CREATE INDEX customerComplaints_type ON customerComplaints(complaintType, createdAt DESC);
CREATE INDEX customerComplaints_phone ON customerComplaints(customerPhone);
CREATE INDEX customerComplaints_invoice ON customerComplaints(invoiceNumber);
CREATE INDEX customerComplaints_accused ON customerComplaints(accusedStaffName);

-- WhatsApp outbox (plan §4.8).
CREATE TABLE whatsappMessages (
  id TEXT PRIMARY KEY,
  event TEXT,
  audience TEXT,
  toNumber TEXT,
  toName TEXT,
  message TEXT,
  waLink TEXT,
  entityType TEXT,
  entityRef TEXT,
  entityId TEXT,
  status TEXT,
  provider TEXT,
  providerMessageId TEXT,
  error TEXT,
  attempts INTEGER,
  sentAt TEXT,
  sentBy TEXT,
  triggeredBy TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX whatsappMessages_status_created ON whatsappMessages(status, createdAt DESC);
CREATE INDEX whatsappMessages_created ON whatsappMessages(createdAt DESC);
CREATE INDEX whatsappMessages_entityRef ON whatsappMessages(entityRef);
CREATE INDEX whatsappMessages_toNumber ON whatsappMessages(toNumber);

-- WhatsApp settings: a single document. cloudApi_accessToken is a SECRET (select:false in Mongo): a repository
-- reading this table must leave it out of its default column list (plan §3).
CREATE TABLE whatsappSettings (
  id TEXT PRIMARY KEY,
  provider TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  adminNumbers TEXT,          -- JSON array
  notifyCustomer INTEGER NOT NULL DEFAULT 0,
  events TEXT,                -- JSON object { eventName: boolean }
  businessName TEXT,
  updatedBy TEXT,
  cloudApi_phoneNumberId TEXT,
  cloudApi_accessToken TEXT,
  cloudApi_apiVersion TEXT,
  cloudApi_templateName TEXT,
  cloudApi_templateLanguage TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

-- Office documents: files stay on Cloudinary, only the metadata is here (plan §4.2).
CREATE TABLE storedDocuments (
  id TEXT PRIMARY KEY,
  docNo TEXT,
  date TEXT,                  -- YYYY-MM-DD text, as in Mongo
  narration TEXT,
  fileUrl TEXT,
  filePublicId TEXT,
  fileResourceType TEXT,
  fileFormat TEXT,
  fileDeliveryType TEXT,
  fileName TEXT,
  fileType TEXT,
  fileSize REAL,
  folderId TEXT,
  uploadedBy TEXT,
  uploadedByUserId TEXT,
  uploadedByRole TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX storedDocuments_docNo ON storedDocuments(docNo);
CREATE INDEX storedDocuments_date ON storedDocuments(date);
CREATE INDEX storedDocuments_folderId ON storedDocuments(folderId);

CREATE TABLE documentFolders (
  id TEXT PRIMARY KEY,
  name TEXT,
  nameKey TEXT,
  createdBy TEXT,
  createdByUserId TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX documentFolders_nameKey ON documentFolders(nameKey);

CREATE TABLE onsitegoPlans (
  id TEXT PRIMARY KEY,
  category TEXT,
  device TEXT,
  kind TEXT,
  vpCode TEXT,
  minPrice REAL,
  maxPrice REAL,
  planName TEXT,
  years REAL,
  price REAL,
  sourceDocId TEXT,
  sourceFileName TEXT,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX onsitegoPlans_cat_device ON onsitegoPlans(category, device);

-- (plan §4.5: may be unused; copied anyway so nothing is lost)
CREATE TABLE gstrReports (
  id TEXT PRIMARY KEY,
  reportId TEXT,
  type TEXT,
  date TEXT,
  partyName TEXT,
  gstin TEXT,
  amount REAL,
  igst REAL,
  cgst REAL,
  sgst REAL,
  totalTax REAL,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX gstrReports_type_date ON gstrReports(type, date);

-- Accounting (hidden module).
CREATE TABLE journalEntries (
  id TEXT PRIMARY KEY,
  entryNumber TEXT,
  date TEXT,
  description TEXT,
  referenceType TEXT,
  referenceId TEXT,
  totalDebit REAL,
  totalCredit REAL,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX journalEntries_entryNumber ON journalEntries(entryNumber);
CREATE INDEX journalEntries_date ON journalEntries(date);
CREATE INDEX journalEntries_reference ON journalEntries(referenceType, referenceId);

-- JournalEntry.lines[] (each line has its own Mongo _id, kept as lineId).
CREATE TABLE journalEntryLines (
  entryId TEXT NOT NULL REFERENCES journalEntries(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  lineId TEXT,
  accountId TEXT,
  accountName TEXT,
  debit REAL,
  credit REAL,
  extra TEXT,
  PRIMARY KEY (entryId, idx)
);
CREATE INDEX journalEntryLines_account ON journalEntryLines(accountId);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT,
  type TEXT,
  description TEXT,
  balance REAL,
  extra TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  v INTEGER NOT NULL DEFAULT 0,
  docHash TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);
CREATE INDEX accounts_code ON accounts(code);
CREATE INDEX accounts_name ON accounts(name);
