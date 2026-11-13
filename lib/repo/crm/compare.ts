/**
 * How the shadow comparison (lib/d1/compare.ts) treats each CRM / documents / accounting read, and WHY. The routes
 * pass the matching entry to readWithShadow (through crmRead in lib/repo/crm/shadow.ts); the wiring test uses the
 * same entries.
 *
 * Only what the copy forces (lib/repo/crm/INVENTORY.md, "Known differences"):
 *  - sorted lists: `tieOrder` on the sort key (documents with an equal key have no defined order in MongoDB; the key
 *    sequence itself must match exactly);
 *  - reads with no sort (`find().limit(5)`, the overview list, the `$group` counts): compared as sets;
 *  - `__v`: `0` equals absent (D1's `v` is NOT NULL DEFAULT 0; a legacy document without __v reads 0).
 * Nothing else is ignored. A null and a missing field are already the same to the comparator.
 */
import type { CompareOptions } from "@/lib/d1/compare";

type Key = (d: any) => unknown;
const k = (...fields: string[]): Key => (d: any) => fields.map((f) => d?.[f] ?? null);

function sorted(path: string, key: Key, docs = true): CompareOptions {
  const p = path ? `${path}[]` : "[]";
  return { tieOrder: [{ path, key }], ...(docs ? { defaultsWhenMissing: { [`${p}.__v`]: 0 } } : {}) };
}
const unordered = (docs = true): CompareOptions => ({ unorderedPaths: [""], ...(docs ? { defaultsWhenMissing: { "[].__v": 0 } } : {}) });
const oneDoc: CompareOptions = { defaultsWhenMissing: { __v: 0 } };
const byCreatedAt = k("createdAt");

export const CRM_COMPARE: Record<string, CompareOptions> = {
  "leads.list": sorted("", byCreatedAt),
  "leads.shareInbox": sorted("", k("updatedAt")),
  /** find(...).limit(5) without sort. */
  "leads.search": unordered(),
  /** find({}, projection) without sort, no __v in the projection. */
  "leads.staffOverview": unordered(false),
  "walkIn.list": sorted("", byCreatedAt),
  "complaints.list": sorted("", byCreatedAt),
  /** [rows, pending, sent, failed]: "[]" reaches the rows (the only array element that is an array). */
  "whatsapp.outbox": sorted("[]", byCreatedAt),
  "whatsapp.settings": oneDoc,
  "whatsapp.settingsWithToken": oneDoc,
  "documents.list": sorted("", k("date", "createdAt")),
  "documents.byId": oneDoc,
  "documents.countInFolder": {},
  /** $group output order is not defined. */
  "documents.folderCounts": unordered(false),
  "documentFolders.list": sorted("", k("nameKey")),
  "documentFolders.byNameKey": oneDoc,
  /** Projection without __v. */
  "onsitego.plans": sorted("", k("minPrice", "price"), false),
  "accounts.list": sorted("", k("code")),
  "journal.list": sorted("", k("date", "createdAt")),
};
