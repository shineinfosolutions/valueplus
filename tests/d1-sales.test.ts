/**
 * Stage A of the D1 migration, SALES & MONEY area (d1/migrations/0002_sales.sql, lib/d1/maps/sales.ts):
 *  - 0002 applies after 0001, every table has exactly the columns the mapping writes, all within D1's 100 columns;
 *  - each spec reads the collection its model really uses;
 *  - realistic documents for every collection, plus edge cases (missing fields, a 50-line bill, split payments,
 *    finance fields, unicode, legacy shapes, unknown fields) map without loss: every Mongo field (and every key of
 *    every array element that became a child row) is found again in a column, a child row or an `extra` JSON — both
 *    straight from the mapper and read back from D1 after the copy;
 *  - full copy, then incremental copies (a line changed, a line removed, $inc paidAmount, a payment added) replace
 *    the child rows without duplicates; a deleted bill and its child rows go at reconciliation;
 *  - counts and hashes match (the status report).
 * MongoDB in memory and a local D1 (Miniflare); nothing external.
 */
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { ALL_SPEC_BY_COLLECTION } from "@/lib/d1/registry";
import { SALES_SPECS } from "@/lib/d1/maps/sales";
import { tableColumns, mapDoc, canonicalJson, normalize, type MasterSpec, type MappedDoc } from "@/lib/d1/masters-map";
import { runD1Sync, getD1SyncStatus } from "@/lib/d1/sync";
import Invoice from "@/models/Invoice";
import PaymentTransaction from "@/models/PaymentTransaction";
import CustomerAdvance from "@/models/CustomerAdvance";
import Estimate from "@/models/Estimate";
import SalesOrder from "@/models/SalesOrder";
import DeletedInvoice from "@/models/DeletedInvoice";
import DeliveryChallan from "@/models/DeliveryChallan";
import EWayBill from "@/models/EWayBill";
import FinanceTransaction from "@/models/FinanceTransaction";
import ExtendedWarranty from "@/models/ExtendedWarranty";
import DiscountApproval from "@/models/DiscountApproval";
import StoreActivityApproval from "@/models/StoreActivityApproval";
import BillingCompany from "@/models/BillingCompany";

const { ObjectId, Decimal128 } = mongoose.mongo as any;

