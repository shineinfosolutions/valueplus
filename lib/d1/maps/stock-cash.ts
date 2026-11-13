import { canonicalJson, idText, toBool, toDate, toInt, toJson, toReal, toText, type ChildSpec, type MasterSpec, type SqlValue } from "../masters-map";

/**
 * D1 copy specs for the purchase, stock and cash area (docs/D1_MIGRATION_PLAN.md §4.2, §4.4, §4.5; tables in
 * d1/migrations/0003_stock_cash.sql). Picked up by lib/d1/registry.ts, so the copy job (lib/d1/sync.ts) copies
 * them with no other change.
 *
 * Decisions, per the plan:
 *  - line arrays that the stock flow / product ledger / live audit read line by line become child tables
 *    (purchaseEntryItems, stockTransferItems, stockAdjustmentItems, stockJournalItems, inventoryAuditItems);
 *    each child row keeps its position (`lineNo`), the subdocument `_id` (`id`) and, in `extra`, any key of the
 *    line the table does not know, so a line is copied without loss;
 *  - arrays that are only displayed or edited as a whole stay JSON (PurchaseOrder.items, StockRequest.items,
 *    StockReturn.items, StockOrderRequest.items / mergedFrom, BillOfMaterial.components, VendorBill.items,
 *    SerialNumber.history, DayClose.denominations, Variant.values);
 *  - 1:1 subdocuments are flattened (Vendor.address -> address_*, Vendor.bankDetails -> bank_*);
 *  - business dates kept as strings in Mongo (billDate "YYYY-MM-DD", CashTransaction.date, cancelledAt ...) are
 *    copied as the same text; only fields that are real Dates in the schema become ISO-8601 text.
 */

type Col = MasterSpec["columns"][number];
type ColType = Col["type"];

const f = (col: string, type: ColType, field: string = col): Col => ({ col, type, get: (d) => d?.[field] });

/** A field of a flattened 1:1 subdocument; a legacy plain-string address is read as its first line. */
function sub(col: string, parent: string, field: string, type: ColType = "text"): Col {
  return {
    col,
    type,
    get: (d) => {
      const s = d?.[parent];
      if (s && typeof s === "object" && !Array.isArray(s)) return s[field];
      if (typeof s === "string" && field === "line1") return s;
      return undefined;
    },
  };
}

const lower = (col: string, field: string): Col => ({
  col,
  type: "text",
  get: (d) => (typeof d?.[field] === "string" ? d[field].toLowerCase() : toText(d?.[field])?.toLowerCase() ?? ""),
});

function convert(type: ColType, v: unknown): SqlValue {
  switch (type) {
    case "text":
      return toText(v);
    case "real":
      return toReal(v);
    case "int":
      return toInt(v);
    case "bool":
      return toBool(v);
    case "date":
      return toDate(v);
    case "json":
      return toJson(v);
  }
}

// ---------------------------------------------------------------------------
// Line tables
// ---------------------------------------------------------------------------

export interface LineCol {
  col: string;
  type: ColType;
  /** Field of the line subdocument (default: col). */
  field?: string;
}

export interface LineTable {
  table: string;
  parentCol: string;
  /** Array field of the parent document. */
  field: string;
  cols: LineCol[];
}

/** Columns of a line table, in insert order: parent id, position, subdocument _id, the line's fields, extra. */
export function lineColumns(t: LineTable): string[] {
  return [t.parentCol, "lineNo", "id", ...t.cols.map((c) => c.col), "extra"];
}

/**
 * One child row per array element, in array order. Keys the table does not know go to the row's `extra` JSON;
 * an element that is not an object (a legacy null or string) is kept whole as {"$value": ...}, and a field that
 * is not an array at all (never written by the app, but possible in raw data) becomes a single row with lineNo -1
 * and {"$notArray": ...}, so nothing is dropped.
 */
function lineRows(t: LineTable) {
  const known = new Set(["_id", ...t.cols.map((c) => c.field ?? c.col)]);
  return (doc: any, id: string): SqlValue[][] => {
    const raw = doc?.[t.field];
    if (raw === undefined || raw === null) return [];
    const empty = t.cols.map(() => null as SqlValue);
    if (!Array.isArray(raw)) return [[id, -1, null, ...empty, canonicalJson({ $notArray: raw })]];
    return raw.map((el: any, i: number) => {
      if (!el || typeof el !== "object" || Array.isArray(el)) {
        return [id, i, null, ...empty, el === undefined ? null : canonicalJson({ $value: el })];
      }
      const extra: Record<string, unknown> = {};
      for (const k of Object.keys(el)) if (!known.has(k) && el[k] !== undefined) extra[k] = el[k];
      return [
        id,
        i,
        el._id === undefined || el._id === null ? null : idText(el._id),
        ...t.cols.map((c) => convert(c.type, el[c.field ?? c.col])),
        Object.keys(extra).length ? canonicalJson(extra) : null,
      ];
    });
  };
}

