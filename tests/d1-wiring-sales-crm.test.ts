/**
 * Stage B2 wave 2, part 1: the SALES & MONEY and CRM / DOCS / ACCOUNTING reads (and the stock / staff reads of the
 * shared report files) are wired into their routes through the shadow framework (lib/d1/shadow.ts). For a
 * representative set of routes, each handler is called in the three modes of its areas' switches:
 *   - mongo, shadow and d1 give the SAME HTTP JSON (compared as canonical JSON: sorted keys, null = missing, which is
 *     what lib/d1/compare.ts does; everything else, money included, must be equal);
 *   - shadow mode records a match in shadow_results for every read path the call ran;
 *   - d1 mode falls back to MongoDB when D1 errors: same answer, and the fallback is recorded.
 *
 * Data: the dashboard golden data set (bills of every kind, receipts, finance, purchases, vendors, deleted bills,
 * written straight into the collections) plus estimates, advances, warranties, approvals, challans, e-way bills,
 * billing companies, notifications, salaries, payouts, cash transactions, and the CRM data of d1-crm-reads (leads with
 * shares, walk-ins, complaints, the WhatsApp outbox, documents in folders, accounts, journal entries). "Now" is the
 * dashboard test's fixed clock. Every route is called once in mongo mode BEFORE the copy, so the writes some GETs
 * make (an EMI schedule filled in, a delivery reminder claimed) are in MongoDB before D1 gets its copy.
 * MongoDB in memory and a local D1 (Miniflare); nothing external.
 */
import "./helpers/fixed-clock";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import { faulty } from "./helpers/d1-faults";
import { smallDataset, seed as seedDashboard } from "./fixtures/dashboard-seed";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { runD1Sync } from "@/lib/d1/sync";
import { canonicalize } from "@/lib/d1/compare";
import { configureReadSource, resetReadModeCache, resetReadSourceConfig } from "@/lib/d1/read-source";
import { flushShadowWork, resetShadowConfig, resetShadowSampling } from "@/lib/d1/shadow";
import { ensureIndexes, INDEXES } from "@/lib/ensure-indexes";
import { setStaffD1 } from "@/lib/repo/staff";
import { SALES_READS } from "@/lib/repo/sales/registry";
import { CRM_READS } from "@/lib/repo/crm";
import { STOCK_READS } from "@/lib/repo/stock";
import { deferredContext } from "@/lib/deferred-context";
import { ONSITEGO_FOLDER } from "@/lib/onsitego";
// Every model of the dashboard data set, so asSaved() finds them by collection name.
import "@/models/Invoice";
import "@/models/Customer";
import "@/models/Item";
import "@/models/Supplier";
import "@/models/Expense";
import "@/models/PaymentTransaction";
import "@/models/FinanceTransaction";
import "@/models/PurchaseEntry";
import "@/models/PurchaseOrder";
import "@/models/Vendor";
import "@/models/VendorBill";
import "@/models/VendorPayment";
import "@/models/AuditLog";
import "@/models/DeletedInvoice";
import Estimate from "@/models/Estimate";
import CustomerAdvance from "@/models/CustomerAdvance";
import ExtendedWarranty from "@/models/ExtendedWarranty";
import DiscountApproval from "@/models/DiscountApproval";
import StoreActivityApproval from "@/models/StoreActivityApproval";
import DeliveryChallan from "@/models/DeliveryChallan";
import EWayBill from "@/models/EWayBill";
import BillingCompany from "@/models/BillingCompany";
import Notification from "@/models/Notification";
import Salary from "@/models/Salary";
import IncentivePayout from "@/models/IncentivePayout";
import CashTransaction from "@/models/CashTransaction";
import CashRegisterSetting from "@/models/CashRegisterSetting";
import Lead from "@/models/Lead";
import WalkInQuery from "@/models/WalkInQuery";
import CustomerComplaint from "@/models/CustomerComplaint";
import WhatsAppMessage from "@/models/WhatsAppMessage";
import WhatsAppSetting from "@/models/WhatsAppSetting";
import StoredDocument from "@/models/StoredDocument";
import DocumentFolder from "@/models/DocumentFolder";
import OnsitegoPlan from "@/models/OnsitegoPlan";
import JournalEntry from "@/models/JournalEntry";
import Account from "@/models/Account";
import { GET as invoicesGET } from "@/app/api/invoices/route";
import { GET as ordersGET } from "@/app/api/orders/route";
import { GET as paymentsGET } from "@/app/api/payments/route";
import { GET as advancesGET } from "@/app/api/crm/advances/route";
import { GET as estimatesGET } from "@/app/api/estimates/route";
import { GET as financeGET } from "@/app/api/finance/route";
import { GET as financeRemindersGET } from "@/app/api/finance/reminders/route";
import { GET as warrantyGET } from "@/app/api/warranty/route";
import { GET as approvalsGET } from "@/app/api/approvals/route";
import { GET as discountApprovalsGET } from "@/app/api/discount-approvals/route";
import { GET as challansGET } from "@/app/api/delivery-challans/route";
import { GET as ewayGET } from "@/app/api/eway-bills/route";
import { GET as billingCompaniesGET } from "@/app/api/billing-companies/route";
import { GET as nextNumberGET } from "@/app/api/invoices/next-number/route";
import { GET as salesOutGET } from "@/app/api/reports/sales-out/route";
import { GET as profitLossGET } from "@/app/api/reports/profit-loss/route";
import { GET as gstrGET } from "@/app/api/gstr-reports/route";
import { GET as dashboardGET } from "@/app/api/dashboard/stats/route";
import { GET as meSummaryGET } from "@/app/api/me/summary/route";
import { GET as notificationsGET } from "@/app/api/notifications/route";
import { GET as cashRegisterGET } from "@/app/api/cash-register/route";
import { GET as vendorsLedgerGET } from "@/app/api/vendors/ledger/route";
import { GET as leadsGET } from "@/app/api/crm/leads/route";
import { GET as walkInGET } from "@/app/api/crm/walk-in/route";
import { GET as complaintsGET } from "@/app/api/crm/complaints/route";
import { GET as whatsappGET } from "@/app/api/whatsapp/route";
import { GET as whatsappSettingsGET } from "@/app/api/whatsapp/settings/route";
import { GET as documentsGET } from "@/app/api/documents/route";
import { GET as foldersGET } from "@/app/api/documents/folders/route";
import { GET as onsitegoPlansGET } from "@/app/api/onsitego/plans/route";
import { GET as accountsGET } from "@/app/api/accounting/accounts/route";
import { GET as journalGET } from "@/app/api/accounting/journal/route";
import { GET as trackGET } from "@/app/api/track/[id]/route";
import { GET as searchGET } from "@/app/api/search/route";
import { GET as myIncentiveGET } from "@/app/api/staff/my-incentive/route";
import { GET as brandSalesGET } from "@/app/api/staff/brand-sales/route";

