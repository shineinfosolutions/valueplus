/**
 * Stage B2 of the D1 migration, SALES & MONEY reads (lib/repo/sales/): for every entry of SALES_READS, the D1
 * implementation returns what the Mongo query returns, for a set of argument combinations.
 *
 *  - Realistic data for every collection of the area, built through the models (so stored documents carry the
 *    schema defaults, as saved ones do) and written in a known order with known timestamps: bills of every type and
 *    status (cancelled, credit note, estimate, sales order), cash / UPI / card / split / finance / due payments,
 *    reprints, delayed deliveries, shared-lead lines, warranty lines, legacy extra fields (warehouse, branchName,
 *    branch.name, createdBy, salesperson), bills with the same date and the same createdAt, receipts, advances
 *    partly used, estimates pending / approved / rejected, challans, finance with an EMI schedule, warranties,
 *    discount and store approvals, billing companies, deleted bills.
 *  - The data is copied into a local D1 with the real copy job (lib/d1/sync.ts), then every read is run both ways.
 *  - Compared: JSON.stringify of both results after ONE normalisation, applied identically to both: object keys
 *    sorted at every level (D1 rebuilds a document in column order, Mongo returns stored order; JSON consumers do
 *    not depend on key order). Nothing else: arrays keep their order, also for reads with no sort in Mongo
 *    (`unordered` in the registry), where D1 follows the order of the index the planner picks on the live indexes
 *    (lib/ensure-indexes.ts, built here as on the live database).
 *  - Then the data is changed (a payment added, a bill cancelled, a reprint, an advance used, an approval decided),
 *    copied again incrementally, and everything is compared again.
 *
 * MongoDB in memory and a local D1 (Miniflare); nothing external.
 */
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import { SALES_SPECS } from "@/lib/d1/maps/sales";
import { runD1Sync } from "@/lib/d1/sync";
import { ensureIndexes, INDEXES } from "@/lib/ensure-indexes";
import { SALES_READS } from "@/lib/repo/sales/registry";
import { setSalesReadsDb } from "@/lib/repo/sales/db";
import { SALES_META, project, minimize } from "@/lib/repo/sales/d1-docs";
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

const { ObjectId } = mongoose.Types;
const SALES_COLLECTIONS = SALES_SPECS.map((s) => s.collection);
const MODELS: any[] = [Invoice, PaymentTransaction, CustomerAdvance, Estimate, SalesOrder, DeletedInvoice, DeliveryChallan, EWayBill, FinanceTransaction, ExtendedWarranty, DiscountApproval, StoreActivityApproval, BillingCompany];

// ---------------------------------------------------------------------------
// Normalisation (identical for both sides) and comparison
// ---------------------------------------------------------------------------

function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function canon(value: any): string {
  return JSON.stringify(sortKeys(JSON.parse(JSON.stringify(value ?? null))));
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `@${i}: mongo …${a.slice(Math.max(0, i - 80), i + 80)}…\n         d1    …${b.slice(Math.max(0, i - 80), i + 80)}…`;
}

const covered = new Set<string>();
const sizes: Record<string, number[]> = {};

async function compare(key: string, args: any[], label = "") {
  const entry = SALES_READS[key];
  if (!entry) {
    check(false, `${key}: in the registry`);
    return;
  }
  covered.add(key);
  let m: any, d: any;
  let mErr: any = null;
  let dErr: any = null;
  try {
    m = await entry.mongo(...args);
  } catch (e) {
    mErr = e;
  }
  try {
    d = await entry.d1(...args);
  } catch (e) {
    dErr = e;
  }
  const name = `${key}(${label || args.map((a) => JSON.stringify(a)).join(", ")})`;
  if (mErr || dErr) {
    check(!!mErr && !!dErr, `${name}: both throw (mongo: ${mErr?.message ?? "-"} | d1: ${dErr?.message ?? "-"})`);
    return;
  }
  const a = canon(m);
  const b = canon(d);
  const n = Array.isArray(m) ? m.length : Array.isArray(m?.invoices) ? m.invoices.length : Array.isArray(m?.approvals) ? m.approvals.length : typeof m === "number" ? m : m ? 1 : 0;
  (sizes[key] ||= []).push(n);
  check(a === b, `${name}: identical (${n})${a === b ? "" : "\n         " + firstDiff(a, b)}`);
}

// ---------------------------------------------------------------------------
// Seed: through the models (defaults applied, as a save does), written in order with chosen timestamps
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-11-01T04:30:00.000Z");
let tick = 0;
/** The next creation time (a minute apart), or the same as the previous one when `same`. */
function nextTime(same = false): Date {
  if (!same) tick++;
  return new Date(T0 + tick * 60_000);
}

async function put(model: any, data: Record<string, any>, opts: { same?: boolean; at?: Date; raw?: (doc: any) => void } = {}) {
  const doc: any = new model(data).toObject();
  opts.raw?.(doc);
  const t = opts.at ?? nextTime(opts.same);
  doc.createdAt = t;
  doc.updatedAt = t;
  doc.__v = 0;
  await model.collection.insertOne(doc);
  return doc;
}

