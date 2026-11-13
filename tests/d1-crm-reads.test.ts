/**
 * D1 reads of the CRM, documents and accounting area (lib/repo/crm): for EVERY entry of CRM_READS and several
 * argument combinations, the D1 read returns exactly what the current Mongo read returns.
 *
 * Realistic data is seeded into an in-memory MongoDB (leads of several salesmen with calls, follow-ups and shares;
 * walk-ins; complaints; the WhatsApp outbox and settings; documents in folders incl. On Site Go; Onsitego plans;
 * accounts and journal entries), plus a few legacy documents written straight into the collections. It is copied to
 * a local D1 by the real copy job (lib/d1/sync.ts), then each pair is run and compared.
 *
 * Comparison: JSON.stringify(mongo) === JSON.stringify(d1) after this normalisation, applied to BOTH sides:
 *  - object keys sorted (key order is not data: D1 rebuilds documents in column order, Mongo in stored order);
 *  - documents.folderCounts: the $group rows sorted by _id (Mongo's $group output order is unspecified).
 * A read that throws must throw on both sides. Results of reads that carry the WhatsApp access token are never
 * printed; the token is a random test value.
 */
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { CRM_DOCS_SPECS } from "@/lib/d1/maps/crm-docs";
import { runD1Sync } from "@/lib/d1/sync";
import { CRM_READS, CRM_SECRET_READS } from "@/lib/repo/crm";
import { ONSITEGO_FOLDER } from "@/lib/onsitego";
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

const { ObjectId } = mongoose.mongo as any;
const COLLECTIONS = CRM_DOCS_SPECS.map((s) => s.collection);
const SYNC = { reconcile: "skip" as const, collections: COLLECTIONS };
/** A made-up token (never a real one); compared, never printed. */
const TOKEN = `test-${randomBytes(16).toString("hex")}`;

// ---------------------------------------------------------------------------
// Normalisation + comparison
// ---------------------------------------------------------------------------

function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function canon(name: string, v: any): string {
  let x = v === undefined ? null : JSON.parse(JSON.stringify(v));
  if (name === "documents.folderCounts" && Array.isArray(x)) x = [...x].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  return JSON.stringify(sortKeys(x));
}

async function outcome(fn: () => Promise<any>): Promise<{ threw: boolean; value?: any }> {
  try {
    return { threw: false, value: await fn() };
  } catch {
    return { threw: true };
  }
}

