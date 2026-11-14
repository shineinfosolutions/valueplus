/**
 * D1 reads of the purchase, stock and cash area (lib/repo/stock, stage B2 of docs/D1_MIGRATION_PLAN.md): every entry
 * of STOCK_READS returns from D1 exactly what its MongoDB query returns, for several argument combinations.
 *
 * Realistic data is seeded in MongoDB (in memory): purchase bills with lines, serial numbers, debit notes and cancelled
 * bills, purchase orders, expenses (cash and not), transfers in transit / received, adjustments, journals, requests,
 * returns, bills of material, live audits (one with 450 lines, today's "all" and "mobile" ones), serial numbers sold /
 * available / returned (names with regex characters and Devanagari), GIDA orders (merged ones too), supplier stock,
 * vendors with bills and payments, cash transactions with pending / rejected / confirmed handovers, day closes, Admin
 * cash entries, bank accounts with legacy cash-register rows, catalogue references and variants. Many rows share a
 * createdAt / date on purpose, so the tie order is checked too. The production indexes (lib/ensure-indexes.ts) and
 * the models' own indexes are built first, so MongoDB picks the plans it picks in production.
 *
 * Everything is then copied to a local D1 with the real copy job (lib/d1/sync.ts), and for each read
 * JSON.stringify(norm(mongo)) must equal JSON.stringify(norm(d1)).
 *
 * The only normalisation (applied to both sides, after a JSON round trip, as a route sends them):
 *  - object keys sorted (D1 cannot know the order fields were written in; no consumer depends on it);
 *  - keys whose value is null dropped (D1 stores a missing field and an explicit null both as NULL).
 * Array order is never changed. A read that throws must throw on both sides.
 */
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { holdsDocuments, stripScalarDefaults } from "./helpers/legacy-docs";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { runD1Sync } from "@/lib/d1/sync";
import { STOCK_CASH_SPECS } from "@/lib/d1/maps/stock-cash";
import { ensureIndexes } from "@/lib/ensure-indexes";
import { STOCK_READS } from "@/lib/repo/stock";
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

const { ObjectId } = mongoose.Types;

const MODELS = [
  PurchaseEntry, DeletedPurchaseEntry, PurchaseOrder, Expense, StockAdjustment, StockJournal, StockOrderRequest,
  StockRequest, StockReturn, StockTransfer, SerialNumber, InventoryAudit, BillOfMaterial, SupplierStockItem,
  SupplierStockUpload, Vendor, VendorBill, VendorPayment, CashTransaction, DayClose, AdminCashEntry, BankAccount,
  CashRegisterSetting, Variant, ProductCatalogReference,
] as any[];

// ---------------------------------------------------------------------------
// Normalisation (both sides)
// ---------------------------------------------------------------------------

function tidy(v: any): any {
  if (Array.isArray(v)) return v.map(tidy);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== null) out[k] = tidy(v[k]);
    return out;
  }
  return v;
}
const norm = (v: any) => JSON.stringify(tidy(JSON.parse(JSON.stringify(v === undefined ? null : v))));

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-10-01T04:30:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

/** A document as the model would save it (defaults, subdocument ids), with set timestamps; written raw so createdAt ties are exact. */
function prep(Model: any, obj: any, created: Date, updated: Date = created) {
  const d = new Model(obj).toObject();
  d.createdAt = created;
  d.updatedAt = updated;
  d.__v = 0;
  return d;
}
async function put(Model: any, docs: any[]) {
  if (docs.length) await Model.collection.insertMany(docs);
}

const ITEM_IDS = Array.from({ length: 12 }, () => new ObjectId());
const ITEM_NAMES = [
  "LG 260L फ्रिज",
  "MC2846BG.DBKQILN(LG CONVECTION MWO)",
  "Samsung 43\" Smart TV",
  "Whirlpool 7kg Washer",
  "iPhone Air ",
  "Voltas 1.5T AC [Inverter]",
  "Bajaj Mixer 750W",
  "Sony Bravia 55",
  "Haier 190L",
  "Godrej Almirah",
  "Philips Iron 50% off",
  "Kent RO_Plus",
];
const VP = (i: number) => `VP-${1001 + i}`;
const WH = [new ObjectId(), new ObjectId()];
const SUPPLIERS = [new ObjectId(), new ObjectId(), new ObjectId()];
const VENDOR_IDS = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];

