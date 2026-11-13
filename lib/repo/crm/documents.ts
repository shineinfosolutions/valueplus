/**
 * Office documents, folders and the Onsitego price list (collections `stored_documents`, `document_folders`,
 * `onsitego_plans`). Mongo side copied verbatim from the routes / lib/onsitego-server.ts.
 */
import connectToDatabase from "@/lib/db";
import StoredDocument from "@/models/StoredDocument";
import DocumentFolder from "@/models/DocumentFolder";
import OnsitegoPlan from "@/models/OnsitegoPlan";
import type { D1DatabaseLike } from "@/lib/d1/types";
import { castObjectIdHex, loadLean, pick, resolveDb } from "./rebuild";

// ---------------------------------------------------------------------------
// GET /api/documents (folderId = the On Site Go folder for salesmen / cashiers, else every document)
// ---------------------------------------------------------------------------

export async function documentsListMongo({ folderId }: { folderId?: string | null }): Promise<any[]> {
  await connectToDatabase();
  const filter: any = {};
  if (folderId) filter.folderId = folderId;
  return StoredDocument.find(filter).sort({ date: -1, createdAt: -1 }).lean();
}

export async function documentsListD1({ folderId }: { folderId?: string | null }, db?: D1DatabaseLike): Promise<any[]> {
  return loadLean(resolveDb(db), "stored_documents", {
    where: folderId ? "folderId = ?" : undefined,
    args: folderId ? [folderId] : [],
    orderBy: "date DESC, createdAt DESC, id ASC",
  });
}

// ---------------------------------------------------------------------------
// GET /api/documents/file: StoredDocument.findById(id).lean()
// ---------------------------------------------------------------------------

export async function documentByIdMongo({ id }: { id: string }): Promise<any> {
  await connectToDatabase();
  return StoredDocument.findById(id).lean();
}

export async function documentByIdD1({ id }: { id: string }, db?: D1DatabaseLike): Promise<any> {
  if (id === null || id === undefined) return null;
  const hex = castObjectIdHex(id); // the cast Mongoose applies (throws for an invalid id, as findById does)
  const docs = await loadLean(resolveDb(db), "stored_documents", { where: "id = ?", args: [hex], limit: 1 });
  return docs[0] ?? null;
}

// ---------------------------------------------------------------------------
// GET /api/documents/folders: count in the On Site Go folder; count per folder; the folder list
// ---------------------------------------------------------------------------

export async function documentCountInFolderMongo({ folderId }: { folderId: string }): Promise<number> {
  await connectToDatabase();
  return StoredDocument.countDocuments({ folderId });
}

export async function documentCountInFolderD1({ folderId }: { folderId: string }, db?: D1DatabaseLike): Promise<number> {
  const r = await resolveDb(db).prepare("SELECT COUNT(*) AS n FROM storedDocuments WHERE folderId = ?").bind(folderId).first<any>();
  return Number(r?.n ?? 0);
}

/** `$group` output order is unspecified in Mongo; the route only builds a Map from it. */
export async function documentFolderCountsMongo(): Promise<any[]> {
  await connectToDatabase();
  return StoredDocument.aggregate([{ $group: { _id: "$folderId", count: { $sum: 1 } } }]);
}

export async function documentFolderCountsD1(_args?: unknown, db?: D1DatabaseLike): Promise<any[]> {
  const res = await resolveDb(db).prepare("SELECT folderId AS _id, COUNT(*) AS count FROM storedDocuments GROUP BY folderId").all<any>();
  return (res.results || []).map((r: any) => ({ _id: r._id ?? null, count: Number(r.count) }));
}

export async function documentFoldersListMongo(): Promise<any[]> {
  await connectToDatabase();
  return DocumentFolder.find({}).sort({ nameKey: 1 }).lean();
}

export async function documentFoldersListD1(_args?: unknown, db?: D1DatabaseLike): Promise<any[]> {
  return loadLean(resolveDb(db), "document_folders", { orderBy: "nameKey ASC, id ASC" });
}

// ---------------------------------------------------------------------------
// getOnsitegoFolder() (lib/onsitego-server.ts): the read part, DocumentFolder.findOne({ nameKey }).lean()
// (it creates the folder when missing; that write stays on Mongo, so null from D1 means "fall back")
// ---------------------------------------------------------------------------

export async function folderByNameKeyMongo({ nameKey }: { nameKey: string }): Promise<any> {
  await connectToDatabase();
  return DocumentFolder.findOne({ nameKey }).lean();
}

export async function folderByNameKeyD1({ nameKey }: { nameKey: string }, db?: D1DatabaseLike): Promise<any> {
  const docs = await loadLean(resolveDb(db), "document_folders", { where: "nameKey = ?", args: [nameKey], orderBy: "id ASC", limit: 1 });
  return docs[0] ?? null;
}

// ---------------------------------------------------------------------------
// GET /api/onsitego/plans
// ---------------------------------------------------------------------------

const PLAN_FIELDS = ["category", "device", "kind", "vpCode", "minPrice", "maxPrice", "planName", "years", "price", "sourceFileName", "createdAt"];

export async function onsitegoPlansMongo(): Promise<any[]> {
  await connectToDatabase();
  return OnsitegoPlan.find({}, { category: 1, device: 1, kind: 1, vpCode: 1, minPrice: 1, maxPrice: 1, planName: 1, years: 1, price: 1, sourceFileName: 1, createdAt: 1 })
    .sort({ minPrice: 1, price: 1 })
    .lean();
}

/** Ties (same minPrice and price) keep insertion order in Mongo's sort; D1 breaks them by id (insertion order). */
export async function onsitegoPlansD1(_args?: unknown, db?: D1DatabaseLike): Promise<any[]> {
  const docs = await loadLean(resolveDb(db), "onsitego_plans", { orderBy: "minPrice ASC, price ASC, id ASC" });
  return docs.map((d) => pick(d, PLAN_FIELDS));
}
