/**
 * D1 copy of the CRM, documents and accounting collections (lib/d1/maps/crm-docs.ts, d1/migrations/0005_crm_docs.sql):
 *  - 0005 applies after 0001 and every table / child table has exactly the columns the mapping writes (≤ 100);
 *  - realistic documents for every collection, plus legacy edge cases (numbers as text, non-array child fields,
 *    non-object array elements, unknown keys, Decimal128, missing timestamps), map WITHOUT LOSS: each Mongo
 *    document is rebuilt from its D1 row + child rows + extra and compared with the original;
 *  - full copy, then incremental (a call and a follow-up added to a lead, shares removed, journal lines replaced)
 *    replaces child rows without duplicates; reconciliation removes a deleted lead's child rows;
 *  - counts and hashes match (the status report);
 *  - the WhatsApp access token is copied faithfully and never printed.
 * Uses MongoDB in memory and a local D1 (Miniflare via wrangler); nothing external.
 */
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { startMemoryMongo, stopMemoryMongo } from "./helpers/memory-mongo";
import { check, summary } from "./helpers/assert";
import { startLocalD1, applyMigrations } from "./helpers/local-d1";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { ALL_SPECS, ALL_SPEC_BY_COLLECTION } from "@/lib/d1/registry";
import { tableColumns, mapDoc, normalize, type MasterSpec } from "@/lib/d1/masters-map";
import { CRM_DOCS_SPECS } from "@/lib/d1/maps/crm-docs";
import { runD1Sync, getD1SyncStatus } from "@/lib/d1/sync";
import Lead from "@/models/Lead";
import WalkInQuery from "@/models/WalkInQuery";
import CustomerComplaint from "@/models/CustomerComplaint";
import WhatsAppMessage from "@/models/WhatsAppMessage";
import WhatsAppSetting from "@/models/WhatsAppSetting";
import StoredDocument from "@/models/StoredDocument";
import DocumentFolder from "@/models/DocumentFolder";
import OnsitegoPlan from "@/models/OnsitegoPlan";
import GSTRReport from "@/models/GSTRReport";
import JournalEntry from "@/models/JournalEntry";
import Account from "@/models/Account";

const { ObjectId, Decimal128 } = mongoose.mongo as any;
const MODELS: Record<string, mongoose.Model<any>> = {
  Lead, WalkInQuery, CustomerComplaint, WhatsAppMessage, WhatsAppSetting, StoredDocument, DocumentFolder, OnsitegoPlan, GSTRReport, JournalEntry, Account,
};
const COLLECTIONS = CRM_DOCS_SPECS.map((s) => s.collection);
const SYNC = { reconcile: "skip" as const, collections: COLLECTIONS };
/** A made-up token (never a real one); the test compares it, never prints it. */
const TOKEN = `test-${randomBytes(16).toString("hex")}`;

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

// ---------------------------------------------------------------------------
// Rebuilding a Mongo document from D1 (the losslessness proof)
// ---------------------------------------------------------------------------

/** Normalised (sorted keys, ObjectId -> hex, Date -> ISO) with null fields and empty arrays removed. */
function clean(v: any): any {
  const n = normalize(v);
  const strip = (x: any): any => {
    if (Array.isArray(x)) return x.map(strip);
    if (x && typeof x === "object") {
      const out: any = {};
      for (const k of Object.keys(x)) {
        const s = strip(x[k]);
        if (s !== null && s !== undefined && !(Array.isArray(s) && s.length === 0)) out[k] = s;
      }
      return out;
    }
    return x;
  };
  return strip(n);
}

const isObj = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The Mongo document as D1 holds it: columns (bool 0/1 -> boolean, JSON parsed), flattened subdocuments, child rows
 * in idx order (lineId -> _id, child extra merged), then the row's extra on top. Without _id / timestamps / __v.
 */