const { ObjectId } = mongoose.Types;
type Handler = (req: Request) => Promise<Response>;
const AREAS = ["sales", "crm", "stock", "staff"];

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

const actor = (name: string, role: string, email = "") => ({ id: new ObjectId().toHexString(), name, email, role, permissions: [] as any[] });
const ADMIN = actor("Admin", "admin", "admin@valueplus.test");
const MANAGER = actor("Neha", "manager", "neha@valueplus.test");
const AMIT = actor("Amit Singh", "salesman");
const RAVI = actor("Ravi Kumar (Sales Executive)", "sales");
const PRIYA = actor("Priya Sharma", "salesman");
const CASHIER = actor("Cash Desk", "cashier");
type Actor = typeof ADMIN;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-11-01T04:30:00.000Z");
let tick = 0;
/** Through the model (schema defaults, as a save gives), written with its own distinct creation time. */
async function put(model: any, data: Record<string, any>) {
  const doc: any = new model(data).toObject();
  const t = new Date(T0 + ++tick * 60_000 + tick * 7);
  doc.createdAt = t;
  doc.updatedAt = t;
  doc.__v = 0;
  await model.collection.insertOne(doc);
  return doc;
}
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 5, 30, 0, 0));

let DOC_ID = "";
const DA_IDS: string[] = [];
let ACC_BANK: any;

