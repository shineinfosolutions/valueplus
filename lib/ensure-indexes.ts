/**
 * Indexes for the queries the app runs most.
 *
 * On Cloudflare Workers mongoose never builds the indexes written in the models (lib/db.ts turns autoIndex off,
 * because there is no long-lived connection to build them on), so the live database may be missing them and every
 * filtered list then reads the whole collection. This creates the ones below, once, from the 5-minute cron
 * (lib/attendance-alerts.ts → ensureIndexesOnce).
 *
 * Safe by construction:
 *  - only createIndex, never dropIndex / syncIndexes: nothing that exists is changed or removed;
 *  - no unique indexes, so a build can never fail on duplicate data that is already there;
 *  - an index whose keys already exist under any name or options (e.g. a unique one from the model) is left alone;
 *  - a collection that does not exist is skipped, not created;
 *  - Atlas builds indexes online: reads and writes carry on while it runs.
 *
 * Collection names are the models' `collection:` options (or mongoose's plural for Expense / LeaveRequest).
 * No index is added on `createdAt` alone for invoices, payments, purchases, expenses or suppliers: those are read
 * sorted by createdAt with no filter, and an index there could change the order of rows with the same createdAt.
 */
import mongoose from "mongoose";
import ScheduledRun from "@/models/ScheduledRun";
import { ALL_SPECS } from "@/lib/d1/registry";

export interface IndexSpec {
  collection: string;
  key: Record<string, 1 | -1>;
  /** Which query this is for (shown in the log). */
  why: string;
}

export const INDEXES: IndexSpec[] = [
  // invoices — the most-read collection
  { collection: "invoices", key: { invoiceNumber: 1 }, why: "bill look-ups by number (~25 places)" },
  { collection: "invoices", key: { date: -1, createdAt: -1 }, why: "lists and reports sorted by bill date" },
  { collection: "invoices", key: { type: 1, status: 1, date: -1 }, why: "sales / GST / incentive reports: type + status + date range" },
  { collection: "invoices", key: { type: 1, createdAt: -1 }, why: "invoice list (type filter, newest first)" },
  { collection: "invoices", key: { customerPhone: 1 }, why: "customer history by mobile" },
  { collection: "invoices", key: { customerId: 1 }, why: "customer ledger" },
  { collection: "invoices", key: { salesExecutive: 1 }, why: "salesman's own sales / incentive" },
  // items
  { collection: "items", key: { code: 1 }, why: "item by code" },
  { collection: "items", key: { vpCode: 1 }, why: "item by VP code (challans, serials, warranty)" },
  { collection: "items", key: { name: 1 }, why: "item by exact name (purchase entry, price lock)" },
  { collection: "items", key: { currentStock: -1, name: 1 }, why: "product list sort" },
  { collection: "items", key: { category: 1, brand: 1 }, why: "brand / category filters and counts" },
  // attendance
  { collection: "attendance", key: { staffName: 1, date: 1 }, why: "one person's day (check-in / out)" },
  { collection: "attendance", key: { date: 1, status: 1 }, why: "everyone on a day (alerts, presence, auto check-out)" },
  // payments / receipts
  { collection: "payment_transactions", key: { date: -1 }, why: "payments list sorted by date" },
  { collection: "payment_transactions", key: { partyId: 1 }, why: "one party's payments" },
  { collection: "payment_transactions", key: { partyType: 1 }, why: "supplier / customer payments" },
  { collection: "payment_transactions", key: { referenceId: 1 }, why: "receipts against a bill" },
  // purchases
  { collection: "purchase_entries", key: { billNo: 1 }, why: "purchase bill by number (~13 places)" },
  { collection: "purchase_entries", key: { billDate: -1, createdAt: -1 }, why: "purchase reports by bill date" },
  // CRM, staff, notifications
  { collection: "leads", key: { assignedStaff: 1, status: 1 }, why: "a salesman's leads" },
  { collection: "leads", key: { mobile: 1 }, why: "lead by mobile" },
  { collection: "notifications", key: { recipientId: 1, readAt: 1, createdAt: -1 }, why: "the bell: unread count and list" },
  { collection: "estimates", key: { approvalStatus: 1 }, why: "pending estimate approvals" },
  { collection: "estimates", key: { estimateNumber: 1 }, why: "estimate by number" },
  { collection: "estimates", key: { customerPhone: 1 }, why: "estimates of a customer" },
  { collection: "customers", key: { phone: 1 }, why: "customer by mobile (billing)" },
  { collection: "customers", key: { code: 1 }, why: "customer by code / next code" },
  { collection: "leaverequests", key: { kind: 1, status: 1 }, why: "breaks and leave in force (alerts, presence)" },
  { collection: "leaverequests", key: { staffName: 1 }, why: "one person's leave" },
  { collection: "staff_tasks", key: { assignedStaff: 1, status: 1 }, why: "a person's open tasks" },
  { collection: "finance_transactions", key: { invoiceNumber: 1 }, why: "finance record of a bill" },
  { collection: "finance_transactions", key: { doId: 1 }, why: "finance record by DO" },
  { collection: "customer_advances", key: { customerPhone: 1, status: 1 }, why: "a customer's open advances at billing" },
  { collection: "serial_numbers", key: { serialNumber: 1 }, why: "serial look-ups" },
  { collection: "serial_numbers", key: { invoiceNumber: 1 }, why: "serials on a bill" },
  { collection: "delivery_challans", key: { invoiceNumber: 1 }, why: "challans of a bill" },
  { collection: "audit_logs", key: { action: 1, createdAt: -1 }, why: "audit screen and edited-bills card" },
  { collection: "audit_logs", key: { entityRef: 1 }, why: "history of one bill" },
  { collection: "push_subscriptions", key: { userId: 1 }, why: "a user's phones for push alerts" },
  // v2/v3: the D1 copy job (lib/d1/sync.ts) reads every copied collection by updatedAt every 5 minutes. Taken
  // from the copy list itself, so a collection added to the copy always gets its index.
  ...ALL_SPECS.map((spec) => ({ collection: spec.collection, key: { updatedAt: 1 as const }, why: "D1 copy: changed since the last run" })),
];

