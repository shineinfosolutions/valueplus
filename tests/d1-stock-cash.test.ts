/**
 * D1 copy of the purchase, stock and cash area (docs/D1_MIGRATION_PLAN.md §4.2, §4.4, §4.5;
 * d1/migrations/0003_stock_cash.sql; lib/d1/maps/stock-cash.ts):
 *  - 0003 applies after 0001, creates only its own tables, and every table has exactly the columns the mapping
 *    writes (≤ 100, so one row per statement stays under D1's 100 bound parameters);
 *  - each spec reads the collection its model really uses;
 *  - realistic documents for every collection, plus legacy edge cases (unknown fields, odd line shapes, a string
 *    address, no timestamps), map without loss: every Mongo field is found again in a column, a child row or `extra`;
 *  - an inventory audit with 450 counted lines fits (lines are child rows, no row near D1's 2 MB limit);
 *  - full copy, then incremental copies that replace child rows (no duplicates), then a reconciliation that removes
 *    a deleted document and its lines; counts and hashes match.
 * Uses MongoDB in memory and a local D1 (Miniflare via wrangler); nothing external.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { ALL_SPECS } from "@/lib/d1/registry";
import { canonicalJson, idText, mapDoc, normalize, tableColumns, toBool, toDate, toInt, toJson, toReal, toText, type MasterSpec, type SqlValue } from "@/lib/d1/masters-map";
import { STOCK_CASH_SPECS, LINE_TABLES, lineColumns, type LineTable } from "@/lib/d1/maps/stock-cash";
import { runD1Sync, getD1SyncStatus } from "@/lib/d1/sync";
import PurchaseEntry from "@/models/PurchaseEntry";
import DeletedPurchaseEntry from "@/models/DeletedPurchaseEntry";
import PurchaseOrder from "@/models/PurchaseOrder";
import Expense from "@/models/Expense";
import StockAdjustment from "@/models/StockAdjustment";
import StockJournal from "@/models/StockJournal";
import StockOrderRequest from "@/models/StockOrderRequest";
import StockRequest from "@/models/StockRequest";
import StockReturn from "@/models/StockReturn";
import StockTransfer from "@/models/StockTransfer";
import SerialNumber from "@/models/SerialNumber";
import InventoryAudit from "@/models/InventoryAudit";
import BillOfMaterial from "@/models/BillOfMaterial";
import SupplierStockItem from "@/models/SupplierStockItem";
import SupplierStockUpload from "@/models/SupplierStockUpload";
import Vendor from "@/models/Vendor";
import VendorBill from "@/models/VendorBill";
import VendorPayment from "@/models/VendorPayment";
import CashTransaction from "@/models/CashTransaction";
import DayClose from "@/models/DayClose";
import AdminCashEntry from "@/models/AdminCashEntry";
import BankAccount from "@/models/BankAccount";
import CashRegisterSetting from "@/models/CashRegisterSetting";
import Variant from "@/models/Variant";
import ProductCatalogReference from "@/models/ProductCatalogReference";

const { ObjectId, Decimal128 } = mongoose.mongo as any;

const MODELS: Record<string, any> = {
  PurchaseEntry, DeletedPurchaseEntry, PurchaseOrder, Expense, StockAdjustment, StockJournal, StockOrderRequest,
  StockRequest, StockReturn, StockTransfer, SerialNumber, InventoryAudit, BillOfMaterial, SupplierStockItem,
  SupplierStockUpload, Vendor, VendorBill, VendorPayment, CashTransaction, DayClose, AdminCashEntry, BankAccount,
  CashRegisterSetting, Variant, ProductCatalogReference,
};

async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any[]> {
  const res = await db.prepare(sql).bind(...args).all();
  return (res.results || []) as any[];
}
async function one(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any> {
  return db.prepare(sql).bind(...args).first();
}
async function count(db: D1DatabaseLike, table: string, where = "", ...args: unknown[]): Promise<number> {
  return Number((await one(db, `SELECT COUNT(*) AS n FROM ${table} ${where}`, ...args))?.n ?? 0);
}

type ColType = MasterSpec["columns"][number]["type"];
function convert(type: ColType, v: unknown): SqlValue {
  switch (type) {
    case "text": return toText(v);
    case "real": return toReal(v);
    case "int": return toInt(v);
    case "bool": return toBool(v);
    case "date": return toDate(v);
    case "json": return toJson(v);
  }
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** The Mongo path a column reads, found by running its getter on a recording proxy (["field"] or ["parent", "field"]). */
function sourcePath(get: (d: any) => unknown): string[] {
  const p: string[] = [];
  const mk = (): any =>
    new Proxy({}, { get: (_t, k) => (typeof k === "string" ? (p.push(k), mk()) : undefined) });
  try {
    get(mk());
  } catch {
    // only the recorded path matters
  }
  return p;
}

const SKIP_TOP = new Set(["_id", "createdAt", "updatedAt", "__v"]);

/**
 * Checks that every field of `doc` is in D1 with the value the mapping promises: a column (converted to its type),
 * a flattened column, a child row (per element and per element key) or the `extra` JSON. Returns the problems.
 */