/** First differing position of two JSON texts, for the failure message (never used on secret reads). */
function where(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}: mongo …${a.slice(Math.max(0, i - 80), i + 80)}… vs d1 …${b.slice(Math.max(0, i - 80), i + 80)}…`;
}

const covered = new Map<string, number>();
/** The row-count expectations describe the seed; they are checked in the first round only. */
let checkSeeded = true;

async function compare(db: D1DatabaseLike, name: string, args: any, label = "", expectItems?: (v: any) => boolean) {
  const pair = CRM_READS[name];
  if (!pair) return check(false, `${name}: in CRM_READS`);
  const m = await outcome(() => pair.mongo(args));
  const d = await outcome(() => pair.d1(args, db));
  const tag = `${name}${label ? ` [${label}]` : ""}`;
  covered.set(name, (covered.get(name) || 0) + 1);
  if (m.threw || d.threw) {
    check(m.threw && d.threw, `${tag}: ${m.threw ? "both throw" : "mongo returns but d1 throws"}`);
    return;
  }
  const a = canon(name, m.value);
  const b = canon(name, d.value);
  const size = Array.isArray(m.value?.[0]) ? `${m.value[0].length} rows + counts` : Array.isArray(m.value) ? `${m.value.length} rows` : m.value === null ? "null" : "1 value";
  if (CRM_SECRET_READS.has(name)) check(a === b, `${tag}: identical (${size}; output not printed: holds the token)`);
  else check(a === b, `${tag}: identical (${size})${a === b ? "" : ` — ${where(a, b)}`}`);
  if (expectItems && checkSeeded) check(expectItems(m.value), `${tag}: the seeded case is exercised`);
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const AMIT = { id: String(new ObjectId()), name: "Amit Singh", role: "salesman" };
const RAVI = { id: String(new ObjectId()), name: "Ravi Kumar (Sales Executive)", role: "sales" };
const PRIYA = { id: String(new ObjectId()), name: "Priya Sharma", role: "salesman" };
const ADMIN = { id: String(new ObjectId()), name: "Admin", role: "admin" };
const HR = { id: String(new ObjectId()), name: "Neha Verma", role: "hr" };
const CASHIER = { id: String(new ObjectId()), name: "Cash Desk", role: "cashier" };

let ACC_CASH: any;
let ACC_SALES: any;
let ACC_BANK: any;
let SETTINGS_ID = "";
let ONSITEGO_ID = "";
let BANK_FOLDER_ID = "";
let DOC_ID = "";

const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 5, 30, 0, 0));

async function seed() {
  const raw = mongoose.connection.db!;
  const share = (who: typeof AMIT, status: string, by: typeof AMIT, extra: any = {}) => ({
    staff: who.name.replace(/\s*\(.*\)$/, ""), staffId: who.id, brand: "LG", products: "LG AC 1.5T", note: "wants demo", status,
    requestedBy: by.name, requestedById: by.id, requestedAt: day(3), ...extra,
  });

  // ── Leads ──
  await Lead.create({
    leadId: "LEAD-2026-0001", customerName: "Rahul Sharma", mobile: "919876543210", email: "rahul@example.com", source: "Walk-in Store",
    interestedProduct: "LLOYD AC 1.5T", vpCode: "VP-AC-15", assignedStaff: "Amit Singh", estimatedValue: 42500.5, priority: "High", status: "Follow-up",
    followUpDate: "2026-10-12", lastFollowUpDate: "2026-10-08", callCount: 2, lastCalledAt: day(6),
    followUps: [
      { date: "2026-10-05", nextDate: "2026-10-08", outcome: "not_received", notes: "", staff: "Amit Singh", staffId: AMIT.id, loggedAt: day(4) },
      { date: "2026-10-08", nextDate: "2026-10-12", outcome: "interested", notes: "Call after salary", staff: "Amit Singh", staffId: AMIT.id, loggedAt: day(7) },
    ],
    calls: [{ at: day(4), staff: "Amit Singh", staffId: AMIT.id }, { at: day(6), staff: "Amit Singh", staffId: AMIT.id }],
    sharedWith: [share(RAVI, "accepted", AMIT, { respondedAt: day(5) }), share(PRIYA, "pending", AMIT)],
    items: [{ name: "LLOYD AC", qty: 1, rate: 42500.5 }],
    timeline: [{ date: day(1), action: "Lead Created", notes: "Walk-in", staff: "Amit Singh" }, { date: day(4), action: "Called customer", notes: "", staff: "Amit Singh" }],
    notes: "Wants installation same day",
  });
  await Lead.create({
    leadId: "LEAD-2026-0002", customerName: "Sunita Devi", mobile: "9123456780", interestedProduct: "LG Fridge", assignedStaff: "  ravi kumar ",
    estimatedValue: 31000, status: "Contacted", priority: "Medium",
    sharedWith: [share(AMIT, "pending", RAVI), share(PRIYA, "rejected", RAVI, { respondedAt: day(6) })],
    timeline: [{ date: day(2), action: "Lead Created", notes: "", staff: "Ravi Kumar" }],
  });
  await Lead.create({ leadId: "LEAD-2026-0003", customerName: "Mohd Arif", mobile: "+91 99887 76655", interestedProduct: "Samsung TV", assignedStaff: "Sales Team", status: "New" });
  await Lead.create({ leadId: "LEAD-2026-0004", customerName: "Kavita Rao", mobile: "9988001122", interestedProduct: "Washing Machine", assignedStaff: "Priya Sharma", status: "Converted", priority: "Low", convertedInvoiceNumber: "VP/2026/0101", estimateNumber: "EST-0009", estimateId: String(new ObjectId()) });
  await Lead.create({ leadId: "LEAD-2026-0005", customerName: "Deepak 100% Kumar", mobile: "9000000005", interestedProduct: "Cooler_X", assignedStaff: "", status: "Lost", sharedWith: [share(PRIYA, "accepted", ADMIN)] });
  await Lead.create({ leadId: "LEAD-2026-0006", customerName: "Anil Gupta", mobile: "9876543210", interestedProduct: "Mixer", assignedStaff: "AMIT SINGH", status: "Interested", priority: "Urgent", calls: [{ at: day(8), staff: "Priya Sharma", staffId: PRIYA.id }] });
  // Legacy lead written straight into the collection: no assignedStaff, no arrays, estimatedValue as text, an unknown field.
  await raw.collection("leads").insertOne({
    _id: new ObjectId(), leadId: "LEAD-2025-0099", customerName: "Old Pool Lead", mobile: "8800112233", interestedProduct: "Fan", status: "New",
    estimatedValue: "12,000", legacyNote: { from: "excel", row: 17 }, createdAt: day(-30), updatedAt: day(-29), __v: 0,
  });

  // ── Walk-ins ──
  const walk = [
    { customerName: "Rahul Sharma", mobile: "9876543210", date: "2026-10-02", time: "11:53 am", reason: "Product Enquiry", interestedProduct: "AC", category: "AC", budget: 45000, staff: "Amit Singh", status: "Converted to Lead", leadId: "LEAD-2026-0001" },
    { customerName: "Pooja", mobile: "9000011111", date: "2026-10-02", time: "04:10 pm", reason: "Price Enquiry", interestedProduct: "TV", budget: 30000.75, staff: "Ravi Kumar", status: "Open", followUpDate: "2026-10-09" },
    { customerName: "Imran", mobile: "9000022222", date: "2026-10-03", time: "12:00 pm", reason: "Service", interestedProduct: "Fridge", staff: "Priya Sharma", status: "Closed", notes: "Sent to service centre" },
  ];
  for (const w of walk) await WalkInQuery.create(w);

  // ── Complaints ──
  const complaints = [
    { ticketNumber: "CMP-2026-0001", complaintType: "product", customerName: "Rahul Sharma", customerPhone: "9876543210", productName: "LLOYD AC", serialNumber: "SN-AC-001", invoiceNumber: "VP/2026/0050", issueTitle: "Not cooling", issueDescription: "Gas leak suspected", priority: "High", status: "Open", assignedTo: "Ravi Kumar" },
    { ticketNumber: "CMP-2026-0002", complaintType: "staff_conduct", accusedStaffId: AMIT.id, accusedStaffName: "Amit Singh", accusedStaffRole: "salesman", accusedStaffBrand: "LLOYD", customerName: "Sunita Devi", customerPhone: "9123456780", issueTitle: "Rude behaviour", issueDescription: "Raised voice", priority: "Critical", status: "Investigating" },
    { ticketNumber: "CMP-2026-0003", complaintType: "delivery_transit", customerName: "Kavita Sharma", customerPhone: "9988001122", productName: "Washer 100% Fresh_Line", issueTitle: "Late delivery", issueDescription: "3 days late", priority: "Low", status: "Resolved", resolvedAt: day(9), resolvedBy: "Admin", resolutionNotes: "Apologised", assignedTo: "Priya Sharma" },
  ];
  for (const c of complaints) await CustomerComplaint.create(c);
  await raw.collection("customer_complaints").insertOne({
    _id: new ObjectId(), ticketNumber: "CMP-2025-0042", complaintType: "other", customerName: "Legacy Customer", customerPhone: "8000000000", issueTitle: "Old", issueDescription: "Imported", priority: "Medium", status: "Closed", importedFrom: "sheet", createdAt: day(-60), updatedAt: day(-59), __v: 0,
  });

  // ── WhatsApp ──
  const settings = await WhatsAppSetting.create({
    provider: "cloud-api", enabled: true, adminNumbers: ["917510002806", "919000000001"], notifyCustomer: false,
    events: { "lead.created": true, "lead.status": false, "complaint.created": true }, businessName: "Value Plus",
    cloudApi: { phoneNumberId: "1234567890", accessToken: TOKEN, apiVersion: "v21.0", templateName: "alert", templateLanguage: "en" }, updatedBy: "Admin",
  });
  SETTINGS_ID = String(settings._id);
  const msgs = [
    { event: "lead.created", audience: "admin", toNumber: "917510002806", toName: "Admin", message: "New lead: Rahul Sharma (AC)", waLink: "https://wa.me/917510002806?text=x", entityType: "lead", entityRef: "LEAD-2026-0001", status: "pending", provider: "manual" },
    { event: "lead.created", audience: "customer", toNumber: "919876543210", toName: "Rahul Sharma", message: "Thank you for visiting Value Plus", entityType: "lead", entityRef: "LEAD-2026-0001", status: "sent", provider: "cloud-api", providerMessageId: "wamid.1", attempts: 1, sentAt: day(2), sentBy: "Admin" },
    { event: "complaint.created", audience: "admin", toNumber: "917510002806", toName: "Admin", message: "Complaint CMP-2026-0001: 100% not cooling", entityType: "complaint", entityRef: "CMP-2026-0001", status: "failed", provider: "cloud-api", error: "Template not approved", attempts: 2 },
    { event: "lead.status", audience: "admin", toNumber: "919000000001", toName: "Admin", message: "Lead LEAD-2026-0004 Converted", entityType: "lead", entityRef: "LEAD-2026-0004", status: "skipped", provider: "manual" },
    { event: "complaint.created", audience: "customer", toNumber: "919123456780", toName: "Sunita Devi", message: "Your complaint is registered", entityType: "complaint", entityRef: "CMP-2026-0002", status: "pending", provider: "manual", triggeredBy: "Priya Sharma" },
  ];
  for (const m of msgs) await WhatsAppMessage.create(m);

  // ── Documents ──
  const onsitego = await DocumentFolder.create({ name: ONSITEGO_FOLDER, nameKey: ONSITEGO_FOLDER.toLowerCase(), createdBy: "System" });
  const bank = await DocumentFolder.create({ name: "Bank", nameKey: "bank", createdBy: "Admin", createdByUserId: ADMIN.id });
  await DocumentFolder.create({ name: "Bills", nameKey: "bills", createdBy: "Admin" });
  ONSITEGO_ID = String(onsitego._id);
  BANK_FOLDER_ID = String(bank._id);
  const file = (n: number, folderId: string, date: string, extra: any = {}) => ({
    docNo: `DOC-${date.replace(/-/g, "")}-00000${n}`, date, narration: `Document ${n}`, fileUrl: `https://res.example.com/doc${n}.pdf`, filePublicId: `valueplus/documents/doc${n}`,
    fileResourceType: "image", fileFormat: "pdf", fileDeliveryType: "private", fileName: `doc ${n}.pdf`, fileType: "application/pdf", fileSize: 1000 * n + 0.5,
    folderId, uploadedBy: "Admin", uploadedByUserId: ADMIN.id, uploadedByRole: "admin", ...extra,
  });
  const d1 = await StoredDocument.create(file(1, ONSITEGO_ID, "2026-10-05", { narration: "Onsite Go price list Oct.pdf" }));
  DOC_ID = String(d1._id);
  await StoredDocument.create(file(2, BANK_FOLDER_ID, "2026-10-05"));
  await StoredDocument.create(file(3, BANK_FOLDER_ID, "2026-10-01"));
  await StoredDocument.create(file(4, "", "2026-10-07"));
  await StoredDocument.create(file(5, ONSITEGO_ID, "2026-09-30", { fileName: "plans सितंबर.pdf" }));
  await raw.collection("stored_documents").insertOne({
    _id: new ObjectId(), docNo: "DOC-LEGACY-1", date: "2026-09-01", narration: "Legacy, no folder field", fileUrl: "https://x/y.pdf", uploadedBy: "Admin", createdAt: day(-40), updatedAt: day(-40), __v: 0,
  });

  // ── Onsitego plans (ties in minPrice/price on purpose) ──
  await OnsitegoPlan.insertMany([
    { category: "AC", device: "Air Conditioner", kind: "EW", vpCode: "OSG-AC", minPrice: 30001, maxPrice: 50000, planName: "1 Yr EW", years: 1, price: 1999, sourceDocId: DOC_ID, sourceFileName: "Oct.pdf" },
    { category: "AC", device: "Air Conditioner", kind: "EW", vpCode: "OSG-AC", minPrice: 30001, maxPrice: 50000, planName: "2 Yr EW", years: 2, price: 2999, sourceDocId: DOC_ID, sourceFileName: "Oct.pdf" },
    { category: "TV", device: "Television", kind: "ADLD", vpCode: "OSG-TV", minPrice: 0, maxPrice: 30000, planName: "1 Yr ADLD", years: 1, price: 999, sourceDocId: DOC_ID, sourceFileName: "Oct.pdf" },
    { category: "TV", device: "Television", kind: "EW", vpCode: "OSG-TV", minPrice: 0, maxPrice: 30000, planName: "1 Yr EW", years: 1, price: 999, sourceDocId: DOC_ID, sourceFileName: "Oct.pdf" },
    { category: "Fridge", device: "Refrigerator", kind: "EW", vpCode: "OSG-RF", minPrice: 15000.5, maxPrice: 30000, planName: "3 Yr EW", years: 3, price: 1499.5, sourceDocId: DOC_ID, sourceFileName: "Oct.pdf" },
  ]);

  // ── Accounting ──
  ACC_CASH = await Account.create({ code: "1001", name: "Cash", type: "asset", balance: 15000.25 });
  ACC_BANK = await Account.create({ code: "1002", name: "Bank", type: "asset", description: "SBI current", balance: 250000 });
  ACC_SALES = await Account.create({ code: "4001", name: "Sales", type: "revenue" });
  const line = (acc: any, debit: number, credit: number) => ({ accountId: acc._id, accountName: acc.name, debit, credit });
  await JournalEntry.create({ entryNumber: "JE-2026-0001", date: "2026-10-02", description: "Cash sale", referenceType: "Invoice", referenceId: "VP/2026/0050", lines: [line(ACC_CASH, 1180, 0), line(ACC_SALES, 0, 1180)], totalDebit: 1180, totalCredit: 1180 });
  await JournalEntry.create({ entryNumber: "JE-2026-0002", date: "2026-10-02", description: "Deposit", lines: [line(ACC_BANK, 5000, 0), line(ACC_CASH, 0, 5000)], totalDebit: 5000, totalCredit: 5000 });
  await JournalEntry.create({ entryNumber: "JE-2026-0003", date: "2026-10-04", description: "Card sale", referenceType: "Invoice", lines: [line(ACC_BANK, 2360.5, 0), line(ACC_SALES, 0, 2360.5)], totalDebit: 2360.5, totalCredit: 2360.5 });

  // Distinct, deliberately shuffled timestamps (the order of createdAt is not the order of insertion), so every
  // sort is really exercised and no two documents tie on a sort key that should decide their order.
  for (const name of ["leads", "walk_in_queries", "customer_complaints", "whatsapp_messages", "stored_documents", "document_folders", "journal_entries", "accounts"]) {
    const ids = (await raw.collection(name).find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).toArray()).map((d: any) => d._id);
    const n = ids.length;
    for (let i = 0; i < n; i++) {
      const slot = (i * 7 + 3) % (n + 7);
      const created = new Date(Date.UTC(2026, 9, 1, 4, 0, 0, 0) + slot * 3_600_000 + i * 17);
      const updated = new Date(created.getTime() + ((i * 5 + 2) % (n + 3)) * 86_400_000 + 123);
      await raw.collection(name).updateOne({ _id: ids[i] }, { $set: { createdAt: created, updatedAt: updated } });
    }
  }
}

