/**
 * Vendor reads: vendors, vendor bills and vendor payments (lists, ledgers, dashboard). `mongo` = the query as it
 * runs today; `d1` = the same from D1.
 */
import mongoose from "mongoose";
import connectToDatabase from "@/lib/db";
import Vendor from "@/models/Vendor";
import VendorBill from "@/models/VendorBill";
import VendorPayment from "@/models/VendorPayment";
import { findDocs, ne, useDb } from "./d1-doc";
import { read } from "./types";

/** Vendor.find({ _id: id }) casts the id first and throws on one that is not an ObjectId; so does this. */
function castId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new Error(`Cast to ObjectId failed for value "${id}" (type string) at path "_id" for model "Vendor"`);
  return String(new mongoose.Types.ObjectId(id));
}

export const VENDOR_READS = {
  /** GET /api/vendors[?status=] — newest first. */
  "vendors.list": read<{ status?: string | null }>({
    mongo: async ({ status }) => {
      await connectToDatabase();
      const filter: any = {};
      if (status && status !== "all") filter.status = status;
      return Vendor.find(filter).sort({ createdAt: -1 }).lean();
    },
    d1: async ({ status }, db) => {
      const by = !!(status && status !== "all");
      return findDocs(useDb(db), "vendors", { where: by ? "status = ?" : undefined, params: by ? [status] : [], orderBy: "createdAt DESC, id" });
    },
  }),

  /** GET /api/vendors/ledger (party=vendor) — one vendor or all, stored order. */
  "vendors.ledger": read<{ id?: string | null }>({
    mongo: async ({ id }) => {
      await connectToDatabase();
      return id ? Vendor.find({ _id: id }).lean() : Vendor.find({}).lean();
    },
    d1: async ({ id }, db) =>
      id ? findDocs(useDb(db), "vendors", { where: "id = ?", params: [castId(id)], orderBy: "id" }) : findDocs(useDb(db), "vendors", { orderBy: "id" }),
  }),

  /** GET /api/dashboard/stats — vendor names and opening balances, stored order. */
  "vendors.dashboard": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return Vendor.find({}, { name: 1, code: 1, phone: 1, openingBalance: 1, openingBalanceDate: 1 }).lean();
    },
    d1: async (_a, db) =>
      findDocs(useDb(db), "vendors", { orderBy: "id", projection: { name: 1, code: 1, phone: 1, openingBalance: 1, openingBalanceDate: 1 } }),
  }),

  /** GET /api/vendors/bills[?vendorId=] — newest bill date first. */
  "vendorBills.list": read<{ vendorId?: string | null }>({
    mongo: async ({ vendorId }) => {
      await connectToDatabase();
      const filter: any = {};
      if (vendorId) filter.vendorId = vendorId;
      return VendorBill.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    },
    d1: async ({ vendorId }, db) =>
      findDocs(useDb(db), "vendor_bills", { where: vendorId ? "vendorId = ?" : undefined, params: vendorId ? [vendorId] : [], orderBy: "date DESC, createdAt DESC, id" }),
  }),

  /** GET /api/vendors/ledger (party=vendor) — bills of one vendor or all, stored order. */
  "vendorBills.ledger": read<{ id?: string | null }>({
    mongo: async ({ id }) => {
      await connectToDatabase();
      return id ? VendorBill.find({ vendorId: id }).lean() : VendorBill.find({}).lean();
    },
    d1: async ({ id }, db) => findDocs(useDb(db), "vendor_bills", { where: id ? "vendorId = ?" : undefined, params: id ? [id] : [], orderBy: "id" }),
  }),

  /** GET /api/vendors/ledger?id= (party=vendor) — the bill-by-bill breakdown, oldest bill date first. */
  "vendorBills.detail": read<{ id: string }>({
    mongo: async ({ id }) => {
      await connectToDatabase();
      return VendorBill.find({ vendorId: id }).sort({ date: 1 }).lean();
    },
    d1: async ({ id }, db) => findDocs(useDb(db), "vendor_bills", { where: "vendorId = ?", params: [id], orderBy: "date, id" }),
  }),

  /** GET /api/dashboard/stats — bills that are not cancelled (the vendor balances), stored order. */
  "vendorBills.dashboard": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return VendorBill.find({ status: { $ne: "cancelled" } }, { vendorId: 1, date: 1, billNo: 1, total: 1, dueDate: 1 }).lean();
    },
    d1: async (_a, db) =>
      findDocs(useDb(db), "vendor_bills", { where: ne("status"), params: ["cancelled"], orderBy: "id", projection: { vendorId: 1, date: 1, billNo: 1, total: 1, dueDate: 1 } }),
  }),

  /** GET /api/vendors/payments[?vendorId=&from=&to=] — newest date first. */
  "vendorPayments.list": read<{ vendorId?: string | null; from?: string | null; to?: string | null }>({
    mongo: async ({ vendorId, from, to }) => {
      await connectToDatabase();
      const filter: any = {};
      if (vendorId) filter.vendorId = vendorId;
      if (from || to) {
        filter.date = {};
        if (from) filter.date.$gte = from;
        if (to) filter.date.$lte = to;
      }
      return VendorPayment.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    },
    d1: async ({ vendorId, from, to }, db) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (vendorId) {
        where.push("vendorId = ?");
        params.push(vendorId);
      }
      if (from) {
        where.push("date >= ?");
        params.push(from);
      }
      if (to) {
        where.push("date <= ?");
        params.push(to);
      }
      return findDocs(useDb(db), "vendor_payments", { where: where.join(" AND ") || undefined, params, orderBy: "date DESC, createdAt DESC, id" });
    },
  }),

  /** GET /api/vendors/ledger (party=vendor) — payments of one vendor or all, stored order. */
  "vendorPayments.ledger": read<{ id?: string | null }>({
    mongo: async ({ id }) => {
      await connectToDatabase();
      return id ? VendorPayment.find({ vendorId: id }).lean() : VendorPayment.find({}).lean();
    },
    d1: async ({ id }, db) => findDocs(useDb(db), "vendor_payments", { where: id ? "vendorId = ?" : undefined, params: id ? [id] : [], orderBy: "id" }),
  }),

  /** GET /api/vendors/ledger?id= (party=vendor) — payments for the bill-by-bill breakdown, oldest date first. */
  "vendorPayments.detail": read<{ id: string }>({
    mongo: async ({ id }) => {
      await connectToDatabase();
      return VendorPayment.find({ vendorId: id }).sort({ date: 1 }).lean();
    },
    d1: async ({ id }, db) => findDocs(useDb(db), "vendor_payments", { where: "vendorId = ?", params: [id], orderBy: "date, id" }),
  }),

  /** GET /api/dashboard/stats — every vendor payment, whole, stored order. */
  "vendorPayments.dashboard": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return VendorPayment.find({}).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), "vendor_payments", { orderBy: "id" }),
  }),
};