function rebuild(spec: MasterSpec, row: any, children: Record<string, any[]>): any {
  const doc: any = {};
  const flat = spec.flattened || {};
  for (const c of spec.columns) {
    let v = row[c.col];
    if (v === null || v === undefined) continue;
    if (c.type === "bool") v = v === 1;
    else if (c.type === "json") v = JSON.parse(v);
    const parent = Object.keys(flat).find((p) => c.col.startsWith(`${p}_`));
    if (parent) (doc[parent] ??= {})[c.col.slice(parent.length + 1)] = v;
    else doc[c.col] = v;
  }
  const knownArrays = new Map<string, string>(); // child table -> Mongo field (from the spec's `known` order)
  const arrayFields = spec.known.filter((k) => !spec.columns.some((c) => c.col === k) && !(k in flat));
  (spec.children || []).forEach((c, i) => knownArrays.set(c.table, arrayFields[i]));
  for (const c of spec.children || []) {
    const rows = children[c.table] || [];
    if (!rows.length) continue;
    doc[knownArrays.get(c.table)!] = rows.map((r) => {
      const ex = r.extra ? JSON.parse(r.extra) : {};
      if ("$value" in ex) return ex.$value;
      const el: any = {};
      for (const k of c.columns) {
        if (k === c.parentCol || k === "idx" || k === "extra" || r[k] === null) continue;
        el[k === "lineId" ? "_id" : k] = r[k];
      }
      return { ...el, ...ex };
    });
  }
  const extra = row.extra ? JSON.parse(row.extra) : {};
  for (const k of Object.keys(extra)) {
    if (k in flat && isObj(extra[k]) && isObj(doc[k])) doc[k] = { ...doc[k], ...extra[k] };
    else doc[k] = extra[k];
  }
  return doc;
}

/** The original, without the fields rebuild() does not produce; a missing boolean reads back as false. */
function comparable(spec: MasterSpec, orig: any): any {
  const { _id, createdAt, updatedAt, __v, ...rest } = orig;
  for (const c of spec.columns) if (c.type === "bool" && rest[c.col] === undefined) rest[c.col] = false;
  return clean(rest);
}

async function d1Rebuild(db: D1DatabaseLike, spec: MasterSpec, id: string): Promise<{ row: any; doc: any } | null> {
  const row = await one(db, `SELECT * FROM ${spec.table} WHERE id = ?`, id);
  if (!row) return null;
  const children: Record<string, any[]> = {};
  for (const c of spec.children || []) children[c.table] = await all(db, `SELECT * FROM ${c.table} WHERE ${c.parentCol} = ? ORDER BY idx`, id);
  return { row, doc: clean(rebuild(spec, row, children)) };
}

// ---------------------------------------------------------------------------
// Seed: realistic documents through the models, edge cases straight into the collections
// ---------------------------------------------------------------------------

const ACC_CASH = new ObjectId();
const ACC_SALES = new ObjectId();
let L1: any;
let L2: any;
let JE1: any;

