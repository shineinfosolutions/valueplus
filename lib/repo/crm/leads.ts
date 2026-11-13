/**
 * Lead reads (collection `leads`, D1 `leads` + leadFollowUps / leadCalls / leadShares). Each read has the CURRENT
 * Mongo query, copied verbatim from its route, and the D1 query that returns the same thing (lib/repo/crm/INVENTORY.md).
 */
import connectToDatabase from "@/lib/db";
import Lead from "@/models/Lead";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { containsArg, hydrateAll, isLiteralRegex, likeContains, likeEscape, loadLean, loadRows, pick, rebuildAll, resolveDb } from "./rebuild";

/** Who is asking (lib/requirePermission getActor): the fields the lead reads use. */
export interface LeadActor {
  id: string;
  name: string;
  role: string;
}

export interface LeadListArgs {
  actor: LeadActor;
  status?: string | null;
  staff?: string | null;
  priority?: string | null;
  mobile?: string | null;
}

/** Roles that see every lead; everyone else sees only their own (app/api/crm/leads/route.ts). */
const ALL_LEADS_ROLES = ["admin", "superadmin", "manager", "accounts", "cashier"];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// GET /api/crm/leads (the leads page, Staff Activity, LeadsLoginPopup, the billing form's mobile lookup)
// ---------------------------------------------------------------------------

/** Mongo: verbatim from app/api/crm/leads/route.ts GET (hydrated documents, newest first). */
export async function leadsListMongo({ actor, status, staff, priority, mobile }: LeadListArgs): Promise<any[]> {
  await connectToDatabase();
  const filter: any = {};
  if (!ALL_LEADS_ROLES.includes(actor.role) && !mobile) {
    const isSales = ["salesman", "sales"].includes(actor.role);
    const names = [...new Set([actor.name.trim(), actor.name.replace(/\s*\(.*\)\s*$/, "").trim()])].filter(Boolean);
    filter.$or = [
      ...names.map((n) => ({ assignedStaff: { $regex: new RegExp(`^\\s*${escapeRegex(n)}\\s*$`, "i") } })),
      ...(isSales ? [{ assignedStaff: { $regex: /^sales team$/i } }, { assignedStaff: { $in: ["", null] } }] : []),
      { sharedWith: { $elemMatch: { staffId: actor.id, status: "accepted" } } },
    ];
  }
  if (status && status !== "all") filter.status = status;
  if (staff) filter.assignedStaff = staff;
  if (priority) filter.priority = priority;
  if (mobile) {
    const digits = mobile.replace(/\D/g, "").slice(-10);
    filter.mobile = digits.length === 10 ? { $regex: `${digits}$` } : mobile;
  }
  return Lead.find(filter).sort({ createdAt: -1 });
}

/** Characters JS `\s` matches that SQLite TRIM is told to strip (ASCII whitespace). */
const WS = "' ' || char(9) || char(10) || char(11) || char(12) || char(13)";

/** D1: the same filter in SQL, hydrated through the Lead model. */
export async function leadsListD1({ actor, status, staff, priority, mobile }: LeadListArgs, db?: D1DatabaseLike): Promise<any[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (!ALL_LEADS_ROLES.includes(actor.role) && !mobile) {
    const isSales = ["salesman", "sales"].includes(actor.role);
    const names = [...new Set([actor.name.trim(), actor.name.replace(/\s*\(.*\)\s*$/, "").trim()])].filter(Boolean);
    const or: string[] = [];
    // /^\s*NAME\s*$/i: the name, case-insensitive, with any surrounding whitespace.
    for (const n of names) {
      or.push(`TRIM(assignedStaff, ${WS}) LIKE ? ESCAPE '\\'`);
      args.push(likeEscape(n));
    }
    if (isSales) {
      or.push(`assignedStaff LIKE 'sales team'`);
      or.push(`(assignedStaff = '' OR assignedStaff IS NULL)`);
    }
    or.push(`EXISTS (SELECT 1 FROM leadShares s WHERE s.leadId = leads.id AND s.staffId = ? AND s.status = 'accepted')`);
    args.push(actor.id);
    where.push(`(${or.join(" OR ")})`);
  }
  if (status && status !== "all") {
    where.push("status = ?");
    args.push(status);
  }
  if (staff) {
    where.push("assignedStaff = ?");
    args.push(staff);
  }
  if (priority) {
    where.push("priority = ?");
    args.push(priority);
  }
  if (mobile) {
    const digits = mobile.replace(/\D/g, "").slice(-10);
    if (digits.length === 10) {
      // { $regex: "<10 digits>$" }: ends with those digits.
      where.push("mobile LIKE ?");
      args.push(`%${digits}`);
    } else {
      where.push("mobile = ?");
      args.push(mobile);
    }
  }
  const docs = await loadLean(resolveDb(db), "leads", {
    where: where.length ? where.join(" AND ") : undefined,
    args,
    orderBy: "createdAt DESC, id ASC",
  });
  return hydrateAll(Lead, docs);
}

