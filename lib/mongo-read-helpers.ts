/**
 * Small helpers for reading less from MongoDB without changing what a route returns.
 * Used by app/api/dashboard/stats/route.ts; tested in tests/mongo-read-helpers.test.ts.
 */

/** One key per stored _id, whatever its type, so a string _id never collides with an ObjectId. */
export const idKey = (id: any) => `${id?._bsontype === "ObjectId" ? "o" : typeof id}:${String(id)}`;

/**
 * Reads the complete documents for rows that were read with a projection, and returns a function that swaps a row
 * for its complete document. aggregate() is used because it sends the _id values exactly as stored; find() would
 * try to cast each one to an ObjectId and fail on any legacy string _id. A row whose document has gone in the
 * meantime is returned as it is.
 */
export async function loadComplete(model: any, rows: any[]): Promise<(row: any) => any> {
  return loadCompleteVia(rows, (ids) => model.aggregate([{ $match: { _id: { $in: ids } } }]));
}

/**
 * loadComplete with the read of the complete documents supplied by the caller (the dashboard reads them through the
 * D1 read switch). `readByIds` gets the distinct _id values exactly as the rows hold them. A document whose _id is
 * the 24-hex TEXT of a row's ObjectId (or the other way round: D1 gives every _id as text) also completes that
 * row, so a summary read and a complete read answered by different databases (one fell back to MongoDB) still pair
 * up; documents read from MongoDB for MongoDB rows always pair up on their exact key first, as before.
 */
export async function loadCompleteVia(rows: any[], readByIds: (ids: any[]) => Promise<any[]>): Promise<(row: any) => any> {
  const ids: any[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = idKey(r._id);
    if (!seen.has(k)) {
      seen.add(k);
      ids.push(r._id);
    }
  }
  if (ids.length === 0) return (row) => row;
  const docs: any[] = await readByIds(ids);
  const byId = new Map<string, any>(docs.map((d) => [idKey(d._id), d]));
  const byText = new Map<string, any>();
  for (const d of docs) if (!byText.has(String(d._id))) byText.set(String(d._id), d);
  return (row) => byId.get(idKey(row._id)) ?? byText.get(String(row._id)) ?? row;
}

/** MongoDB's sort order across value types (missing/null first, then numbers, strings, objects, arrays … dates). */
function bsonTypeRank(v: any): number {
  if (v === undefined || v === null) return 1;
  if (typeof v === "number") return 2;
  if (typeof v === "string") return 3;
  if (Array.isArray(v)) return 5;
  if (v?._bsontype === "ObjectId") return 7;
  if (typeof v === "boolean") return 8;
  if (v instanceof Date) return 9;
  return 4;
}

/** Compares two stored values the way a MongoDB ascending sort does (for the value types this app stores). */
export function compareLikeMongo(a: any, b: any): number {
  const ra = bsonTypeRank(a);
  const rb = bsonTypeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) return a - b;
  if (ra === 3) return a < b ? -1 : a > b ? 1 : 0;
  if (ra === 9) return a.getTime() - b.getTime();
  return 0;
}

/**
 * The order `.sort({ createdAt: -1 })` returns rows in, worked out from rows read in stored order. MongoDB sorts a
 * collection scan with a stable sort, so rows with the same createdAt keep their stored order — as they do here
 * (Array.prototype.sort is stable). Lets one read in stored order serve a list that used to be read sorted.
 */
export const newestFirst = <T>(rows: T[]): T[] =>
  [...rows].sort((a: any, b: any) => compareLikeMongo(b.createdAt, a.createdAt));

/** `{ field: { $ne: value } }` as MongoDB applies it to a stored value (an array is equal if any element is). */
export const notEqual = (stored: any, value: string) => (Array.isArray(stored) ? !stored.includes(value) : stored !== value);

/** Rows grouped by a key, each group keeping the rows' original order. */
export function groupRows<T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = keyOf(row);
    const g = groups.get(k);
    if (g) g.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}