async function seedSales() {
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
  await est(1, { approvalStatus: "pending", kind: "bill", salesperson: "Amit Singh", salesExecutive: "Amit Singh" });
  await est(2, { approvalStatus: "approved", approvedBy: "admin", approvedAt: new Date("2026-11-04T07:00:00.000Z"), dealAmount: 31000, customerPhone: "+91 89600 12345" });
  await est(3, { approvalStatus: "rejected", rejectedBy: "manager", rejectReason: "Below floor", status: "Rejected", salesperson: "Ravi Kumar" });
  await est(4, { approvalStatus: "pending", status: "Converted", convertedInvoiceNumber: "VP/26-27/0002", items: [] });

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
  await adv(1, { productBooked: "LG Washing Machine", targetBrand: "LG" });
  await adv(2, { status: "Partially Used", usedAmount: 4000, remainingBalance: 6000, linkedInvoiceNumber: "VP/26-27/0004", paymentMode: "UPI", transactionRef: "UPI-1" });
  await adv(3, { status: "Fully Adjusted", usedAmount: 15000, remainingBalance: 0, customerPhone: "9415098765", customerName: "Sita Devi", targetBrand: "Samsung" });

  const ew = (n: number, extra: Record<string, any>) =>
    put(ExtendedWarranty, { warrantyId: `EW-${n}`, customerName: "Sita Devi", customerPhone: "9415098765", invoiceNumber: "VP/26-27/0004", productName: "Voltas AC 1.5T", vpCode: "VP131", planName: "2 Year", startDate: "2026-11-02", endDate: "2028-11-01", warrantyAmount: 1499, ...extra });
  await ew(1, {});
  await ew(2, { startDate: "2026-11-13", warrantyAmount: 999.5, vpCode: "VP999", status: "Claimed" });
  await ew(3, { startDate: "2026-10-15", warrantyAmount: 2499, customerPhone: "9839012345", invoiceNumber: "VP/26-27/0001" });

  const da = (n: number, extra: Record<string, any>) =>
    put(DiscountApproval, { requestedBy: "Amit Singh", requestedById: AMIT.id, requestedByRole: "salesman", itemName: "Samsung TV 43in", sellingPrice: 32000, price: 30000 - n * 100, percent: 6.25, tier: "manager", ...extra });
  DA_IDS.push(String((await da(1, {}))._id));
  await da(2, { status: "approved", reviewedBy: "manager", reviewedAt: new Date("2026-11-04T05:00:00.000Z"), tier: "cashier" });
  DA_IDS.push(String((await da(3, { tier: "admin" }))._id));
  await da(4, { status: "rejected", reviewNote: "Too low" });

  const sa = (n: number, extra: Record<string, any>) =>
    put(StoreActivityApproval, { activityId: `ACT-${n}`, storeName: "Kunraghat Showroom", storeInchargeName: "Neha", storeInchargeEmail: "neha@valueplus.test", title: `Request ${n}`, description: "Please approve", ...extra });
  await sa(1, { activityType: "price_change", payload: { kind: "invoice.payment", target: "VP-001", requestedBy: { id: MANAGER.id, name: "Neha" }, data: { amount: 100 } } });
  await sa(2, { activityType: "expense_approval", status: "approved", superAdminNotes: "ok", amount: 1200, payload: { requestedBy: { id: "someone-else" } } });
  await sa(3, { storeName: "Godown", storeInchargeEmail: "ravi@valueplus.test", payload: { kind: "x" } });

  const dc = (n: number, extra: Record<string, any>) =>
    put(DeliveryChallan, { challanNo: `DC-2026-${String(n).padStart(4, "0")}`, destinationParty: "Ramesh Gupta", itemName: "Godrej Refrigerator 260L", ...extra });
  await dc(7, { type: "Outward Delivery", status: "in-transit", vehicleNo: "UP53 AB 1234", autoFromBill: true });
  await dc(8, { flowType: "CR", claimStatus: "pending", serialImei: "IMEI-998877", itemPrice: 18000 });
  await dc(9, { flowType: "CNR", claimStatus: "settled", creditAmount: 17000, approvalStatus: "approved" });

  await put(EWayBill, { ewayBillNo: "EWB-111", invoiceNumber: "VP-001", customerName: "Sita Devi", deliveryAddress: "Golghar", vehicleNumber: "UP53 AB 1234", items: [{ itemName: "Fridge", hsn: "8418", quantity: 1, taxableValue: 15677.97, gstRate: 18 }], taxableValue: 15677.97, totalGst: 2822.03, totalAmount: 18500, status: "Generated", generatedDate: "2026-11-01" });

  await put(BillingCompany, { gstin: "09ABCDE1234F1Z5", companyName: "Gupta Traders", pan: "ABCDE1234F", usageCount: 5 });
  await put(BillingCompany, { gstin: "09AAACZ2222D1Z2", companyName: "Zenith Hospital", usageCount: 12 });
}

async function seedStaffAndCash() {
  for (const [i, who] of [ADMIN, ADMIN, AMIT, ADMIN].entries()) {
    await put(Notification, { recipientId: who.id, recipientName: who.name, type: "general", title: `Note ${i}`, message: "Bill VP/26-27/0001 needs a look", link: "/sales", readAt: i === 1 ? new Date("2026-11-05T05:00:00.000Z") : null, refType: i === 3 ? "task" : "", refId: i === 3 ? new ObjectId().toHexString() : "" });
  }
  await put(Salary, { employeeName: "Amit Singh", employeeId: AMIT.id, monthlySalary: 18000, payableAmount: 19500, incentives: 1500, month: "October", year: 2026, paymentStatus: "Paid" });
  await put(IncentivePayout, { userId: AMIT.id, employeeName: "Amit Singh", amount: 700, date: "2026-11-02" });
  await put(CashTransaction, { type: "INFLOW", category: "OTHER_RECEIPT", amount: 2500, date: "2026-11-10", time: "11:00 AM", referenceNo: "CT-1", description: "Scrap sale", recordedBy: "Cash Desk" });
  await put(CashTransaction, { type: "OUTFLOW", category: "MD_HANDOVER", amount: 10000, date: "2026-11-11", time: "07:00 PM", referenceNo: "CT-2", adminStatus: "pending", recordedBy: "Cash Desk" });
  await put(CashRegisterSetting, { key: "cash-register", openingCash: 50000 });
}