async function seed() {
  // ── Purchase entries: 40 (entries, debit notes, cancelled), with ties on createdAt and billDate ──
  const pes: any[] = [];
  for (let i = 0; i < 40; i++) {
    const debit = i % 9 === 4;
    const cancelled = i % 7 === 3;
    const lines = Array.from({ length: 1 + (i % 4) }, (_, j) => {
      const k = (i + j) % ITEM_IDS.length;
      const qty = 1 + ((i + j) % 3);
      const line: any = {
        itemId: i % 11 === 10 && j === 0 ? "" : String(ITEM_IDS[k]),
        name: ITEM_NAMES[k],
        quantity: qty,
        rate: 1000 + k * 250.5,
        gstRate: k % 2 ? 18 : 28,
        hsn: k % 3 ? "8418" : "",
        serialNumbers: k % 2 === 0 ? Array.from({ length: qty }, (_, s) => `SN-${i}-${j}-${s}`) : [],
      };
      return line;
    });
    const total = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
    const doc: any = {
      billNo: debit ? `DN-${100 + i}` : `PB-2026-${String(i).padStart(3, "0")}`,
      supplierName: ["Sharma Electronics", "LG India Pvt Ltd", "Gupta Traders"][i % 3],
      supplierGST: i % 3 === 1 ? "09AAACL1234F1Z5" : "",
      supplierId: i % 5 === 0 ? undefined : SUPPLIERS[i % 3],
      warehouseId: WH[i % 2],
      linkedPoNo: i % 6 === 0 ? `PO-${i}` : undefined,
      type: debit ? "debit-note" : "entry",
      billingEntity: i % 4 === 0 ? "ashoka" : "valueplus",
      // Bill dates repeat (several bills per day).
      billDate: `2026-10-${String(1 + Math.floor(i / 3)).padStart(2, "0")}`,
      dueDate: i % 2 ? `2026-11-${String(1 + (i % 28)).padStart(2, "0")}` : undefined,
      items: lines,
      subtotal: Math.round(total * 100) / 100,
      gst: Math.round(total * 0.18 * 100) / 100,
      total: Math.round(total * 1.18 * 100) / 100,
      paid: i % 3 === 0 ? Math.round(total * 1.18 * 100) / 100 : i % 3 === 1 ? 500 : 0,
      balance: i % 3 === 0 ? 0 : 1000,
      status: cancelled ? "cancelled" : ["paid", "partial", "pending"][i % 3],
      ...(cancelled ? { cancelledAt: "2026-10-20", cancelledBy: "Admin", cancelReason: "Wrong supplier", lastModifiedReason: "cancel" } : {}),
    };
    // createdAt: groups of 3 share the exact same instant.
    const d = prep(PurchaseEntry, doc, at(Math.floor(i / 3) * 60), at(Math.floor(i / 3) * 60 + 5));
    if (i === 7) d.legacyNote = "migrated from Tally"; // unknown field -> extra
    if (i === 8) d.items[0].mrp = 15990; // unknown line key -> line extra
    if (i === 9) d.date = "2026-10-03"; // a `date` some old bills carry (aged stock reads it)
    pes.push(d);
  }
  await put(PurchaseEntry, pes);

  await put(DeletedPurchaseEntry, [0, 1, 2, 3, 4].map((i) =>
    prep(DeletedPurchaseEntry, {
      billNo: `PB-DEL-${i}`, supplierName: i % 2 ? "LG India Pvt Ltd" : "Sharma Electronics", total: 10000 + i,
      deletedAt: new Date(Date.parse("2026-11-10T10:00:00.000Z") + (i % 3) * 3600_000 * 20),
      deletedBy: i === 3 ? "Ravi (Cashier)" : "Admin", deletedByRole: "admin", deleteReason: "Duplicate entry",
      pinVerified: i % 2 === 0, snapshot: { billNo: `PB-DEL-${i}`, items: [{ name: "x", quantity: 1 }], total: 10000 + i },
    }, at(1000 + i))
  ));

  await put(PurchaseOrder, Array.from({ length: 6 }, (_, i) =>
    prep(PurchaseOrder, {
      poNo: `PO-${i}`, supplierName: "LG India Pvt Ltd", date: new Date(`2026-10-0${1 + i}T00:00:00.000Z`),
      expectedDate: i % 2 ? new Date("2026-10-20T00:00:00.000Z") : undefined, totalAmount: 50000 + i * 1000,
      subtotal: 42000, gst: 8000, status: ["sent", "received", "partial", "pending"][i % 4],
      items: [{ itemId: String(ITEM_IDS[i]), name: ITEM_NAMES[i], quantity: 2, rate: 21000, gstRate: 18 }],
    }, at(i < 3 ? 100 : 100 + i))
  ));

  await put(Expense, Array.from({ length: 12 }, (_, i) =>
    prep(Expense, {
      expenseNo: `EXP-${i}`, category: ["Tea", "Transport", "Electricity"][i % 3], description: `Expense ${i}`,
      amount: 100 + i * 37.5, date: `2026-10-${String(1 + (i % 6) * 2).padStart(2, "0")}`,
      paymentMode: ["Cash", "cash", "UPI", "Bank"][i % 4], status: "paid",
    }, at(200 + Math.floor(i / 2)))
  ));

  // ── Stock documents ──
  await put(StockTransfer, Array.from({ length: 8 }, (_, i) =>
    prep(StockTransfer, {
      transferNo: `ST-${i}`, fromWarehouse: "Kunraghat Showroom", toWarehouse: "Godown 2", fromWarehouseId: WH[0], toWarehouseId: WH[1],
      items: [
        { itemId: String(ITEM_IDS[i]), itemName: ITEM_NAMES[i], quantity: 1 + i, costPrice: 1000 * i },
        { itemId: String(ITEM_IDS[i + 1]), itemName: ITEM_NAMES[i + 1], quantity: 2, unit: "Nos" },
      ],
      totalValue: 1000 * i, date: `2026-10-${String(10 + Math.floor(i / 2)).padStart(2, "0")}`,
      status: i % 2 ? "received" : "in-transit",
    }, at(300 + Math.floor(i / 3)))
  ));
  await put(StockAdjustment, Array.from({ length: 4 }, (_, i) =>
    prep(StockAdjustment, {
      adjustmentNo: `ADJ-${i}`, date: "2026-10-12", reason: "Damaged in transit", warehouseId: WH[0],
      items: [{ itemId: String(ITEM_IDS[i]), itemName: ITEM_NAMES[i], quantity: 1, type: i % 2 ? "in" : "out", remarks: i % 2 ? undefined : "box torn" }],
    }, at(400))
  ));
  await put(StockJournal, Array.from({ length: 3 }, (_, i) =>
    prep(StockJournal, {
      journalNumber: `SJ-${i}`, date: "2026-10-13", purpose: "Assembly",
      items: [
        { itemId: ITEM_IDS[i], itemName: ITEM_NAMES[i], warehouseId: WH[0], quantity: 2, type: "out" },
        { itemId: ITEM_IDS[i + 3], itemName: ITEM_NAMES[i + 3], quantity: 1, type: "in" },
      ],
    }, at(410 + i))
  ));
  await put(StockRequest, Array.from({ length: 3 }, (_, i) =>
    prep(StockRequest, {
      requestNumber: `SR-${i}`, date: "2026-10-14", requestingWarehouseId: WH[1], supplyingWarehouseId: WH[0],
      items: [{ itemId: ITEM_IDS[i], itemName: ITEM_NAMES[i], requestedQty: 3 }], status: ["Pending", "Approved", "Fulfilled"][i],
    }, at(420))
  ));
  await put(StockReturn, Array.from({ length: 3 }, (_, i) =>
    prep(StockReturn, {
      returnNumber: `RT-${i}`, date: "2026-10-15", returnType: i ? "Supplier Return" : "Customer Return", referenceId: `INV-${i}`,
      items: [{ itemId: ITEM_IDS[i], itemName: ITEM_NAMES[i], quantity: 1, reason: "Defective" }],
    }, at(430 + i))
  ));
  await put(BillOfMaterial, Array.from({ length: 2 }, (_, i) =>
    prep(BillOfMaterial, {
      bomNumber: `BOM-${i}`, finishedGoodItemId: ITEM_IDS[5], finishedGoodName: ITEM_NAMES[5], expectedQuantity: 1,
      components: [{ itemId: ITEM_IDS[6], itemName: ITEM_NAMES[6], quantity: 2, cost: 150 }], totalCost: 300,
    }, at(440))
  ));

  // ── Live audits: one with 450 lines, today's "all" (in progress) and "mobile" ones, older completed ones ──
  const auditLines = (n: number, countedEvery: number) =>
    Array.from({ length: n }, (_, j) => ({
      productId: String(ITEM_IDS[j % ITEM_IDS.length]), productName: `${ITEM_NAMES[j % ITEM_NAMES.length]} #${j}`,
      vpCode: VP(j % 12), category: j % 2 ? "Refrigerator" : "Television", expectedStock: j % 5,
      physicalStock: j % countedEvery === 0 ? j % 5 : 0, difference: 0, condition: j % 50 === 0 ? "Damaged" : "Good",
      remarks: j % 77 === 0 ? "dent on door" : "", counted: j % countedEvery === 0,
      countedBy: j % countedEvery === 0 ? "Ravi" : "", countedAt: j % countedEvery === 0 ? new Date(Date.parse("2026-11-14T05:00:00.000Z") + j * 1000) : undefined,
    }));
  await put(InventoryAudit, [
    prep(InventoryAudit, { auditDate: "2026-11-14", auditor: "Ravi", items: auditLines(450, 3), status: "In Progress", kind: "all", totalExpected: 900, completionTime: "10:30:00 am" }, at(5000)),
    prep(InventoryAudit, { auditDate: "2026-11-14", auditor: "Ravi", items: auditLines(30, 2), status: "Completed", kind: "mobile", completionTime: "11:00:00 am", completedAt: new Date("2026-11-14T06:00:00.000Z") }, at(5000)),
    prep(InventoryAudit, { auditDate: "2026-11-13", auditor: "Sita", items: auditLines(40, 1), status: "Completed", kind: "all", completionTime: "9:00:00 pm" }, at(4000)),
    prep(InventoryAudit, { auditDate: "2026-11-13", auditor: "Sita", items: auditLines(10, 1), status: "Discrepancy Found", completionTime: "9:10:00 pm" }, at(4000)),
    prep(InventoryAudit, { auditDate: "2026-11-12", auditor: "Sita", items: [], status: "Completed", kind: "mobile", completionTime: "8:00:00 pm" }, at(3000)),
  ]);

  // ── Serial numbers ──
  await put(SerialNumber, Array.from({ length: 60 }, (_, i) => {
    const k = i % ITEM_IDS.length;
    const status = i % 5 === 0 ? "SOLD" : i % 11 === 0 ? "RETURNED" : "AVAILABLE";
    return prep(SerialNumber, {
      serialNumber: `SN-${String(i).padStart(4, "0")}${i % 4 === 0 ? "A" : ""}`, itemId: String(ITEM_IDS[k]), vpCode: VP(k),
      itemName: ITEM_NAMES[k], warehouse: i % 2 ? "Godown 2" : "Kunraghat Showroom", purchaseEntryId: String(pes[i % 40]._id),
      price: 1000 + k, status,
      ...(status === "SOLD" ? { invoiceId: String(new ObjectId()), invoiceNumber: `SVAK2026RI${i}`, customerName: "Amit", customerPhone: "9876543210", soldDate: "2026-11-02" } : {}),
      history: [{ action: `Inward via Bill #${pes[i % 40].billNo}`, date: new Date("2026-10-05T06:00:00.000Z"), performedBy: "Purchase Inward", details: "Supplier: LG" }],
    }, at(600 + Math.floor(i / 4)));
  }));

  // ── GIDA stock orders ──
  const sp = ["665f00000000000000000001", "665f00000000000000000002"];
  await put(StockOrderRequest, Array.from({ length: 8 }, (_, i) =>
    prep(StockOrderRequest, {
      requestNumber: `GO-${i}`, status: i === 6 ? "merged" : i === 7 ? "approved" : ["pending", "sent", "rejected"][i % 3],
      salesperson: i % 2 ? "Rahul" : "Mohan", salespersonId: i === 7 ? "" : sp[i % 2], note: i % 3 ? "" : "urgent",
      items: [{ itemCode: `IC-${i}`, description: "LG 1.5T AC", brand: "LG", quantity: 1 + i, availableAtRequest: 5 }],
      totalQuantity: 1 + i, ...(i === 7 ? { mergedFrom: ["GO-0", "GO-2"], approvedBy: "Admin", approvedAt: new Date("2026-11-03T05:00:00.000Z") } : {}),
      ...(i === 6 ? { mergedInto: "GO-7" } : {}),
    }, at(700 + Math.floor(i / 3)))
  ));

  // ── Supplier stock: the newest upload today ──
  await put(SupplierStockUpload, [0, 1, 2].map((i) =>
    prep(SupplierStockUpload, { fileName: `stock-${i}.xlsx`, uploadedBy: "Ravi", uploadedByRole: "cashier", rowCount: 30, newProducts: i, totalUnits: 120 }, at(800 + i))
  ));
  await put(SupplierStockItem, Array.from({ length: 30 }, (_, i) =>
    prep(SupplierStockItem, {
      itemCode: `IC-${i}`, description: i % 4 === 0 ? "AC 1.5T" : `Item ${i % 6}`, brand: ["LG", "Samsung", "", "Voltas"][i % 4],
      groupName: "AC", warehouse: i % 2 ? "Noida" : "Lucknow", availableStock: i % 7 === 0 ? 0 : i % 5, previousStock: 2,
      isNewArrival: i % 6 === 0, active: i % 9 !== 0,
    }, at(800))
  ));

  // ── Vendors, bills, payments ──
  await put(Vendor, VENDOR_IDS.map((_id, i) =>
    prep(Vendor, {
      _id, code: `VEN-000${i + 1}`, name: ["Ram Traders", "Shyam Distributors", "Kunraghat Sales", "Old Vendor"][i],
      phone: `90000000${i}${i}`, status: i === 3 ? "inactive" : "active", openingBalance: i * 1000,
      openingBalanceDate: i ? "2026-04-01" : "", address: { line1: `Shop ${i}`, city: "Gorakhpur" },
      bankDetails: i % 2 ? { bankName: "SBI", accountNumber: `1234${i}`, ifscCode: "SBIN0001849" } : undefined,
    }, at(i < 2 ? 900 : 900 + i))
  ));
  await put(VendorBill, Array.from({ length: 12 }, (_, i) =>
    prep(VendorBill, {
      billNo: `VB-${i}`, vendorId: String(VENDOR_IDS[i % 3]), vendorName: "Ram Traders",
      date: `2026-10-${String(5 + Math.floor(i / 4)).padStart(2, "0")}`, dueDate: i % 2 ? "2026-11-05" : "",
      items: [{ name: "Installation", quantity: 2, rate: 500, amount: 1000 }], subtotal: 1000, gstRate: 18, gstAmount: 180,
      total: 1180 + i, status: i % 5 === 4 ? "cancelled" : "open", ...(i % 5 === 4 ? { cancelledAt: "2026-10-09", cancelledBy: "Admin", cancelReason: "dup" } : {}),
    }, at(950 + Math.floor(i / 2)))
  ));
  await put(VendorPayment, Array.from({ length: 12 }, (_, i) =>
    prep(VendorPayment, {
      paymentId: `VP-PAY-${i}`, vendorId: String(VENDOR_IDS[i % 3]), vendorName: "Ram Traders",
      date: `2026-10-${String(6 + Math.floor(i / 3)).padStart(2, "0")}`, amount: 500 + i * 10, mode: i % 2 ? "UPI" : "Cash",
      againstBillNo: i % 3 ? "" : `VB-${i}`, type: i % 4 === 3 ? "paid" : "received",
    }, at(980 + Math.floor(i / 3)))
  ));

  // ── Cash ──
  await put(CashTransaction, Array.from({ length: 20 }, (_, i) => {
    const handover = i % 4 === 0;
    return prep(CashTransaction, {
      type: i % 3 === 0 ? "INFLOW" : "OUTFLOW", category: handover ? "MD_HANDOVER" : i % 3 === 0 ? "OTHER_RECEIPT" : "BANK_DEPOSIT",
      amount: 1000 + i * 100, date: `2026-11-${String(1 + Math.floor(i / 2)).padStart(2, "0")}`, time: i % 2 ? "14:05" : "10:30:00 am",
      referenceNo: `CT-${i}`, description: handover ? "Evening handover" : "", recordedBy: "Ravi",
      ...(handover ? { adminStatus: ["pending", "rejected", "confirmed"][(i / 4) % 3], ...(i === 4 ? { adminRejectReason: "short by 500" } : {}) } : {}),
    }, at(1100 + Math.floor(i / 2)));
  }));
  await put(DayClose, Array.from({ length: 10 }, (_, i) =>
    prep(DayClose, {
      date: `2026-11-${String(1 + i).padStart(2, "0")}`, openingCash: 0, systemExpectedCash: 5000 + i, countedCash: 5000 + i - (i % 3) * 10,
      denominations: [{ value: 500, count: 8 + i }, { value: 100, count: 10 }], coinsAmount: i, difference: -(i % 3) * 10,
      closedBy: "Ravi", closedByRole: "cashier", closedAt: `2026-11-${String(1 + i).padStart(2, "0")}T21:00:00+05:30`,
      ...(i === 2 ? { originalSystemExpectedCash: 4000, recalculatedAt: "2026-11-10", recalculatedBy: "Admin" } : {}),
    }, at(1200 + i))
  ));
  await put(AdminCashEntry, Array.from({ length: 8 }, (_, i) =>
    prep(AdminCashEntry, {
      type: ["OPENING", "DEPOSIT", "EXPENSE", "OTHER_OUT"][i % 4], amount: 100 + i, date: `2026-11-0${1 + Math.floor(i / 3)}`,
      time: "12:00", recordedBy: "Admin", voided: i === 5, ...(i === 5 ? { voidedBy: "Admin", voidedAt: "2026-11-05", voidReason: "typo" } : {}),
    }, at(1300 + Math.floor(i / 2)))
  ));
  await put(BankAccount, [
    { name: "HDFC Current", bank: "HDFC Bank", number: "50200012345678", type: "current" },
    { name: "SBI Savings", bank: "SBI", number: "3012345678", type: "savings", ifsc: "SBIN0001849" },
    { name: "Cash Register", bank: "Cash", number: "CASH-001", type: "cash" },
    { name: "Main CASH REGISTER drawer", bank: "Cash", number: "X-1", type: "current" },
    { name: "Petty", bank: "Cash", number: "cash-register-2", type: "savings" },
    { name: "Bank of Baroda", bank: "Baroda", number: "BOB-9", type: "current", status: "inactive" },
  ].map((b, i) => prep(BankAccount, b, at(i < 3 ? 1400 : 1400 + i))));
  await put(CashRegisterSetting, [prep(CashRegisterSetting, { key: "cash-register", openingCash: 12500, countedCash: 12500, calibratedBy: "Admin", calibratedAt: "2026-11-01" }, at(1500))]);

  // ── Small masters ──
  await put(Variant, ["Colour", "Capacity", "Size"].map((name, i) => prep(Variant, { name, values: i === 2 ? [] : ["A", "B"] }, at(1600))));
  await put(ProductCatalogReference, Array.from({ length: 10 }, (_, i) =>
    prep(ProductCatalogReference, {
      vpCode: VP(9 - i), description: `Ref ${i}`, brand: i % 2 ? "LG" : "Samsung", groupName: ["AC", "TV", "REF"][i % 3],
      category: i % 4 === 0 ? "" : ["Air Conditioner", "Television", "Refrigerator"][i % 3],
    }, at(1700))
  ));
}