async function seed() {
  const raw = mongoose.connection.db!;
  const d = (s: string) => new Date(s);

  // Leads
  L1 = await Lead.create({
    leadId: "LD-2026-0001", customerName: "राम कुमार", mobile: "9876543210", email: "ram@example.com", source: "Walk-in Store",
    walkInReason: "Product Enquiry", interestedProduct: "Samsung 55\" Crystal 4K", vpCode: "VP00123", assignedStaff: "Amit Singh",
    estimatedValue: 54990.5, priority: "High", status: "Follow-up", followUpDate: "2026-11-15", lastFollowUpDate: "2026-11-12",
    followUps: [
      { date: "2026-11-10", nextDate: "2026-11-12", outcome: "not_received", notes: "", staff: "Amit Singh", staffId: "u1", loggedAt: d("2026-11-10T05:00:00Z") },
      { date: "2026-11-12", nextDate: "2026-11-15", outcome: "interested", notes: "wants EMI — 6 months", staff: "Amit Singh", staffId: "u1", loggedAt: d("2026-11-12T06:30:00Z") },
    ],
    callCount: 3, lastCalledAt: d("2026-11-12T06:29:00Z"),
    calls: [
      { at: d("2026-11-10T04:59:00Z"), staff: "Amit Singh", staffId: "u1" },
      { at: d("2026-11-11T09:00:00Z"), staff: "Amit Singh", staffId: "u1" },
      { at: d("2026-11-12T06:29:00Z"), staff: "Ravi", staffId: "u2" },
    ],
    sharedWith: [{ staff: "Ravi", staffId: "u2", brand: "LG", products: "LG AC 1.5T", note: "AC too", status: "accepted", requestedBy: "Amit Singh", requestedById: "u1", requestedAt: d("2026-11-11T10:00:00Z"), respondedAt: d("2026-11-11T11:00:00Z") }],
    notes: "Prefers evening calls", estimateNumber: "EST-0042", estimateId: String(new ObjectId()),
    items: [{ itemId: String(new ObjectId()), name: "Samsung TV", qty: 1, price: 54990.5 }],
    timeline: [{ date: d("2026-11-10T05:00:00Z"), action: "Created", notes: "", staff: "Amit Singh" }, { date: d("2026-11-12T06:30:00Z"), action: "Follow-up", notes: "EMI", staff: "Amit Singh" }],
  });
  L2 = await Lead.create({ leadId: "LD-2026-0002", customerName: "Sita", mobile: "9000000002", interestedProduct: "Fridge" });
  await raw.collection("leads").insertOne({
    _id: new ObjectId(), leadId: "LD-OLD-1", customerName: "Legacy", mobile: 9000000003, estimatedValue: "12,500", callCount: 2.5,
    lastCalledAt: "yesterday", followUps: "called twice, no answer",
    calls: [{ at: "2026-01-01 10am", staff: 5 }, null, "x", { at: d("2026-01-02T00:00:00Z"), staffId: new ObjectId("650000000000000000000009"), via: "mobile" }],
    sharedWith: [{ staff: "A", staffId: "u9", _id: new ObjectId(), extraKey: { deep: [1, 2] } }],
    items: "not an array", campaign: "Diwali", __v: 7,
  });

  // Walk-ins, complaints
  await WalkInQuery.create([
    { customerName: "Mohan", mobile: "9111111111", date: "2026-11-13", time: "11:53 am", reason: "Price Enquiry", interestedProduct: "Washing machine", category: "Appliances", budget: 25000, staff: "Ravi", notes: "", followUpDate: "2026-11-14" },
    { customerName: "Geeta", mobile: "9111111112", date: "2026-11-13", interestedProduct: "AC", status: "Converted to Lead", leadId: "LD-2026-0002" },
  ]);
  await raw.collection("walk_in_queries").insertOne({ _id: new ObjectId(), customerName: "Old", mobile: "9", date: "13/11/2026", interestedProduct: "TV", budget: "N/A", createdAt: "2025-02-01", updatedAt: "garbage" });
  await CustomerComplaint.create([
    { ticketNumber: "CMP-0001", complaintType: "product", customerName: "Ram", customerPhone: "9876543210", productName: "TV", vpCode: "VP00123", serialNumber: "SN123", invoiceNumber: "VP/26-27/0001", purchaseDate: "2026-10-01", issueTitle: "No picture", issueDescription: "Black screen after 2 weeks", priority: "High" },
    { ticketNumber: "CMP-0002", complaintType: "staff_conduct", accusedStaffId: "u3", accusedStaffName: "Kamal", accusedStaffRole: "sales", accusedStaffBrand: "LG", customerName: "Shyam", customerPhone: "9000000005", issueTitle: "Rude", issueDescription: "…", priority: "Critical", status: "Resolved", assignedTo: "Manager", assignedStaffRole: "admin", assignedDate: "2026-11-02", actionTaken: "Warned", resolutionNotes: "Apologised", resolvedAt: d("2026-11-03T08:00:00Z"), resolvedBy: "Admin", customerFeedback: "OK" },
  ]);

  // WhatsApp
  await WhatsAppMessage.create([
    { event: "invoice.created", audience: "customer", toNumber: "919876543210", toName: "Ram", message: "आपका बिल VP/26-27/0001 ₹54,990.50", waLink: "https://wa.me/919876543210?text=...", entityType: "invoice", entityRef: "VP/26-27/0001", entityId: String(new ObjectId()) },
    { event: "invoice.created", audience: "admin", toNumber: "919000000000", message: "New bill", status: "sent", provider: "cloud-api", providerMessageId: "wamid.ABC", attempts: 1, sentAt: d("2026-11-13T06:00:00Z"), sentBy: "system", triggeredBy: "u1" },
    { event: "payment.received", audience: "admin", toNumber: "919000000000", message: "Payment", status: "failed", error: "(#131030) Recipient not in allowed list", attempts: 3 },
  ]);
  await raw.collection("whatsapp_messages").insertOne({ _id: new ObjectId(), event: "x", audience: "admin", toNumber: "1", message: "m", attempts: "3", sentAt: "2026-11-13 10:00", createdAt: d("2026-11-01T00:00:00Z"), updatedAt: d("2026-11-01T00:00:00Z") });
  await WhatsAppSetting.create({ provider: "cloud-api", enabled: true, adminNumbers: ["919000000000", "919000000001"], notifyCustomer: false, events: { "invoice.created": true, "payment.received": false }, businessName: "Value Plus", cloudApi: { phoneNumberId: "1234567890", accessToken: TOKEN, apiVersion: "v21.0", templateName: "vp_alert", templateLanguage: "en" }, updatedBy: "admin" });
  await raw.collection("whatsapp_settings").insertOne({ _id: new ObjectId(), provider: "manual", enabled: "yes", cloudApi: "none", events: [] });

  // Documents
  const [f1] = await DocumentFolder.create([
    { name: "Bank Statements", nameKey: "bank statements", createdBy: "Admin", createdByUserId: "u0" },
    { name: "On Site Go", nameKey: "on site go", createdBy: "Admin" },
  ]);
  await StoredDocument.create([
    { docNo: "DOC-0001", date: "2026-11-01", narration: "SBI statement Oct", fileUrl: "https://res.cloudinary.com/x/raw/private/a.pdf", filePublicId: "docs/a", fileResourceType: "raw", fileFormat: "pdf", fileDeliveryType: "private", fileName: "a.pdf", fileType: "application/pdf", fileSize: 123456, folderId: String(f1._id), uploadedBy: "Admin", uploadedByUserId: "u0", uploadedByRole: "admin" },
    { docNo: "DOC-0002", date: "2026-11-02", narration: "Signed letter", fileUrl: "https://res.cloudinary.com/x/image/upload/b.jpg", uploadedBy: "Office" },
  ]);
  await raw.collection("stored_documents").insertOne({ _id: new ObjectId(), docNo: "DOC-OLD", date: "2026-01-01", narration: "old", fileUrl: "u", fileSize: "1.2 MB", uploadedBy: "x", folderId: null, tags: ["a"] });

  // Onsitego, GSTR
  await OnsitegoPlan.create([
    { category: "TV", device: "LED TV", kind: "EW", vpCode: "OSG-TV-1", minPrice: 0, maxPrice: 30000, planName: "1 Yr Extended Warranty", years: 1, price: 1499, sourceDocId: "d1", sourceFileName: "osg.pdf" },
    { category: "TV", device: "LED TV", kind: "ADLD", minPrice: 30001, maxPrice: 60000, planName: "2 Yr Damage Protection", years: 2, price: 3999 },
    { category: "AC", device: "Split AC", kind: "EW", minPrice: 0, maxPrice: 99999999, planName: "AC care", years: 1.5, price: 2499 },
  ]);
  await raw.collection("onsitego_plans").insertOne({ _id: new ObjectId(), planName: "Decimal plan", price: Decimal128.fromString("1999.99"), minPrice: 0 });
  await GSTRReport.create([
    { reportId: "R1", type: "GSTR1", date: "2026-10-31", partyName: "ABC Traders", gstin: "09ABCDE1234F1Z5", amount: 100000, igst: 0, cgst: 9000, sgst: 9000, totalTax: 18000 },
    { reportId: "R2", type: "GSTR2", date: "2026-10-31", partyName: "Samsung India", amount: 500000.75, igst: 90000.14, totalTax: 90000.14 },
  ]);

  // Accounting
  await Account.create([
    { _id: ACC_CASH, code: "1000", name: "Cash", type: "asset", balance: 25000.5 },
    { _id: ACC_SALES, code: "4000", name: "Sales", type: "revenue", description: "Sales revenue", balance: -25000.5 },
  ]);
  await raw.collection("accounts").insertOne({ _id: new ObjectId(), code: 2000, name: "Old", type: "liability", balance: "1e3" });
  JE1 = await JournalEntry.create({
    entryNumber: "JE-0001", date: "2026-11-13", description: "Cash sale", referenceType: "Invoice", referenceId: "VP/26-27/0001",
    lines: [{ accountId: ACC_CASH, accountName: "Cash", debit: 25000.5, credit: 0 }, { accountId: ACC_SALES, accountName: "Sales", debit: 0, credit: 25000.5 }],
    totalDebit: 25000.5, totalCredit: 25000.5,
  });
  await raw.collection("journal_entries").insertOne({
    _id: new ObjectId(), entryNumber: "JE-OLD", date: "2025-01-01", description: "legacy", totalDebit: 10, totalCredit: "10",
    lines: [{ accountName: "Suspense", debit: 10, memo: "no account id" }, { _id: "line-2", accountId: "free text", credit: 10 }],
  });
  await raw.collection("journal_entries").insertOne({ _id: new ObjectId(), entryNumber: "JE-OBJ", date: "2025-01-02", description: "lines not an array", totalDebit: 0, totalCredit: 0, lines: { a: 1 } });
}