// ---------------------------------------------------------------------------
// The comparisons
// ---------------------------------------------------------------------------

async function compareAll(db: D1DatabaseLike, round: string) {
  const r = (s: string) => `${round}${s ? `, ${s}` : ""}`;
  const len = (n: number) => (v: any) => Array.isArray(v) && v.length === n;

  // leads.list: every role kind, filters, the mobile lookup.
  await compare(db, "leads.list", { actor: ADMIN }, r("admin: every lead"), len(7));
  await compare(db, "leads.list", { actor: CASHIER, status: "all" }, r("cashier, status=all"));
  await compare(db, "leads.list", { actor: AMIT }, r("salesman Amit: own (any case/spaces) + pool + accepted shares"));
  await compare(db, "leads.list", { actor: RAVI }, r("salesman 'Ravi Kumar (Sales Executive)' matches 'ravi kumar' + accepted share"), (v) => v.some((l: any) => l.leadId === "LEAD-2026-0001") && v.some((l: any) => l.leadId === "LEAD-2026-0002"));
  await compare(db, "leads.list", { actor: PRIYA }, r("salesman Priya: pending/rejected shares not shown"));
  await compare(db, "leads.list", { actor: HR }, r("hr: own name only, no pool"), len(0));
  await compare(db, "leads.list", { actor: AMIT, status: "Follow-up" }, r("salesman + status"));
  await compare(db, "leads.list", { actor: ADMIN, staff: "Sales Team", priority: "Medium" }, r("staff + priority"));
  await compare(db, "leads.list", { actor: HR, mobile: "+91 98765 43210" }, r("mobile lookup, last 10 digits, any role"), len(2));
  await compare(db, "leads.list", { actor: AMIT, mobile: "98765" }, r("mobile lookup, short = exact"), len(0));
  await compare(db, "leads.list", { actor: ADMIN, mobile: "9876543210", status: "Interested" }, r("mobile + status"));
  await compare(db, "leads.shareInbox", { actorId: AMIT.id }, r("Amit: one pending"), len(1));
  await compare(db, "leads.shareInbox", { actorId: PRIYA.id }, r("Priya: one pending"), len(1));
  await compare(db, "leads.shareInbox", { actorId: RAVI.id }, r("Ravi: accepted only = none"), len(0));
  await compare(db, "leads.search", { q: "LEAD-2026" }, r("literal, limit 5"), len(5));
  await compare(db, "leads.search", { q: "sharma" }, r("literal, case-insensitive"));
  await compare(db, "leads.search", { q: "100%" }, r("literal with %"), len(1));
  await compare(db, "leads.search", { q: "^(amit|mohd)" }, r("regex"));
  await compare(db, "leads.search", { q: "98765.?432" }, r("regex on mobile"));
  await compare(db, "leads.search", { q: "(" }, r("invalid regex throws"));
  await compare(db, "leads.staffOverview", {}, r(""), len(7));

  await compare(db, "walkIn.list", {}, r("all"), len(3));
  await compare(db, "walkIn.list", { date: "2026-10-02" }, r("date"), len(2));
  await compare(db, "walkIn.list", { date: "2026-10-02", status: "Open" }, r("date + status"), len(1));
  await compare(db, "walkIn.list", { mobile: "9876543210" }, r("mobile"), len(1));

  await compare(db, "complaints.list", {}, r("all"), len(4));
  await compare(db, "complaints.list", { type: "all", status: "all", priority: "all", staff: "all", search: "  " }, r("all = no filter"), len(4));
  await compare(db, "complaints.list", { type: "staff_conduct" }, r("type"));
  await compare(db, "complaints.list", { status: "Resolved", priority: "Low" }, r("status + priority"));
  await compare(db, "complaints.list", { staff: "ravi" }, r("staff literal (assignedTo)"), len(1));
  await compare(db, "complaints.list", { staff: "^amit" }, r("staff regex"), len(1));
  await compare(db, "complaints.list", { search: "sharma" }, r("search literal"), len(2));
  await compare(db, "complaints.list", { search: " 100% " }, r("search with %"), len(1));
  await compare(db, "complaints.list", { search: "s_n" }, r("search with _: literal, not a LIKE wildcard ('Sunita' must not match)"), len(0));
  await compare(db, "complaints.list", { search: "CMP-2026-000[12]" }, r("search regex"), len(2));
  await compare(db, "complaints.list", { staff: "ravi", search: "SN-AC" }, r("search replaces staff"));
  await compare(db, "complaints.list", { staff: "[" }, r("invalid regex throws"));

  await compare(db, "whatsapp.outbox", { limit: 200 }, r("default"), (v) => v[0].length === 5 && v[1] === 2);
  await compare(db, "whatsapp.outbox", { status: "pending", limit: 200 }, r("status"));
  await compare(db, "whatsapp.outbox", { audience: "admin", event: "complaint.created", limit: 200 }, r("audience + event"));
  await compare(db, "whatsapp.outbox", { q: "rahul", limit: 200 }, r("q"));
  await compare(db, "whatsapp.outbox", { q: "100%", limit: 200 }, r("q with %"), (v) => v[0].length === 1);
  await compare(db, "whatsapp.outbox", { q: "LEAD-2026-000(4)", limit: 200 }, r("q with regex chars is literal"), (v) => v[0].length === 0);
  await compare(db, "whatsapp.outbox", { status: "all", audience: "all", event: "all", limit: 2 }, r("limit 2"), (v) => v[0].length === 2);
  await compare(db, "whatsapp.outbox", { limit: -3 }, r("negative limit"));
  await compare(db, "whatsapp.settings", {}, r("token deselected"));
  await compare(db, "whatsapp.settingsWithToken", { id: SETTINGS_ID }, r("by id"));
  await compare(db, "whatsapp.settingsWithToken", { id: String(new ObjectId()) }, r("unknown id = null"));
  await compare(db, "whatsapp.settingsWithToken", { id: "not-an-id" }, r("invalid id throws"));

  await compare(db, "documents.list", {}, r("all"), len(6));
  await compare(db, "documents.list", { folderId: ONSITEGO_ID }, r("On Site Go only"), len(2));
  await compare(db, "documents.list", { folderId: BANK_FOLDER_ID }, r("Bank folder"), len(2));
  await compare(db, "documents.byId", { id: DOC_ID }, r("found"));
  await compare(db, "documents.byId", { id: String(new ObjectId()) }, r("not found"));
  await compare(db, "documents.countInFolder", { folderId: ONSITEGO_ID }, r("On Site Go"));
  await compare(db, "documents.countInFolder", { folderId: "" }, r("unfiled"));
  await compare(db, "documents.folderCounts", {}, r("incl. '' and missing folderId"));
  await compare(db, "documentFolders.list", {}, r(""), len(3));
  await compare(db, "documentFolders.byNameKey", { nameKey: ONSITEGO_FOLDER.toLowerCase() }, r("On Site Go"));
  await compare(db, "documentFolders.byNameKey", { nameKey: "nope" }, r("missing = null"));
  await compare(db, "onsitego.plans", {}, r("ties on minPrice/price"), len(5));

  await compare(db, "accounts.list", {}, r(""), len(3));
  await compare(db, "journal.list", {}, r("all"), len(3));
  await compare(db, "journal.list", { accountId: String(ACC_CASH._id) }, r("by account"), len(2));
  await compare(db, "journal.list", { accountId: String(new ObjectId()) }, r("unused account"), len(0));
  await compare(db, "journal.list", { accountId: "xyz" }, r("invalid account id throws"));
}