async function seedCrm() {
  const raw = mongoose.connection.db!;
  const share = (who: Actor, status: string, by: Actor, extra: any = {}) => ({
    staff: who.name.replace(/\s*\(.*\)$/, ""), staffId: who.id, brand: "LG", products: "LG AC 1.5T", note: "wants demo", status,
    requestedBy: by.name, requestedById: by.id, requestedAt: day(3), ...extra,
  });
  await Lead.create({
    leadId: "LEAD-2026-0001", customerName: "Rahul Sharma", mobile: "919876543210", source: "Walk-in Store", interestedProduct: "LLOYD AC 1.5T",
    assignedStaff: "Amit Singh", estimatedValue: 42500.5, priority: "High", status: "Follow-up", callCount: 2, lastCalledAt: day(6),
    followUps: [{ date: "2026-10-08", nextDate: "2026-10-12", outcome: "interested", notes: "Call after salary", staff: "Amit Singh", staffId: AMIT.id, loggedAt: day(7) }],
    calls: [{ at: day(4), staff: "Amit Singh", staffId: AMIT.id }],
    sharedWith: [share(RAVI, "accepted", AMIT, { respondedAt: day(5) }), share(PRIYA, "pending", AMIT)],
    timeline: [{ date: day(1), action: "Lead Created", notes: "Walk-in", staff: "Amit Singh" }],
  });
  await Lead.create({ leadId: "LEAD-2026-0002", customerName: "Sunita Devi", mobile: "9123456780", interestedProduct: "LG Fridge", assignedStaff: "  ravi kumar ", estimatedValue: 31000, status: "Contacted", sharedWith: [share(AMIT, "pending", RAVI)] });
  await Lead.create({ leadId: "LEAD-2026-0003", customerName: "Mohd Arif", mobile: "+91 99887 76655", interestedProduct: "Samsung TV", assignedStaff: "Sales Team", status: "New" });
  await Lead.create({ leadId: "LEAD-2026-0004", customerName: "Kavita Rao", mobile: "9988001122", interestedProduct: "Washing Machine", assignedStaff: "Priya Sharma", status: "Converted", priority: "Low" });
  await Lead.create({ leadId: "LEAD-2026-0006", customerName: "Anil Gupta", mobile: "9876543210", interestedProduct: "Mixer", assignedStaff: "AMIT SINGH", status: "Interested", priority: "Urgent" });

  for (const w of [
    { customerName: "Rahul Sharma", mobile: "9876543210", date: "2026-10-02", time: "11:53 am", reason: "Product Enquiry", interestedProduct: "AC", budget: 45000, staff: "Amit Singh", status: "Converted to Lead", leadId: "LEAD-2026-0001" },
    { customerName: "Pooja", mobile: "9000011111", date: "2026-10-02", time: "04:10 pm", reason: "Price Enquiry", interestedProduct: "TV", budget: 30000.75, staff: "Ravi Kumar", status: "Open" },
  ]) await WalkInQuery.create(w);

  for (const c of [
    { ticketNumber: "CMP-2026-0001", complaintType: "product", customerName: "Rahul Sharma", customerPhone: "9876543210", productName: "LLOYD AC", issueTitle: "Not cooling", issueDescription: "Gas leak suspected", priority: "High", status: "Open", assignedTo: "Ravi Kumar" },
    { ticketNumber: "CMP-2026-0002", complaintType: "staff_conduct", accusedStaffId: AMIT.id, accusedStaffName: "Amit Singh", customerName: "Sunita Devi", customerPhone: "9123456780", issueTitle: "Rude behaviour", issueDescription: "Raised voice", priority: "Critical", status: "Investigating" },
  ]) await CustomerComplaint.create(c);

  await WhatsAppSetting.create({
    provider: "manual", enabled: true, adminNumbers: ["917510002806"], notifyCustomer: false, events: { "lead.created": true }, businessName: "Value Plus",
    cloudApi: { phoneNumberId: "1234567890", accessToken: "test-token-not-real", apiVersion: "v21.0" },
  });
  for (const m of [
    { event: "lead.created", audience: "admin", toNumber: "917510002806", toName: "Admin", message: "New lead: Rahul Sharma (AC)", entityType: "lead", entityRef: "LEAD-2026-0001", status: "pending", provider: "manual" },
    { event: "lead.created", audience: "customer", toNumber: "919876543210", toName: "Rahul Sharma", message: "Thank you for visiting", entityType: "lead", entityRef: "LEAD-2026-0001", status: "sent", provider: "cloud-api", attempts: 1, sentAt: day(2) },
    { event: "complaint.created", audience: "admin", toNumber: "917510002806", toName: "Admin", message: "Complaint CMP-2026-0001: 100% not cooling", entityType: "complaint", entityRef: "CMP-2026-0001", status: "failed", provider: "cloud-api", error: "Template not approved", attempts: 2 },
  ]) await WhatsAppMessage.create(m);

  const onsitego = await DocumentFolder.create({ name: ONSITEGO_FOLDER, nameKey: ONSITEGO_FOLDER.toLowerCase(), createdBy: "System" });
  const bank = await DocumentFolder.create({ name: "Bank", nameKey: "bank", createdBy: "Admin" });
  const file = (n: number, folderId: string, date: string) => ({
    docNo: `DOC-${date.replace(/-/g, "")}-00000${n}`, date, narration: `Document ${n}`, fileUrl: `https://res.example.com/doc${n}.pdf`, filePublicId: `valueplus/documents/doc${n}`,
    fileResourceType: "image", fileFormat: "pdf", fileName: `doc ${n}.pdf`, fileType: "application/pdf", fileSize: 1000 * n + 0.5, folderId, uploadedBy: "Admin",
  });
  DOC_ID = String((await StoredDocument.create(file(1, String(onsitego._id), "2026-10-05")))._id);
  await StoredDocument.create(file(2, String(bank._id), "2026-10-05"));
  await StoredDocument.create(file(3, String(bank._id), "2026-10-01"));
  await StoredDocument.create(file(4, "", "2026-10-07"));
  await OnsitegoPlan.insertMany([
    { category: "AC", device: "Air Conditioner", kind: "EW", vpCode: "OSG-AC", minPrice: 30001, maxPrice: 50000, planName: "1 Yr EW", years: 1, price: 1999, sourceDocId: DOC_ID, sourceFileName: "Oct.pdf" },
    { category: "TV", device: "Television", kind: "ADLD", vpCode: "OSG-TV", minPrice: 0, maxPrice: 30000, planName: "1 Yr ADLD", years: 1, price: 999, sourceDocId: DOC_ID, sourceFileName: "Oct.pdf" },
  ]);

  const cash = await Account.create({ code: "1001", name: "Cash", type: "asset", balance: 15000.25 });
  ACC_BANK = await Account.create({ code: "1002", name: "Bank", type: "asset", description: "SBI current", balance: 250000 });
  const sales = await Account.create({ code: "4001", name: "Sales", type: "revenue" });
  const jl = (acc: any, debit: number, credit: number) => ({ accountId: acc._id, accountName: acc.name, debit, credit });
  await JournalEntry.create({ entryNumber: "JE-2026-0001", date: "2026-10-02", description: "Cash sale", lines: [jl(cash, 1180, 0), jl(sales, 0, 1180)], totalDebit: 1180, totalCredit: 1180 });
  await JournalEntry.create({ entryNumber: "JE-2026-0002", date: "2026-10-03", description: "Deposit", lines: [jl(ACC_BANK, 5000, 0), jl(cash, 0, 5000)], totalDebit: 5000, totalCredit: 5000 });

  // Distinct creation / update times (the clock is frozen, so the models gave every document the same ones).
  for (const name of ["leads", "walk_in_queries", "customer_complaints", "whatsapp_messages", "stored_documents", "document_folders", "journal_entries", "accounts", "onsitego_plans", "whatsapp_settings"]) {
    const docs = (await raw.collection(name).find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).toArray()).map((d: any) => d._id);
    for (let i = 0; i < docs.length; i++) {
      const created = new Date(Date.UTC(2026, 9, 1, 4, 0, 0, 0) + ((i * 7 + 3) % (docs.length + 7)) * 3_600_000 + i * 17);
      await raw.collection(name).updateOne({ _id: docs[i] }, { $set: { createdAt: created, updatedAt: new Date(created.getTime() + i * 86_400_000 + 123) } });
    }
  }
}

