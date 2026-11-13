/**
 * Cash reads: the cash register (lib/cashRegister.ts), day closes, the Admin cash book and bank accounts.
 * `mongo` = the query as it runs today; `d1` = the same from D1.
 */
import connectToDatabase from "@/lib/db";
import CashTransaction from "@/models/CashTransaction";
import CashRegisterSetting from "@/models/CashRegisterSetting";
import DayClose from "@/models/DayClose";
import AdminCashEntry from "@/models/AdminCashEntry";
import BankAccount from "@/models/BankAccount";
import { LEGACY_CASH_REGISTER, NOT_LEGACY_CASH_REGISTER } from "@/lib/legacy-rows";
import { findDocs, findOneDoc, ne, regexFilter, useDb } from "./d1-doc";
import { read } from "./types";

/**
 * The legacy cash-register filter of lib/legacy-rows.ts in SQL (both regexes are ASCII literals, so exact), or as a
 * JS test when regexFilter cannot say it in SQL.
 */
function legacyParts() {
  const name = regexFilter("name", "name", "cash register");
  const number = regexFilter("number", "number", "cash-register");
  return { name, number };
}

export const CASH_READS = {
  /** lib/cashRegister.ts getCashRegisterSummary — every recorded cash movement (mongoose documents), newest first. */
  "cashTransactions.all": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return CashTransaction.find({}).sort({ createdAt: -1 });
    },
    d1: async (_a, db) => findDocs(useDb(db), "cash_transactions", { orderBy: "createdAt DESC, id" }),
    // The register balance checks payouts (admin-cash POST / PATCH), the day close and calibration: never from D1.
    mongoOnlyInD1: true,
  }),

  /** lib/cashRegister.ts getCashRegisterSummary — the Admin's drawer count (opening cash). */
  "cashRegisterSetting.get": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return CashRegisterSetting.findOne({ key: "cash-register" }).lean();
    },
    d1: async (_a, db) => findOneDoc(useDb(db), "cash_register_settings", { where: "key = ?", params: ["cash-register"], orderBy: "id" }),
    // Part of the register balance (see cashTransactions.all).
    mongoOnlyInD1: true,
  }),

  /** GET /api/day-close (getPendingDate) — the latest day close (a mongoose document). */
  "dayCloses.latest": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return DayClose.findOne({}).sort({ date: -1 });
    },
    d1: async (_a, db) => findOneDoc(useDb(db), "day_closes", { orderBy: "date DESC, id" }),
  }),

  /** lib/day-close-pending.ts (GET /api/me/summary) — only the date of the latest day close. */
  "dayCloses.latestDate": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return DayClose.findOne({}, { date: 1 }).sort({ date: -1 }).lean();
    },
    d1: async (_a, db) => findOneDoc(useDb(db), "day_closes", { orderBy: "date DESC, id", projection: { date: 1 } }),
  }),

  /** GET /api/day-close — the last 60 day closes, newest first. */
  "dayCloses.history": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return DayClose.find({}).sort({ date: -1 }).limit(60).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), "day_closes", { orderBy: "date DESC, id", limit: 60 }),
  }),

  /** POST /api/day-close/recompute — every day close, oldest first (mongoose documents). */
  "dayCloses.allAsc": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return DayClose.find({}).sort({ date: 1 });
    },
    d1: async (_a, db) => findDocs(useDb(db), "day_closes", { orderBy: "date, id" }),
    // Read by a POST that rewrites the day closes.
    mongoOnlyInD1: true,
  }),

  /** GET /api/admin-cash (buildBook) — every Admin cash entry, oldest first. */
  "adminCashEntries.book": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return AdminCashEntry.find({}).sort({ date: 1, createdAt: 1 }).lean();
    },
    d1: async (_a, db) => findDocs(useDb(db), "admin_cash_entries", { orderBy: "date, createdAt, id" }),
    // The Admin's available cash: admin-cash POST refuses a payout above it, PATCH refuses a cancel that makes it negative.
    mongoOnlyInD1: true,
  }),

  /** GET /api/bank-accounts — every account except the legacy cash-register rows (mongoose documents), newest first. */
  "bankAccounts.list": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return BankAccount.find(NOT_LEGACY_CASH_REGISTER).sort({ createdAt: -1 });
    },
    d1: async (_a, db) => {
      const { name, number } = legacyParts();
      if (name.sql && number.sql) {
        return findDocs(useDb(db), "bank_accounts", {
          where: `${ne("type")} AND (name IS NULL OR NOT (${name.sql})) AND (number IS NULL OR NOT (${number.sql}))`,
          params: ["cash", ...name.params, ...number.params],
          orderBy: "createdAt DESC, id",
        });
      }
      return findDocs(useDb(db), "bank_accounts", {
        where: ne("type"),
        params: ["cash"],
        orderBy: "createdAt DESC, id",
        post: (d) => !name.test(d) && !number.test(d),
      });
    },
  }),

  /** lib/legacy-rows.ts cleanupLegacyBankWarehouse (scripts/cleanup-legacy-bank-warehouse.ts) — the legacy rows, stored order. */
  "bankAccounts.legacy": read<{}>({
    mongo: async () => {
      await connectToDatabase();
      return BankAccount.find(LEGACY_CASH_REGISTER, { name: 1, number: 1, type: 1 }).lean();
    },
    d1: async (_a, db) => {
      const { name, number } = legacyParts();
      const projection = { name: 1, number: 1, type: 1 } as const;
      if (name.sql && number.sql) {
        return findDocs(useDb(db), "bank_accounts", {
          where: `(type = ? OR ${name.sql} OR ${number.sql})`,
          params: ["cash", ...name.params, ...number.params],
          orderBy: "id",
          projection,
        });
      }
      return findDocs(useDb(db), "bank_accounts", { orderBy: "id", projection, post: (d) => d.type === "cash" || name.test(d) || number.test(d) });
    },
  }),
};