async function losslessProblems(db: D1DatabaseLike, spec: MasterSpec, doc: any): Promise<string[]> {
  const id = idText(doc._id);
  const row = await one(db, `SELECT * FROM ${spec.table} WHERE id = ?`, id);
  if (!row) return [`${spec.table} ${id}: row missing`];
  const problems: string[] = [];
  const extra = row.extra ? JSON.parse(row.extra) : {};
  const direct = new Map<string, { col: string; type: ColType }>();
  const flat = new Map<string, Map<string, { col: string; type: ColType }>>();
  for (const c of spec.columns) {
    if (c.col === "nameLower") continue; // derived search helper, not a Mongo field
    const p = sourcePath(c.get);
    if (p.length === 1) direct.set(p[0], { col: c.col, type: c.type });
    else if (p.length === 2) {
      if (!flat.has(p[0])) flat.set(p[0], new Map());
      flat.get(p[0])!.set(p[1], { col: c.col, type: c.type });
    }
  }
  const lineByField = new Map<string, LineTable>();
  for (const ch of spec.children || []) {
    const lt = Object.values(LINE_TABLES).find((t) => t.table === ch.table)!;
    lineByField.set(lt.field, lt);
  }
  for (const k of Object.keys(doc)) {
    if (SKIP_TOP.has(k) || doc[k] === undefined) continue;
    const v = doc[k];
    const where = `${spec.table} ${id} .${k}`;
    if (lineByField.has(k)) {
      const lt = lineByField.get(k)!;
      const rows = await all(db, `SELECT * FROM ${lt.table} WHERE ${lt.parentCol} = ? ORDER BY lineNo`, id);
      if (v === null) {
        if (rows.length) problems.push(`${where}: null array but ${rows.length} rows`);
        continue;
      }
      if (!Array.isArray(v)) {
        const ok = rows.length === 1 && rows[0].lineNo === -1 && same(JSON.parse(rows[0].extra).$notArray, normalize(v));
        if (!ok) problems.push(`${where}: non-array value not kept`);
        continue;
      }
      if (rows.length !== v.length) problems.push(`${where}: ${v.length} elements, ${rows.length} rows`);
      v.forEach((el: any, i: number) => {
        const r = rows.find((x) => x.lineNo === i);
        if (!r) return problems.push(`${where}[${i}]: no row`);
        const rx = r.extra ? JSON.parse(r.extra) : {};
        if (!el || typeof el !== "object") {
          if (!same(rx.$value, normalize(el))) problems.push(`${where}[${i}]: scalar element lost`);
          return;
        }
        for (const ek of Object.keys(el)) {
          if (el[ek] === undefined) continue;
          if (ek === "_id") {
            if (r.id !== idText(el._id)) problems.push(`${where}[${i}]._id`);
            continue;
          }
          const lc = lt.cols.find((c) => (c.field ?? c.col) === ek);
          if (lc) {
            if (r[lc.col] !== convert(lc.type, el[ek])) problems.push(`${where}[${i}].${ek}: ${JSON.stringify(r[lc.col])} vs ${canonicalJson(el[ek])}`);
          } else if (!(ek in rx) || !same(rx[ek], el[ek])) problems.push(`${where}[${i}].${ek}: not in a column or the line's extra`);
        }
      });
      continue;
    }
    if (flat.has(k) && v && typeof v === "object" && !Array.isArray(v)) {
      const cols = flat.get(k)!;
      for (const sk of Object.keys(v)) {
        if (sk === "_id" || v[sk] === undefined) continue;
        const c = cols.get(sk);
        if (c) {
          if (row[c.col] !== convert(c.type, v[sk])) problems.push(`${where}.${sk}: ${JSON.stringify(row[c.col])}`);
        } else if (!extra[k] || !same(extra[k][sk], v[sk])) problems.push(`${where}.${sk}: not in a column or extra`);
      }
      continue;
    }
    if (flat.has(k) && typeof v === "string") {
      const c = flat.get(k)!.get("line1");
      if (!c || row[c.col] !== v) problems.push(`${where}: string subdocument not kept in line1`);
      continue;
    }
    const c = direct.get(k);
    if (c) {
      const want = convert(c.type, v);
      if (row[c.col] !== want) problems.push(`${where}: D1 ${JSON.stringify(row[c.col])} vs ${JSON.stringify(want)}`);
      // A value of the right kind must round-trip exactly (only off-type legacy values may be coerced or NULLed).
      if (c.type === "json" && !same(JSON.parse(row[c.col]), v)) problems.push(`${where}: JSON differs`);
      if (c.type === "text" && typeof v === "string" && row[c.col] !== v) problems.push(`${where}: text differs`);
      if (c.type === "real" && typeof v === "number" && row[c.col] !== v) problems.push(`${where}: number differs`);
      if (c.type === "bool" && typeof v === "boolean" && row[c.col] !== (v ? 1 : 0)) problems.push(`${where}: bool differs`);
      continue;
    }
    if (!(k in extra) || !same(extra[k], v)) problems.push(`${where}: not in a column, child table or extra`);
  }
  return problems;
}

const WH_A = new ObjectId();
const WH_B = new ObjectId();
const ITEM_1 = new ObjectId();
const ITEM_2 = new ObjectId();
const SUP_1 = new ObjectId();

