/**
 * Older documents, as they really are in the live MongoDB: saved before some schema fields (or their defaults)
 * existed, so the stored copy lacks them. A NON-lean MongoDB read fills those defaults back in when mongoose loads
 * the document (BankAccount.branch "Kunraghat, Gorakhpur", Estimate.advanceAmount 0, Invoice.backdateStatus ""), a
 * lean read does not. The D1 twin of each read must give exactly the same (shadow findings of 14 Nov 2026).
 */
import mongoose from "mongoose";

/** Whether an answer holds mongoose documents (a non-lean read) rather than plain objects. */
export function holdsDocuments(v: any): boolean {
  if (v instanceof mongoose.Document) return true;
  if (Array.isArray(v)) return v.some((x) => x instanceof mongoose.Document);
  if (v && typeof v === "object") return Object.values(v).some((x) => Array.isArray(x) && x.some((y) => y instanceof mongoose.Document));
  return false;
}

/**
 * Every third document of each model (by _id) loses every top-level field with a scalar schema default (text,
 * number, date): the fields added to the schemas over time. Written raw, so mongoose adds nothing back, and
 * updatedAt is left as it was (the caller makes the copy job copy everything again, as its nightly repair would).
 * Left alone: booleans and arrays (an absent one reads false / [] from D1: the documented copy limit, the same for
 * the app), indexed fields and `status` (unsetting them changes which index MongoDB scans, so the natural order of
 * an unsorted read, which says nothing about D1). Returns the number of documents changed.
 */
export async function stripScalarDefaults(models: any[], every = 3): Promise<number> {
  let n = 0;
  for (const M of models) {
    const indexed = new Set<string>((M.schema.indexes() as any[]).flatMap(([keys]) => Object.keys(keys)));
    const paths = Object.keys(M.schema.paths).filter((p) => {
      const t = M.schema.paths[p];
      return (
        !p.includes(".") &&
        !["_id", "__v", "createdAt", "updatedAt", "status"].includes(p) &&
        !indexed.has(p) &&
        ["String", "Number", "Date"].includes(t.instance) &&
        t.defaultValue !== undefined &&
        // A function default (Date.now) gives a new value on every load, so two reads of a document lacking it
        // never agree, whichever database they read: nothing to compare.
        typeof t.defaultValue !== "function"
      );
    });
    if (!paths.length) continue;
    const all = await M.collection.find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).toArray();
    const ids = all.map((d: any) => d._id).filter((_: any, i: number) => i % every === 1);
    if (!ids.length) continue;
    const r = await M.collection.updateMany({ _id: { $in: ids } }, { $unset: Object.fromEntries(paths.map((p) => [p, ""])) });
    n += r.modifiedCount;
  }
  return n;
}