function line(itemName: string, quantity: number, rate: number, extra: Record<string, any> = {}) {
  const taxableAmount = Math.round((rate * quantity) / 1.18 * 100) / 100;
  const gst = Math.round((rate * quantity - taxableAmount) * 100) / 100;
  return {
    itemId: new ObjectId().toHexString(),
    itemName,
    itemCode: `IT-${itemName.slice(0, 3).toUpperCase()}`,
    vpCode: `VP${itemName.length}${quantity}`,
    hsn: "8418",
    quantity,
    unit: "Pcs",
    rate,
    minSellingPrice: Math.round(rate * 0.9),
    costPrice: Math.round(rate * 0.8),
    taxableAmount,
    gstRate: 18,
    cgst: gst / 2,
    sgst: gst / 2,
    igst: 0,
    amount: rate * quantity,
    serialNumber: `SN${itemName.length}${quantity}${rate}`,
    ...extra,
  };
}

let billNo = 0;
function bill(day: string, total: number, extra: Record<string, any> = {}) {
  billNo++;
  const taxable = Math.round((total / 1.18) * 100) / 100;
  return {
    invoiceNumber: `VP/26-27/${String(billNo).padStart(4, "0")}`,
    type: "tax-invoice",
    customerId: `CUST-${100 + (billNo % 4)}`,
    customerName: ["Ramesh Gupta", "Sita Devi", "Mohd Arif", "Priya Singh"][billNo % 4],
    customerPhone: ["9839012345", "9415098765", "7007123456", "8960012345"][billNo % 4],
    customerAddress: "Golghar, Gorakhpur",
    customerCity: "Gorakhpur",
    customerPin: "273001",
    date: day,
    dueDate: day,
    status: "paid",
    items: [line("Godrej Refrigerator 260L", 1, total)],
    subtotal: taxable,
    taxableAmount: taxable,
    cgst: Math.round((total - taxable) * 50) / 100,
    sgst: Math.round((total - taxable) * 50) / 100,
    totalGST: Math.round((total - taxable) * 100) / 100,
    total,
    paidAmount: total,
    balanceAmount: 0,
    paymentMode: "Cash",
    salesExecutive: "AMIT SINGH",
    ...extra,
  };
}

const ids: Record<string, any> = {};