// ---------------------------------------------------------------------------
// GET /api/crm/leads?shareInbox=1 (LeadShareInbox, /api/me/summary leadShareInbox)
// ---------------------------------------------------------------------------

export async function leadShareInboxMongo({ actorId }: { actorId: string }): Promise<any[]> {
  await connectToDatabase();
  return Lead.find({ sharedWith: { $elemMatch: { staffId: actorId, status: "pending" } } }).sort({ updatedAt: -1 }).lean();
}

export async function leadShareInboxD1({ actorId }: { actorId: string }, db?: D1DatabaseLike): Promise<any[]> {
  return loadLean(resolveDb(db), "leads", {
    where: "EXISTS (SELECT 1 FROM leadShares s WHERE s.leadId = leads.id AND s.staffId = ? AND s.status = 'pending')",
    args: [actorId],
    orderBy: "updatedAt DESC, id ASC",
  });
}

// ---------------------------------------------------------------------------
// GET /api/search (the Lead part of the global search)
// ---------------------------------------------------------------------------

export async function leadSearchMongo({ q }: { q: string }): Promise<any[]> {
  await connectToDatabase();
  const regex = new RegExp(q, "i");
  return Lead.find({
    $or: [
      { leadId: regex },
      { customerName: regex },
      { mobile: regex },
    ],
  }).limit(5);
}

/**
 * `q` is used as a raw regex by the route. A plain literal becomes LIKE '%q%'; anything with a regex metacharacter
 * is matched with the same JS RegExp on the rebuilt documents (Mongo regexes only match string values).
 * No sort in Mongo = natural order; D1 uses id order (ObjectIds grow with insertion).
 */
export async function leadSearchD1({ q }: { q: string }, db?: D1DatabaseLike): Promise<any[]> {
  const regex = new RegExp(q, "i");
  const d = resolveDb(db);
  if (isLiteralRegex(q)) {
    const docs = await loadLean(d, "leads", {
      where: ["leadId", "customerName", "mobile"].map(likeContains).join(" OR "),
      args: [containsArg(q), containsArg(q), containsArg(q)],
      orderBy: "id ASC",
      limit: 5,
    });
    return hydrateAll(Lead, docs);
  }
  const all = rebuildAll(await loadRows(d, "leads", { orderBy: "id ASC" }));
  const hit = (v: unknown) => typeof v === "string" && regex.test(v);
  return hydrateAll(Lead, all.filter((l) => hit(l.leadId) || hit(l.customerName) || hit(l.mobile)).slice(0, 5));
}

// ---------------------------------------------------------------------------
// GET /api/staff/overview (a staff member's leads)
// ---------------------------------------------------------------------------

const OVERVIEW_FIELDS = ["customerName", "status", "assignedStaff", "estimatedValue"];

export async function leadsOverviewMongo(): Promise<any[]> {
  await connectToDatabase();
  return Lead.find({}, { customerName: 1, status: 1, assignedStaff: 1, estimatedValue: 1 }).lean();
}

export async function leadsOverviewD1(_args?: unknown, db?: D1DatabaseLike): Promise<any[]> {
  const docs = await loadLean(resolveDb(db), "leads", { orderBy: "id ASC", children: false });
  return docs.map((d) => pick(d, OVERVIEW_FIELDS));
}
