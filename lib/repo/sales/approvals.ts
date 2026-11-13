/**
 * Discount-approval and store-activity-approval reads of the GET paths (see invoices.ts for the mongo… / d1…
 * convention and lib/repo/sales/INVENTORY.md for where each is used).
 */
import DiscountApproval from "@/models/DiscountApproval";
import StoreActivityApproval from "@/models/StoreActivityApproval";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { META, Where, countDocs, findDocs } from "./d1-docs";

// ---------------------------------------------------------------------------
// discountapprovals (GET /api/discount-approvals)
// ---------------------------------------------------------------------------

/**
 * `?ids=a,b`: the caller's own requests. Mongoose casts each id to an ObjectId first and throws a CastError on one
 * that is not; the D1 read throws too (same message shape), so the route answers 500 either way.
 */
export async function mongoDiscountApprovalsByIds(ids: string[], actorId: string) {
  return DiscountApproval.find({ _id: { $in: ids }, requestedById: actorId }).lean();
}

export async function d1DiscountApprovalsByIds(db: D1DatabaseLike, ids: string[], actorId: string) {
  const hex: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !/^[0-9a-fA-F]{24}$/.test(id)) {
      const err: any = new Error(`Cast to ObjectId failed for value "${id}" (type ${typeof id}) at path "_id" for model "DiscountApproval"`);
      err.name = "CastError";
      throw err;
    }
    hex.push(id.toLowerCase());
  }
  return findDocs(db, META.discountApprovals, { where: new Where().in("id", hex).eq("requestedById", actorId) });
}

/** The decision list: status filter, the tiers the role may decide, newest 200. */
export async function mongoDiscountApprovalList(status: string | null, tiers: string[]) {
  const q: any = {};
  if (status) q.status = status;
  if (tiers.length < 3) q.tier = { $in: tiers };
  return DiscountApproval.find(q).sort({ createdAt: -1 }).limit(200).lean();
}

export async function d1DiscountApprovalList(db: D1DatabaseLike, status: string | null, tiers: string[]) {
  const where = new Where();
  if (status) where.eq("status", status);
  if (tiers.length < 3) where.in("tier", tiers);
  return findDocs(db, META.discountApprovals, { where, orderBy: "createdAt DESC, id", limit: 200 });
}

// ---------------------------------------------------------------------------
// store_activity_approvals (GET /api/approvals, /api/me/summary)
// ---------------------------------------------------------------------------

export interface StoreApprovalArgs {
  status: string | null;
  storeName: string | null;
  isAdmin: boolean;
  actorId?: string;
  actorEmail?: string;
}

function storeApprovalQuery({ status, storeName, isAdmin, actorId, actorEmail }: StoreApprovalArgs) {
  const query: any = {};
  if (status && status !== "all") query.status = status;
  if (storeName && storeName !== "all") query.storeName = storeName;
  if (!isAdmin) {
    query.$or = [{ "payload.requestedBy.id": actorId }, { storeInchargeEmail: actorEmail }];
  }
  return query;
}

/** The list and the pending count, as the route reads them. */
export async function mongoStoreApprovals(args: StoreApprovalArgs) {
  const query = storeApprovalQuery(args);
  const approvals = await StoreActivityApproval.find(query).sort({ createdAt: -1 }).lean();
  const pendingCount = await StoreActivityApproval.countDocuments({ ...query, status: "pending" });
  return { approvals, pendingCount };
}

/** `col = ?`, or `col IS NULL` for a missing value (Mongo matches { f: undefined / null } to a missing field). */
function eqOrMissing(sqlExpr: string, v: unknown): [string, unknown[]] {
  return v === undefined || v === null ? [`${sqlExpr} IS NULL`, []] : [`${sqlExpr} = ?`, [v]];
}

function storeApprovalWhere({ status, storeName, isAdmin, actorId, actorEmail }: StoreApprovalArgs, statusOverride?: string): Where {
  const where = new Where();
  const st = statusOverride ?? (status && status !== "all" ? status : null);
  if (st) where.eq("status", st);
  if (storeName && storeName !== "all") where.eq("storeName", storeName);
  if (!isAdmin) {
    // payload.requestedBy.id as stored (a text value; json_extract gives NULL when there is none)
    const [a, ap] = eqOrMissing(`json_extract(payload, '$.requestedBy.id')`, actorId);
    const [b, bp] = eqOrMissing("storeInchargeEmail", actorEmail);
    where.raw(`(${a} OR ${b})`, ...ap, ...bp);
  }
  return where;
}

export async function d1StoreApprovals(db: D1DatabaseLike, args: StoreApprovalArgs) {
  const approvals = await findDocs(db, META.storeApprovals, { where: storeApprovalWhere(args), orderBy: "createdAt DESC, id" });
  const pendingCount = await countDocs(db, META.storeApprovals, { where: storeApprovalWhere(args, "pending") });
  return { approvals, pendingCount };
}

/** GET /api/me/summary (Admin): requests waiting for a decision. */
export async function mongoPendingStoreApprovalCount() {
  return StoreActivityApproval.countDocuments({ status: "pending" });
}

export async function d1PendingStoreApprovalCount(db: D1DatabaseLike) {
  return countDocs(db, META.storeApprovals, { where: new Where().eq("status", "pending") });
}