/** A plain object (not an ObjectId, Date, array …). */
const isPlain = (v: any) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

/** `def` filled in under `raw`: raw wins wherever it has a value; arrays are merged element by element. */
function fillDefaults(def: any, raw: any): any {
  if (raw === undefined) return def;
  if (Array.isArray(raw) && Array.isArray(def)) return raw.map((x, i) => fillDefaults(def[i], x));
  if (isPlain(raw) && isPlain(def)) {
    const out: any = { ...def };
    for (const key of Object.keys(raw)) out[key] = fillDefaults(def[key], raw[key]);
    return out;
  }
  return raw;
}

/**
 * The dashboard data set, as the app would have saved it: each document passed through its model (schema defaults
 * and subdocument ids filled in, every stored field kept), with createdAt / updatedAt / __v where the fixture left
 * them out. The fixture writes legacy shapes on purpose (for the dashboard golden test); a legacy document differs
 * between MongoDB and D1 only in the copy's documented limits (a missing boolean reads `false`, missing timestamps
 * are filled in: lib/repo/sales/INVENTORY.md), which this test is not about.
 */
function asSaved(data: Record<string, any[]>): Record<string, any[]> {
  const byCollection = new Map<string, any>();
  for (const name of mongoose.modelNames()) {
    const m = mongoose.model(name);
    byCollection.set(m.collection.collectionName, m);
  }
  const out: Record<string, any[]> = {};
  for (const [collection, docs] of Object.entries(data)) {
    const model = byCollection.get(collection);
    out[collection] = docs.map((raw, i) => {
      const doc = model ? fillDefaults(new model(raw).toObject({ depopulate: true }), raw) : { ...raw };
      const when = raw.createdAt || raw.updatedAt || new Date(Date.UTC(2026, 9, 1, 3, 0, 0, i * 1000));
      doc.createdAt = raw.createdAt || when;
      doc.updatedAt = raw.updatedAt || when;
      if (doc.__v === undefined) doc.__v = 0;
      return doc;
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Calling a route
// ---------------------------------------------------------------------------

interface Case {
  label: string;
  handler: Handler;
  url: string;
  actor?: Actor;
}

async function call(c: Case): Promise<{ status: number; text: string }> {
  const run = () => c.handler(new Request(c.url));
  const res = c.actor ? await deferredContext.run({ approver: c.actor as any }, run) : await run();
  return { status: res.status, text: await res.text() };
}

/** What the comparison sees: the canonical JSON (keys sorted, null = missing), as lib/d1/compare.ts. */
const canon = (text: string) => {
  try {
    return JSON.stringify(canonicalize(JSON.parse(text)));
  } catch {
    return text;
  }
};

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}: mongo …${a.slice(Math.max(0, i - 80), i + 80)}… / d1 …${b.slice(Math.max(0, i - 80), i + 80)}…`;
}

async function setMode(db: D1DatabaseLike, value: string) {
  for (const a of AREAS) {
    await db.prepare("INSERT OR REPLACE INTO feature_flags (key, value, updatedAt) VALUES (?, ?, '2026-11-13T00:00:00.000Z')").bind(`read:${a}`, value).run();
  }
  resetReadModeCache();
}

async function lastId(db: D1DatabaseLike): Promise<number> {
  const r: any = await db.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM shadow_results").first();
  return Number(r?.n || 0);
}

async function rowsAfter(db: D1DatabaseLike, id: number): Promise<any[]> {
  return ((await db.prepare("SELECT area, name, kind, match, diffCount, diffs, error FROM shadow_results WHERE id > ? ORDER BY id").bind(id).all()).results || []) as any[];
}

// ---------------------------------------------------------------------------

async function main() {
  mongoose.set("autoIndex", false);
  await startMemoryMongo("d1_wiring_sales_crm_test");
  const local = await startLocalD1();
  const db = local.db;
  try {
    await applyMigrations(db);
    const flags = ((await db.prepare("SELECT key, value FROM feature_flags WHERE key LIKE 'read:%' ORDER BY key").all()).results || []) as any[];
    check(
      ["sales", "crm", "stock", "staff"].every((a) => flags.some((f) => f.key === `read:${a}` && f.value === "shadow")),
      `migration 0008 seeds read:sales / crm / stock / staff = 'shadow' (${flags.map((f) => `${f.key}=${f.value}`).join(", ")})`
    );

    await seedDashboard(asSaved(smallDataset()));
    await seedSales();
    await seedStaffAndCash();
    await seedCrm();
    await ensureIndexes(INDEXES);

    configureReadSource({ resolveD1: () => db, envValue: () => "", flagTtlMs: 0 });
    resetShadowConfig();
    setStaffD1(db);

    const H = (h: unknown) => h as Handler;
    const U = (p: string) => `http://localhost${p}`;
    const cases: Case[] = [
      { label: "invoices list", handler: H(invoicesGET), url: U("/api/invoices") },
      { label: "invoices list ?includeEstimates=true", handler: H(invoicesGET), url: U("/api/invoices?includeEstimates=true") },
      { label: "invoices list ?type=credit-note", handler: H(invoicesGET), url: U("/api/invoices?type=credit-note") },
      { label: "invoices list ?warehouse=Ashoka … (showroom names)", handler: H(invoicesGET), url: U("/api/invoices?warehouse=Ashoka%20Enterprises%20(Kunraghat%20Showroom)") },
      { label: "invoices list ?location=Main Branch (exact name)", handler: H(invoicesGET), url: U("/api/invoices?location=Main%20Branch") },
      { label: "invoices list ?warehouse=nowhere (no match: whole ledger)", handler: H(invoicesGET), url: U("/api/invoices?warehouse=nowhere") },
      { label: "one invoice by number", handler: H(invoicesGET), url: U("/api/invoices?invoiceNumber=VP-001") },
      { label: "orders ?staff=Amit Singh", handler: H(ordersGET), url: U("/api/orders?staff=Amit%20Singh") },
      { label: "next number (tax invoice)", handler: H(nextNumberGET), url: U("/api/invoices/next-number") },
      { label: "next number (estimate)", handler: H(nextNumberGET), url: U("/api/invoices/next-number?type=estimate") },
      { label: "payments", handler: H(paymentsGET), url: U("/api/payments") },
      { label: "payments ?partyType=Supplier", handler: H(paymentsGET), url: U("/api/payments?partyType=Supplier") },
      { label: "advances", handler: H(advancesGET), url: U("/api/crm/advances") },
      { label: "advances ?search=lg", handler: H(advancesGET), url: U("/api/crm/advances?search=lg") },
      { label: "estimates (admin)", handler: H(estimatesGET), url: U("/api/estimates"), actor: ADMIN },
      { label: "estimates ?approval=pending (salesman: own only)", handler: H(estimatesGET), url: U("/api/estimates?approval=pending"), actor: AMIT },
      { label: "finance list (kept on MongoDB)", handler: H(financeGET), url: U("/api/finance") },
      { label: "finance reminders", handler: H(financeRemindersGET), url: U("/api/finance/reminders") },
      { label: "warranty", handler: H(warrantyGET), url: U("/api/warranty") },
      { label: "warranty ?customerPhone=", handler: H(warrantyGET), url: U("/api/warranty?customerPhone=9415098765") },
      { label: "approvals (admin)", handler: H(approvalsGET), url: U("/api/approvals"), actor: ADMIN },
      { label: "approvals ?status=pending (manager: own)", handler: H(approvalsGET), url: U("/api/approvals?status=pending"), actor: MANAGER },
      { label: "discount approvals ?status=pending (manager)", handler: H(discountApprovalsGET), url: U("/api/discount-approvals?status=pending"), actor: MANAGER },
      { label: "discount approvals ?ids= (own requests)", handler: H(discountApprovalsGET), url: U(`/api/discount-approvals?ids=${DA_IDS.join(",")}`), actor: AMIT },
      { label: "track VP-001 (bill)", handler: (req) => (trackGET as any)(req, { params: Promise.resolve({ id: "VP-001" }) }), url: U("/api/track/VP-001") },
      { label: "track DC-2026-0007 (challan)", handler: (req) => (trackGET as any)(req, { params: Promise.resolve({ id: "DC-2026-0007" }) }), url: U("/api/track/DC-2026-0007") },
      { label: "my incentive ?detail=1 (salesman)", handler: H(myIncentiveGET), url: U("/api/staff/my-incentive?detail=1"), actor: AMIT },
      { label: "brand sales (salesman, all time)", handler: H(brandSalesGET), url: U("/api/staff/brand-sales?range=all"), actor: AMIT },
      { label: "delivery challans ?flowType=CR", handler: H(challansGET), url: U("/api/delivery-challans?flowType=CR") },
      { label: "e-way bills", handler: H(ewayGET), url: U("/api/eway-bills") },
      { label: "billing companies", handler: H(billingCompaniesGET), url: U("/api/billing-companies") },
      { label: "vendors ledger ?party=customer", handler: H(vendorsLedgerGET), url: U("/api/vendors/ledger?party=customer"), actor: ADMIN },
      { label: "sales-out", handler: H(salesOutGET), url: U("/api/reports/sales-out?startDate=2026-10-01&endDate=2026-11-13") },
      { label: "sales-out ?dueOnly&bank=Bajaj", handler: H(salesOutGET), url: U("/api/reports/sales-out?dueOnly=true&bank=Bajaj") },
      { label: "profit-loss", handler: H(profitLossGET), url: U("/api/reports/profit-loss?startDate=2026-10-01&endDate=2026-11-13"), actor: ADMIN },
      { label: "gstr HSN_SUMMARY", handler: H(gstrGET), url: U("/api/gstr-reports?type=HSN_SUMMARY") },
      { label: "gstr GSTR1_B2B (Nov)", handler: H(gstrGET), url: U("/api/gstr-reports?type=GSTR1_B2B&month=10&year=2026") },
      { label: "gstr GSTR1", handler: H(gstrGET), url: U("/api/gstr-reports?type=GSTR1") },
      { label: "gstr GSTR2", handler: H(gstrGET), url: U("/api/gstr-reports?type=GSTR2") },
      { label: "dashboard stats (this month)", handler: H(dashboardGET), url: U("/api/dashboard/stats") },
      { label: "dashboard stats (Oct 25 - Nov 13, Ashoka)", handler: H(dashboardGET), url: U("/api/dashboard/stats?startDate=2026-10-25&endDate=2026-11-13&warehouse=Ashoka%20Enterprises%20(Kunraghat%20Showroom)") },
      { label: "me/summary (admin)", handler: H(meSummaryGET), url: U("/api/me/summary"), actor: ADMIN },
      { label: "me/summary (salesman)", handler: H(meSummaryGET), url: U("/api/me/summary"), actor: AMIT },
      { label: "notifications (admin)", handler: H(notificationsGET), url: U("/api/notifications"), actor: ADMIN },
      { label: "cash register", handler: H(cashRegisterGET), url: U("/api/cash-register"), actor: CASHIER },
      { label: "leads (salesman)", handler: H(leadsGET), url: U("/api/crm/leads"), actor: AMIT },
      { label: "leads (admin)", handler: H(leadsGET), url: U("/api/crm/leads"), actor: ADMIN },
      { label: "leads ?mobile= (billing form look-up)", handler: H(leadsGET), url: U("/api/crm/leads?mobile=%2B91%2098765%2043210"), actor: RAVI },
      { label: "leads ?shareInbox=1", handler: H(leadsGET), url: U("/api/crm/leads?shareInbox=1"), actor: PRIYA },
      { label: "global search ?q=rahul (leads part)", handler: H(searchGET), url: U("/api/search?q=rahul"), actor: ADMIN },
      { label: "walk-ins", handler: H(walkInGET), url: U("/api/crm/walk-in") },
      { label: "complaints ?search=cool", handler: H(complaintsGET), url: U("/api/crm/complaints?search=cool") },
      { label: "whatsapp outbox", handler: H(whatsappGET), url: U("/api/whatsapp"), actor: ADMIN },
      { label: "whatsapp outbox ?q=100%", handler: H(whatsappGET), url: U("/api/whatsapp?q=100%25&status=all"), actor: ADMIN },
      { label: "whatsapp settings", handler: H(whatsappSettingsGET), url: U("/api/whatsapp/settings"), actor: ADMIN },
      { label: "documents (admin)", handler: H(documentsGET), url: U("/api/documents"), actor: ADMIN },
      { label: "documents (salesman: On Site Go only)", handler: H(documentsGET), url: U("/api/documents"), actor: AMIT },
      { label: "document folders (admin)", handler: H(foldersGET), url: U("/api/documents/folders"), actor: ADMIN },
      { label: "document folders (cashier)", handler: H(foldersGET), url: U("/api/documents/folders"), actor: CASHIER },
      { label: "onsitego plans", handler: H(onsitegoPlansGET), url: U("/api/onsitego/plans"), actor: AMIT },
      { label: "accounts", handler: H(accountsGET), url: U("/api/accounting/accounts") },
      { label: "journal", handler: H(journalGET), url: U("/api/accounting/journal") },
      { label: "journal ?accountId=<bank>", handler: H(journalGET), url: U(`/api/accounting/journal?accountId=${ACC_BANK._id}`) },
    ];

    // Every route once in mongo mode BEFORE the copy: a GET that writes (EMI schedule, delivery reminders) has
    // written before D1 gets its copy.
    await setMode(db, "mongo");
    for (const c of cases) await call(c);

    const copy = await runD1Sync(db, { reconcile: "skip", budgetMs: 10 * 60_000 });
    check(copy.ok && copy.errors === 0 && !copy.timedOut, `everything copied into D1 (${Object.values(copy.collections).reduce((s: number, x: any) => s + x.copied, 0)} documents)`);

    // ── mongo / shadow / d1: the same JSON; shadow records matches ──
    console.log("\nmongo, shadow and d1 mode");
    const ranNames = new Set<string>();
    for (const c of cases) {
      await setMode(db, "mongo");
      const m = await call(c);
      await setMode(db, "shadow");
      resetShadowSampling();
      const before = await lastId(db);
      const s = await call(c);
      await flushShadowWork();
      const rows = (await rowsAfter(db, before)).filter((r) => r.kind === "shadow");
      await setMode(db, "d1");
      const d = await call(c);

      const mc = canon(m.text);
      const wired = !/kept on MongoDB/.test(c.label);
      // The finance list keeps its MongoDB read (it saves an EMI schedule on the documents); the fixture's finance
      // records lack fields its schema requires, so that save fails the same way in every mode.
      const ok = wired ? m.status === 200 && s.status === 200 && d.status === 200 : m.status === s.status && m.status === d.status;
      check(ok, `${c.label}: ${wired ? "200 in every mode" : "same status in every mode"} (${m.status}/${s.status}/${d.status})${ok ? "" : ` ${m.text.slice(0, 160)}`}`);
      check(s.text === m.text, `${c.label}: shadow mode answer byte-identical to mongo mode`);
      check(canon(d.text) === mc, `${c.label}: d1 mode answer identical${canon(d.text) === mc ? "" : ` ${firstDiff(mc, canon(d.text))}`}`);
      const bad = rows.filter((r) => r.match !== 1);
      check(
        wired ? rows.length > 0 && bad.length === 0 : rows.length === 0,
        `${c.label}: shadow ${wired ? `recorded ${rows.length} match(es)` : "records nothing (not wired)"} [${rows.map((r) => `${r.area}/${r.name}`).join(", ")}]${
          bad.length ? ` MISMATCH ${bad.map((r) => `${r.area}/${r.name}: ${r.error || r.diffs}`).join("; ")}` : ""
        }`
      );
      for (const r of rows) ranNames.add(`${r.area}/${r.name}`);
    }

    const wiredSales = Object.keys(SALES_READS).filter((k) => k !== "finance.list");
    const notSeen = wiredSales.filter((k) => !ranNames.has(`sales/${k}`));
    console.log(`  sales reads compared in shadow mode: ${wiredSales.length - notSeen.length} of ${wiredSales.length}${notSeen.length ? ` (not in these cases: ${notSeen.join(", ")})` : ""}`);
    const crmSeen = Object.keys(CRM_READS).filter((k) => ranNames.has(`crm/${k}`));
    console.log(`  crm reads compared in shadow mode: ${crmSeen.length} of ${Object.keys(CRM_READS).length}`);
    check(crmSeen.length >= 14, "most crm reads ran through the shadow comparison");

    // ── d1 mode really reads D1 ──
    console.log("\nd1 mode reads D1; a D1 error falls back to MongoDB");
    await db.prepare("UPDATE accounts SET name = 'Bank (from D1)' WHERE code = '1002'").run();
    await setMode(db, "d1");
    const fromD1 = await call({ label: "accounts", handler: H(accountsGET), url: U("/api/accounting/accounts") });
    check(/Bank \(from D1\)/.test(fromD1.text), "d1 mode serves the D1 row");
    await setMode(db, "mongo");
    check(!/Bank \(from D1\)/.test((await call({ label: "accounts", handler: H(accountsGET), url: U("/api/accounting/accounts") })).text), "mongo mode does not");
    await db.prepare("UPDATE accounts SET name = 'Bank' WHERE code = '1002'").run();

    // Every D1 SELECT fails (the flag read with its freshness facts, and the recording still work): each route answers from MongoDB, the
    // same as in mongo mode, and each fallback is recorded.
    const broken = faulty(db, { fail: (sql) => /^\s*SELECT/i.test(sql) && !/feature_flags|shadow_results|write_through_state|sync_errors/.test(sql) });
    for (const c of cases) {
      await setMode(db, "mongo");
      const m = await call(c);
      await setMode(db, "d1");
      configureReadSource({ resolveD1: () => broken });
      setStaffD1(broken);
      const before = await lastId(db);
      const d = await call(c);
      await flushShadowWork();
      configureReadSource({ resolveD1: () => db });
      setStaffD1(db);
      const rows = await rowsAfter(db, before);
      const wired = !/kept on MongoDB/.test(c.label);
      check(d.status === m.status && d.text === m.text, `${c.label}: D1 failing, d1 mode answers from MongoDB (byte-identical to mongo mode)`);
      // A read marked mongoOnlyInD1 (next number, cash register) is answered by MongoDB even in d1 mode, so its D1
      // failure shows up as a failed shadow comparison instead of a fallback.
      const mongoOnly = (r: any) => (r.area === "sales" ? !!SALES_READS[r.name]?.mongoOnlyInD1 : !!(STOCK_READS as any)[r.name]?.mongoOnlyInD1);
      check(
        !wired ||
          (rows.length > 0 &&
            rows.every((r) => (r.kind === "fallback" || (r.kind === "shadow" && mongoOnly(r))) && /simulated failure/.test(r.error || ""))),
        `${c.label}: ${rows.length} fallback(s) recorded`
      );
    }
  } finally {
    setStaffD1(null);
    resetReadSourceConfig();
    resetShadowConfig();
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-wiring-sales-crm") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