export interface EnsureIndexesResult {
  created: string[];
  exists: number;
  skipped: string[];
  failed: string[];
}

const label = (s: IndexSpec) => `${s.collection} ${JSON.stringify(s.key)}`;

/** Same keys in the same order with the same directions (1 and 1.0 are the same; "text" etc. compare as text). */
function sameKey(a: Record<string, any>, b: Record<string, any>): boolean {
  const ea = Object.entries(a);
  const eb = Object.entries(b);
  const sameValue = (x: any, y: any) => (typeof x === "number" || typeof y === "number" ? Number(x) === Number(y) : String(x) === String(y));
  return ea.length === eb.length && ea.every(([k, v], i) => eb[i][0] === k && sameValue(v, eb[i][1]));
}

/**
 * Creates every index in `specs` that is not there yet. Never throws for one index: each outcome is reported.
 * `db` defaults to mongoose's current database (on Workers, the current request's connection).
 */
export async function ensureIndexes(specs: IndexSpec[] = INDEXES, db: any = mongoose.connection.db): Promise<EnsureIndexesResult> {
  if (!db) throw new Error("ensureIndexes: no database connection");
  const result: EnsureIndexesResult = { created: [], exists: 0, skipped: [], failed: [] };
  const existingByCollection = new Map<string, Record<string, any>[] | null>();

  for (const spec of specs) {
    try {
      if (!existingByCollection.has(spec.collection)) {
        try {
          const list = await db.collection(spec.collection).listIndexes().toArray();
          existingByCollection.set(spec.collection, list.map((ix: any) => ix.key));
        } catch (e: any) {
          // NamespaceNotFound: the collection has never been written. Leave it alone rather than create it.
          if (e?.code === 26 || e?.codeName === "NamespaceNotFound") existingByCollection.set(spec.collection, null);
          else throw e;
        }
      }
      const existing = existingByCollection.get(spec.collection);
      if (existing === null || existing === undefined) {
        result.skipped.push(`${label(spec)}: no such collection`);
        continue;
      }
      if (existing.some((key) => sameKey(key, spec.key))) {
        result.exists++;
        continue;
      }
      await db.collection(spec.collection).createIndex(spec.key);
      existing.push(spec.key);
      result.created.push(label(spec));
    } catch (e: any) {
      // 85 IndexOptionsConflict / 86 IndexKeySpecsConflict / 68 IndexAlreadyExists: an index with this name already
      // exists in another form. Retrying will not change that, so it is reported and left alone.
      if ([68, 85, 86].includes(e?.code)) result.skipped.push(`${label(spec)}: ${e?.codeName || e?.message}`);
      else result.failed.push(`${label(spec)}: ${e?.message || e}`);
    }
  }
  return result;
}

/** Bump the version (":v2") after adding entries to INDEXES, so the cron runs it again. */
export const ENSURE_INDEXES_JOB = "ensure-indexes:v3";

/**
 * Runs ensureIndexes from the cron until it has succeeded once. `claim` is the cron's once-only helper
 * (lib/attendance-alerts.ts): the first caller for a key gets true, everyone later false.
 *  - Done once (every index created or already there): never again for this version.
 *  - At most one attempt per hour, so a failing build does not repeat every 5 minutes.
 *  - Never throws: a failure here must not stop the attendance alerts.
 */
export async function ensureIndexesOnce(claim: (key: string) => Promise<boolean>): Promise<EnsureIndexesResult | null> {
  try {
    // Through the read:staff switch (lib/repo/staff/shadow-read.ts). Only a guard: the claim below is MongoDB's
    // atomic once-only write, so a stale answer can at most cost one more claim attempt.
    // Loaded here, not at the top: the staff reads import every staff model, and a model that is loaded builds its
    // own indexes (and creates its collection), which this module must not cause just by being imported.
    const { readStaff } = await import("@/lib/repo/staff/shadow-read");
    if (await readStaff("scheduledRuns.exists", ENSURE_INDEXES_JOB)) return null;
    if (!(await claim(`${ENSURE_INDEXES_JOB}:attempt:${new Date().toISOString().slice(0, 13)}`))) return null;
    const result = await ensureIndexes();
    console.log(
      `ensure-indexes: ${result.created.length} created, ${result.exists} already there, ${result.skipped.length} skipped, ${result.failed.length} failed`,
      JSON.stringify({ created: result.created, skipped: result.skipped, failed: result.failed })
    );
    if (result.failed.length === 0) await claim(ENSURE_INDEXES_JOB);
    return result;
  } catch (e) {
    console.warn("ensure-indexes: did not run (the cron carries on):", e);
    return null;
  }
}