// ---------------------------------------------------------------------------

async function main() {
  await startMemoryMongo("d1_crm_reads_test");
  const local = await startLocalD1();
  const db = local.db;
  try {
    await applyMigrations(db);
    await seed();
    const first = await runD1Sync(db, SYNC);
    check(first.ok && first.errors === 0 && COLLECTIONS.every((c) => first.collections[c]?.fullCopyDone), "full copy to D1 without errors");

    await compareAll(db, "after full copy");
    for (const name of Object.keys(CRM_READS)) check((covered.get(name) || 0) > 0, `${name}: compared`);

    // Secret handling, checked without printing anything.
    const plain = JSON.stringify(await CRM_READS["whatsapp.settings"].d1({}, db));
    check(!plain.includes(TOKEN) && !plain.includes("accessToken"), "whatsapp.settings (D1) never carries the access token");
    const withTok: any = await CRM_READS["whatsapp.settingsWithToken"].d1({ id: SETTINGS_ID }, db);
    check(withTok?.cloudApi?.accessToken === TOKEN, "whatsapp.settingsWithToken (D1) returns the stored token");
    for (const name of Object.keys(CRM_READS).filter((n) => !CRM_SECRET_READS.has(n))) {
      const out = await CRM_READS[name].d1(name === "documents.byId" ? { id: DOC_ID } : name === "whatsapp.outbox" ? { limit: 1000 } : { actor: ADMIN, actorId: AMIT.id, q: "a", folderId: ONSITEGO_ID, nameKey: "bank" }, db).catch(() => null);
      if (JSON.stringify(out ?? null).includes(TOKEN)) check(false, `${name}: leaks the token`);
    }

    // Changes made the way the app makes them, then an incremental copy: the reads still match.
    const l1: any = await Lead.findOne({ leadId: "LEAD-2026-0001" });
    l1.followUps.push({ date: "2026-10-12", nextDate: "", outcome: "converted", notes: "Bought", staff: "Amit Singh", staffId: AMIT.id, loggedAt: day(11) });
    l1.sharedWith[1].status = "accepted";
    l1.sharedWith[1].respondedAt = day(11);
    l1.status = "Converted";
    await l1.save();
    await Lead.updateOne({ leadId: "LEAD-2026-0006" }, { $inc: { callCount: 1 }, $push: { calls: { at: day(12), staff: "Amit Singh", staffId: AMIT.id } } });
    await WhatsAppMessage.updateMany({ status: "pending" }, { $set: { status: "sent", sentAt: day(12), sentBy: "Admin" } });
    await JournalEntry.deleteOne({ entryNumber: "JE-2026-0002" });
    await StoredDocument.updateOne({ docNo: "DOC-20261007-000004" }, { $set: { folderId: BANK_FOLDER_ID } });
    await new Promise((res) => setTimeout(res, 5));
    const incr = await runD1Sync(db, { reconcile: "force", collections: COLLECTIONS });
    check(incr.ok && incr.errors === 0, "incremental copy (+ reconcile for the deletion) without errors");
    checkSeeded = false;
    await compareAll(db, "after changes");
  } finally {
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-crm-reads") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e?.message || e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