async function all(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any[]> {
  const res = await db.prepare(sql).bind(...args).all();
  return (res.results || []) as any[];
}
async function one(db: D1DatabaseLike, sql: string, ...args: unknown[]): Promise<any> {
  return db.prepare(sql).bind(...args).first();
}
async function count(db: D1DatabaseLike, table: string): Promise<number> {
  return Number((await one(db, `SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0);
}

const SALES_COLLECTIONS = SALES_SPECS.map((s) => s.collection);

/** Array field -> child table (the rest of a spec's children are 1:1 side tables). */
const ARRAY_CHILDREN: Record<string, Record<string, string>> = {
  invoices: { items: "invoiceItems", payments: "invoicePayments" },
  estimates: { items: "estimateItems" },
  finance_transactions: { emiSchedule: "financeEmiInstallments", linkedInvoices: "financeLinkedInvoices" },
};
const IDX_COLS = new Set(["idx", "lineNo"]);

// ---------------------------------------------------------------------------
// The loss check: every Mongo value is found again, compared independently of the mapper's own conversion.
// ---------------------------------------------------------------------------

/** Does a D1 value hold this Mongo value? */
function same(colValue: unknown, v: unknown): boolean {
  if (v === undefined || v === null) return colValue === null || colValue === 0;
  if (typeof v === "boolean") return colValue === (v ? 1 : 0);
  const n = normalize(v);
  if (typeof n === "number") return colValue === n || (typeof colValue === "string" && colValue === String(n));
  if (typeof n === "string") {
    if (colValue === n) return true;
    if (typeof colValue === "number") return Number(n.replace(/,/g, "")) === colValue; // Decimal128 / "1,234.5"
    const t = Date.parse(n);
    return Number.isFinite(t) && colValue === new Date(t).toISOString(); // a Date column given a legacy string
  }
  if (typeof colValue !== "string") return false;
  try {
    return canonicalJson(JSON.parse(colValue)) === canonicalJson(v);
  } catch {
    return false;
  }
}

interface Found {
  row: Record<string, unknown>;
  /** child table -> rows in idx order */
  children: Record<string, Record<string, unknown>[]>;
}

/** Every top-level field of `doc` (and every key of every child element) is in `found`. Returns the problems. */
function lossCheck(spec: MasterSpec, doc: any, found: Found): string[] {
  const problems: string[] = [];
  const extra = found.row.extra ? JSON.parse(String(found.row.extra)) : {};
  const mainCols = new Set(spec.columns.map((c) => c.col));
  const arrays = ARRAY_CHILDREN[spec.collection] || {};
  const sides = (spec.children || []).filter((c) => !c.columns.some((x) => IDX_COLS.has(x)));
  for (const k of Object.keys(doc)) {
    const v = doc[k];
    if (v === undefined) continue;
    if (k === "_id") {
      if (found.row.id !== String(v)) problems.push("_id");
      continue;
    }
    if (k === "createdAt" || k === "updatedAt") {
      if (v instanceof Date && found.row[k] !== v.toISOString()) problems.push(k);
      continue;
    }
    if (k === "__v") {
      if (found.row.v !== Number(v)) problems.push("__v");
      continue;
    }
    if (k in extra) {
      if (canonicalJson(extra[k]) !== canonicalJson(v)) problems.push(`extra.${k}`);
      continue;
    }
    if (mainCols.has(k)) {
      if (!same(found.row[k], v)) problems.push(`${k}: ${JSON.stringify(found.row[k])} vs ${canonicalJson(v)}`);
      continue;
    }
    const side = sides.find((c) => c.columns.includes(k));
    if (side) {
      const r = found.children[side.table]?.[0];
      if (!r || !same(r[k], v)) problems.push(`${side.table}.${k}`);
      continue;
    }
    if (arrays[k]) {
      const rows = found.children[arrays[k]] || [];
      if (!Array.isArray(v)) {
        const ex = rows.length === 1 && rows[0].extra ? JSON.parse(String(rows[0].extra)) : null;
        if (!ex || canonicalJson(ex.$raw) !== canonicalJson(v)) problems.push(`${k} (not an array)`);
        continue;
      }
      if (rows.length !== v.length) {
        problems.push(`${k}: ${rows.length} rows for ${v.length} elements`);
        continue;
      }
      v.forEach((e: any, i: number) => {
        const r = rows[i];
        const ex = r.extra ? JSON.parse(String(r.extra)) : {};
        if (!e || typeof e !== "object" || Array.isArray(e)) {
          if (canonicalJson(ex.$value) !== canonicalJson(e ?? null)) problems.push(`${k}[${i}] (not an object)`);
          return;
        }
        for (const ek of Object.keys(e)) {
          if (e[ek] === undefined) continue;
          if (ek === "_id" && "id" in r) {
            if (r.id !== String(e._id)) problems.push(`${k}[${i}]._id`);
          } else if (ek in ex) {
            if (canonicalJson(ex[ek]) !== canonicalJson(e[ek])) problems.push(`${k}[${i}].extra.${ek}`);
          } else if (ek in r && !IDX_COLS.has(ek)) {
            if (!same(r[ek], e[ek])) problems.push(`${k}[${i}].${ek}: ${JSON.stringify(r[ek])} vs ${canonicalJson(e[ek])}`);
          } else problems.push(`${k}[${i}].${ek} missing`);
        }
      });
      continue;
    }
    problems.push(`${k} missing`);
  }
  return problems;
}

function foundFromMapped(m: MappedDoc): Found {
  const children: Found["children"] = {};
  for (const c of m.children) {
    children[c.table] = c.rows.map((r) => Object.fromEntries(c.columns.map((col, i) => [col, r[i]])));
  }
  return { row: m.row, children };
}

async function foundFromD1(db: D1DatabaseLike, spec: MasterSpec, id: string): Promise<Found | null> {
  const row = await one(db, `SELECT * FROM ${spec.table} WHERE id = ?`, id);
  if (!row) return null;
  const children: Found["children"] = {};
  for (const c of spec.children || []) {
    const order = c.columns.find((x) => IDX_COLS.has(x));
    children[c.table] = await all(db, `SELECT * FROM ${c.table} WHERE ${c.parentCol} = ?${order ? ` ORDER BY ${order}` : ""}`, id);
  }
  return { row, children };
}

// ---------------------------------------------------------------------------
// Realistic data
// ---------------------------------------------------------------------------

const WH = new ObjectId();

function line(i: number, extra: Record<string, unknown> = {}) {
  const rate = 10000 + i * 137.5;
  const taxable = rate / 1.18;
  return {
    itemId: String(new ObjectId()), itemName: i === 0 ? "सैमसंग 55\" टीवी — Crystal 4K" : `LG Fridge ${i}`, itemCode: `IT${i}`, vpCode: `VP${1000 + i}`,
    hsn: "8528", quantity: 1 + (i % 3), unit: "Pcs", rate, minSellingPrice: rate - 500, costPrice: rate - 2000,
    incentiveType: i % 2 ? "fixed" : "none", incentiveValue: i % 2 ? 200 : 0, incentiveEarned: i % 2 ? 200 : 0,
    incentiveRules: i === 1 ? [{ type: "fixed", value: 200, minPrice: 9000 }] : undefined,
    discount: i % 4 === 0 ? 250 : 0, discountType: "amount", taxableAmount: taxable, gstRate: 18,
    cgst: taxable * 0.09, sgst: taxable * 0.09, igst: 0, amount: rate, serialNumber: i % 5 === 0 ? `SN-${i}-ÄÖ` : "",
    extendedWarrantyProvider: i === 2 ? "Onsitego" : "", extendedWarrantyAmount: i === 2 ? 1999 : 0, stockWarehouseId: i === 3 ? String(WH) : "",
    ...extra,
  };
}

function bill(n: number, over: Record<string, unknown> = {}) {
  return {
    invoiceNumber: `VP/26-27/${String(n).padStart(4, "0")}`, customerId: String(new ObjectId()), customerName: n === 1 ? "राम कुमार" : `Customer ${n}`,
    customerPhone: `98${String(n).padStart(8, "0")}`, warehouseId: WH, date: "2026-11-13", dueDate: "2026-12-13",
    items: [line(0), line(1)], subtotal: 20137.5, taxableAmount: 17065.68, cgst: 1535.91, sgst: 1535.91, totalGST: 3071.82,
    total: 20137.5, paidAmount: 20137.5, balanceAmount: 0, paymentMode: "Cash", salesExecutive: "AMIT SINGH",
    ...over,
  };
}

async function seed() {
  const mongo = mongoose.connection.db!;
  // Invoices through the model (defaults applied, as the app writes them).
  await Invoice.create(bill(1)); // unicode customer and line
  await Invoice.create(bill(2, { items: Array.from({ length: 50 }, (_, i) => line(i)), total: 999999.99, paymentMode: "Multiple",
    payments: [{ mode: "Cash", amount: 10000, receivedBy: "Ravi" }, { mode: "UPI", amount: 40000, txnId: "UTR123" }, { mode: "Finance", amount: 949999.99, reference: "DO-77" }] }));
  await Invoice.create(bill(3, {
    paymentMode: "Finance", financeProvider: "Bajaj Finance Limited", financeDoId: "DO-555", financeAppId: "APP1", financeGrossLoan: 30000,
    financeNetLoan: 28500.5, financeDownPayment: 5000, financeApprovalStatus: "Approved", financePdfUrls: ["r2/a.pdf", "r2/b.pdf"],
    financeDos: [{ provider: "Bajaj", doId: "DO-555", amount: 20000 }, { provider: "Bajaj", doId: "DO-556", amount: 8500.5 }],
    financeTenureMonths: 8, monthlyEMI: 3562.56, cardCategory: "Debit Card", cardAmount: 500, cardLast4: "4242", cardMdrPercent: 1.2,
  }));
  await Invoice.create(bill(4, {
    type: "credit-note", creditNoteRef: "VP/26-27/0001", dispatchType: "delayed_delivery", deliveryStatus: "out_for_delivery",
    expectedDeliveryDate: "2026-11-20", deliveryOtp: "4821", driverName: "Suresh", deliveryProofKeys: ["k1", "k2", "k3"],
    deliveredAt: new Date("2026-11-14T09:00:00Z"), deliveryReminderSentAt: new Date("2026-11-19T03:30:00Z"),
    storeExit: { mode: "delivery", lines: [{ lineIndex: 0, itemName: "TV", serial: "SN1", serialMatched: true, photoKeys: ["p1"], by: "x", at: new Date("2026-11-14T08:00:00Z") }] },
    printLogs: [{ printedAt: "2026-11-13T10:00:00Z", printedBy: "Cashier" }], reprintCount: 1, adminOverridePinUsed: true,
  }));
  await Invoice.create(bill(5, { type: "proforma", status: "draft", items: [] }));
  await Invoice.create(bill(6, { type: "sales-order", status: "pending", paidAmount: 0, balanceAmount: 20137.5, paymentMode: "Due / Credit" }));
  // Legacy / odd invoices straight into the collection: missing fields, unknown fields, numbers as strings,
  // a Decimal128, a line with an unknown key, a payment with an _id, an element that is not an object, no timestamps.
  await mongo.collection("invoices").insertOne({
    _id: new ObjectId(), invoiceNumber: "OLD-1", customerName: "Walk-in", total: Decimal128.fromString("1234.50"), paidAmount: "1,000.25",
    items: [{ _id: new ObjectId(), itemName: "Fan", rate: 1234.5, quantity: 1, legacyColour: "white" }, null],
    payments: [{ _id: new ObjectId(), mode: "Cash", amount: 1000.25 }], legacyCounter: 7, gstBreakup: { "18": 188.3 }, __v: 2,
  });
  await mongo.collection("invoices").insertOne({ _id: new ObjectId(), invoiceNumber: "OLD-2", items: "see paper bill", customerPhone: 9876543210, updatedAt: new Date() });
  await mongo.collection("invoices").insertOne({ _id: new ObjectId(), invoiceNumber: "BARE" });

  await PaymentTransaction.create([
    { transactionId: "PT-1", partyId: "c1", partyType: "Customer", partyName: "राम कुमार", amount: 5000, paymentMode: "UPI", date: "2026-11-13", referenceId: "VP/26-27/0001", type: "received", balanceAfter: -250 },
    { transactionId: "PT-2", partyId: "s1", partyType: "Supplier", partyName: "Value Plus Retail", amount: 125000.5, paymentMode: "Bank Transfer", date: "2026-11-12", type: "paid", bankAccountId: "b1", lastEditedAt: new Date("2026-11-13T05:00:00Z"), editCount: 1 },
  ]);
  await CustomerAdvance.create([
    { receiptNumber: "ADV-2026-0001", customerName: "Sita", customerPhone: "9000000001", amount: 5000, remainingBalance: 5000, date: "2026-11-10", time: "10:30", productBooked: "LG 1.5T AC" },
    { receiptNumber: "ADV-2026-0002", customerId: "c2", customerName: "Gita", customerPhone: "9000000002", amount: 2000, usedAmount: 2000, remainingBalance: 0, status: "Fully Adjusted", linkedInvoiceNumber: "VP/26-27/0002", date: "2026-11-11", time: "12:00" },
  ]);
  await Estimate.create([
    { estimateNumber: "EST-1", customerName: "Mohan", total: 45000, items: [{ itemCode: "IT1", name: "TV", quantity: 1, rate: 45000, amount: 45000, itemId: "x1" }, { itemCode: "IT2", name: "Stand", quantity: 2, rate: 0, amount: 0 }],
      kind: "bill", approvalStatus: "approved", approvedAt: new Date("2026-11-13T06:00:00Z"), financeDoData: { tenure: 8, raw: { a: [1, 2] } },
      priceUnlock: { by: "Admin", byRole: "admin", at: new Date("2026-11-13T05:00:00Z"), lines: [{ itemName: "TV", rate: 45000, lockedMin: 46000 }] }, financePdfUrls: ["r2/do.pdf"] },
    { estimateNumber: "EST-2", customerName: "Ünïcødé ग्राहक", total: 0 },
  ]);
  await SalesOrder.create([{ orderNo: "SO-1", customerName: "Rita", totalAmount: 10000, balanceAmount: 10000, deliveryDate: new Date("2026-11-20T00:00:00Z") }]);
  await DeletedInvoice.create({
    invoiceNumber: "VP/26-27/0099", customerName: "Gone", total: 1000, deletedAt: new Date(), deletedBy: "Admin", deleteReason: "duplicate", pinVerified: true,
    snapshot: { ...bill(99), items: Array.from({ length: 50 }, (_, i) => line(i)) }, legacyExtraField: "kept", restoredFrom: { by: "x" },
  });
  await DeliveryChallan.create([
    { challanNo: "DC-1", type: "Outward Delivery", invoiceNumber: "VP/26-27/0004", destinationParty: "Customer 4", itemName: "TV", deliveryProofKeys: ["a"], autoFromBill: true, deliveredAt: new Date() },
    { challanNo: "DC-2", type: "Supplier Return", destinationParty: "LG", itemName: "Fridge", flowType: "CR", claimStatus: "settled", creditAmount: 15000, settledAt: new Date(), approvalStatus: "approved" },
  ]);
  await EWayBill.create({ ewayBillNo: "EWB-1", invoiceNumber: "VP/26-27/0002", customerName: "Customer 2", deliveryAddress: "Gorakhpur", vehicleNumber: "UP53AB1234",
    items: [{ itemName: "TV", hsn: "8528", quantity: 1, taxableValue: 30000, gstRate: 18 }], taxableValue: 30000, totalGst: 5400, totalAmount: 35400 });
  await FinanceTransaction.create({
    customerName: "Customer 3", customerMobile: "9800000003", invoiceNumber: "VP/26-27/0003", doId: "DO-555", productPrice: 35000, grossLoanAmount: 30000, netLoanAmount: 28500.5, netDisbursement: 28000,
    emiSchedule: Array.from({ length: 12 }, (_, i) => ({ installmentNumber: i + 1, dueDate: `2027-${String(i + 1).padStart(2, "0")}-05`, amount: 3562.56, status: i < 2 ? "Paid" : "Pending", paidDate: i < 2 ? "2027-01-05" : undefined, paymentChannel: i < 2 ? "Shop Counter" : undefined })),
    linkedInvoices: [{ invoiceNumber: "VP/26-27/0006", amount: 5000, linkedAt: new Date("2026-11-13T07:00:00Z") }], uploadedPdfUrls: ["r2/do555.pdf"],
  });
  await mongo.collection("finance_transactions").insertOne({ _id: new ObjectId(), doId: "DO-OLD", emiSchedule: [{ installmentNumber: 1, amount: "999", waived: true }], updatedAt: new Date() });
  await ExtendedWarranty.create({ warrantyId: "EW-1", customerName: "Customer 2", customerPhone: "9800000002", invoiceNumber: "VP/26-27/0002", productName: "TV", vpCode: "VP1000", planName: "2 yr", startDate: "2026-11-13", endDate: "2028-11-12", warrantyAmount: 1999 });
  await DiscountApproval.create({ requestedBy: "Amit", requestedById: "u1", itemName: "TV", sellingPrice: 50000, price: 44000, percent: 12, tier: "admin", reviewedAt: new Date() });
  await StoreActivityApproval.create([
    { activityId: "SA-1", storeName: "Kunraghat", storeInchargeName: "Ravi", storeInchargeEmail: "r@example.com", title: "Price change", description: "TV", activityType: "price_change",
      payload: { kind: "item.update", target: "item:abc", before: { mrp: 1 }, after: { mrp: 2 }, baseVersion: 3 } },
    { activityId: "SA-2", storeName: "Kunraghat", storeInchargeName: "Ravi", storeInchargeEmail: "r@example.com", title: "General", description: "x", status: "approved", superAdminActionAt: new Date() },
  ]);
  await BillingCompany.create([{ gstin: " 09abcde1234f1z5 ", companyName: "Ashoka Traders", pan: "ABCDE1234F" }, { gstin: "09ZZZZZ9999Z1Z9", companyName: "ठाकुर एंटरप्राइज़ेज" }]);
}

async function main() {
  await startMemoryMongo("d1_sales_test");
  const local = await startLocalD1();
  const db = local.db;
  const mongo = mongoose.connection.db!;
  try {
    // ── 1. migration and table shape ──
    const files = await applyMigrations(db);
    check(files[0]?.startsWith("0001_") && files[1] === "0002_sales.sql", `0002 applies after 0001: ${files.join(", ")}`);
    check(SALES_SPECS.length === 13 && SALES_SPECS.every((s) => ALL_SPEC_BY_COLLECTION[s.collection] === s), "13 sales collections registered");
    for (const spec of SALES_SPECS) {
      const cols = (await all(db, `PRAGMA table_info(${spec.table})`)).map((c) => c.name);
      const want = tableColumns(spec);
      // Same set of columns; a column added later by ALTER TABLE sits at the end of the table, and every write names
      // its columns, so the order does not matter.
      check(JSON.stringify([...cols].sort()) === JSON.stringify([...want].sort()), `${spec.table}: columns match the mapping (${cols.length})`);
      check(want.length <= 100, `${spec.table}: ${want.length} columns <= 100 (one row per statement fits 100 params)`);
      for (const child of spec.children || []) {
        const ccols = (await all(db, `PRAGMA table_info(${child.table})`)).map((c) => c.name);
        check(JSON.stringify(ccols) === JSON.stringify(child.columns) && child.columns.length <= 100, `${child.table}: columns match (${ccols.length})`);
      }
    }
    const models: Record<string, any> = {
      invoices: Invoice, payment_transactions: PaymentTransaction, customer_advances: CustomerAdvance, estimates: Estimate, sales_orders: SalesOrder,
      deleted_invoices: DeletedInvoice, delivery_challans: DeliveryChallan, eway_bills: EWayBill, finance_transactions: FinanceTransaction,
      extended_warranties: ExtendedWarranty, discountapprovals: DiscountApproval, store_activity_approvals: StoreActivityApproval, billing_companies: BillingCompany,
    };
    for (const spec of SALES_SPECS) {
      check(models[spec.collection]?.collection?.collectionName === spec.collection, `${spec.table} reads the model's collection "${spec.collection}"`);
    }
    // Every field each schema declares is mapped somewhere (column, side table or child), so nothing normal hits `extra`.
    for (const spec of SALES_SPECS) {
      const paths = Object.keys(models[spec.collection].schema.paths).map((p) => p.split(".")[0]).filter((p) => !["_id", "__v", "createdAt", "updatedAt"].includes(p));
      const missing = [...new Set(paths)].filter((p) => !spec.known.includes(p));
      check(missing.length === 0, `${spec.table}: every schema field is mapped${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
    }

    // ── 2. mapping without a database: every field of every document is found again ──
    await seed();
    let docsChecked = 0;
    for (const spec of SALES_SPECS) {
      const docs = await mongo.collection(spec.collection).find().toArray();
      check(docs.length > 0, `${spec.collection}: ${docs.length} test documents`);
      const problems: string[] = [];
      for (const d of docs) {
        const m = await mapDoc(spec, d, "2026-11-13T00:00:00.000Z");
        for (const p of lossCheck(spec, d, foundFromMapped(m))) problems.push(`${String(d._id)} ${p}`);
        docsChecked++;
      }
      check(problems.length === 0, `${spec.collection}: mapped without loss${problems.length ? `: ${problems.slice(0, 5).join("; ")}` : ""}`);
    }
    check(docsChecked >= 25, `${docsChecked} documents checked`);
    // The check itself catches a loss: a dropped column value, a dropped extra, a missing line, a changed line key.
    {
      const spec = ALL_SPEC_BY_COLLECTION.invoices;
      const d = await mongo.collection("invoices").findOne({ invoiceNumber: "OLD-1" });
      const fresh = async () => foundFromMapped(await mapDoc(spec, d));
      const a = await fresh();
      a.row.invoiceNumber = null;
      const b = await fresh();
      b.row.extra = null;
      const c = await fresh();
      c.children.invoiceItems.pop();
      const e = await fresh();
      e.children.invoiceItems[0].extra = null;
      const f = await fresh();
      f.children.invoicePayments[0].amount = 1;
      check([a, b, c, e, f].every((x) => lossCheck(spec, d, x).length > 0), "the loss check fails on a dropped value, extra, line, line key or changed payment");
    }
    const bare = await mapDoc(ALL_SPEC_BY_COLLECTION.invoices, { _id: new ObjectId("650000000000000000000009") });
    check(bare.row.invoiceNumber === null && bare.row.extra === null && bare.children.every((c) => c.rows.length === 0), "an empty invoice: NULLs, no child rows, no extra");
    const odd = await mongo.collection("invoices").findOne({ invoiceNumber: "OLD-1" });
    const oddMap = await mapDoc(ALL_SPEC_BY_COLLECTION.invoices, odd);
    check(oddMap.row.total === 1234.5 && oddMap.row.paidAmount === 1000.25 && oddMap.row.v === 2, "legacy invoice: Decimal128 and '1,000.25' read as numbers, __v kept");
    check(JSON.parse(String(oddMap.row.extra)).legacyCounter === 7, "legacy invoice: unknown fields in extra");
    const oddLines = oddMap.children.find((c) => c.table === "invoiceItems")!.rows;
    check(oddLines.length === 2 && String(oddLines[0][oddLines[0].length - 1]).includes("legacyColour") && String(oddLines[1][oddLines[1].length - 1]) === '{"$value":null}', "legacy lines: unknown key and a null element kept in the line's extra");
    const sa = await mapDoc(ALL_SPEC_BY_COLLECTION.store_activity_approvals, await mongo.collection("store_activity_approvals").findOne({ activityId: "SA-1" }));
    check(sa.row.payloadKind === "item.update" && sa.row.payloadTarget === "item:abc", "store activity: payload kind / target columns");

    // ── 3. full copy, then read every document back from D1 ──
    const first = await runD1Sync(db, { reconcile: "skip", collections: SALES_COLLECTIONS });
    check(first.ok && first.errors === 0 && !first.timedOut, `full copy ok (${first.ms} ms, errors ${first.errors})`);
    for (const spec of SALES_SPECS) {
      const m = await mongo.collection(spec.collection).countDocuments();
      check(first.collections[spec.collection]?.fullCopyDone && (await count(db, spec.table)) === m, `${spec.table}: Mongo ${m} = D1 ${await count(db, spec.table)}`);
      const problems: string[] = [];
      for (const d of await mongo.collection(spec.collection).find().toArray()) {
        const found = await foundFromD1(db, spec, String(d._id));
        if (!found) problems.push(`${String(d._id)} not in D1`);
        else for (const p of lossCheck(spec, d, found)) problems.push(`${String(d._id)} ${p}`);
      }
      check(problems.length === 0, `${spec.table}: every document read back from D1 without loss${problems.length ? `: ${problems.slice(0, 5).join("; ")}` : ""}`);
    }
    const invs = await mongo.collection("invoices").find().toArray();
    const expectLines = invs.reduce((n, d: any) => n + (Array.isArray(d.items) ? d.items.length : d.items === undefined ? 0 : 1), 0);
    const expectPays = invs.reduce((n, d: any) => n + (Array.isArray(d.payments) ? d.payments.length : 0), 0);
    check((await count(db, "invoiceItems")) === expectLines, `invoiceItems: ${expectLines} rows`);
    check((await count(db, "invoicePayments")) === expectPays, `invoicePayments: ${expectPays} rows`);
    const big = await Invoice.findOne({ invoiceNumber: "VP/26-27/0002" }).lean();
    const bigLines = await all(db, "SELECT * FROM invoiceItems WHERE invoiceId = ? ORDER BY lineNo", String(big!._id));
    check(bigLines.length === 50 && bigLines[49].lineNo === 49 && bigLines[7].id === String((big as any).items[7]._id) && bigLines[0].itemName === "सैमसंग 55\" टीवी — Crystal 4K", "50-line bill: lines in order with their _ids, unicode intact");
    const pays = await all(db, "SELECT mode, amount, txnId FROM invoicePayments WHERE invoiceId = ? ORDER BY idx", String(big!._id));
    check(JSON.stringify(pays.map((p) => p.mode)) === '["Cash","UPI","Finance"]' && pays[1].txnId === "UTR123" && pays.reduce((s, p) => s + p.amount, 0) === 999999.99, "split payments: three rows adding up to the total");
    const fin = await one(db, "SELECT f.*, i.financeDoId, i.financeApprovalStatus FROM invoiceFinance f JOIN invoices i ON i.id = f.invoiceId WHERE i.invoiceNumber = 'VP/26-27/0003'");
    check(fin && fin.financeDoId === "DO-555" && fin.financeApprovalStatus === "Approved" && fin.financeNetLoan === 28500.5 && JSON.parse(fin.financeDos).length === 2 && fin.cardLast4 === "4242", "finance bill: main + invoiceFinance columns, financeDos JSON");
    const dlv = await one(db, "SELECT d.*, i.deliveryStatus FROM invoiceDelivery d JOIN invoices i ON i.id = d.invoiceId WHERE i.invoiceNumber = 'VP/26-27/0004'");
    check(dlv && dlv.deliveryOtp === "4821" && dlv.isShippingSameAsBilling === 1 && JSON.parse(dlv.storeExit).lines[0].at === "2026-11-14T08:00:00.000Z" && dlv.deliveryReminderSentAt === "2026-11-19T03:30:00.000Z", "delivery bill: invoiceDelivery with storeExit JSON and ISO dates");
    check((await count(db, "invoiceDelivery")) === (await mongo.collection("invoices").countDocuments({ isShippingSameAsBilling: { $exists: true } })), "invoiceDelivery: a row only for bills that have delivery fields");
    check((await one(db, "SELECT COUNT(*) AS n FROM invoices WHERE customerName = 'राम कुमार' COLLATE NOCASE")).n === 1, "unicode customer name searchable");
    check((await count(db, "financeEmiInstallments")) === 13 && (await count(db, "financeLinkedInvoices")) === 1, "finance EMI schedule and linked invoices as child rows");
    const emi = await all(db, "SELECT * FROM financeEmiInstallments WHERE dueDate <= '2027-03-31' AND status = 'Pending'");
    check(emi.length === 1 && emi[0].installmentNumber === 3, "EMI rows queryable by due date and status");
    check((await count(db, "estimateItems")) === 2, "estimate lines as child rows");
    const delInv = await one(db, "SELECT * FROM deletedInvoices");
    check(JSON.parse(delInv.snapshot).items.length === 50 && JSON.parse(delInv.extra).legacyExtraField === "kept" && delInv.pinVerified === 1, "deleted invoice: whole snapshot JSON, strict:false extras kept");
    check((await one(db, "SELECT gstin FROM billingCompanies WHERE companyName = 'Ashoka Traders'")).gstin === "09ABCDE1234F1Z5", "billing company gstin as the model stored it (trimmed, uppercased)");

    // ── 4. incremental: lines and payments replaced, not added to ──
    const inv1 = await Invoice.findOne({ invoiceNumber: "VP/26-27/0001" });
    const lines1 = inv1!.toObject().items as any[];
    await Invoice.findByIdAndUpdate(inv1!._id, { $set: { "items.1.rate": 777, "items.1.amount": 777 }, $inc: { paidAmount: -500, balanceAmount: 500 } });
    await Invoice.findByIdAndUpdate(big!._id, { $pop: { items: 1 }, $push: { payments: { mode: "Card", amount: 1 } } });
    await Invoice.findByIdAndUpdate(inv1!._id, { $inc: { paidAmount: 250 } });
    const linesBefore = await count(db, "invoiceItems");
    const paysBefore = await count(db, "invoicePayments");
    const inc = await runD1Sync(db, { reconcile: "skip", collections: SALES_COLLECTIONS });
    check(inc.ok && inc.collections.invoices.mode === "incremental" && inc.collections.invoices.copied === 2, `incremental copied ${inc.collections.invoices.copied} invoices`);
    const r1 = await one(db, "SELECT paidAmount, balanceAmount FROM invoices WHERE id = ?", String(inv1!._id));
    check(r1.paidAmount === 20137.5 - 500 + 250 && r1.balanceAmount === 500, "$inc paidAmount reached D1");
    const l1 = await all(db, "SELECT id, lineNo, rate FROM invoiceItems WHERE invoiceId = ? ORDER BY lineNo", String(inv1!._id));
    check(l1.length === 2 && l1[1].rate === 777 && l1[0].id === String(lines1[0]._id), "changed line replaced in place, no duplicate");
    check((await count(db, "invoiceItems")) === linesBefore - 1 && (await count(db, "invoiceItems WHERE invoiceId = '" + String(big!._id) + "'")) === 49, "removed line gone, no duplicates overall");
    check((await count(db, "invoicePayments")) === paysBefore + 1, "added payment copied once");
    const dupes = await one(db, "SELECT COUNT(*) AS n FROM (SELECT invoiceId, lineNo FROM invoiceItems GROUP BY invoiceId, lineNo HAVING COUNT(*) > 1)");
    check(dupes.n === 0, "no (invoiceId, lineNo) duplicates");
    const again = await runD1Sync(db, { reconcile: "skip", collections: SALES_COLLECTIONS });
    check(again.ok && Object.values(again.collections).every((c) => c.copied === 0), "a run straight after rewrites nothing");

    // ── 5. reconciliation: a deleted bill and its child rows go; a write behind updatedAt is repaired ──
    await Invoice.deleteOne({ _id: big!._id });
    await mongo.collection("finance_transactions").updateOne({ doId: "DO-555" }, { $set: { "emiSchedule.2.status": "Paid", updatedAt: new Date("2025-01-01T00:00:00Z") } });
    const rec = await runD1Sync(db, { reconcile: "force", collections: SALES_COLLECTIONS });
    check(rec.ok && rec.collections.invoices.reconcile?.deleted === 1 && rec.collections.finance_transactions.reconcile?.repaired === 1, "reconcile: 1 bill deleted, 1 finance row repaired");
    check((await count(db, `invoiceItems WHERE invoiceId = '${String(big!._id)}'`)) === 0 && (await count(db, `invoicePayments WHERE invoiceId = '${String(big!._id)}'`)) === 0, "deleted bill's lines and payments gone");
    check((await all(db, "SELECT status FROM financeEmiInstallments WHERE idx = 2 AND financeId = (SELECT id FROM financeTransactions WHERE doId = 'DO-555')"))[0].status === "Paid", "EMI change behind updatedAt repaired");

    // ── 6. counts and hashes match ──
    const status = await getD1SyncStatus(db, { sampleSize: 200 });
    for (const cs of status.collections.filter((c) => SALES_COLLECTIONS.includes(c.collection))) {
      check(cs.mongoCount === cs.d1Count && !cs.error && cs.sample?.size === cs.mongoCount && cs.sample?.mismatched === 0 && cs.sample?.missing === 0, `status ${cs.collection}: ${cs.mongoCount} = ${cs.d1Count}, all hashes match`);
    }
    const finalLines = (await mongo.collection("invoices").find().toArray()).reduce((n, d: any) => n + (Array.isArray(d.items) ? d.items.length : d.items === undefined ? 0 : 1), 0);
    check((await count(db, "invoiceItems")) === finalLines, `invoiceItems = Mongo lines (${finalLines})`);
    check((await count(db, "sync_errors")) === 0, "no sync errors");
  } finally {
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-sales") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