// ---------------------------------------------------------------------------
// Cases: every read, several argument combinations
// ---------------------------------------------------------------------------

function cases(): Record<string, any[]> {
  return {
    "purchaseEntries.list": [{}, { type: "debit-note" }, { type: "entry" }, { type: "nothing" }],
    "purchaseEntries.allNatural": [{}],
    "purchaseEntries.allNewestFirst": [{}],
    "purchaseEntries.byBillDateDesc": [{}, { startDate: "2026-10-03", endDate: "2026-10-08" }, { startDate: "2026-10-03" }],
    "purchaseEntries.gstr2": [{}],
    "purchaseEntries.agedStock": [{}],
    "purchaseEntries.dashboard": [{}],
    "purchaseEntries.profitLoss": [{}, { startDate: "2026-10-02", endDate: "2026-10-09" }, { startDate: "2026-10-05" }, { endDate: "2026-10-04" }],
    "purchaseEntries.brandInfo": [
      { id: String(ITEM_IDS[0]), name: ITEM_NAMES[0] },
      { id: String(ITEM_IDS[1]), name: ITEM_NAMES[1] },
      { id: String(new ObjectId()), name: ITEM_NAMES[4] },
      { id: String(new ObjectId()), name: "no such product" },
    ],
    "purchaseEntries.byBillNo": [{ billNo: "PB-2026-007" }, { billNo: "DN-104" }, { billNo: "PB-NONE" }],
    "deletedPurchaseEntries.audit": [
      // limit 1 and 3 end between two deletedAt values: a limit that cuts through a run of equal deletedAt picks an
      // unspecified member of the run in MongoDB (see INVENTORY.md), so it is not compared.
      { limit: 200 }, { limit: 1 }, { limit: 3 }, { q: "lg", limit: 200 }, { q: "(cashier)", limit: 200 }, { q: "PB-DEL-1", limit: 1 },
      { from: "2026-11-11", limit: 200 }, { from: "2026-11-10", to: "2026-11-11", limit: 200 }, { q: "शर्मा", limit: 200 },
    ],
    "purchaseOrders.list": [{}],
    "purchaseOrders.dashboard": [{}],
    "expenses.list": [{}],
    "expenses.dashboard": [{}],
    "expenses.byIds": [{ ids: [] }, { ids: "__expenseIds__" as any }],
    "expenses.profitLoss": [{}, { startDate: "2026-10-03", endDate: "2026-10-09" }, { startDate: "2026-10-07" }, { endDate: "2026-10-05" }],
    "expenses.cash": [{}],
    "productCatalogReferences.list": [{}],
    "productCatalogReferences.withCategory": [{}],
    "productCatalogReferences.groupMappings": [{ groups: ["AC", "TV"] }, { groups: ["REF"] }, { groups: ["NONE"] }],
    "variants.list": [{}],
    "serialNumbers.byNumbers": [
      { serials: ["SN-0001", "SN-0004A", "SN-9999"], fields: "status" },
      { serials: ["SN-0001", "SN-0004A", "SN-9999"], fields: "number" },
      { serials: [], fields: "number" },
      // SN-0000B is stored last but sorts first: $in on the serialNumber index returns serial-number order.
      { serials: ["SN-0040A", "SN-0000B", "SN-0001"], fields: "status" },
    ],

    "stockAdjustments.list": [{}],
    "stockJournals.list": [{}],
    "stockRequests.list": [{}],
    "stockReturns.list": [{}],
    "billOfMaterials.list": [{}],
    "stockTransfers.list": [{}],
    "stockTransfers.byDateDesc": [{}],
    "productLedger.movements": [{ collection: "stock_adjustments" }, { collection: "stock_returns" }, { collection: "stock_journals" }, { collection: "stocktransfers" }],
    "inventoryAudits.forDay": [{ date: "2026-11-14", kind: "all" }, { date: "2026-11-14", kind: "mobile" }, { date: "2026-11-13", kind: "all" }, { date: "2026-11-12", kind: "all" }],
    "inventoryAudits.byId": "__auditIds__" as any,
    "inventoryAudits.list": [{}, { date: "2026-11-13" }, { date: "2026-01-01" }],
    "serialNumbers.list": [
      {}, { status: "ALL" }, { status: "SOLD" }, { status: "RETURNED", vpCode: VP(0) }, { status: "ALL", itemId: String(ITEM_IDS[3]) },
      { status: "ALL", name: "lg " }, { status: "ALL", name: "फ्रिज" }, { status: "ALL", name: "MC2846BG.DBK" }, { status: "ALL", name: " samsung 43\" " },
      { name: "a(b" }, { status: "ALL", name: "Philips Iron 50%" }, { status: "ALL", name: "RO_plus" },
    ],
    "serialNumbers.productLedger": [
      { itemVpCode: VP(1), itemCode: "C-1", itemId: String(ITEM_IDS[1]), itemName: ITEM_NAMES[1] },
      { itemVpCode: VP(2), itemCode: undefined, itemId: undefined, itemName: "iphone air" },
      { itemVpCode: undefined, itemCode: VP(0), itemId: "", itemName: ITEM_NAMES[0] },
      { itemVpCode: "", itemCode: "", itemId: "", itemName: "voltas 1.5t ac [inverter]" },
    ],
    "serialNumbers.search": [{ q: "SN-00" }, { q: "lg" }, { q: "^SN-001" }, { q: "फ्रिज" }, { q: "zzz" }],
    "stockOrders.list": [{}, { status: "pending" }, { salespersonId: "665f00000000000000000001" }, { salespersonId: "665f00000000000000000002", status: "sent" }, { salespersonId: "" }],
    "stockOrders.pending": [{}],
    "supplierStock.lastUpload": [{}],
    "supplierStock.items": [{}],

    "vendors.list": [{}, { status: "all" }, { status: "active" }, { status: "inactive" }],
    "vendors.ledger": [{}, { id: String(VENDOR_IDS[1]) }, { id: String(new ObjectId()) }, { id: "not-an-id" }],
    "vendors.dashboard": [{}],
    "vendorBills.list": [{}, { vendorId: String(VENDOR_IDS[0]) }, { vendorId: "none" }],
    "vendorBills.ledger": [{}, { id: String(VENDOR_IDS[1]) }],
    "vendorBills.detail": [{ id: String(VENDOR_IDS[0]) }, { id: String(VENDOR_IDS[2]) }],
    "vendorBills.dashboard": [{}],
    "vendorPayments.list": [{}, { vendorId: String(VENDOR_IDS[0]) }, { from: "2026-10-07", to: "2026-10-08" }, { vendorId: String(VENDOR_IDS[1]), from: "2026-10-07" }, { to: "2026-10-06" }],
    "vendorPayments.ledger": [{}, { id: String(VENDOR_IDS[2]) }],
    "vendorPayments.detail": [{ id: String(VENDOR_IDS[0]) }, { id: String(VENDOR_IDS[1]) }],
    "vendorPayments.dashboard": [{}],

    "cashTransactions.all": [{}],
    "cashRegisterSetting.get": [{}],
    "dayCloses.latest": [{}],
    "dayCloses.latestDate": [{}],
    "dayCloses.history": [{}],
    "dayCloses.allAsc": [{}],
    "adminCashEntries.book": [{}],
    "bankAccounts.list": [{}],
    "bankAccounts.legacy": [{}],
  };
}