/** Mongo array lengths of every child table of a spec, summed over the collection. */
async function expectedChildRows(spec: MasterSpec): Promise<Record<string, number>> {
  const docs = await mongoose.connection.db!.collection(spec.collection).find().toArray();
  const out: Record<string, number> = {};
  for (const c of spec.children || []) {
    const field = spec.known.filter((k) => !spec.columns.some((col) => col.col === k) && !(k in (spec.flattened || {})))[(spec.children || []).indexOf(c)];
    out[c.table] = docs.reduce((n: number, d: any) => n + (Array.isArray(d[field]) ? d[field].length : 0), 0);
  }
  return out;
}

async function checkLossless(db: D1DatabaseLike, label: string) {
  for (const spec of CRM_DOCS_SPECS) {
    const docs = await mongoose.connection.db!.collection(spec.collection).find().toArray();
    let bad = 0;
    for (const d of docs) {
      const got = await d1Rebuild(db, spec, String(d._id));
      const want = comparable(spec, d);
      if (!got || JSON.stringify(got.doc) !== JSON.stringify(want)) {
        bad++;
        // Field names only: values may hold a secret.
        const gk = got ? Object.keys(got.doc).join(",") : "missing row";
        console.log(`    ${spec.collection} ${d._id}: rebuilt keys [${gk}] vs Mongo keys [${Object.keys(want).join(",")}]`);
        if (spec.collection !== "whatsapp_settings" && got) console.log(`      got  ${JSON.stringify(got.doc)}\n      want ${JSON.stringify(want)}`);
      }
    }
    check(bad === 0 && docs.length > 0, `${label}: ${spec.collection}: all ${docs.length} documents rebuilt from D1 equal Mongo`);
  }
}

