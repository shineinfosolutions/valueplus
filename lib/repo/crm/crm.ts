/**
 * Walk-in enquiries and customer complaints (collections `walk_in_queries`, `customer_complaints`).
 * Mongo side copied verbatim from the routes; D1 side returns the same (lib/repo/crm/INVENTORY.md).
 */
import connectToDatabase from "@/lib/db";
import WalkInQuery from "@/models/WalkInQuery";
import CustomerComplaint from "@/models/CustomerComplaint";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { containsArg, hydrateAll, isLiteralRegex, likeContains, loadLean, resolveDb } from "./rebuild";

// ---------------------------------------------------------------------------
// GET /api/crm/walk-in
// ---------------------------------------------------------------------------

export interface WalkInArgs {
  date?: string | null;
  status?: string | null;
  mobile?: string | null;
}

export async function walkInListMongo({ date, status, mobile }: WalkInArgs): Promise<any[]> {
  await connectToDatabase();
  const filter: any = {};
  if (date) filter.date = date;
  if (status) filter.status = status;
  if (mobile) filter.mobile = mobile;
  return WalkInQuery.find(filter).sort({ createdAt: -1 });
}

export async function walkInListD1({ date, status, mobile }: WalkInArgs, db?: D1DatabaseLike): Promise<any[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (date) (where.push("date = ?"), args.push(date));
  if (status) (where.push("status = ?"), args.push(status));
  if (mobile) (where.push("mobile = ?"), args.push(mobile));
  const docs = await loadLean(resolveDb(db), "walk_in_queries", {
    where: where.length ? where.join(" AND ") : undefined,
    args,
    orderBy: "createdAt DESC, id ASC",
  });
  return hydrateAll(WalkInQuery, docs);
}

// ---------------------------------------------------------------------------
// GET /api/crm/complaints
// ---------------------------------------------------------------------------

export interface ComplaintArgs {
  type?: string | null;
  status?: string | null;
  priority?: string | null;
  staff?: string | null;
  search?: string | null;
}

export async function complaintsListMongo({ type, status, priority, staff, search }: ComplaintArgs): Promise<any[]> {
  await connectToDatabase();
  const filter: any = {};
  if (type && type !== "all") {
    filter.complaintType = type;
  }
  if (status && status !== "all") {
    filter.status = status;
  }
  if (priority && priority !== "all") {
    filter.priority = priority;
  }
  if (staff && staff !== "all") {
    filter.$or = [
      { accusedStaffName: { $regex: new RegExp(staff, "i") } },
      { assignedTo: { $regex: new RegExp(staff, "i") } },
    ];
  }
  if (search && search.trim()) {
    const s = search.trim();
    filter.$or = [
      { ticketNumber: { $regex: s, $options: "i" } },
      { customerName: { $regex: s, $options: "i" } },
      { customerPhone: { $regex: s, $options: "i" } },
      { accusedStaffName: { $regex: s, $options: "i" } },
      { productName: { $regex: s, $options: "i" } },
      { serialNumber: { $regex: s, $options: "i" } },
      { invoiceNumber: { $regex: s, $options: "i" } },
    ];
  }
  return CustomerComplaint.find(filter)
    .sort({ createdAt: -1 })
    .lean();
}

const SEARCH_FIELDS = ["ticketNumber", "customerName", "customerPhone", "accusedStaffName", "productName", "serialNumber", "invoiceNumber"];

/**
 * `staff` and `search` are raw regexes in the route. A plain literal becomes LIKE '%…%' in SQL; one with a regex
 * metacharacter is applied with the same JS RegExp to the rebuilt documents (string values only, as Mongo does).
 * As in the route, `search` replaces the `staff` condition when both are given.
 */
export async function complaintsListD1({ type, status, priority, staff, search }: ComplaintArgs, db?: D1DatabaseLike): Promise<any[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (type && type !== "all") (where.push("complaintType = ?"), args.push(type));
  if (status && status !== "all") (where.push("status = ?"), args.push(status));
  if (priority && priority !== "all") (where.push("priority = ?"), args.push(priority));

  let regexOr: { rx: RegExp; fields: string[] } | null = null;
  let source: string | null = null;
  let fields: string[] = [];
  if (staff && staff !== "all") {
    source = staff;
    fields = ["accusedStaffName", "assignedTo"];
    new RegExp(staff, "i"); // an invalid pattern throws here, as it does in the Mongo route
  }
  if (search && search.trim()) {
    source = search.trim();
    fields = SEARCH_FIELDS;
    new RegExp(source, "i");
  }
  if (source !== null) {
    if (isLiteralRegex(source)) {
      where.push(`(${fields.map(likeContains).join(" OR ")})`);
      for (let i = 0; i < fields.length; i++) args.push(containsArg(source));
    } else {
      regexOr = { rx: new RegExp(source, "i"), fields };
    }
  }
  let docs = await loadLean(resolveDb(db), "customer_complaints", {
    where: where.length ? where.join(" AND ") : undefined,
    args,
    orderBy: "createdAt DESC, id ASC",
  });
  if (regexOr) {
    const { rx, fields: fs } = regexOr;
    docs = docs.filter((d) => fs.some((f) => typeof d[f] === "string" && rx.test(d[f])));
  }
  return docs;
}