async function seed() {
  const raw = (c: string) => mongoose.connection.db!.collection(c);

  // ── purchasing ──
  await PurchaseEntry.create({
    billNo: "PB-2026-001", supplierName: "Value Plus Retail", supplierGST: "09ABCDE1234F1Z5", supplierId: SUP_1, warehouseId: WH_A,
    linkedPoNo: "PO-0001", billingEntity: "valueplus", billDate: "2026-11-01", dueDate: "2026-12-01",
    items: [
      { itemId: String(ITEM_1), name: "Samsung 55\" Crystal 4K", quantity: 2, rate: 41250.5, gstRate: 18, hsn: "8528", serialNumbers: ["SN-A1", "SN-A2"] },
      { itemId: String(ITEM_2), name: "LG 260L फ्रिज", quantity: 1, rate: 22000, gstRate: 18 },
    ],
    subtotal: 104501, gst: 18810.18, total: 123311.18, paid: 50000, balance: 73311.18, status: "partial",
  });
  await PurchaseEntry.create({
    billNo: "PB-2026-002", supplierName: "Ashoka Distributors", type: "debit-note", billingEntity: "ashoka", billDate: "2026-10-28",
    noPoReason: "urgent restock", items: [], total: 0, status: "cancelled", cancelledAt: "2026-10-29T10:00:00.000Z", cancelledBy: "admin",
    cancelReason: "duplicate", lastModifiedReason: "cancel", backdateStatus: "approved", backdateRequestedBy: "sm1", backdateMadeOn: "2026-10-30",
  });
  // Legacy shapes written without the schema: line keys the table does not know, a null line, a string supplierId,
  // a numeric string, an unknown top-level field, no timestamps.
  await raw("purchase_entries").insertOne({
    _id: new ObjectId(), billNo: "OLD-7", supplierName: "Old Supplier", supplierId: "free-text-supplier", billDate: "2024-01-05",
    items: [{ _id: new ObjectId(), itemId: "x1", name: "Legacy fan", quantity: "3", rate: 999, gstRate: 12, mrp: 1500, batch: { no: "B1" } }, null, "loose text"],
    total: "1,234.50", status: "paid", legacyNote: "migrated from Tally", __v: 2,
  });
  // `items` not an array at all.
  await raw("purchase_entries").insertOne({ _id: new ObjectId(), billNo: "OLD-8", supplierName: "Odd", billDate: "2024-01-06", items: { itemId: "x2" }, total: 1, createdAt: new Date("2024-01-06T05:00:00Z"), updatedAt: new Date("2024-01-06T05:00:00Z") });

  await DeletedPurchaseEntry.create({
    billNo: "PB-2026-000", supplierName: "Value Plus Retail", total: 5000, deletedAt: new Date("2026-11-02T08:15:00Z"), deletedBy: "admin",
    deletedByRole: "admin", deletedByUserId: "u1", deleteReason: "entered twice", pinVerified: true,
    snapshot: { _id: new ObjectId(), billNo: "PB-2026-000", items: [{ itemId: "i9", quantity: 1, rate: 5000 }], createdAt: new Date("2026-11-01T00:00:00Z") },
    restoredHint: "strict:false field",
  });
  await PurchaseOrder.create({
    poNo: "PO-0001", supplierName: "Value Plus Retail", date: new Date("2026-10-30T06:30:00Z"), expectedDate: new Date("2026-11-05T00:00:00Z"),
    totalAmount: 123311.18, subtotal: 104501, gst: 18810.18, status: "received",
    items: [{ itemId: String(ITEM_1), name: "Samsung 55\"", quantity: 2, rate: 41250.5, gstRate: 18 }],
  });
  await Expense.create({ expenseNo: "EXP-001", category: "Electricity", description: "Nov bill — बिजली", amount: 4520.75, date: "2026-11-03", paymentMode: "Cash" });

  // ── stock documents ──
  await StockAdjustment.create({
    adjustmentNo: "ADJ-001", date: "2026-11-04", reason: "Damaged in transit", warehouseId: WH_A,
    items: [{ itemId: String(ITEM_1), itemName: "Samsung 55\"", quantity: 1, type: "out", remarks: "screen cracked" }, { itemId: String(ITEM_2), itemName: "LG fridge", quantity: 2, type: "in" }],
  });
  await StockJournal.create({
    journalNumber: "SJ-001", date: "2026-11-04", purpose: "Opening balance",
    items: [{ itemId: ITEM_1, itemName: "Samsung 55\"", warehouseId: WH_B, quantity: 4, type: "in" }],
  });
  await StockOrderRequest.create({
    requestNumber: "SOR-001", status: "sent", salesperson: "Ravi", salespersonId: "u7", note: "for Diwali",
    items: [{ itemCode: "VP001", description: "LED 43", brand: "LG", groupName: "TV", productDesc: "43 inch", charDesc: "Smart", warehouse: "GKP", availableAtRequest: 5, quantity: 2 }],
    totalQuantity: 2, approvedBy: "admin", approvedAt: new Date("2026-11-05T09:00:00Z"), message: "Please send 2 x VP001", sentBy: "admin", sentAt: new Date("2026-11-05T09:05:00Z"),
    mergedFrom: ["SOR-000A", "SOR-000B"],
  });
  await StockOrderRequest.create({ requestNumber: "SOR-002", status: "rejected", salesperson: "Asha", items: [{ itemCode: "VP002", quantity: 1 }], rejectedBy: "admin", rejectedAt: new Date("2026-11-06T09:00:00Z"), rejectReason: "out of stock", mergedInto: "SOR-003" });
  await StockRequest.create({ requestNumber: "SR-001", date: "2026-11-05", requestingWarehouseId: WH_A, supplyingWarehouseId: WH_B, items: [{ itemId: ITEM_1, itemName: "Samsung", requestedQty: 3 }], status: "Approved" });
  await StockReturn.create({ returnNumber: "RET-001", date: "2026-11-06", returnType: "Customer Return", referenceId: "INV-1001", items: [{ itemId: ITEM_2, itemName: "LG fridge", quantity: 1, reason: "noisy" }] });
  await StockTransfer.create({
    transferNo: "TR-001", fromWarehouse: "Showroom", toWarehouse: "GIDA Godown", fromWarehouseId: WH_A, toWarehouseId: WH_B, date: "2026-11-06", status: "completed", totalValue: 82501,
    items: [{ itemId: String(ITEM_1), itemName: "Samsung 55\"", quantity: 2, unit: "PCS", costPrice: 41250.5 }],
  });
  await SerialNumber.create({
    serialNumber: "SN-A1", itemId: String(ITEM_1), vpCode: "VP001", itemName: "Samsung 55\"", status: "SOLD", purchaseEntryId: "pe1", invoiceId: "inv1",
    invoiceNumber: "VP/26-27/0042", customerName: "राम कुमार", customerPhone: "9800000000", soldDate: "2026-11-07", price: 52999,
    history: [{ action: "PURCHASED", date: new Date("2026-11-01T10:00:00Z") }, { action: "SOLD", date: new Date("2026-11-07T11:00:00Z"), performedBy: "Ravi", details: "bill 42" }],
  });
  await SerialNumber.create({ serialNumber: "SN-A2", itemId: String(ITEM_1), vpCode: "VP001", itemName: "Samsung 55\"" });

  // The full daily audit: 450 lines, a third counted.
  const auditItems = Array.from({ length: 450 }, (_, i) => ({
    productId: `P${i}`, productName: `Product ${i} — लंबा नाम ${"x".repeat(i % 40)}`, vpCode: `VP${String(i).padStart(4, "0")}`, category: i % 3 ? "TV" : "Fridge",
    expectedStock: (i % 7) + 1, physicalStock: i % 3 === 0 ? (i % 7) + 1 : 0, difference: 0, condition: i === 5 ? "Damaged" : "Good", remarks: i === 5 ? "dent" : "",
    counted: i % 3 === 0, countedBy: i % 3 === 0 ? "staff-" + (i % 4) : "", countedAt: i % 3 === 0 ? new Date(Date.UTC(2026, 10, 8, 4, i % 60)) : undefined,
  }));
  await InventoryAudit.create({
    auditDate: "2026-11-08", auditor: "Inventory Manager", category: "All Categories", items: auditItems, totalExpected: 1800, totalPhysical: 600, totalDiscrepancy: 1200,
    status: "In Progress", auditorId: "u2", warehouse: "Showroom", kind: "all", completionTime: "10:15:00 am", notes: "",
  });
  await InventoryAudit.create({ auditDate: "2026-11-07", auditor: "Ravi", items: [{ productId: "P1", productName: "x", expectedStock: 1 }], status: "Completed", completedBy: "u2", completedAt: new Date("2026-11-07T15:00:00Z"), kind: "mobile" });

  await BillOfMaterial.create({ bomNumber: "BOM-1", finishedGoodItemId: ITEM_1, finishedGoodName: "Combo", expectedQuantity: 1, components: [{ itemId: ITEM_2, itemName: "part", quantity: 2, cost: 100 }], totalCost: 200 });
  await SupplierStockItem.create({ itemCode: "VP001", description: "LED 43", brand: "LG", groupName: "AUDIO & VIDEO", productDesc: "43", charDesc: "Smart", warehouse: "GKP", availableStock: 12, previousStock: 0, isNewArrival: true, uploadId: "up1" });
  await SupplierStockItem.create({ itemCode: "VP001", warehouse: "LKO", availableStock: 0, active: false });
  await SupplierStockUpload.create({ fileName: "stock 13-11.xlsx", uploadedBy: "admin", uploadedByRole: "admin", rowCount: 527, newProducts: 3, totalUnits: 4410 });

  // ── vendors ──
  await Vendor.create({
    code: "V001", name: "Shree Traders", contactPerson: "Mohan", email: "st@example.com", phone: "9811111111", altPhone: "", gstNumber: "09AAACS1234Q1Z2",
    address: { line1: "Golghar", line2: "Near bank", city: "Gorakhpur", state: "Uttar Pradesh", pincode: "273001" },
    creditLimit: 250000, creditDays: 45, openingBalance: -1250.5, openingBalanceDate: "2026-04-01",
    bankDetails: { bankName: "HDFC", accountNumber: "5010001", ifscCode: "HDFC0000492", accountType: "Current" }, notes: "pays monthly",
  });
  await raw("vendors").insertOne({
    _id: new ObjectId(), code: "V-LEG", name: "Legacy Vendor", phone: "9822222222", address: "12 Old Market, Gorakhpur",
    bankDetails: { bankName: "SBI", branch: "Civil Lines" }, creditLimit: Decimal128.fromString("50000.25"), status: "inactive", tags: ["wholesale"],
  });
  await VendorBill.create({
    billNo: "VB-001", vendorId: "v1", vendorName: "Shree Traders", date: "2026-11-09", dueDate: "2026-12-09",
    items: [{ name: "Install service", description: "5 units", quantity: 5, rate: 500, amount: 2500 }], subtotal: 2500, gstRate: 18, gstAmount: 450, total: 2950, reference: "PO 77", createdBy: "admin",
  });
  await VendorBill.create({ billNo: "VB-002", vendorId: "v1", vendorName: "Shree Traders", date: "2026-11-10", total: 100, status: "cancelled", cancelledAt: "2026-11-10", cancelledBy: "admin", cancelReason: "typo" });
  await VendorPayment.create({ paymentId: "VP-001", vendorId: "v1", vendorName: "Shree Traders", date: "2026-11-10", amount: 2950, mode: "NEFT", refNo: "UTR123", againstBillNo: "VB-001", receivedBy: "cashier", type: "received", createdBy: "admin", createdByRole: "admin" });

  // ── cash ──
  await CashTransaction.create({ type: "INFLOW", category: "CASH_SALE", amount: 52999, date: "2026-11-07", referenceNo: "VP/26-27/0042", description: "बिल 42", partyName: "राम कुमार", recordedBy: "cashier" });
  await CashTransaction.create({
    type: "OUTFLOW", category: "MD_HANDOVER", amount: 100000, date: "2026-11-07", time: "08:30:00 pm", referenceNo: "HO-7", handedTo: "MD",
    adminStatus: "confirmed", adminReviewedBy: "admin", adminReviewedAt: "2026-11-07T15:10:00.000Z",
  });
  await CashTransaction.create({ type: "OUTFLOW", category: "BANK_DEPOSIT", amount: 0.01, date: "2026-11-08", referenceNo: "DEP-1", targetBankAccount: "HDFC 0492", adminStatus: "rejected", adminRejectReason: "wrong amount" });
  await DayClose.create({
    date: "2026-11-07", openingCash: 15000, systemExpectedCash: 67999, systemOpeningCash: 15000, dayCashIn: 52999, dayCashFromInvoices: 52999, dayCashOut: 0,
    countedCash: 68000, denominations: [{ value: 500, count: 100 }, { value: 200, count: 90 }], coinsAmount: 0, difference: 1, notes: "₹1 extra",
    closedBy: "cashier", closedByRole: "cashier", closedAt: "2026-11-07T16:30:00.000Z",
  });
  await DayClose.create({ date: "2026-11-06", systemExpectedCash: 1000, countedCash: 1000, difference: 0, closedBy: "cashier", closedAt: "2026-11-06T16:30:00.000Z", originalSystemExpectedCash: 900, originalDifference: 100, recalculatedAt: "2026-11-07T05:00:00.000Z", recalculatedBy: "admin" });
  await AdminCashEntry.create({ type: "DEPOSIT", amount: 100000, date: "2026-11-08", time: "11:00", bankAccountId: "b1", bankAccount: "HDFC 0492", referenceNo: "SLIP-9", recordedBy: "admin", recordedByUserId: "u1" });
  await AdminCashEntry.create({ type: "EXPENSE", amount: 250, date: "2026-11-08", recordedBy: "admin", voided: true, voidedBy: "admin", voidedAt: "2026-11-08T12:00:00.000Z", voidReason: "duplicate" });
  await BankAccount.create({ name: "HDFC Current", bank: "HDFC", number: "50200012345678", type: "current", balance: 1234567.89 });
  await CashRegisterSetting.create({ key: "cash-register", openingCash: 15000, countedCash: 15000, calibratedBy: "admin", calibratedAt: "2026-11-01T04:00:00.000Z" });
  await Variant.create({ name: "Colour", values: ["Black", "Silver", "शैम्पेन"] });
  await Variant.create({ name: "Size" });
  await ProductCatalogReference.create({ vpCode: " vp0099 ", description: "LED 32", brand: "Samsung", groupName: "AUDIO & VIDEO", category: "LED TV", productDesc: "32", charDesc: "HD" });
}

