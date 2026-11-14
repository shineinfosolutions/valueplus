/**
 * Estimate, delivery-challan, e-way bill and extended-warranty reads of the GET paths (see invoices.ts for the
 * mongo… / d1… convention and lib/repo/sales/INVENTORY.md for where each is used).
 */
import Estimate from "@/models/Estimate";
import DeliveryChallan from "@/models/DeliveryChallan";
import EWayBill from "@/models/EWayBill";
import ExtendedWarranty from "@/models/ExtendedWarranty";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { META, Where, countDocs, findDocs, findOneDoc, regexMatches } from "./d1-docs";

// ---------------------------------------------------------------------------
// estimates
// ---------------------------------------------------------------------------

/** GET /api/estimates (phone / status / approval; also /api/me/summary with approval=pending). Not .lean(). */
export async function mongoEstimateList(phone: string | null, status: string | null, approval: string | null) {
  const query: any = {};
  if (phone) {
    const clean = phone.replace(/\D/g, "");
    query.customerPhone = { $regex: clean, $options: "i" };
  }
  if (status) {
    query.status = status;
  }

  if (approval) query.approvalStatus = approval;
  return Estimate.find(query).sort({ createdAt: -1 });
}

export async function d1EstimateList(db: D1DatabaseLike, phone: string | null, status: string | null, approval: string | null) {
  const where = new Where();
  // The pattern is digits only, so "contains" is exact (instr is case-sensitive, digits have no case).
  if (phone) where.raw(`instr(customerPhone, ?) > 0`, phone.replace(/\D/g, ""));
  if (status) where.eq("status", status);
  if (approval) where.eq("approvalStatus", approval);
  return findDocs(db, META.estimates, { where, orderBy: "createdAt DESC, id", hydrateWith: Estimate });
}

/** GET /api/invoices/next-number?type=estimate. */
export async function mongoEstimateNumbers() {
  return Estimate.find({}, { estimateNumber: 1 }).lean();
}

export async function d1EstimateNumbers(db: D1DatabaseLike) {
  return findDocs(db, META.estimates, { projection: { estimateNumber: 1 } });
}

// ---------------------------------------------------------------------------
// delivery_challans
// ---------------------------------------------------------------------------

export interface ChallanListArgs {
  flowType: string | null;
  claimStatus: string | null;
  approvalStatus: string | null;
  search: string | null;
}

/** GET /api/delivery-challans. */
export async function mongoChallanList({ flowType, claimStatus, approvalStatus, search }: ChallanListArgs) {
  const query: any = {};
  if (flowType && flowType !== "all") query.flowType = flowType === "CR" ? { $in: ["CR", "CNR"] } : flowType;
  if (claimStatus && claimStatus !== "all") query.claimStatus = claimStatus;
  if (approvalStatus && approvalStatus !== "all") query.approvalStatus = approvalStatus;
  if (search) {
    query.$or = [
      { challanNo: { $regex: search, $options: "i" } },
      { invoiceNumber: { $regex: search, $options: "i" } },
      { destinationParty: { $regex: search, $options: "i" } },
      { sourceParty: { $regex: search, $options: "i" } },
      { itemName: { $regex: search, $options: "i" } },
      { serialImei: { $regex: search, $options: "i" } },
      { vehicleNo: { $regex: search, $options: "i" } },
    ];
  }

  return DeliveryChallan.find(query).sort({ createdAt: -1 }).lean();
}

export async function d1ChallanList(db: D1DatabaseLike, { flowType, claimStatus, approvalStatus, search }: ChallanListArgs) {
  const where = new Where();
  if (flowType && flowType !== "all") {
    if (flowType === "CR") where.in("flowType", ["CR", "CNR"]);
    else where.eq("flowType", flowType);
  }
  if (claimStatus && claimStatus !== "all") where.eq("claimStatus", claimStatus);
  if (approvalStatus && approvalStatus !== "all") where.eq("approvalStatus", approvalStatus);
  let filter: ((d: any) => boolean) | undefined;
  if (search) {
    const re = new RegExp(search, "i");
    const fields = ["challanNo", "invoiceNumber", "destinationParty", "sourceParty", "itemName", "serialImei", "vehicleNo"];
    filter = (d) => fields.some((f) => regexMatches(d[f], re));
  }
  return findDocs(db, META.challans, { where, orderBy: "createdAt DESC, id", filter });
}

/** GET /api/track/[id]: the challan with this number, or of this bill. */
export async function mongoTrackChallan(decodedId: string) {
  return DeliveryChallan.findOne({
    $or: [
      { challanNo: decodedId },
      { invoiceNumber: decodedId },
    ]
  }).lean();
}

export async function d1TrackChallan(db: D1DatabaseLike, decodedId: string) {
  return findOneDoc(db, META.challans, { where: new Where().raw(`(challanNo = ? OR invoiceNumber = ?)`, decodedId, decodedId) });
}

// ---------------------------------------------------------------------------
// eway_bills
// ---------------------------------------------------------------------------