async function seed() {
  // ── invoices ──
  ids.cash = (await put(Invoice, bill("2026-11-01", 25000, { warehouseId: new ObjectId() })))._id;
  ids.upi = (await put(Invoice, bill("2026-11-01", 18500, { paymentMode: "UPI", upiTxnId: "UPI123456", warehouse: "Kunraghat Showroom" })))._id;
  await put(Invoice, bill("2026-11-01", 9999.5, { paymentMode: "Card", cardType: "Visa", cardAmount: 9999.5, cardLast4: "4321", cardMdrPercent: 1.2, cardMdrAmount: 119.99, cardNetSettlement: 9879.51, branchName: "Godown" }));
  // split payment: cash + UPI
  ids.split = (
    await put(Invoice, bill("2026-11-02", 50000, {
      paymentMode: "Cash + UPI",
      payments: [
        { mode: "Cash", amount: 10000, receivedBy: "Cashier Neha" },
        { mode: "UPI", amount: 40000, txnId: "UPI998877", reference: "PhonePe" },
      ],
      items: [line("LG Washing Machine 7kg", 1, 32000), line("Voltas AC 1.5T", 1, 18000, { extendedWarrantyProvider: "Onsitego", extendedWarrantyPlan: "2 Year", extendedWarrantyAmount: 1499, extendedWarrantyDuration: 24 })],
      extendedWarrantyTotal: 1499,
      onsitegoIncentive: 149.9,
    }))
  )._id;
  // finance bill with two DOs
  ids.finance = (
    await put(Invoice, bill("2026-11-02", 64990, {
      paymentMode: "Finance",
      financeProvider: "Bajaj Finserv",
      financeDoId: "DO-BAJ-1001",
      financeAppId: "APP-77",
      financeGrossLoan: 54990,
      financeNetLoan: 52990,
      financeDownPayment: 10000,
      financeDownPaymentMode: "UPI",
      financeApprovalStatus: "Disbursed",
      financeDos: [{ provider: "Bajaj Finserv", doId: "DO-BAJ-1001", amount: 44990 }, { provider: "Bajaj Finserv", doId: "DO-BAJ-1002", amount: 10000 }],
      financePdfUrls: ["r2://finance/do-1001.pdf"],
      financeTenureMonths: 8,
      monthlyEMI: 6873.75,
      paidAmount: 10000,
      balanceAmount: 54990,
      items: [line("Samsung TV 55in", 1, 64990, { incentiveType: "fixed", incentiveValue: 500, incentiveEarned: 500, incentiveRules: [{ minQty: 1, amount: 500 }] })],
      salesExecutiveIncentive: 500,
    }))
  )._id;
  // due / credit with cash advance at the counter
  ids.due = (
    await put(Invoice, bill("2026-11-03", 30000, {
      paymentMode: "Due",
      status: "partial",
      paidAmount: 5000,
      balanceAmount: 25000,
      dueAdvanceAmount: 5000,
      dueAdvanceMode: "Cash",
      paymentTerms: "Net 15",
    }))
  )._id;
  await put(Invoice, bill("2026-11-03", 12000, { paymentMode: "Credit", status: "pending", paidAmount: 2000, balanceAmount: 10000, dueAdvanceAmount: 2000, dueAdvanceMode: "UPI" }));
  // cancelled
  ids.cancelled = (await put(Invoice, bill("2026-11-03", 15000, { status: "cancelled", cancelledAt: "2026-11-03T10:00:00.000Z", cancelledBy: "admin", cancelReason: "Customer changed mind", lastModifiedReason: "cancel", paymentMode: "cash" })))._id;
  // credit note against the cash bill
  await put(Invoice, bill("2026-11-04", -25000, { type: "credit-note", creditNoteRef: "VP/26-27/0001", total: -25000, paidAmount: 0, balanceAmount: 0, paymentMode: "Cash" }));
  // estimate saved as proforma, and a sales order
  await put(Invoice, bill("2026-11-04", 42000, { type: "proforma", status: "draft", paidAmount: 0, balanceAmount: 42000, paymentMode: "Unclassified" }));
  await put(Invoice, bill("2026-11-04", 22000, { type: "sales-order", status: "pending", paidAmount: 5000, balanceAmount: 17000, createdBy: "Rahul Verma", salesperson: "Rahul Verma", salesExecutive: "" }));
  // Ashoka bill, delayed delivery, reprinted
  ids.delayed = (
    await put(Invoice, bill("2026-11-05", 41000, {
      invoiceNumber: "AE/26-27/0001",
      billingEntity: "ashoka",
      dispatchType: "delayed_delivery",
      deliveryStatus: "pending_dispatch",
      expectedDeliveryDate: "2026-11-15",
      deliveryNote: "Deliver after 5 pm",
      isShippingSameAsBilling: false,
      shippingStreet: "Rapti Nagar Phase 2",
      shippingCity: "Gorakhpur",
      deliveryChallanNo: "DC-2026-0007",
      reprintCount: 2,
      lastPrintedAt: "2026-11-06T06:00:00.000Z",
      printLogs: [{ printedAt: "2026-11-05T06:00:00.000Z", printedBy: "Neha" }, { printedAt: "2026-11-06T06:00:00.000Z", printedBy: "Admin" }],
      branch: { name: "Main" },
    }))
  )._id;
  // delivered, reminder already sent; shared-lead lines (two salesmen)
  await put(Invoice, bill("2026-11-05", 36000, {
    dispatchType: "delayed_delivery",
    deliveryStatus: "out_for_delivery",
    expectedDeliveryDate: "2026-11-10",
    deliveryReminderSentAt: new Date("2026-11-08T03:30:00.000Z"),
    driverName: "Sanjay",
    driverPhone: "9000000001",
    items: [line("Whirlpool Fridge", 1, 20000, { salesExecutive: "AMIT SINGH", incentiveEarned: 200 }), line("IFB Microwave", 1, 16000, { salesExecutive: "Rahul Verma", incentiveEarned: 150 })],
    branch: [{ name: "Main" }, { name: "Godown" }],
  }));
  // same date, same createdAt: full ties
  await put(Invoice, bill("2026-11-06", 5000, { salesExecutive: "Rahul Verma" }));
  await put(Invoice, bill("2026-11-06", 7000, { salesExecutive: "Rahul Verma", customerGST: "09ABCDE1234F1Z5", customerCompanyName: "Gupta Traders" }), { same: true });
  await put(Invoice, bill("2026-11-06", 8000, { paymentMode: "Online", onlineGateway: "Razorpay", onlineTxnId: "pay_123", warehouse: "" }), { same: true });
  // a bill with no costPrice on a line, a legacy-ish unknown field, unicode
  await put(Invoice, bill("2026-11-07", 3100, { customerName: "Ã…sha Kumārī", items: [line("Prestige Iron", 2, 1550, { costPrice: undefined })], legacyNote: { source: "excel", row: 12 } }));
  // legacy shapes the schema would not write today: a payments field that is not an array, a line that is not a
  // document, a number where text is expected inside an unknown field
  await put(Invoice, bill("2026-11-07", 2500, { paymentMode: "Cheque" }), {
    raw: (d) => {
      d.payments = "Cheque 2500 (old format)";
      d.items.push("free gift: carry bag");
      d.oldRef = { no: 42, tags: ["a", 1, null] };
    },
  });
  // later bills (newer createdAt, older date) to make date and createdAt orders differ
  await put(Invoice, bill("2026-10-28", 11000, { salesExecutive: "AMIT SINGH (Manager)" }));
  await put(Invoice, bill("2026-10-30", 26000, { paymentMode: "UPI", financeProvider: "" }));

  // ── payment_transactions ──
  const pay = (n: number, extra: Record<string, any>) =>
    put(PaymentTransaction, {
      transactionId: `TXN-${1000 + n}`,
      partyId: "CUST-101",
      partyType: "Customer",
      partyName: "Sita Devi",
      amount: 1000 * n,
      paymentMode: "Cash",
      date: "2026-11-03",
      type: "received",
      ...extra,
    });
  ids.pay1 = (await pay(1, { referenceId: "VP/26-27/0001", notes: "Initial payment for invoice VP/26-27/0001" }))._id;
  await pay(2, { referenceId: "VP/26-27/0006", notes: "Due cleared" });
  await pay(3, { paymentMode: "UPI", bankTxnRef: "UTR-445566", bankAccountRef: "HDFC-01", bankAccountId: "bank-1" });
  await pay(4, { partyId: "SUP-1", partyType: "Supplier", partyName: "Godrej Distributor", type: "paid", paymentMode: "NEFT", date: "2026-11-02", referenceId: "PB-77" });
  await pay(5, { partyId: "SUP-2", partyType: "Supplier", partyName: "LG Distributor", type: "paid", paymentMode: "Cash", date: "2026-11-03" });
  ids.pay6 = (await pay(6, { paymentMode: "cash (counter)", date: "2026-11-04", lastEditedAt: new Date("2026-11-05T05:00:00.000Z"), lastEditedBy: "admin", editCount: 1 }))._id;
  await pay(7, { transactionId: "TXN-LEGACY-VP/26-27/0003", date: "2026-11-01", referenceId: "VP/26-27/0003" });
  await pay(8, { paymentMode: "Finance Disbursement", partyName: "Bajaj Finserv", date: "2026-11-05", referenceId: "VP/26-27/0005", balanceAfter: 0 });

  // ── customer_advances ──
  const adv = (n: number, extra: Record<string, any>) =>
    put(CustomerAdvance, {
      receiptNumber: `ADV-2026-${100 + n}`,
      customerId: "CUST-102",
      customerName: "Mohd Arif",
      customerPhone: "7007123456",
      amount: 5000 * n,
      remainingBalance: 5000 * n,
      date: "2026-11-02",
      time: "11:30 AM",
      ...extra,
    });
  ids.adv1 = (await adv(1, { productBooked: "LG Washing Machine", targetBrand: "LG" }))._id;
  await adv(2, { status: "Partially Used", usedAmount: 4000, remainingBalance: 6000, linkedInvoiceNumber: "VP/26-27/0004", paymentMode: "UPI", transactionRef: "UPI-1" });
  await adv(3, { status: "Fully Adjusted", usedAmount: 15000, remainingBalance: 0, customerPhone: "9415098765", customerName: "Sita Devi", targetBrand: "Samsung" });
  await adv(4, { status: "Refunded", reason: "Product not available", customerName: "Priya (VIP)" });

  // ── estimates ──
  const est = (n: number, extra: Record<string, any>) =>
    put(Estimate, {
      estimateNumber: `EST-2026-${200 + n}`,
      date: new Date("2026-11-03T06:00:00.000Z"),
      customerName: "Priya Singh",
      customerPhone: "8960012345",
      items: [{ itemCode: "IT-SAM", name: "Samsung TV 43in", quantity: 1, rate: 32000, itemId: "it-1", tax: 18, amount: 32000 }],
      subTotal: 27118.64,
      taxTotal: 4881.36,
      total: 32000,
      ...extra,
    });
  await est(1, { approvalStatus: "pending", kind: "bill", salesperson: "Rahul Verma", salesExecutive: "Rahul Verma" });
  await est(2, {
    approvalStatus: "approved",
    approvedBy: "admin",
    approvedAt: new Date("2026-11-04T07:00:00.000Z"),
    dealAmount: 31000,
    priceUnlock: { by: "admin", byRole: "admin", at: new Date("2026-11-04T06:55:00.000Z"), lines: [{ itemName: "Samsung TV 43in", rate: 31000, lockedMin: 31500 }] },
    financeProvider: "HDB",
    financeDoData: { doId: "HDB-1", amounts: [1, 2.5] },
    customerPhone: "+91 89600 12345",
  });
  await est(3, { approvalStatus: "rejected", rejectedBy: "manager", rejectedAt: new Date("2026-11-05T07:00:00.000Z"), rejectReason: "Below floor", status: "Rejected" });
  await est(4, { status: "Converted", convertedInvoiceNumber: "VP/26-27/0002", items: [] });

  // ── sales_orders (copied; no GET path reads it) ──
  await put(SalesOrder, { orderNo: "SO-1", customerName: "Ramesh Gupta", itemsCount: 2, totalAmount: 50000, paidAmount: 10000, balanceAmount: 40000 });

  // ── deleted_invoices ──
  await put(DeletedInvoice, { invoiceNumber: "VP/26-27/0099", customerName: "Test", total: 999, deletedAt: new Date("2026-11-06T06:00:00.000Z"), deletedBy: "admin", deleteReason: "Duplicate", pinVerified: true, snapshot: { invoiceNumber: "VP/26-27/0099", items: [{ itemName: "X", quantity: 1 }] }, extraNote: "strict false" });
  await put(DeletedInvoice, { invoiceNumber: "EST-2026-0001", docType: "Estimate", deletedAt: new Date("2026-10-20T06:00:00.000Z"), deletedBy: "manager", deleteReason: "Old", snapshot: {} });

  // ── delivery_challans ──
  const dc = (n: number, extra: Record<string, any>) =>
    put(DeliveryChallan, { challanNo: `DC-2026-${String(n).padStart(4, "0")}`, destinationParty: "Ramesh Gupta", itemName: "Godrej Refrigerator 260L", ...extra });
  await dc(7, { type: "Outward Delivery", invoiceNumber: "AE/26-27/0001", status: "in-transit", vehicleNo: "UP53 AB 1234", autoFromBill: true, deliveryOtp: "4321" });
  await dc(8, { flowType: "CR", claimStatus: "pending", serialImei: "IMEI-998877", supplierId: "SUP-1", itemPrice: 18000 });
  await dc(9, { flowType: "CNR", claimStatus: "settled", settledAt: new Date("2026-11-06T09:00:00.000Z"), creditAmount: 17000, approvalStatus: "approved", approvedAt: new Date("2026-11-06T08:00:00.000Z") });
  await dc(10, { flowType: "PR", status: "delivered", deliveredAt: new Date("2026-11-07T10:00:00.000Z"), deliveryProofKeys: ["r2://proof/1.jpg"], destinationParty: "LG Service Centre" });

  // ── eway_bills ──
  await put(EWayBill, { ewayBillNo: "EWB-111", invoiceNumber: "VP/26-27/0002", customerName: "Sita Devi", deliveryAddress: "Golghar", vehicleNumber: "UP53 AB 1234", items: [{ itemName: "Fridge", hsn: "8418", quantity: 1, taxableValue: 15677.97, gstRate: 18 }], taxableValue: 15677.97, totalGst: 2822.03, totalAmount: 18500, status: "Generated", generatedDate: "2026-11-01" });
  await put(EWayBill, { ewayBillNo: "EWB-112", invoiceNumber: "AE/26-27/0001", customerName: "Ramesh Gupta", deliveryAddress: "Rapti Nagar", vehicleNumber: "UP53 CD 9999", items: [], taxableValue: 34745.76, totalGst: 6254.24, totalAmount: 41000 });

  // ── finance_transactions ──
  const emi = (i: number, status: string, extra: Record<string, any> = {}) => ({ installmentNumber: i, dueDate: `2026-${String(11 + i).padStart(2, "0")}-05`.replace("2026-13", "2027-01").replace("2026-14", "2027-02"), amount: 6873.75, status, ...extra });
  await put(FinanceTransaction, {
    financeProvider: "Bajaj Finserv",
    customerName: "Mohd Arif",
    customerMobile: "7007123456",
    invoiceNumber: "VP/26-27/0005",
    doId: "DO-BAJ-1001",
    date: "2026-11-02",
    productPrice: 64990,
    grossLoanAmount: 54990,
    netLoanAmount: 52990,
    tenureMonths: 8,
    monthlyEmiAmount: 6873.75,
    emiSchedule: [emi(1, "Paid", { paidDate: "2026-12-05", paymentMode: "NACH", receiptNumber: "R-1" }), emi(2, "Pending"), emi(3, "Bounced", { bounceReason: "Insufficient funds", penaltyAmount: 500 })],
    totalPaidEmiAmount: 6873.75,
    approvalStatus: "Disbursed",
    paymentReceivedDate: "2026-11-05",
    actualReceivedAmount: 52000,
    linkedInvoices: [{ invoiceNumber: "VP/26-27/0005", amount: 44990, linkedAt: new Date("2026-11-02T08:00:00.000Z") }],
  });
  await put(FinanceTransaction, {
    financeProvider: "Bajaj Finserv",
    customerName: "Mohd Arif",
    customerMobile: "7007123456",
    invoiceNumber: "VP/26-27/0005",
    doId: "DO-BAJ-1002",
    date: "2026-11-02",
    netDisbursement: 9800,
    approvalStatus: "Reconciled",
    bankAccountRef: "HDFC-01",
    transactionRef: "UTR-1",
    paymentReceivedDate: "2026-11-04",
  });
  await put(FinanceTransaction, { financeProvider: "HDB", customerName: "Priya Singh", customerMobile: "8960012345", invoiceNumber: "VP/26-27/0099", doId: "HDB-55", date: "2026-11-06", approvalStatus: "Pending" });

  // ── extended_warranties ──
  const ew = (n: number, extra: Record<string, any>) =>
    put(ExtendedWarranty, { warrantyId: `EW-${n}`, customerName: "Sita Devi", customerPhone: "9415098765", invoiceNumber: "VP/26-27/0004", productName: "Voltas AC 1.5T", vpCode: "VP131", planName: "2 Year", startDate: "2026-11-02", endDate: "2028-11-01", warrantyAmount: 1499, ...extra });
  await ew(1, {});
  await ew(2, { startDate: "2026-11-13", warrantyAmount: 999.5, vpCode: "VP999", status: "Claimed" });
  await ew(3, { startDate: "2026-10-15", warrantyAmount: 2499, customerPhone: "9839012345", invoiceNumber: "VP/26-27/0001" });

  // ── discountapprovals ──
  const da = (n: number, extra: Record<string, any>) =>
    put(DiscountApproval, { requestedBy: "Rahul Verma", requestedById: "user-rahul", requestedByRole: "salesman", itemName: "Samsung TV 43in", sellingPrice: 32000, price: 30000 - n * 100, percent: 6.25, tier: "manager", ...extra });
  ids.da1 = (await da(1, {}))._id;
  ids.da2 = (await da(2, { status: "approved", reviewedBy: "manager", reviewedAt: new Date("2026-11-04T05:00:00.000Z"), tier: "cashier" }))._id;
  ids.da3 = (await da(3, { tier: "admin", requestedById: "user-amit", requestedBy: "AMIT SINGH" }))._id;
  await da(4, { status: "rejected", tier: "manager", reviewNote: "Too low" });

  // ── store_activity_approvals ──
  const sa = (n: number, extra: Record<string, any>) =>
    put(StoreActivityApproval, { activityId: `ACT-${n}`, storeName: "Kunraghat Showroom", storeInchargeName: "Neha", storeInchargeEmail: "neha@valueplus.test", title: `Request ${n}`, description: "Please approve", ...extra });
  await sa(1, { activityType: "price_change", payload: { kind: "invoice.payment", target: "VP/26-27/0001", requestedBy: { id: "user-rahul", name: "Rahul Verma" }, data: { amount: 100 } } });
  await sa(2, { activityType: "expense_approval", status: "approved", superAdminActionAt: new Date("2026-11-05T05:00:00.000Z"), superAdminNotes: "ok", amount: 1200, payload: { requestedBy: { id: "user-amit" } } });
  await sa(3, { storeName: "Godown", storeInchargeEmail: "ravi@valueplus.test", payload: { kind: "x" } });
  await sa(4, { status: "rejected", storeInchargeEmail: "neha@valueplus.test" });

  // ── billing_companies (usageCount ties, name order) ──
  await put(BillingCompany, { gstin: "09ABCDE1234F1Z5", companyName: "Gupta Traders", pan: "ABCDE1234F", usageCount: 5 });
  await put(BillingCompany, { gstin: "09AAACB1111C1Z1", companyName: "Bharat Electricals", usageCount: 5 });
  await put(BillingCompany, { gstin: "09AAACZ2222D1Z2", companyName: "Zenith Hospital", usageCount: 12 });
  await put(BillingCompany, { gstin: "09AAACZ3333D1Z3", companyName: "Bharat Electricals", usageCount: 5 });
}

