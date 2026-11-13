/**
 * The one way a route or helper runs a SALES & MONEY read: through the `sales` read switch (feature flag
 * `read:sales`, lib/d1/read-source.ts), i.e.
 *
 *   readWithShadow("sales", name, () => SALES_READS[name].mongo(...args), (db) => SALES_READS[name].d1At(db, ...args),
 *                  { compare: SALES_COMPARE[name] })
 *
 * The Mongo side connects first, so in `d1` mode a route that reads only sales data needs no MongoDB connection for
 * this read. The Mongo side is exactly the query the route ran before (the registry's mongo function is that query,
 * moved). Callers must not change the returned value in place: in shadow mode it is compared after the response.
 */
import connectToDatabase from "@/lib/db";
import { readWithShadow } from "@/lib/d1/shadow";
import { SALES_READS } from "./registry";
import { SALES_COMPARE } from "./compare";

export function salesRead<T = any>(name: string, ...args: any[]): Promise<T> {
  const entry = SALES_READS[name];
  if (!entry) throw new Error(`unknown sales read ${name}`);
  return readWithShadow<T>(
    "sales",
    name,
    async () => {
      await connectToDatabase();
      return entry.mongo(...args);
    },
    (db) => entry.d1At(db, ...args),
    // mongoOnlyInD1: a read that decides a write keeps answering from MongoDB in d1 mode (registry.ts).
    { compare: SALES_COMPARE[name], mongoOnlyInD1: !!entry.mongoOnlyInD1 }
  );
}