/** GET /api/eway-bills (invoiceNumber / status). Not .lean(). */
export async function mongoEwayBillList(invoiceNumber: string | null, status: string | null) {
  const filter: any = {};
  if (invoiceNumber) filter.invoiceNumber = invoiceNumber;
  if (status && status !== "all") filter.status = status;
  return EWayBill.find(filter).sort({ createdAt: -1 });
}

export async function d1EwayBillList(db: D1DatabaseLike, invoiceNumber: string | null, status: string | null) {
  const where = new Where();
  if (invoiceNumber) where.eq("invoiceNumber", invoiceNumber);
  if (status && status !== "all") where.eq("status", status);
  return findDocs(db, META.ewayBills, { where, orderBy: "createdAt DESC, id", hydrateWith: EWayBill });
}

/** GET /api/gstr-reports?type=GSTR1: the e-way bills of the listed bills. */
export async function mongoGstr1EwayBills(invoiceNumbers: string[]) {
  return invoiceNumbers.length
    ? await EWayBill.find(
        { invoiceNumber: { $in: invoiceNumbers } },
        { invoiceNumber: 1, ewayBillNo: 1, generatedDate: 1 }
      ).lean()
    : [];
}

export async function d1Gstr1EwayBills(db: D1DatabaseLike, invoiceNumbers: string[]) {
  if (!invoiceNumbers.length) return [];
  return findDocs(db, META.ewayBills, { where: new Where().in("invoiceNumber", invoiceNumbers), projection: { invoiceNumber: 1, ewayBillNo: 1, generatedDate: 1 } });
}

// ---------------------------------------------------------------------------
// extended_warranties (GET /api/warranty)
// ---------------------------------------------------------------------------

export interface WarrantyListArgs {
  invoiceNumber: string | null;
  customerPhone: string | null;
  vpCode: string | null;
  status: string | null;
}

/** The list (not .lean()). */
export async function mongoWarrantyList({ invoiceNumber, customerPhone, vpCode, status }: WarrantyListArgs) {
  const filter: any = {};
  if (invoiceNumber) filter.invoiceNumber = invoiceNumber;
  if (customerPhone) filter.customerPhone = customerPhone;
  if (vpCode) filter.vpCode = vpCode;
  if (status) filter.status = status;
  return ExtendedWarranty.find(filter).sort({ createdAt: -1 });
}

export async function d1WarrantyList(db: D1DatabaseLike, { invoiceNumber, customerPhone, vpCode, status }: WarrantyListArgs) {
  const where = new Where();
  if (invoiceNumber) where.eq("invoiceNumber", invoiceNumber);
  if (customerPhone) where.eq("customerPhone", customerPhone);
  if (vpCode) where.eq("vpCode", vpCode);
  if (status) where.eq("status", status);
  return findDocs(db, META.warranties, { where, orderBy: "createdAt DESC, id", hydrateWith: ExtendedWarranty });
}

export async function mongoWarrantyCount() {
  return ExtendedWarranty.countDocuments();
}

export async function d1WarrantyCount(db: D1DatabaseLike) {
  return countDocs(db, META.warranties);
}

/** `[{ _id: null, total }]`, or `[]` when there is no warranty at all ($group over nothing gives no row). */
export async function mongoWarrantyRevenue() {
  return ExtendedWarranty.aggregate([
    { $group: { _id: null, total: { $sum: "$warrantyAmount" } } }
  ]);
}

export async function d1WarrantyRevenue(db: D1DatabaseLike) {
  const row = await db.prepare(`SELECT COUNT(*) AS n, TOTAL(warrantyAmount) AS total FROM extendedWarranties`).first<{ n: number; total: number }>();
  if (!row || !Number(row.n)) return [];
  return [{ _id: null, total: Number(row.total) }];
}

/** Warranties starting today or later (todayStr = istToday()). */
export async function mongoWarrantyTodayCount(todayStr: string) {
  return ExtendedWarranty.countDocuments({ startDate: { $gte: todayStr } });
}

export async function d1WarrantyTodayCount(db: D1DatabaseLike, todayStr: string) {
  return countDocs(db, META.warranties, { where: new Where().cmp("startDate", ">=", todayStr) });
}

/** Warranties starting this month (thisMonthStr = "YYYY-MM"). */
export async function mongoWarrantyMonthCount(thisMonthStr: string) {
  return ExtendedWarranty.countDocuments({ startDate: { $regex: `^${thisMonthStr}` } });
}

export async function d1WarrantyMonthCount(db: D1DatabaseLike, thisMonthStr: string) {
  const re = new RegExp(`^${thisMonthStr}`);
  // A plain "YYYY-MM" is a literal prefix: done in SQL. Anything else is matched exactly as Mongo would, in JS.
  if (/^[\w-]*$/.test(thisMonthStr)) {
    return countDocs(db, META.warranties, { where: new Where().raw(`substr(startDate, 1, length(?)) = ?`, thisMonthStr, thisMonthStr) });
  }
  return countDocs(db, META.warranties, { filter: (d) => regexMatches(d.startDate, re) });
}