/** Changes the way the app does (driver updates bump updatedAt), so the incremental copy has work to do. */
async function change() {
  const now = new Date("2026-11-10T06:00:00.000Z");
  await Invoice.collection.updateOne({ _id: ids.due }, { $set: { paidAmount: 30000, balanceAmount: 0, status: "paid", dueClearedAt: "2026-11-10", dueClearedMode: "Cash", updatedAt: now }, $push: { payments: { mode: "Cash", amount: 25000, txnId: "", reference: "", receivedBy: "Neha", notes: "due cleared" } } as any });
  await Invoice.collection.updateOne({ _id: ids.upi }, { $set: { status: "cancelled", cancelReason: "wrong bill", updatedAt: now } });
  await Invoice.collection.updateOne({ _id: ids.cash }, { $inc: { reprintCount: 1 }, $set: { lastPrintedAt: now.toISOString(), updatedAt: now }, $push: { printLogs: { _id: new ObjectId(), printedAt: now.toISOString(), printedBy: "Neha" } } as any });
  await put(PaymentTransaction, { transactionId: "TXN-2001", partyId: "CUST-103", partyType: "Customer", partyName: "Priya Singh", amount: 25000, paymentMode: "Cash", date: "2026-11-10", type: "received", referenceId: "VP/26-27/0006" });
  await CustomerAdvance.collection.updateOne({ _id: ids.adv1 }, { $set: { status: "Partially Used", usedAmount: 1000, remainingBalance: 4000, updatedAt: now } });
  await DiscountApproval.collection.updateOne({ _id: ids.da1 }, { $set: { status: "approved", reviewedBy: "manager", reviewedAt: now, updatedAt: now } });
  await PaymentTransaction.collection.deleteOne({ _id: ids.pay6 });
}

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