/**
 * Reads sorted by a key that several documents can share, and the key. MongoDB returns documents with the same sort
 * key in an unspecified order (its in-memory sort is not stable past ~16 documents, and the order differs between
 * builds: the Windows test server and Linux Atlas do not agree), so neither side can be held to MongoDB's tie order.
 * For these reads, on both sides, each run of documents with an equal key is put in _id order; the order of different
 * keys is still compared as it is. D1 itself returns ties in _id (stored) order.
 */
const TIE_KEYS: Record<string, (d: any) => unknown[]> = {
  "purchaseEntries.list": (d) => [d.createdAt],
  "purchaseEntries.allNewestFirst": (d) => [d.createdAt],
  "purchaseEntries.brandInfo": (d) => [d.billDate],
  "deletedPurchaseEntries.audit": (d) => [d.deletedAt],
  "purchaseOrders.list": (d) => [d.createdAt],
  "purchaseOrders.dashboard": (d) => [d.createdAt],
  "expenses.list": (d) => [d.createdAt],
  "expenses.dashboard": (d) => [d.createdAt],
  "expenses.cash": (d) => [d.createdAt],
  "variants.list": (d) => [d.createdAt],
  "stockAdjustments.list": (d) => [d.createdAt],
  "stockJournals.list": (d) => [d.createdAt],
  "stockRequests.list": (d) => [d.createdAt],
  "stockReturns.list": (d) => [d.createdAt],
  "billOfMaterials.list": (d) => [d.createdAt],
  "stockTransfers.list": (d) => [d.createdAt],
  "stockTransfers.byDateDesc": (d) => [d.date, d.createdAt],
  "inventoryAudits.list": (d) => [d.auditDate, d.createdAt],
  "serialNumbers.list": (d) => [d.createdAt],
  "stockOrders.list": (d) => [d.createdAt],
  "stockOrders.pending": (d) => [d.createdAt],
  "supplierStock.items": (d) => [d.isNewArrival, d.brand, d.description],
  "vendors.list": (d) => [d.createdAt],
  "vendorBills.list": (d) => [d.date, d.createdAt],
  "vendorBills.detail": (d) => [d.date],
  "vendorPayments.list": (d) => [d.date, d.createdAt],
  "vendorPayments.detail": (d) => [d.date],
  "cashTransactions.all": (d) => [d.createdAt],
  "adminCashEntries.book": (d) => [d.date, d.createdAt],
  "bankAccounts.list": (d) => [d.createdAt],
};

