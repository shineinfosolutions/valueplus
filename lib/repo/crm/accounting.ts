/**
 * Accounting (collections `accounts`, `journal_entries` + journalEntryLines). Mongo side copied verbatim from the
 * routes. The `gstr_reports` collection has no read in the app (see INVENTORY.md).
 */
import connectToDatabase from "@/lib/db";
import Account from "@/models/Account";
import JournalEntry from "@/models/JournalEntry";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { castObjectIdHex, hydrateAll, loadLean, resolveDb } from "./rebuild";

// GET /api/accounting/accounts
export async function accountsListMongo(): Promise<any[]> {
  await connectToDatabase();
  return Account.find({}).sort({ code: 1 });
}

export async function accountsListD1(_args?: unknown, db?: D1DatabaseLike): Promise<any[]> {
  return hydrateAll(Account, await loadLean(resolveDb(db), "accounts", { orderBy: "code ASC, id ASC" }));
}

// GET /api/accounting/journal[?accountId=]
export async function journalListMongo({ accountId }: { accountId?: string | null }): Promise<any[]> {
  await connectToDatabase();
  let query = {};
  if (accountId) {
    query = { "lines.accountId": accountId };
  }
  return JournalEntry.find(query).sort({ date: -1, createdAt: -1 });
}

/** `lines.accountId` is an ObjectId path: Mongoose casts the string (an invalid one throws), D1 holds the hex. */
export async function journalListD1({ accountId }: { accountId?: string | null }, db?: D1DatabaseLike): Promise<any[]> {
  const hex = accountId ? castObjectIdHex(accountId) : null;
  const docs = await loadLean(resolveDb(db), "journal_entries", {
    where: hex ? "EXISTS (SELECT 1 FROM journalEntryLines l WHERE l.entryId = journalEntries.id AND l.accountId = ?)" : undefined,
    args: hex ? [hex] : [],
    orderBy: "date DESC, createdAt DESC, id ASC",
  });
  return hydrateAll(JournalEntry, docs);
}