async function compareAll(round: string) {
  console.log(`\n-- ${round}`);
  // invoices
  for (const n of ["VP/26-27/0001", "AE/26-27/0001", "vp/26-27/0001", "nope"]) await compare("invoices.byNumber", [n]);
  for (const type of [null, "tax-invoice", "proforma", "credit-note", "sales-order", ""]) {
    for (const includeEstimates of [false, true]) {
      for (const warehouse of [null, "all", "Kunraghat Showroom", "Main Central Warehouse", "godown", "Nowhere (x)"]) {
        await compare("invoices.list", [{ type, includeEstimates, warehouse }], `${type}/${includeEstimates}/${warehouse}`);
      }
    }
  }
  for (const [type, staff] of [[null, null], [null, "all"], [null, "Rahul Verma"], ["sales-order", "rahul"], ["tax-invoice", "AMIT SINGH"], [null, "Nobody Here"]] as const) {
    await compare("orders.list", [type, staff]);
  }
  for (const p of [null, "CUST-101", "CUST-999"]) await compare("payments.paidInvoices", [p]);
  await compare("nextNumber.invoiceNumbers", []);
  await compare("nextNumber.proformaNumbers", []);
  await compare("warranty.invoices", []);
  for (const id of [null, "CUST-102", "CUST-404"]) await compare("vendorsLedger.customerInvoices", [id]);
  for (const id of ["AE/26-27/0001", "ae/26-27/0001", "DC-2026-0007", "VP/26-27/0002", "missing", "VP/26-27/000."]) await compare("track.invoice", [id]);
  const so = (o: Record<string, any>) => ({ startDate: null, endDate: null, paymentMode: null, bank: null, dueOnly: null, staff: null, customer: null, ...o });
  for (const args of [
    so({}),
    so({ startDate: "2026-11-02", endDate: "2026-11-05" }),
    so({ startDate: "2026-11-03" }),
    so({ endDate: "2026-11-01" }),
    so({ bank: "Cash" }),
    so({ bank: "Finance" }),
    so({ bank: "bajaj" }),
    so({ bank: "upi" }),
    so({ bank: "all", paymentMode: "UPI" }),
    so({ dueOnly: "true" }),
    so({ staff: "Rahul Verma" }),
    so({ staff: "all", customer: "sita" }),
    so({ customer: "ã…sha" }),
  ]) {
    await compare("salesOut.invoices", [args], JSON.stringify(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null))));
  }
  await compare("gstr.hsnInvoices", []);
  await compare("gstr.b2bInvoices", []);
  await compare("gstr.gstr1Invoices", []);
  for (const args of [
    { startDate: null, endDate: null, branch: null },
    { startDate: "2026-11-01", endDate: "2026-11-04", branch: null },
    { startDate: "2026-11-05", endDate: null, branch: "ALL" },
    { startDate: null, endDate: "2026-11-02", branch: null },
    { startDate: null, endDate: null, branch: "Main" },
    { startDate: null, endDate: null, branch: "Godown" },
  ]) {
    await compare("profitLoss.invoices", [args]);
  }
  await compare("dashboard.invoiceSummary", []);
  const someInvoiceIds = (await Invoice.find({}, { _id: 1 }).sort({ _id: 1 }).lean()).filter((_, i) => i % 3 === 0).map((d: any) => d._id);
  await compare("dashboard.invoicesByIds", [someInvoiceIds], `${someInvoiceIds.length} ids`);
  await compare("dashboard.invoicesByIds", [[]], "no ids");
  await compare("cashRegister.cashInvoices", []);
  await compare("cashRegister.financeLinkedInvoices", [["VP/26-27/0005", "VP/26-27/0099", "VP/26-27/0005"]]);
  await compare("cashRegister.financeLinkedInvoices", [[]]);
  await compare("cashRegister.dueCashBills", []);
  await compare("staffIncentive.bills", []);
  for (const [from, to] of [[undefined, undefined], ["2026-11-02", undefined], [undefined, "2026-11-03"], ["2026-11-01", "2026-11-05"]]) {
    await compare("staffBrandSales.bills", [from, to]);
  }
  for (const until of ["2026-11-12", "2026-11-20", "2026-11-01"]) await compare("deliveryReminders.dueInvoices", [until]);

  // payments
  for (const [partyId, partyType] of [[null, null], ["CUST-101", null], [null, "Supplier"], ["CUST-101", "Customer"], ["SUP-1", "Supplier"], ["X", null]]) {
    await compare("payments.list", [partyId, partyType]);
  }
  await compare("dashboard.supplierPayments", []);
  await compare("dashboard.paymentSummary", []);
  const somePaymentIds = (await PaymentTransaction.find({}, { _id: 1 }).sort({ _id: 1 }).lean()).slice(0, 3).map((d: any) => d._id);
  await compare("dashboard.paymentsByIds", [somePaymentIds], `${somePaymentIds.length} ids`);
  await compare("cashRegister.cashReceipts", []);
  await compare("vendorsLedger.payments", ["Supplier"]);
  await compare("vendorsLedger.payments", ["Customer"]);

  // advances
  for (const [phone, status, search] of [[null, null, null], ["7007123456", null, null], [" 7007123456 ", "all", null], [null, "Refunded", null], [null, null, "lg"], [null, null, "ADV-2026-10"], [null, null, "priya (vip)"], ["9415098765", "Fully Adjusted", "sam"]]) {
    await compare("advances.list", [phone, status, search]);
  }

  // finance
  for (const args of [[null, null, null, null], ["VP/26-27/0005", null, null, null], [null, "HDB-55", null, null], [null, null, "Disbursed", null], [null, null, "all", "Bajaj Finserv"], [null, null, null, "HDB"]]) {
    await compare("finance.list", args);
  }
  await compare("finance.reminders", []);
  await compare("dashboard.financeSummary", []);
  await compare("cashRegister.financeRecords", []);

  // deleted
  await compare("dashboard.deletedInRange", [new Date("2026-11-01T00:00:00+05:30"), new Date("2026-11-30T23:59:59.999+05:30")], "Nov");
  await compare("dashboard.deletedInRange", [new Date("2026-10-01T00:00:00+05:30"), new Date("2026-12-31T23:59:59.999+05:30")], "Oct-Dec");
  await compare("nextNumber.deletedNumbers", []);
  await compare("billingCompanies.list", []);

  // estimates
  for (const [phone, status, approval] of [[null, null, null], ["8960012345", null, null], ["+91-89600", null, null], [null, "Rejected", null], [null, null, "pending"], [null, null, "approved"], ["000", null, null]]) {
    await compare("estimates.list", [phone, status, approval]);
  }
  await compare("nextNumber.estimateNumbers", []);

  // challans
  const cl = (o: Record<string, any>) => ({ flowType: null, claimStatus: null, approvalStatus: null, search: null, ...o });
  for (const args of [cl({}), cl({ flowType: "CR" }), cl({ flowType: "PR" }), cl({ flowType: "all", claimStatus: "settled" }), cl({ approvalStatus: "pending" }), cl({ search: "imei" }), cl({ search: "up53" }), cl({ search: "lg service" })]) {
    await compare("challans.list", [args], JSON.stringify(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null))));
  }
  for (const id of ["DC-2026-0007", "AE/26-27/0001", "none"]) await compare("track.challan", [id]);

  // e-way bills
  for (const [no, status] of [[null, null], ["VP/26-27/0002", null], [null, "Prepared"], [null, "all"]]) await compare("ewayBills.list", [no, status]);
  await compare("gstr.gstr1EwayBills", [["VP/26-27/0001", "VP/26-27/0002", "AE/26-27/0001"]]);
  await compare("gstr.gstr1EwayBills", [[]]);

  // warranties
  const wl = (o: Record<string, any>) => ({ invoiceNumber: null, customerPhone: null, vpCode: null, status: null, ...o });
  for (const args of [wl({}), wl({ invoiceNumber: "VP/26-27/0004" }), wl({ customerPhone: "9839012345" }), wl({ vpCode: "VP999", status: "Claimed" })]) await compare("warranty.list", [args]);
  await compare("warranty.count", []);
  await compare("warranty.revenue", []);
  for (const d of ["2026-11-13", "2026-11-01", "2027-01-01"]) await compare("warranty.todayCount", [d]);
  for (const m of ["2026-11", "2026-10", "2025-01"]) await compare("warranty.monthCount", [m]);

  // approvals
  await compare("discountApprovals.byIds", [[String(ids.da1), String(ids.da2), String(ids.da3)], "user-rahul"]);
  await compare("discountApprovals.byIds", [[String(ids.da3).toUpperCase()], "user-amit"], "upper-case id");
  await compare("discountApprovals.byIds", [["not-an-id"], "user-rahul"], "invalid id");
  for (const [status, tiers] of [[null, ["cashier", "manager", "admin"]], ["pending", ["cashier", "manager", "admin"]], [null, ["cashier"]], ["approved", ["cashier", "manager"]], [null, []]] as const) {
    await compare("discountApprovals.list", [status, [...tiers]]);
  }
  for (const args of [
    { status: null, storeName: null, isAdmin: true },
    { status: "pending", storeName: null, isAdmin: true },
    { status: "all", storeName: "Godown", isAdmin: true },
    { status: null, storeName: null, isAdmin: false, actorId: "user-rahul", actorEmail: "manager@valueplus.test" },
    { status: null, storeName: null, isAdmin: false, actorId: "user-x", actorEmail: "neha@valueplus.test" },
    { status: "pending", storeName: "all", isAdmin: false, actorId: "user-amit", actorEmail: "ravi@valueplus.test" },
  ]) {
    await compare("approvals.list", [args]);
  }
  await compare("meSummary.pendingApprovals", []);
}