/** Mongo docs vs D1 rows for one collection: counts, line-row totals, and the lossless check for every document. */
async function compareCollection(db: D1DatabaseLike, spec: MasterSpec): Promise<{ docs: number; problems: string[]; lineRows: number; expectedLines: number }> {
  const docs = await mongoose.connection.db!.collection(spec.collection).find().toArray();
  const problems: string[] = [];
  for (const d of docs) problems.push(...(await losslessProblems(db, spec, d)));
  let lineRows = 0;
  let expectedLines = 0;
  for (const ch of spec.children || []) {
    const lt = Object.values(LINE_TABLES).find((t) => t.table === ch.table)!;
    lineRows += await count(db, ch.table);
    expectedLines += docs.reduce((n, d: any) => n + (Array.isArray(d[lt.field]) ? d[lt.field].length : d[lt.field] == null ? 0 : 1), 0);
  }
  if ((await count(db, spec.table)) !== docs.length) problems.push(`${spec.table}: D1 count ${await count(db, spec.table)} vs Mongo ${docs.length}`);
  return { docs: docs.length, problems, lineRows, expectedLines };
}

async function main() {
  await startMemoryMongo("d1_stock_cash_test");
  const local = await startLocalD1();
  const db = local.db;
  const mongo = mongoose.connection.db!;
  try {
    // ── 1. migration ──
    const files = await applyMigrations(db);
    check(files[0].startsWith("0001_") && files.includes("0003_stock_cash.sql"), `migrations applied in order: ${files.join(", ")}`);
    const myTables = STOCK_CASH_SPECS.flatMap((s) => [s.table, ...(s.children || []).map((c) => c.table)]);
    const others = readdirSync(path.join(process.cwd(), "d1", "migrations")).filter((f) => f.endsWith(".sql") && f !== "0003_stock_cash.sql");
    const clash = others.flatMap((f) => {
      const sql = readFileSync(path.join(process.cwd(), "d1", "migrations", f), "utf8");
      return myTables.filter((t) => new RegExp(`CREATE\\s+(TABLE|INDEX)\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${t}\\b`, "i").test(sql)).map((t) => `${f}:${t}`);
    });
    check(clash.length === 0, `0003's tables are created by no other migration (${others.join(", ")})${clash.length ? " CLASH " + clash.join(",") : ""}`);
    const mine = readFileSync(path.join(process.cwd(), "d1", "migrations", "0003_stock_cash.sql"), "utf8");
    const created = Array.from(mine.matchAll(/CREATE TABLE (\w+)/g), (m) => m[1]);
    check(JSON.stringify([...created].sort()) === JSON.stringify([...myTables].sort()), `0003 creates exactly the ${myTables.length} tables of the specs`);
    const indexNames = Array.from(mine.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+) ON (\w+)/g), (m) => [m[1], m[2]]);
    check(indexNames.every(([n, t]) => myTables.includes(t) && n.startsWith(t + "_")) && !/UNIQUE/.test(mine.replace(/--.*$/gm, "")), `${indexNames.length} indexes, all non-unique and on 0003's own tables`);
    const allTables = ALL_SPECS.map((s) => s.table);
    check(new Set(allTables).size === allTables.length && new Set(ALL_SPECS.map((s) => s.collection)).size === ALL_SPECS.length, "no table or collection is registered twice");

    check(STOCK_CASH_SPECS.length === 25, `25 collections in the area (${STOCK_CASH_SPECS.length})`);
    for (const spec of STOCK_CASH_SPECS) {
      const cols = (await all(db, `PRAGMA table_info(${spec.table})`)).map((c) => c.name);
      const want = tableColumns(spec);
      check(JSON.stringify(cols) === JSON.stringify(want) && want.length <= 100, `${spec.table}: ${cols.length} columns match the mapping (≤ 100: one row per statement)`);
      for (const child of spec.children || []) {
        const ccols = (await all(db, `PRAGMA table_info(${child.table})`)).map((c) => c.name);
        const lt = Object.values(LINE_TABLES).find((t) => t.table === child.table)!;
        check(JSON.stringify(ccols) === JSON.stringify(child.columns) && JSON.stringify(lineColumns(lt)) === JSON.stringify(child.columns), `${child.table}: ${ccols.length} columns match`);
        const fks = await all(db, `PRAGMA foreign_key_list(${child.table})`);
        check(fks.length === 1 && fks[0].table === spec.table && fks[0].on_delete === "CASCADE", `${child.table}: FK to ${spec.table} ON DELETE CASCADE`);
      }
    }
    // Each spec reads the collection its model uses (Expense and StockTransfer have no explicit name).
    const byModel = Object.entries(MODELS).map(([name, m]) => [name, m.collection.collectionName as string]);
    const specColls = new Set(STOCK_CASH_SPECS.map((s) => s.collection));
    check(byModel.every(([, c]) => specColls.has(c)) && byModel.length === specColls.size, `collections match the models: ${byModel.map(([n, c]) => `${n}=${c}`).join(", ")}`);

    // ── 2. mapping edge cases, without a database ──
    const pe = STOCK_CASH_SPECS.find((s) => s.collection === "purchase_entries")!;
    const bare = await mapDoc(pe, { _id: new ObjectId("650000000000000000000003") }, "2026-11-13T00:00:00.000Z");
    check(bare.row.billNo === null && bare.row.extra === null && bare.children[0].rows.length === 0, "bare purchase entry: NULLs, no lines, no extra");
    const variantSpec = STOCK_CASH_SPECS.find((s) => s.collection === "variants")!;
    const vm = await mapDoc(variantSpec, { _id: new ObjectId(), name: "Colour", values: ["Red"] });
    check(vm.row.valuesJson === '["Red"]' && vm.row.extra === null, "Variant.values -> valuesJson (VALUES is a reserved word)");

    // ── 3. full copy ──
    await seed();
    const first = await runD1Sync(db, { reconcile: "skip" });
    check(first.ok && first.errors === 0, `first run ok (${first.ms} ms, errors ${first.errors})`);
    check(STOCK_CASH_SPECS.every((s) => first.collections[s.collection]?.mode === "full" && first.collections[s.collection]?.fullCopyDone), "every collection of the area did its full copy");
    const errs = await all(db, "SELECT * FROM sync_errors");
    if (errs.length) console.log(errs);
    for (const spec of STOCK_CASH_SPECS) {
      const r = await compareCollection(db, spec);
      check(r.docs > 0 && r.problems.length === 0, `${spec.collection}: ${r.docs} docs copied without loss${r.problems.length ? "\n      " + r.problems.slice(0, 8).join("\n      ") : ""}`);
      if (spec.children?.length) check(r.lineRows === r.expectedLines, `${spec.collection}: ${r.lineRows} line rows = ${r.expectedLines} array elements`);
    }

    // Spot checks of the edge cases.
    const old7 = await one(db, "SELECT * FROM purchaseEntries WHERE billNo = 'OLD-7'");
    check(old7.total === 1234.5 && old7.supplierId === "free-text-supplier" && old7.extra === '{"legacyNote":"migrated from Tally"}' && old7.v === 2, "legacy entry: numeric string, free-text supplierId, unknown field in extra, __v");
    const old7Lines = await all(db, "SELECT * FROM purchaseEntryItems WHERE purchaseEntryId = ? ORDER BY lineNo", old7.id);
    check(old7Lines.length === 3 && old7Lines[0].quantity === 3 && old7Lines[0].extra === '{"batch":{"no":"B1"},"mrp":1500}' && old7Lines[1].extra === '{"$value":null}' && old7Lines[2].extra === '{"$value":"loose text"}', "legacy lines: unknown keys in the line's extra, null / text elements kept");
    const old8 = await one(db, "SELECT id FROM purchaseEntries WHERE billNo = 'OLD-8'");
    const old8Lines = await all(db, "SELECT * FROM purchaseEntryItems WHERE purchaseEntryId = ?", old8.id);
    check(old8Lines.length === 1 && old8Lines[0].lineNo === -1 && old8Lines[0].extra === '{"$notArray":{"itemId":"x2"}}', "an `items` that is not an array is kept as one $notArray row");
    const pb1 = await one(db, "SELECT * FROM purchaseEntries WHERE billNo = 'PB-2026-001'");
    check(pb1.supplierId === String(SUP_1) && pb1.warehouseId === String(WH_A) && pb1.billDate === "2026-11-01" && pb1.total === 123311.18, "ObjectId refs -> 24-hex text, business date kept as text");
    const pb1Lines = await all(db, "SELECT * FROM purchaseEntryItems WHERE purchaseEntryId = ? ORDER BY lineNo", pb1.id);
    check(pb1Lines.length === 2 && pb1Lines[0].serialNumbers === '["SN-A1","SN-A2"]' && /^[0-9a-f]{24}$/.test(pb1Lines[0].id) && pb1Lines[1].name === "LG 260L फ्रिज" && pb1Lines[1].serialNumbers === "[]", "purchase lines: serials JSON, line _id kept, unicode");
    const del = await one(db, "SELECT * FROM deletedPurchaseEntries");
    check(del.deletedAt === "2026-11-02T08:15:00.000Z" && del.pinVerified === 1 && JSON.parse(del.snapshot).items[0].rate === 5000 && JSON.parse(del.extra).restoredHint === "strict:false field", "deleted entry: Date -> ISO, snapshot JSON, strict:false field in extra");
    const po = await one(db, "SELECT * FROM purchaseOrders");
    check(po.date === "2026-10-30T06:30:00.000Z" && JSON.parse(po.items)[0].rate === 41250.5, "purchase order: Date -> ISO, items JSON");
    const audit = await one(db, "SELECT * FROM inventoryAudits WHERE auditDate = '2026-11-08'");
    check((await count(db, "inventoryAuditItems", "WHERE auditId = ?", audit.id)) === 450 && (await count(db, "inventoryAuditItems", "WHERE auditId = ? AND counted = 1", audit.id)) === 150, "450-line audit: 450 child rows, live progress is a COUNT(*) WHERE counted = 1");
    const p5 = await one(db, "SELECT * FROM inventoryAuditItems WHERE auditId = ? AND productId = 'P0'", audit.id);
    check(p5.countedAt === "2026-11-08T04:00:00.000Z" && p5.counted === 1 && p5.countedBy === "staff-0", "audit line: countedAt ISO, counted 0/1");
    const vend = await one(db, "SELECT * FROM vendors WHERE code = 'V001'");
    check(vend.address_city === "Gorakhpur" && vend.address_country === "India" && vend.bank_ifscCode === "HDFC0000492" && vend.openingBalance === -1250.5 && vend.nameLower === "shree traders", "vendor flattened (schema default country kept), negative opening balance");
    const vleg = await one(db, "SELECT * FROM vendors WHERE code = 'V-LEG'");
    check(vleg.address_line1 === "12 Old Market, Gorakhpur" && vleg.creditLimit === 50000.25 && vleg.extra === '{"bankDetails":{"branch":"Civil Lines"},"tags":["wholesale"]}' && vleg.createdAt === vleg.updatedAt, "legacy vendor: string address, Decimal128, unknown bank key and field in extra, ObjectId time");
    const dc = await one(db, "SELECT * FROM dayCloses WHERE date = '2026-11-07'");
    check(JSON.parse(dc.denominations)[1].count === 90 && dc.notes === "₹1 extra" && dc.closedAt === "2026-11-07T16:30:00.000Z", "day close: denominations JSON, text kept as is");
    check((await one(db, "SELECT valuesJson FROM variants WHERE name = 'Colour'")).valuesJson === '["Black","Silver","शैम्पेन"]', "variant values JSON");
    check((await one(db, "SELECT vpCode FROM productCatalogReferences")).vpCode === "VP0099", "catalog vpCode as mongoose stored it (uppercased, trimmed)");
    check((await one(db, "SELECT * FROM cashTransactions WHERE referenceNo = 'DEP-1'")).amount === 0.01, "small amounts exact");

    // No row anywhere near D1's 2 MB limit.
    let biggest = { table: "", bytes: 0 };
    for (const t of myTables) {
      for (const r of await all(db, `SELECT * FROM ${t}`)) {
        const bytes = new TextEncoder().encode(JSON.stringify(r)).length;
        if (bytes > biggest.bytes) biggest = { table: t, bytes };
      }
    }
    check(biggest.bytes < 100_000, `largest row ${biggest.bytes} bytes (${biggest.table}), far under 2 MB`);

    const idle = await runD1Sync(db, { reconcile: "skip" });
    check(idle.ok && STOCK_CASH_SPECS.every((s) => idle.collections[s.collection].mode === "incremental" && idle.collections[s.collection].copied === 0), "second run: incremental, nothing rewritten");

    // ── 4. incremental: lines replaced, never duplicated ──
    const pbDoc = await PurchaseEntry.findOne({ billNo: "PB-2026-001" });
    await PurchaseEntry.updateOne({ _id: pbDoc!._id }, { $set: { items: [{ itemId: String(ITEM_2), name: "LG 260L", quantity: 5, rate: 21000, gstRate: 18 }], subtotal: 105000 } });
    const auditDoc = await InventoryAudit.findOne({ auditDate: "2026-11-08" });
    await InventoryAudit.updateOne(
      { _id: auditDoc!._id },
      { $set: { "items.$[it].counted": true, "items.$[it].physicalStock": 9, "items.$[it].countedBy": "late-staff", "items.$[it].countedAt": new Date("2026-11-08T06:00:00Z") } },
      { arrayFilters: [{ "it.productId": "P1" }] }
    );
    await StockTransfer.create({ transferNo: "TR-002", fromWarehouse: "GIDA Godown", toWarehouse: "Showroom", date: "2026-11-09", items: [{ itemId: String(ITEM_2), itemName: "LG", quantity: 1 }, { itemId: String(ITEM_1), itemName: "Samsung", quantity: 1 }] });
    await CashTransaction.updateOne({ referenceNo: "DEP-1" }, { $set: { adminStatus: "confirmed", adminReviewedBy: "admin" } });
    await Vendor.updateOne({ code: "V001" }, { $set: { "address.city": "Lucknow" } });
    const linesBefore = await count(db, "purchaseEntryItems");
    const incr = await runD1Sync(db, { reconcile: "skip" });
    check(incr.ok && incr.collections.purchase_entries.copied === 1 && incr.collections.inventory_audits.copied === 1 && incr.collections.stocktransfers.copied === 1 && incr.collections.cash_transactions.copied === 1 && incr.collections.vendors.copied === 1, `incremental copied exactly the changed documents (${JSON.stringify(Object.fromEntries(STOCK_CASH_SPECS.map((s) => [s.collection, incr.collections[s.collection].copied]).filter(([, n]) => n)))})`);
    const newLines = await all(db, "SELECT * FROM purchaseEntryItems WHERE purchaseEntryId = ?", String(pbDoc!._id));
    check(newLines.length === 1 && newLines[0].quantity === 5 && newLines[0].lineNo === 0 && (await count(db, "purchaseEntryItems")) === linesBefore - 1, "purchase lines replaced (2 -> 1), none duplicated");
    check((await count(db, "inventoryAuditItems", "WHERE auditId = ?", String(auditDoc!._id))) === 450, "audit still has exactly 450 line rows after an update");
    const p1 = await one(db, "SELECT * FROM inventoryAuditItems WHERE auditId = ? AND productId = 'P1'", String(auditDoc!._id));
    check(p1.counted === 1 && p1.physicalStock === 9 && p1.countedBy === "late-staff" && p1.countedAt === "2026-11-08T06:00:00.000Z", "an arrayFilters count reached the audit line row");
    check((await count(db, "stockTransferItems")) === 3, "new transfer's lines added");
    check((await one(db, "SELECT address_city FROM vendors WHERE code = 'V001'")).address_city === "Lucknow", "flattened subdocument change copied");
    for (const spec of STOCK_CASH_SPECS) {
      const r = await compareCollection(db, spec);
      check(r.problems.length === 0 && r.lineRows === r.expectedLines, `after incremental: ${spec.collection} lossless${r.problems.length ? " " + r.problems.slice(0, 5).join("; ") : ""}`);
    }

    // ── 5. reconciliation: a deleted document takes its lines with it ──
    await PurchaseEntry.deleteOne({ billNo: "OLD-7" });
    await StockJournal.deleteMany({});
    const rec = await runD1Sync(db, { reconcile: "force" });
    check(rec.ok && rec.collections.purchase_entries.reconcile?.deleted === 1 && rec.collections.stock_journals.reconcile?.deleted === 1, "reconciliation deleted the removed documents");
    check((await count(db, "purchaseEntryItems", "WHERE purchaseEntryId = ?", old7.id)) === 0 && (await count(db, "stockJournalItems")) === 0, "and their line rows");

    // ── 6. counts and hashes match ──
    const status = await getD1SyncStatus(db, { sampleSize: 1000 });
    for (const spec of STOCK_CASH_SPECS) {
      const cs = status.collections.find((c) => c.collection === spec.collection)!;
      const ok = cs.mongoCount === cs.d1Count && !cs.error && cs.sample!.size === cs.mongoCount && cs.sample!.mismatched === 0 && cs.sample!.missing === 0;
      check(ok, `status ${spec.collection}: Mongo ${cs.mongoCount} = D1 ${cs.d1Count}, ${cs.sample?.size} hashes match${cs.childCounts ? ", lines " + JSON.stringify(cs.childCounts) : ""}`);
    }
    for (const spec of STOCK_CASH_SPECS.filter((s) => s.children?.length)) {
      const r = await compareCollection(db, spec);
      check(r.lineRows === r.expectedLines, `${spec.collection}: line rows ${r.lineRows} = Mongo array elements ${r.expectedLines}`);
    }
    check((await count(db, "sync_errors")) === 0, "no copy errors");

    // The lossless check itself catches a lost line key, a wrong line value and a lost top-level field.
    const peSpec = STOCK_CASH_SPECS.find((s) => s.collection === "purchase_entries")!;
    const pbNow = await mongo.collection("purchase_entries").findOne({ billNo: "PB-2026-001" });
    await db.prepare("UPDATE purchaseEntryItems SET quantity = 4 WHERE purchaseEntryId = ?").bind(String(pbNow!._id)).run();
    check((await losslessProblems(db, peSpec, pbNow)).some((p) => p.includes(".items[0].quantity")), "lossless check flags a changed line value");
    const vSpec = STOCK_CASH_SPECS.find((s) => s.collection === "vendors")!;
    const vlegDoc = await mongo.collection("vendors").findOne({ code: "V-LEG" });
    await db.prepare("UPDATE vendors SET extra = NULL WHERE code = 'V-LEG'").run();
    const vp = await losslessProblems(db, vSpec, vlegDoc);
    check(vp.some((p) => p.includes(".tags")) && vp.some((p) => p.includes(".bankDetails.branch")), "lossless check flags fields missing from extra");
  } finally {
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-stock-cash") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
