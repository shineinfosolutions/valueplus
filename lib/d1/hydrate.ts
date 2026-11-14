/**
 * The D1 twin of a NON-lean MongoDB read (`Model.find(...)` without `.lean()`).
 *
 * Why this exists: a mongoose document is not what is stored. When mongoose loads a document it HYDRATES it: every
 * schema path the stored copy lacks gets its schema default (BankAccount.ifsc "HDFC0000492", Estimate.advanceAmount
 * 0, Invoice.backdateStatus "", a boolean false, an array []), values are cast to the schema's types, and toJSON
 * leaves empty objects out. A row rebuilt from D1 is the STORED copy (a field that was never saved is NULL, so it
 * is left out), so without this step the D1 answer misses exactly the fields mongoose invents on load (the shadow
 * findings of 14 Nov: bankAccounts.list, estimates.list, cashRegister.cashInvoices).
 *
 * The fix is to do what mongoose does, with mongoose itself: `Model.hydrate(storedCopy)` builds the very document a
 * MongoDB read builds from the same stored copy (no database is touched). So defaults, casting, element defaults in
 * sub-document arrays and toJSON are the same by construction, and a schema change needs no change here.
 * lib/repo/crm does the same (hydrateAll); the staff area keeps a checked table instead (lib/repo/staff/meta.ts).
 *
 * The one thing D1 cannot say is whether a NULL column was absent or an explicit null in MongoDB. Absent is assumed
 * (what every document saved through the models has); an explicit null on a path with a default would read the
 * default from D1 and null from MongoDB, and the shadow comparison would show it.
 */
import type { Model } from "mongoose";

/** Each stored copy as the mongoose document a non-lean read gives (with the read's projection, if any). */
export function hydrateLikeMongoose(model: Model<any>, docs: any[], projection?: Record<string, 0 | 1>): any[] {
  return docs.map((d) => (projection ? (model as any).hydrate(d, projection) : model.hydrate(d)));
}