async function main() {
  await startMemoryMongo("d1_crm_docs_test");
  const local = await startLocalD1();
  const db = local.db;
  const mongo = mongoose.connection.db!;
  try {
    // ── 1. registry + migration ──
    check(CRM_DOCS_SPECS.length === 11 && CRM_DOCS_SPECS.every((s) => ALL_SPEC_BY_COLLECTION[s.collection] === s), "11 CRM / docs / accounting specs, all in the registry");
    for (const [name, model] of Object.entries(MODELS)) {
      check(COLLECTIONS.includes(model.collection.collectionName), `${name}: collection '${model.collection.collectionName}' is copied`);
    }
    check(new Set(ALL_SPECS.map((s) => s.table)).size === ALL_SPECS.length && new Set(ALL_SPECS.map((s) => s.collection)).size === ALL_SPECS.length, "no table or collection is mapped twice across areas");

    const files = await applyMigrations(db);
    check(files[0].startsWith("0001_") && files.includes("0005_crm_docs.sql") && files.indexOf("0005_crm_docs.sql") > 0, `migrations applied in order: ${files.join(", ")}`);
    for (const spec of CRM_DOCS_SPECS) {
      const cols = (await all(db, `PRAGMA table_info(${spec.table})`)).map((c) => c.name);
      const want = tableColumns(spec);
      check(JSON.stringify(cols) === JSON.stringify(want), `${spec.table}: columns match the mapping (${cols.length})`);
      check(want.length <= 100, `${spec.table}: ${want.length} columns ≤ 100, one row per statement ≤ 100 params`);
      for (const child of spec.children || []) {
        const ccols = (await all(db, `PRAGMA table_info(${child.table})`)).map((c) => c.name);
        check(JSON.stringify(ccols) === JSON.stringify(child.columns), `${child.table}: columns match (${ccols.length})`);
      }
    }
    const idx = (await all(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name);
    for (const want of ["leads_mobile", "leads_status", "leads_staff_status", "leads_followUpDate", "leadFollowUps_date", "leadCalls_staff_at", "leadShares_staff_status", "customerComplaints_status_priority", "whatsappMessages_status_created", "storedDocuments_date", "onsitegoPlans_cat_device", "gstrReports_type_date", "journalEntryLines_account"]) {
      check(idx.includes(want), `index ${want}`);
    }

    // ── 2. mapping without a database ──
    const leadSpec = ALL_SPEC_BY_COLLECTION.leads;
    const bare = await mapDoc(leadSpec, { _id: new ObjectId("650000000000000000000002") }, "2026-11-13T00:00:00.000Z");
    check(bare.row.leadId === null && bare.row.extra === null && bare.children.every((c) => c.rows.length === 0), "bare lead: NULLs, no extra, no child rows");
    const odd = await mapDoc(leadSpec, { _id: new ObjectId(), estimatedValue: "12,500", calls: [null, { at: "x", staff: "A", foo: 1 }] });
    check(odd.row.estimatedValue === 12500 && odd.row.extra === '{"estimatedValue":"12,500"}', `number written as text: parsed into the column, original kept in extra (${odd.row.extra})`);
    const calls = odd.children.find((c) => c.table === "leadCalls")!;
    check(calls.rows.length === 2 && calls.rows[0][1] === 0 && calls.rows[0][5] === '{"$value":null}' && calls.rows[1][2] === "x" && calls.rows[1][5] === '{"at":"x","foo":1}', "child rows: idx, a null element kept, a non-date 'at' and an unknown key in the child extra");
    const big = await mapDoc(leadSpec, { _id: new ObjectId(), calls: Array.from({ length: 250 }, (_, i) => ({ at: new Date(Date.UTC(2026, 0, 1, 0, i)), staff: "S", staffId: "u" })) });
    check(big.children.find((c) => c.table === "leadCalls")!.rows.length === 250, "250 calls map to 250 rows (inserted in chunks of ≤ 100 params)");

    // ── 3. full copy ──
    await seed();
    const first = await runD1Sync(db, SYNC);
    check(first.ok && first.errors === 0, `first run ok (${first.ms} ms, errors ${first.errors})`);
    check(COLLECTIONS.every((c) => first.collections[c]?.mode === "full" && first.collections[c].fullCopyDone), "every CRM / docs collection did its full copy");
    for (const spec of CRM_DOCS_SPECS) {
      const m = await mongo.collection(spec.collection).countDocuments();
      check(m === (await count(db, spec.table)) && m > 0, `${spec.collection}: Mongo ${m} = D1 ${await count(db, spec.table)}`);
      const want = await expectedChildRows(spec);
      for (const c of spec.children || []) check((await count(db, c.table)) === want[c.table], `${c.table}: ${want[c.table]} rows = Mongo array elements`);
    }
    await checkLossless(db, "after full copy");
    // The comparison has teeth: without its extra, the legacy lead no longer rebuilds to the Mongo document.
    const legacyDoc = await mongo.collection("leads").findOne({ leadId: "LD-OLD-1" });
    const legacyD1 = await d1Rebuild(db, leadSpec, String(legacyDoc!._id));
    const noExtra = clean(rebuild(leadSpec, { ...legacyD1!.row, extra: null }, { leadCalls: await all(db, "SELECT * FROM leadCalls WHERE leadId = ? ORDER BY idx", String(legacyDoc!._id)) }));
    check(JSON.stringify(noExtra) !== JSON.stringify(comparable(leadSpec, legacyDoc)), "dropping extra makes the rebuild differ (the check detects loss)");

    // Spot checks on the realistic rows.
    const l1 = await one(db, "SELECT * FROM leads WHERE id = ?", String(L1._id));
    check(l1.customerName === "राम कुमार" && l1.estimatedValue === 54990.5 && l1.callCount === 3 && l1.lastCalledAt === "2026-11-12T06:29:00.000Z" && l1.followUpDate === "2026-11-15" && l1.extra === null, "lead: unicode, money, count, ISO date, text follow-up date, nothing in extra");
    check(JSON.parse(l1.timeline).length === 2 && JSON.parse(l1.items)[0].price === 54990.5, "lead: timeline and items as JSON");
    const fu = await all(db, "SELECT * FROM leadFollowUps WHERE leadId = ? ORDER BY idx", String(L1._id));
    check(fu.length === 2 && fu[1].notes === "wants EMI — 6 months" && fu[1].loggedAt === "2026-11-12T06:30:00.000Z" && fu[1].extra === null, "follow-ups as child rows");
    const due = await all(db, "SELECT l.leadId FROM leadFollowUps f JOIN leads l ON l.id = f.leadId WHERE f.nextDate = '2026-11-15'");
    check(due.length === 1 && due[0].leadId === "LD-2026-0001", "follow-up rows join back to their lead");
    const perStaff = await all(db, "SELECT staffId, COUNT(*) AS n FROM leadCalls WHERE leadId = ? GROUP BY staffId ORDER BY staffId", String(L1._id));
    check(JSON.stringify(perStaff) === '[{"staffId":"u1","n":2},{"staffId":"u2","n":1}]', "calls per staff (Staff Activity query)");
    check((await one(db, "SELECT status FROM leadShares WHERE leadId = ? AND staffId = 'u2'", String(L1._id))).status === "accepted", "share row");
    const legacy = await one(db, "SELECT * FROM leads WHERE leadId = 'LD-OLD-1'");
    const lx = JSON.parse(legacy.extra);
    check(legacy.mobile === "9000000003" && lx.mobile === 9000000003 && lx.callCount === 2.5 && lx.followUps === "called twice, no answer" && JSON.parse(legacy.items) === "not an array" && lx.campaign === "Diwali" && legacy.v === 7, "legacy lead: misfit values, non-array follow-ups and unknown field kept in extra, odd items as JSON");
    const je = await all(db, "SELECT * FROM journalEntryLines WHERE entryId = ? ORDER BY idx", String(JE1._id));
    check(je.length === 2 && je[0].accountId === String(ACC_CASH) && je[0].lineId === String(JE1.lines[0]._id) && je[1].credit === 25000.5, "journal lines: child rows with account id and line id");
    const bal = await all(db, "SELECT accountId, SUM(debit) - SUM(credit) AS net FROM journalEntryLines GROUP BY accountId ORDER BY accountId");
    check(bal.some((r) => r.accountId === String(ACC_CASH) && r.net === 25000.5), "ledger sum over journal lines");
    const plan = await one(db, "SELECT * FROM onsitegoPlans WHERE planName = 'Decimal plan'");
    check(plan.price === 1999.99 && JSON.parse(plan.extra).price === "1999.99", "Decimal128 price: REAL column, exact decimal text in extra");
    const wsRow = await one(db, "SELECT * FROM whatsappSettings WHERE provider = 'cloud-api'");
    const wsMongo = await mongo.collection("whatsapp_settings").findOne({ provider: "cloud-api" });
    check(wsRow.cloudApi_accessToken === wsMongo!.cloudApi.accessToken && wsRow.cloudApi_accessToken === TOKEN, "WhatsApp access token copied faithfully (value not printed)");
    check(wsRow.enabled === 1 && wsRow.notifyCustomer === 0 && JSON.parse(wsRow.adminNumbers).length === 2 && JSON.parse(wsRow.events)["payment.received"] === false && wsRow.extra === null, "WhatsApp settings: booleans, JSON numbers and events, flattened cloudApi");
    const wsLegacy = await one(db, "SELECT * FROM whatsappSettings WHERE provider = 'manual'");
    check(wsLegacy.enabled === 0 && JSON.parse(wsLegacy.extra).enabled === "yes" && JSON.parse(wsLegacy.extra).cloudApi === "none", "legacy settings: 'yes' boolean and string cloudApi kept in extra");
    const walkOld = await one(db, "SELECT * FROM walkInQueries WHERE customerName = 'Old'");
    check(walkOld.budget === null && JSON.parse(walkOld.extra).budget === "N/A" && walkOld.createdAt === "2025-02-01T00:00:00.000Z" && walkOld.updatedAt === walkOld.createdAt, "walk-in: 'N/A' budget kept, string createdAt, garbled updatedAt falls back");

    // A second run straight after rewrites nothing.
    const idle = await runD1Sync(db, SYNC);
    check(idle.ok && COLLECTIONS.every((c) => idle.collections[c].mode === "incremental" && idle.collections[c].copied === 0), "second run: incremental, nothing rewritten");

    // ── 4. incremental: a call and a follow-up added, shares removed, journal lines replaced ──
    await Lead.findByIdAndUpdate(L1._id, {
      $push: { calls: { at: new Date("2026-11-13T05:00:00Z"), staff: "Amit Singh", staffId: "u1" }, followUps: { date: "2026-11-13", nextDate: "2026-11-20", outcome: "callback", staff: "Amit Singh", staffId: "u1", loggedAt: new Date("2026-11-13T05:01:00Z") } },
      $inc: { callCount: 1 },
      $set: { sharedWith: [], lastCalledAt: new Date("2026-11-13T05:00:00Z"), followUpDate: "2026-11-20" },
    });
    await Lead.findByIdAndUpdate(L2._id, { $push: { calls: { at: new Date("2026-11-13T05:10:00Z"), staff: "Ravi", staffId: "u2" } }, $inc: { callCount: 1 } });
    await JournalEntry.findByIdAndUpdate(JE1._id, { $set: { lines: [{ accountId: ACC_CASH, accountName: "Cash", debit: 100, credit: 0 }], totalDebit: 100, totalCredit: 0 } });
    await WhatsAppMessage.updateOne({ status: "pending" }, { $set: { status: "sent", sentAt: new Date(), sentBy: "Amit" } });
    const incr = await runD1Sync(db, SYNC);
    check(incr.ok && incr.collections.leads.copied === 2 && incr.collections.journal_entries.copied === 1 && incr.collections.whatsapp_messages.copied === 1, `incremental copied leads ${incr.collections.leads.copied}, journal ${incr.collections.journal_entries.copied}, messages ${incr.collections.whatsapp_messages.copied}`);
    const calls1 = await all(db, "SELECT idx, staffId, at FROM leadCalls WHERE leadId = ? ORDER BY idx", String(L1._id));
    check(calls1.length === 4 && calls1.map((r) => r.idx).join() === "0,1,2,3" && calls1[3].at === "2026-11-13T05:00:00.000Z", "lead calls replaced: 4 rows, idx 0..3, the new call last");
    check((await count(db, "leadFollowUps", "WHERE leadId = ?", String(L1._id))) === 3 && (await count(db, "leadShares", "WHERE leadId = ?", String(L1._id))) === 0, "follow-up added, shares removed");
    check((await one(db, "SELECT callCount, followUpDate FROM leads WHERE id = ?", String(L1._id))).callCount === 4, "$inc callCount reached D1");
    check((await count(db, "leadCalls", "WHERE leadId = ?", String(L2._id))) === 1, "a first call on a lead with none");
    check((await count(db, "journalEntryLines", "WHERE entryId = ?", String(JE1._id))) === 1, "journal lines replaced, not added to");
    for (const spec of CRM_DOCS_SPECS) {
      const want = await expectedChildRows(spec);
      for (const c of spec.children || []) check((await count(db, c.table)) === want[c.table], `after incremental: ${c.table} ${want[c.table]} rows, no duplicates`);
    }
    const dupes = await one(db, "SELECT COUNT(*) AS n FROM (SELECT leadId, at, staffId FROM leadCalls WHERE at IS NOT NULL GROUP BY leadId, at, staffId HAVING COUNT(*) > 1)");
    check(Number(dupes.n) === 0, "no duplicated call rows");
    await checkLossless(db, "after incremental");

    // ── 5. reconciliation removes a deleted lead and its child rows ──
    await Lead.deleteOne({ _id: L1._id });
    const rec = await runD1Sync(db, { reconcile: "force", collections: COLLECTIONS });
    check(rec.ok && rec.collections.leads.reconcile?.deleted === 1, "reconcile deleted the lead");
    for (const t of ["leadCalls", "leadFollowUps", "leadShares"]) check((await count(db, t, "WHERE leadId = ?", String(L1._id))) === 0, `${t}: its rows gone`);

    // ── 6. counts and hashes match ──
    const status = await getD1SyncStatus(db, { sampleSize: 500 });
    for (const cs of status.collections.filter((c) => COLLECTIONS.includes(c.collection))) {
      check(cs.mongoCount === cs.d1Count && !cs.error, `status ${cs.collection}: Mongo ${cs.mongoCount} = D1 ${cs.d1Count}`);
      check(!!cs.sample && cs.sample.size === cs.mongoCount && cs.sample.mismatched === 0 && cs.sample.missing === 0, `status ${cs.collection}: all ${cs.sample?.size} hashes match`);
    }
    check((await count(db, "sync_errors")) === 0, "no sync errors");

    // ── 7. the secret is not in anything the job reports ──
    const reports = JSON.stringify([first, idle, incr, rec, status]);
    check(!reports.includes(TOKEN), "the access token appears in no run result or status report");
  } finally {
    await local.dispose();
    await stopMemoryMongo();
  }
  process.exit(summary("d1-crm-docs") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await stopMemoryMongo();
  } catch {}
  process.exit(1);
});