/** Each run of equal sort keys in _id order (see TIE_KEYS); everything else untouched. */
function settleTies(list: any, key: (d: any) => unknown[]): any {
  if (!Array.isArray(list)) return list;
  const plain = JSON.parse(JSON.stringify(list));
  const out: any[] = [];
  let run: any[] = [];
  const flush = () => {
    out.push(...run.sort((a, b) => (String(a._id) < String(b._id) ? -1 : String(a._id) > String(b._id) ? 1 : 0)));
    run = [];
  };
  for (const d of plain) {
    if (run.length && JSON.stringify(key(run[0])) !== JSON.stringify(key(d))) flush();
    run.push(d);
  }
  flush();
  return out;
}

const keyOf = (d: any) => d?.billNo ?? d?.serialNumber ?? d?.transferNo ?? d?.paymentId ?? d?.requestNumber ?? d?.expenseNo ?? d?.date ?? String(d?._id).slice(-4);

async function runOne(fn: () => Promise<any>, tie?: (d: any) => unknown[]): Promise<{ ok: true; json: string; n: number; keys: string; docs: boolean } | { ok: false; error: string }> {
  try {
    const raw = await fn();
    const v = tie ? settleTies(raw, tie) : raw;
    return { ok: true, json: norm(v), n: Array.isArray(v) ? v.length : v ? 1 : 0, keys: Array.isArray(v) ? v.map(keyOf).join(" ") : "", docs: holdsDocuments(raw) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `@${i}\n      mongo: …${a.slice(Math.max(0, i - 150), i + 150)}\n      d1:    …${b.slice(Math.max(0, i - 150), i + 150)}`;
}

async function compareAll(db: D1DatabaseLike, label: string) {
  const all = cases();
  const expenseIds = (await Expense.find({}, { _id: 1 }).sort({ createdAt: -1 }).limit(5).lean()).map((e: any) => String(e._id)).reverse();
  all["expenses.byIds"][1] = { ids: [...expenseIds, String(new ObjectId())] };
  const auditIds = (await InventoryAudit.find({}, { _id: 1 }).lean()).map((a: any) => ({ id: String(a._id) }));
  all["inventoryAudits.byId"] = [...auditIds, { id: String(new ObjectId()) }];

  const names = Object.keys(STOCK_READS);
  const missing = names.filter((n) => !all[n]);
  check(missing.length === 0, `${label}: every registry entry has test cases${missing.length ? " MISSING " + missing.join(", ") : ""}`);
  const extra = Object.keys(all).filter((n) => !STOCK_READS[n]);
  check(extra.length === 0, `${label}: no case for an unknown read${extra.length ? " " + extra.join(", ") : ""}`);

  let compared = 0;
  for (const name of names) {
    for (const args of all[name] || []) {
      const tie = TIE_KEYS[name];
      const m = await runOne(() => STOCK_READS[name].mongo(args), tie);
      const d = await runOne(() => STOCK_READS[name].d1(args, db), tie);
      const desc = `${label}: ${name}(${JSON.stringify(args).slice(0, 90)})`;
      if (!m.ok || !d.ok) {
        check(!m.ok && !d.ok, `${desc}: both throw (mongo: ${m.ok ? "ok" : m.error.slice(0, 60)} / d1: ${d.ok ? "ok" : d.error.slice(0, 60)})`);
        continue;
      }
      compared++;
      // A non-lean MongoDB read gives mongoose documents (defaults filled in on load): its D1 twin must be hydrated too.
      if (m.n > 0) check(m.docs === d.docs, `${desc}: both sides ${m.docs ? "mongoose documents (non-lean read: D1 hydrates)" : "plain objects"} (mongo ${m.docs}, d1 ${d.docs})`);
      check(m.json === d.json, `${desc}: identical (${m.n} docs, ${m.json.length} bytes)${m.json === d.json ? "" : " " + firstDiff(m.json, d.json) + `
      order mongo: ${m.keys}
      order d1:    ${d.keys}`}`);
    }
  }
  return compared;
}

async function syncAll(db: D1DatabaseLike) {
  const collections = STOCK_CASH_SPECS.map((s) => s.collection);
  for (let i = 0; i < 20; i++) {
    const r = await runD1Sync(db, { reconcile: "skip", collections, budgetMs: 120_000 });
    if (r.errors) throw new Error(`copy job errors: ${r.errors}`);
    if (collections.every((c) => r.collections[c]?.fullCopyDone)) return;
  }
  throw new Error("the copy did not finish");
}

async function main() {
  await startMemoryMongo("d1_stock_reads_test");
  const local = await startLocalD1();
  const db = local.db;
  try {
    await applyMigrations(db);
    // The models' indexes and the production ones, so MongoDB plans these queries as it does live.
    for (const M of MODELS) await M.init();
    await seed();
    const ix = await ensureIndexes();
    check(ix.failed.length === 0, `production indexes built (${ix.created.length} created, ${ix.exists} existed)`);

    await syncAll(db);
    const n = Number((await db.prepare("SELECT COUNT(*) AS n FROM purchaseEntries").first<any>())?.n);
    const lines = Number((await db.prepare("SELECT COUNT(*) AS n FROM inventoryAuditItems").first<any>())?.n);
    check(n === 40 && lines === 530, `copied to D1 (40 purchase entries: ${n}; 530 audit lines: ${lines})`);
    check(Object.keys(STOCK_READS).length >= 60, `${Object.keys(STOCK_READS).length} reads in STOCK_READS`);

    const compared = await compareAll(db, "seeded");

    // Writes after the copy (as write-through would carry them): an edited bill, a new transfer, a received transfer,
    // a sold serial, a new day close. Copied incrementally, then everything compared again.
    await PurchaseEntry.updateOne({ billNo: "PB-2026-001" }, { $set: { status: "paid", paid: 999 }, $push: { items: { itemId: String(ITEM_IDS[2]), name: ITEM_NAMES[2], quantity: 1, rate: 10, gstRate: 18, serialNumbers: ["SN-NEW-1"] } } });
    await StockTransfer.create({ transferNo: "ST-NEW", fromWarehouse: "Kunraghat Showroom", toWarehouse: "Godown 2", items: [{ itemId: String(ITEM_IDS[0]), itemName: ITEM_NAMES[0], quantity: 1 }], date: "2026-11-14" });
    await StockTransfer.updateOne({ transferNo: "ST-0" }, { $set: { status: "received" } });
    await SerialNumber.updateOne({ serialNumber: "SN-0001" }, { $set: { status: "SOLD", invoiceNumber: "SVAK2026RI900", soldDate: "2026-11-14" } });
    await SerialNumber.create({ serialNumber: "SN-0000B", itemId: String(ITEM_IDS[0]), vpCode: VP(0), itemName: ITEM_NAMES[0], history: [{ action: "Added by hand" }] });
    await DayClose.create({ date: "2026-11-13", systemExpectedCash: 100, countedCash: 100, difference: 0, closedBy: "Ravi", closedAt: "2026-11-13T21:00:00+05:30" });
    await InventoryAudit.updateOne({ auditDate: "2026-11-14", kind: "all" }, { $set: { "items.1.counted": true, "items.1.countedBy": "Sita", "items.1.countedAt": new Date("2026-11-14T07:00:00.000Z") } });
    await syncAll(db);
    const compared2 = await compareAll(db, "after writes");

    // Older documents without the defaulted fields (finding of 14 Nov: bankAccounts.list showed branch / ifsc from
    // MongoDB's hydration that D1 did not have). The raw $unset keeps updatedAt, so the copy job is made to copy
    // everything again, as its nightly repair would.
    const stripped = await stripScalarDefaults(MODELS);
    check(stripped > 20, `older documents without their defaulted fields (${stripped})`);
    await db.prepare("UPDATE sync_state SET fullCopyStartedAt = NULL, fullCopyLastId = NULL, fullCopyDoneAt = NULL").run();
    await syncAll(db);
    const bankNull = await db.prepare("SELECT COUNT(*) AS n FROM bankAccounts WHERE ifsc IS NULL AND branch IS NULL").first<any>();
    check(Number(bankNull?.n) >= 1, `a bank account without stored ifsc / branch is in D1 (${bankNull?.n})`);
    const compared3 = await compareAll(db, "older documents");
    console.log(`\n  ${compared + compared2 + compared3} read calls compared`);
  } finally {
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-stock-reads") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