function lineChild(t: LineTable): ChildSpec {
  return { table: t.table, parentCol: t.parentCol, columns: lineColumns(t), rows: lineRows(t) };
}

export const LINE_TABLES: Record<string, LineTable> = {
  purchaseEntryItems: {
    table: "purchaseEntryItems",
    parentCol: "purchaseEntryId",
    field: "items",
    cols: [
      { col: "itemId", type: "text" },
      { col: "name", type: "text" },
      { col: "quantity", type: "real" },
      { col: "rate", type: "real" },
      { col: "gstRate", type: "real" },
      { col: "hsn", type: "text" },
      { col: "serialNumbers", type: "json" },
    ],
  },
  stockTransferItems: {
    table: "stockTransferItems",
    parentCol: "stockTransferId",
    field: "items",
    cols: [
      { col: "itemId", type: "text" },
      { col: "itemName", type: "text" },
      { col: "quantity", type: "real" },
      { col: "unit", type: "text" },
      { col: "costPrice", type: "real" },
    ],
  },
  stockAdjustmentItems: {
    table: "stockAdjustmentItems",
    parentCol: "stockAdjustmentId",
    field: "items",
    cols: [
      { col: "itemId", type: "text" },
      { col: "itemName", type: "text" },
      { col: "quantity", type: "real" },
      { col: "type", type: "text" },
      { col: "remarks", type: "text" },
    ],
  },
  stockJournalItems: {
    table: "stockJournalItems",
    parentCol: "stockJournalId",
    field: "items",
    cols: [
      { col: "itemId", type: "text" },
      { col: "itemName", type: "text" },
      { col: "warehouseId", type: "text" },
      { col: "quantity", type: "real" },
      { col: "type", type: "text" },
    ],
  },
  inventoryAuditItems: {
    table: "inventoryAuditItems",
    parentCol: "auditId",
    field: "items",
    cols: [
      { col: "productId", type: "text" },
      { col: "productName", type: "text" },
      { col: "vpCode", type: "text" },
      { col: "category", type: "text" },
      { col: "expectedStock", type: "real" },
      { col: "physicalStock", type: "real" },
      { col: "difference", type: "real" },
      { col: "condition", type: "text" },
      { col: "remarks", type: "text" },
      { col: "counted", type: "bool" },
      { col: "countedBy", type: "text" },
      { col: "countedAt", type: "date" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/** A spec whose columns are plain top-level fields (plus optional extra columns / children). */
function plain(collection: string, table: string, cols: [string, ColType][], more: Partial<MasterSpec> = {}): MasterSpec {
  const columns = cols.map(([c, t]) => f(c, t));
  return {
    collection,
    table,
    columns: [...columns, ...(more.columns || [])],
    known: [...cols.map(([c]) => c), ...(more.known || [])],
    ...(more.flattened ? { flattened: more.flattened } : {}),
    ...(more.children ? { children: more.children } : {}),
  };
}

const VENDOR_ADDRESS = ["line1", "line2", "city", "state", "pincode", "country"];
const VENDOR_BANK = ["bankName", "accountNumber", "ifscCode", "accountType"];

export const STOCK_CASH_SPECS: MasterSpec[] = [
  // ── Purchasing ──
  plain(
    "purchase_entries",
    "purchaseEntries",
    [
      ["billNo", "text"], ["supplierName", "text"], ["supplierGST", "text"], ["supplierId", "text"], ["warehouse", "text"],
      ["warehouseId", "text"], ["linkedPoNo", "text"], ["noPoReason", "text"], ["type", "text"], ["billingEntity", "text"],
      ["billDate", "text"], ["dueDate", "text"], ["subtotal", "real"], ["gst", "real"], ["total", "real"], ["paid", "real"],
      ["balance", "real"], ["status", "text"], ["cancelledAt", "text"], ["cancelledBy", "text"], ["cancelReason", "text"],
      ["lastModifiedReason", "text"], ["backdateStatus", "text"], ["backdateRequestedBy", "text"], ["backdateMadeOn", "text"],
    ],
    { known: ["items"], children: [lineChild(LINE_TABLES.purchaseEntryItems)] }
  ),
  plain("deleted_purchase_entries", "deletedPurchaseEntries", [
    ["billNo", "text"], ["supplierName", "text"], ["total", "real"], ["deletedAt", "date"], ["deletedBy", "text"],
    ["deletedByRole", "text"], ["deletedByUserId", "text"], ["deleteReason", "text"], ["pinVerified", "bool"],
    ["usedLegacyPin", "bool"], ["snapshot", "json"],
  ]),
  plain("purchase_orders", "purchaseOrders", [
    ["poNo", "text"], ["supplierName", "text"], ["date", "date"], ["expectedDate", "date"], ["totalAmount", "real"],
    ["subtotal", "real"], ["gst", "real"], ["status", "text"], ["items", "json"],
  ]),
  plain("expenses", "expenses", [
    ["expenseNo", "text"], ["category", "text"], ["description", "text"], ["amount", "real"], ["date", "text"],
    ["paymentMode", "text"], ["status", "text"],
  ]),

  // ── Stock documents ──
  plain("stock_adjustments", "stockAdjustments", [["adjustmentNo", "text"], ["date", "text"], ["reason", "text"], ["warehouseId", "text"]], {
    known: ["items"],
    children: [lineChild(LINE_TABLES.stockAdjustmentItems)],
  }),
  plain("stock_journals", "stockJournals", [["journalNumber", "text"], ["date", "text"], ["purpose", "text"]], {
    known: ["items"],
    children: [lineChild(LINE_TABLES.stockJournalItems)],
  }),
  plain("stock_order_requests", "stockOrderRequests", [
    ["requestNumber", "text"], ["status", "text"], ["salesperson", "text"], ["salespersonId", "text"], ["note", "text"],
    ["totalQuantity", "real"], ["approvedBy", "text"], ["approvedAt", "date"], ["rejectedBy", "text"], ["rejectedAt", "date"],
    ["rejectReason", "text"], ["message", "text"], ["sentBy", "text"], ["sentAt", "date"], ["mergedInto", "text"],
    ["items", "json"], ["mergedFrom", "json"],
  ]),
  plain("stock_requests", "stockRequests", [
    ["requestNumber", "text"], ["date", "text"], ["requestingWarehouseId", "text"], ["supplyingWarehouseId", "text"],
    ["status", "text"], ["items", "json"],
  ]),
  plain("stock_returns", "stockReturns", [
    ["returnNumber", "text"], ["date", "text"], ["returnType", "text"], ["referenceId", "text"], ["status", "text"], ["items", "json"],
  ]),
  plain(
    "stocktransfers",
    "stockTransfers",
    [
      ["transferNo", "text"], ["fromWarehouse", "text"], ["toWarehouse", "text"], ["fromWarehouseId", "text"],
      ["toWarehouseId", "text"], ["totalValue", "real"], ["date", "text"], ["status", "text"],
    ],
    { known: ["items"], children: [lineChild(LINE_TABLES.stockTransferItems)] }
  ),
  plain("serial_numbers", "serialNumbers", [
    ["serialNumber", "text"], ["itemId", "text"], ["vpCode", "text"], ["itemName", "text"], ["batchNo", "text"],
    ["status", "text"], ["warehouse", "text"], ["purchaseEntryId", "text"], ["invoiceId", "text"], ["invoiceNumber", "text"],
    ["customerName", "text"], ["customerPhone", "text"], ["soldDate", "text"], ["price", "real"], ["history", "json"],
  ]),
  plain(
    "inventory_audits",
    "inventoryAudits",
    [
      ["auditDate", "text"], ["auditor", "text"], ["category", "text"], ["totalExpected", "real"], ["totalPhysical", "real"],
      ["totalDiscrepancy", "real"], ["status", "text"], ["auditorId", "text"], ["completedBy", "text"], ["completedAt", "date"],
      ["warehouse", "text"], ["kind", "text"], ["completionTime", "text"], ["notes", "text"],
    ],
    { known: ["items"], children: [lineChild(LINE_TABLES.inventoryAuditItems)] }
  ),
  plain("bill_of_materials", "billOfMaterials", [
    ["bomNumber", "text"], ["finishedGoodItemId", "text"], ["finishedGoodName", "text"], ["expectedQuantity", "real"],
    ["totalCost", "real"], ["components", "json"],
  ]),
  plain("supplier_stock_items", "supplierStockItems", [
    ["itemCode", "text"], ["description", "text"], ["brand", "text"], ["groupName", "text"], ["productDesc", "text"],
    ["charDesc", "text"], ["warehouse", "text"], ["availableStock", "real"], ["previousStock", "real"], ["isNewArrival", "bool"],
    ["active", "bool"], ["uploadId", "text"],
  ]),
  plain("supplier_stock_uploads", "supplierStockUploads", [
    ["fileName", "text"], ["uploadedBy", "text"], ["uploadedByRole", "text"], ["rowCount", "real"], ["newProducts", "real"],
    ["totalUnits", "real"],
  ]),

  // ── Vendors (parties that buy from us on account) ──
  plain(
    "vendors",
    "vendors",
    [
      ["code", "text"], ["name", "text"],
    ],
    {
      columns: [
        lower("nameLower", "name"),
        f("contactPerson", "text"),
        f("email", "text"),
        f("phone", "text"),
        f("altPhone", "text"),
        f("gstNumber", "text"),
        f("panNumber", "text"),
        ...VENDOR_ADDRESS.map((k) => sub(`address_${k}`, "address", k)),
        f("creditLimit", "real"),
        f("creditDays", "real"),
        f("openingBalance", "real"),
        f("openingBalanceDate", "text"),
        ...VENDOR_BANK.map((k) => sub(`bank_${k}`, "bankDetails", k)),
        f("notes", "text"),
        f("status", "text"),
      ],
      known: [
        "contactPerson", "email", "phone", "altPhone", "gstNumber", "panNumber", "address", "creditLimit", "creditDays",
        "openingBalance", "openingBalanceDate", "bankDetails", "notes", "status",
      ],
      flattened: { address: VENDOR_ADDRESS, bankDetails: VENDOR_BANK },
    }
  ),
  plain("vendor_bills", "vendorBills", [
    ["billNo", "text"], ["vendorId", "text"], ["vendorName", "text"], ["date", "text"], ["dueDate", "text"], ["subtotal", "real"],
    ["gstRate", "real"], ["gstAmount", "real"], ["total", "real"], ["notes", "text"], ["reference", "text"], ["status", "text"],
    ["cancelledAt", "text"], ["cancelledBy", "text"], ["cancelReason", "text"], ["createdBy", "text"], ["items", "json"],
  ]),
  plain("vendor_payments", "vendorPayments", [
    ["paymentId", "text"], ["vendorId", "text"], ["vendorName", "text"], ["date", "text"], ["amount", "real"], ["mode", "text"],
    ["refNo", "text"], ["againstBillNo", "text"], ["receivedBy", "text"], ["notes", "text"], ["type", "text"],
    ["createdBy", "text"], ["createdByRole", "text"],
  ]),

  // ── Cash ──
  plain("cash_transactions", "cashTransactions", [
    ["type", "text"], ["category", "text"], ["amount", "real"], ["date", "text"], ["time", "text"], ["referenceNo", "text"],
    ["description", "text"], ["partyName", "text"], ["targetBankAccount", "text"], ["handedTo", "text"], ["recordedBy", "text"],
    ["adminStatus", "text"], ["adminReviewedBy", "text"], ["adminReviewedAt", "text"], ["adminRejectReason", "text"],
  ]),
  plain("day_closes", "dayCloses", [
    ["date", "text"], ["openingCash", "real"], ["systemExpectedCash", "real"], ["systemOpeningCash", "real"], ["dayCashIn", "real"],
    ["dayCashFromInvoices", "real"], ["dayCashOut", "real"], ["originalSystemExpectedCash", "real"], ["originalDifference", "real"],
    ["recalculatedAt", "text"], ["recalculatedBy", "text"], ["countedCash", "real"], ["denominations", "json"],
    ["coinsAmount", "real"], ["difference", "real"], ["notes", "text"], ["closedBy", "text"], ["closedByRole", "text"],
    ["closedAt", "text"],
  ]),
  plain("admin_cash_entries", "adminCashEntries", [
    ["type", "text"], ["amount", "real"], ["date", "text"], ["time", "text"], ["bankAccountId", "text"], ["bankAccount", "text"],
    ["referenceNo", "text"], ["description", "text"], ["recordedBy", "text"], ["recordedByUserId", "text"], ["voided", "bool"],
    ["voidedBy", "text"], ["voidedAt", "text"], ["voidReason", "text"],
  ]),
  plain("bank_accounts", "bankAccounts", [
    ["name", "text"], ["bank", "text"], ["number", "text"], ["ifsc", "text"], ["branch", "text"], ["type", "text"],
    ["balance", "real"], ["status", "text"],
  ]),
  plain("cash_register_settings", "cashRegisterSettings", [
    ["key", "text"], ["openingCash", "real"], ["countedCash", "real"], ["calibratedBy", "text"], ["calibratedAt", "text"],
  ]),

  // ── Small masters used by purchasing ──
  // `values` is a reserved word in SQL (INSERT ... VALUES), so the column is `valuesJson`: the copy job writes column
  // names unquoted, and every later query would otherwise have to quote it.
  {
    collection: "variants",
    table: "variants",
    columns: [f("name", "text"), f("valuesJson", "json", "values"), f("status", "text")],
    known: ["name", "values", "status"],
  },
  plain("product_catalog_references", "productCatalogReferences", [
    ["vpCode", "text"], ["description", "text"], ["brand", "text"], ["groupName", "text"], ["category", "text"],
    ["productDesc", "text"], ["charDesc", "text"],
  ]),
];
