import type { D1DatabaseLike } from "@/lib/d1/types";

/**
 * One read of the area: `mongo` runs the query exactly as the route / helper runs it today, `d1` returns the same
 * documents from D1. Both take the same `args`; `d1` also takes the database (default: the Worker's DB binding).
 */
export interface StockRead<A = any> {
  mongo: (args: A) => Promise<any>;
  d1: (args: A, db?: D1DatabaseLike | null) => Promise<any>;
}

export const read = <A>(r: StockRead<A>): StockRead<A> => r;