// ---------------------------------------------------------------------------

async function main() {
  // As on Workers (lib/db.ts): mongoose builds no index itself; the live indexes are the cron's list (below).
  mongoose.set("autoIndex", false);
  await startMemoryMongo("d1_sales_reads_test");
  const local = await startLocalD1();
  const db = local.db;
  setSalesReadsDb(db);
  try {
    await applyMigrations(db);
    await seed();
    // The live database's indexes (lib/ensure-indexes.ts, built by the cron): the planner then picks what it would live.
    await ensureIndexes(INDEXES);

    // ── the rebuild metadata matches the copy mapping ──
    for (const spec of SALES_SPECS) {
      const meta = SALES_META[spec.collection];
      const childTables = (meta.arrays.map((a) => a.table) as string[]).concat(meta.sides.map((s) => s.table)).sort();
      check(JSON.stringify(childTables) === JSON.stringify((spec.children || []).map((c) => c.table).sort()), `${spec.table}: every child table is rebuilt`);
      for (const a of meta.arrays) {
        const c = spec.children!.find((x) => x.table === a.table)!;
        const want = [...(a.withId ? ["id"] : []), a.parentCol, a.idxCol, ...a.fields.map(([f]) => f), "extra"];
        check(JSON.stringify(c.columns) === JSON.stringify(want), `${a.table}: rebuild columns = copy columns`);
      }
    }

    // ── projection and minimize helpers behave like MongoDB / mongoose ──
    // checked against MongoDB itself, on a scratch collection
    const sample = { _id: "x", a: 1, items: [{ p: 1, q: 2, _id: "l1" }, 5, { q: 3 }, [{ p: 4 }]], o: { p: 1 }, s: "t", n: { m: { k: 1, j: 2 } } };
    const scratch = mongoose.connection.db!.collection("projection_scratch");
    await scratch.insertOne(sample as any);
    for (const proj of [{ "items.p": 1, a: 1 }, { "s.x": 1, _id: 0 }, { "o.p": 1, "o.z": 1 }, { "n.m.k": 1 }, { items: 1, "zz.y": 1 }] as any[]) {
      const real = await scratch.findOne({ _id: "x" } as any, { projection: proj });
      check(canon(real) === canon(project(sample, proj)), `projection ${JSON.stringify(proj)} = MongoDB's (${JSON.stringify(real)})`);
    }
    await scratch.drop();
    check(JSON.stringify(minimize({ a: {}, b: { c: {} }, d: [{}], e: 0 })) === JSON.stringify({ d: [{}], e: 0 }), "minimize: empty objects go, arrays stay");

    const first = await runD1Sync(db, { reconcile: "skip", collections: SALES_COLLECTIONS });
    check(first.ok && first.errors === 0 && !first.timedOut, `first copy: no errors (${Object.values(first.collections).reduce((s: number, c: any) => s + c.copied, 0)} docs)`);
    await compareAll("after the full copy");

    await change();
    await runD1Sync(db, { reconcile: "force", collections: SALES_COLLECTIONS });
    await compareAll("after changes + incremental copy");

    const missing = Object.keys(SALES_READS).filter((k) => !covered.has(k));
    check(missing.length === 0, `every registry entry compared (${covered.size} of ${Object.keys(SALES_READS).length})${missing.length ? ": missing " + missing.join(", ") : ""}`);
    const empty = Object.entries(sizes).filter(([, n]) => n.every((x) => x === 0)).map(([k]) => k);
    check(empty.length === 0, `every read returned something at least once${empty.length ? ": empty " + empty.join(", ") : ""}`);
  } finally {
    setSalesReadsDb(null);
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-sales-reads") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
